package app.devlink;

import android.content.Context;

import net.schmizz.keepalive.KeepAliveProvider;
import net.schmizz.sshj.DefaultConfig;
import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.connection.channel.direct.Session;
import net.schmizz.sshj.transport.verification.HostKeyVerifier;
import net.schmizz.sshj.userauth.keyprovider.KeyProvider;
import net.schmizz.sshj.userauth.password.PasswordFinder;
import net.schmizz.sshj.userauth.password.PasswordUtils;

import org.bouncycastle.jce.provider.BouncyCastleProvider;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.Security;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Một kết nối SSH dùng chung cho cả app. Mọi lệnh chạy qua `sh -c`, tệp truyền bằng `cat`/`tar` nên đầu xe không cần SFTP. */
final class Ssh {
    private Ssh() {}

    interface Out { void chunk(String s); }

    interface Prog { void on(long bytes); }

    static final class Cancelled extends IOException {
        Cancelled() { super("Đã dừng"); }
    }

    /** một việc đang chạy, để bấm Dừng được */
    static final class Job {
        volatile boolean stopped;
        private volatile Session sess;

        void cancel() {
            stopped = true;
            Session s = sess;
            if (s != null) {
                try {
                    s.close();
                } catch (Exception e) {
                    // bỏ qua
                }
            }
        }
    }

    static final class Res {
        String out = "";
        String err = "";
        int code;
    }

    private static final Object LOCK = new Object();
    private static SSHClient cli;
    private static String banner = "";
    private static String who = "";
    private static boolean providerDone;

    private static void ensureProvider() {
        if (providerDone) return;
        // Android có sẵn một bản BC rút gọn tên "BC": thay bằng bản đầy đủ để có ed25519/curve25519/chacha20
        Security.removeProvider("BC");
        Security.insertProviderAt(new BouncyCastleProvider(), 1);
        providerDone = true;
    }

    static boolean up() {
        synchronized (LOCK) {
            return cli != null && cli.isConnected() && cli.isAuthenticated();
        }
    }

    static String banner() { synchronized (LOCK) { return banner; } }
    static String who() { synchronized (LOCK) { return who; } }

    static void ensure(Context ctx, Store st) throws Exception {
        if (up()) return;
        synchronized (CONNECT_LOCK) {
            if (up()) return; // luồng khác vừa nối xong
            connect(ctx, st);
        }
    }

    static void disconnect() {
        synchronized (LOCK) {
            if (cli != null) {
                try {
                    cli.disconnect();
                } catch (Exception e) {
                    // bỏ qua
                }
                try {
                    cli.close();
                } catch (Exception e) {
                    // bỏ qua
                }
            }
            cli = null;
            banner = "";
            who = "";
        }
    }

    private static void markDown() {
        disconnect();
    }

    private static final Object CONNECT_LOCK = new Object();

    static void connect(Context ctx, final Store st) throws Exception {
        synchronized (CONNECT_LOCK) {
            disconnect();
            ensureProvider();
            final String host = st.host();
            final int port = st.port();
            final String user = st.user();
            Net.bindFor(ctx, host);

            DefaultConfig cfg = new DefaultConfig();
            cfg.setKeepAliveProvider(KeepAliveProvider.KEEP_ALIVE);
            SSHClient c = new SSHClient(cfg);
            final String hk = host + ":" + port;
            final String[] changed = new String[1];
            c.addHostKeyVerifier(new HostKeyVerifier() {
                @Override
                public boolean verify(String h, int p, PublicKey k) {
                    String fp = Util.fingerprint(k.getEncoded());
                    String old = st.known(hk);
                    if (old == null) {
                        st.known(hk, fp);
                        return true;
                    }
                    if (old.equals(fp)) return true;
                    changed[0] = fp;
                    return false;
                }

                @Override
                public List<String> findExistingAlgorithms(String h, int p) {
                    return Collections.emptyList();
                }
            });
            c.setConnectTimeout(8000);
            try {
                c.connect(host, port);
                c.getConnection().getKeepAlive().setKeepAliveInterval(15);
                String key = st.key();
                String pass = st.pass();
                String pw = st.password();
                if (!key.isEmpty()) {
                    PasswordFinder pf = pass.isEmpty() ? null : PasswordUtils.createOneOff(pass.toCharArray());
                    KeyProvider kp = c.loadKeys(key, (String) null, pf);
                    c.authPublickey(user, kp);
                } else if (!pw.isEmpty()) {
                    c.authPassword(user, pw);
                } else {
                    throw new IllegalStateException("Chưa có khóa riêng hoặc mật khẩu. Dán khóa ở mục Kết nối.");
                }
            } catch (Exception e) {
                try {
                    c.close();
                } catch (Exception x) {
                    // bỏ qua
                }
                if (changed[0] != null) throw new Util.HostKeyChanged(hk, changed[0]);
                throw e;
            }
            String sv = "";
            try {
                sv = c.getTransport().getServerVersion();
            } catch (Exception e) {
                // không có thì thôi
            }
            synchronized (LOCK) {
                cli = c;
                banner = sv == null ? "" : sv;
                who = user + "@" + host + (port == 22 ? "" : ":" + port);
            }
        }
    }

    private static Session open() throws Exception {
        SSHClient c;
        synchronized (LOCK) {
            c = cli;
        }
        if (c == null) throw new IllegalStateException("Chưa kết nối. Vào mục Kết nối.");
        try {
            return c.startSession();
        } catch (Exception e) {
            markDown();
            throw e;
        }
    }

    private static void pump(InputStream is, Out out) {
        try {
            Reader r = new InputStreamReader(is, StandardCharsets.UTF_8);
            char[] b = new char[4096];
            int n;
            while ((n = r.read(b)) != -1) {
                if (n > 0) out.chunk(new String(b, 0, n));
            }
        } catch (Exception e) {
            // luồng đã đóng
        }
    }

    /** chạy một script, kết quả (cả lỗi) đổ dần vào out. Trả về mã thoát, -999 nếu bị dừng. */
    static int run(String script, final Out out, Job job) throws Exception {
        if (script.length() > 120000) throw new IllegalStateException("Lệnh dài quá 120 KB. Hãy tải lên thành file rồi chạy.");
        Session s = open();
        job.sess = s;
        try {
            final Session.Command cmd = s.exec("sh -c " + Util.sq(Util.PRE + script));
            try {
                cmd.getOutputStream().close(); // stdin rỗng: lệnh nào đọc stdin sẽ không treo
            } catch (Exception e) {
                // bỏ qua
            }
            Thread te = new Thread(new Runnable() {
                @Override
                public void run() {
                    pump(cmd.getErrorStream(), out);
                }
            });
            te.setDaemon(true);
            te.start();
            pump(cmd.getInputStream(), out);
            te.join(3000);
            try {
                cmd.join(5, TimeUnit.SECONDS);
            } catch (Exception e) {
                // bỏ qua
            }
            if (job.stopped) return -999;
            Integer st = cmd.getExitStatus();
            return st == null ? -1 : st;
        } finally {
            job.sess = null;
            try {
                s.close();
            } catch (Exception e) {
                // bỏ qua
            }
        }
    }

    private static Thread drain(final InputStream is, final StringBuilder sb) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Reader r = new InputStreamReader(is, StandardCharsets.UTF_8);
                    char[] b = new char[2048];
                    int n;
                    while ((n = r.read(b)) != -1) {
                        synchronized (sb) {
                            if (sb.length() < 200000) sb.append(b, 0, n);
                        }
                    }
                } catch (Exception e) {
                    // đóng
                }
            }
        });
        t.setDaemon(true);
        t.start();
        return t;
    }

    /** chạy script nhỏ và lấy kết quả (dùng cho danh sách thư mục, xóa, chmod...) */
    static Res capture(String script) throws Exception {
        Session s = open();
        try {
            final Session.Command cmd = s.exec("sh -c " + Util.sq(Util.PRE + script));
            try {
                cmd.getOutputStream().close();
            } catch (Exception e) {
                // bỏ qua
            }
            StringBuilder o = new StringBuilder();
            StringBuilder e = new StringBuilder();
            Thread t1 = drain(cmd.getInputStream(), o);
            Thread t2 = drain(cmd.getErrorStream(), e);
            t1.join(60000);
            t2.join(3000);
            try {
                cmd.join(5, TimeUnit.SECONDS);
            } catch (Exception x) {
                // bỏ qua
            }
            Res r = new Res();
            synchronized (o) {
                r.out = o.toString();
            }
            synchronized (e) {
                r.err = e.toString();
            }
            Integer st = cmd.getExitStatus();
            r.code = st == null ? -1 : st;
            return r;
        } finally {
            try {
                s.close();
            } catch (Exception x) {
                // bỏ qua
            }
        }
    }

    /** chạy lệnh trên máy và ghi nguyên văn stdout (nhị phân) vào `to`: dùng cho `cat file` và `tar cf - dir` */
    static long pull(String command, OutputStream to, Prog p, Job job) throws Exception {
        Session s = open();
        job.sess = s;
        try {
            final Session.Command cmd = s.exec("sh -c " + Util.sq(Util.PRE + command));
            try {
                cmd.getOutputStream().close();
            } catch (Exception e) {
                // bỏ qua
            }
            StringBuilder err = new StringBuilder();
            drain(cmd.getErrorStream(), err);
            InputStream is = cmd.getInputStream();
            byte[] buf = new byte[65536];
            long total = 0, lastTick = 0;
            try {
                int n;
                while ((n = is.read(buf)) != -1) {
                    if (job.stopped) throw new Cancelled();
                    to.write(buf, 0, n);
                    total += n;
                    long now = System.currentTimeMillis();
                    if (p != null && now - lastTick > 200) {
                        lastTick = now;
                        p.on(total);
                    }
                }
            } catch (IOException e) {
                if (job.stopped) throw new Cancelled();
                throw e;
            }
            if (job.stopped) throw new Cancelled();
            try {
                cmd.join(10, TimeUnit.SECONDS);
            } catch (Exception e) {
                // bỏ qua
            }
            Integer st = cmd.getExitStatus();
            if (st != null && st != 0) {
                String m;
                synchronized (err) {
                    m = err.toString().trim();
                }
                throw new IOException("Máy báo lỗi (mã " + st + ")" + (m.isEmpty() ? "" : ": " + m));
            }
            if (p != null) p.on(total);
            return total;
        } finally {
            job.sess = null;
            try {
                s.close();
            } catch (Exception e) {
                // bỏ qua
            }
        }
    }

    /** ghi dữ liệu từ `in` vào tệp trên máy bằng `cat > tệp` */
    static long push(InputStream in, String remote, boolean exec, Prog p, Job job) throws Exception {
        Session s = open();
        job.sess = s;
        long total = 0;
        try {
            final Session.Command cmd = s.exec("sh -c " + Util.sq(Util.PRE + "cat > " + Util.sq(remote)));
            StringBuilder err = new StringBuilder();
            drain(cmd.getErrorStream(), err);
            drain(cmd.getInputStream(), new StringBuilder());
            OutputStream os = cmd.getOutputStream();
            byte[] buf = new byte[32768];
            long lastTick = 0;
            try {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (job.stopped) throw new Cancelled();
                    os.write(buf, 0, n);
                    total += n;
                    long now = System.currentTimeMillis();
                    if (p != null && now - lastTick > 200) {
                        lastTick = now;
                        p.on(total);
                    }
                }
                os.flush();
                os.close();
            } catch (IOException e) {
                if (job.stopped) throw new Cancelled();
                throw e;
            }
            try {
                cmd.join(60, TimeUnit.SECONDS);
            } catch (Exception e) {
                // bỏ qua
            }
            Integer st = cmd.getExitStatus();
            if (st == null || st != 0) {
                String m;
                synchronized (err) {
                    m = err.toString().trim();
                }
                throw new IOException("Máy không ghi được tệp (mã " + st + ")" + (m.isEmpty() ? "" : ": " + m));
            }
        } finally {
            job.sess = null;
            try {
                s.close();
            } catch (Exception e) {
                // bỏ qua
            }
        }
        if (exec) capture("chmod +x " + Util.sq(remote));
        if (p != null) p.on(total);
        return total;
    }
}
