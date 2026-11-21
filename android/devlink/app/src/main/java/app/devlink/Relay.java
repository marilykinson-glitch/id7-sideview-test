package app.devlink;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Chế độ "Claude điều khiển": điện thoại hỏi nhánh GitHub (qua 4G), chạy lệnh Claude để lại trên đầu xe
 * qua SSH rồi ghi kết quả lên lại.
 *
 * Kênh (trên nhánh relay):
 *   cmd/<id>.sh    lệnh Claude gửi. Dòng đầu có thể là chỉ thị: #@timeout 300, #@pull /đường/dẫn, #@put /đích đường/dẫn/trong/repo [x]
 *   out/<id>.txt   kết quả (ghi "đang chạy" trước khi chạy để mỗi lệnh chỉ chạy một lần)
 *   files/<id>/... tệp tải về từ đầu xe
 *   status.json    nhịp tim của điện thoại
 */
final class Relay {
    private Relay() {}

    private static final long CAP_FILE = 25L * 1024 * 1024;
    private static final int CAP_TEXT = 400000;

    private static volatile boolean running;
    private static Thread th;
    private static ConnectivityManager.NetworkCallback cb;
    private static volatile Network cell;
    private static volatile Ssh.Job cur;
    private static final StringBuilder LOG = new StringBuilder();
    private static final ScheduledExecutorService TIMER = Executors.newSingleThreadScheduledExecutor();
    private static final HashSet<String> handled = new HashSet<>();
    private static final HashMap<String, Object[]> unsent = new HashMap<>();
    private static String statusSha;
    private static long lastBeat;
    private static String lastLastId = "";

    static boolean running() {
        return running;
    }

    static synchronized void log(String s) {
        LOG.append(new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date())).append("  ").append(s).append('\n');
        if (LOG.length() > 30000) LOG.delete(0, LOG.length() - 24000);
    }

    static synchronized String logText() {
        return LOG.toString();
    }

    static synchronized void start(final Context ctx, final Store st) {
        if (running) return;
        running = true;
        final Context app = ctx.getApplicationContext();
        ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        try {
            cb = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network n) {
                    cell = n;
                }

                @Override
                public void onLost(Network n) {
                    if (n.equals(cell)) cell = null;
                }
            };
            cm.requestNetwork(new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR).build(), cb);
        } catch (Throwable e) {
            cb = null;
        }
        log("Bật chế độ Claude điều khiển");
        th = new Thread(new Runnable() {
            @Override
            public void run() {
                loop(app, st);
            }
        }, "relay");
        th.setDaemon(true);
        th.start();
    }

    static synchronized void stop(Context ctx) {
        if (!running) return;
        running = false;
        Ssh.Job j = cur;
        if (j != null) j.cancel();
        if (th != null) th.interrupt();
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cb != null) cm.unregisterNetworkCallback(cb);
        } catch (Throwable e) {
            // bỏ qua
        }
        cb = null;
        cell = null;
        log("Đã tắt chế độ Claude điều khiển");
    }

    private static Network pickNet(Context app) {
        Network c = cell;
        if (c != null) return c;
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return n;
            }
        } catch (Throwable e) {
            // dùng mạng mặc định
        }
        return null;
    }

    private static void loop(Context app, Store st) {
        Gh gh = null;
        boolean checked = false;
        int fail = 0;
        String lastErr = "";
        while (running) {
            try {
                String repo = st.relayRepo().trim(), br = st.relayBranch().trim(), tok = st.relayToken().trim();
                if (repo.isEmpty() || br.isEmpty() || tok.isEmpty()) {
                    if (!"cfg".equals(lastErr)) log("Thiếu repo, nhánh hoặc token. Điền trong mục Claude.");
                    lastErr = "cfg";
                    Thread.sleep(5000);
                    continue;
                }
                if (gh == null || !gh.same(repo, br, tok)) {
                    gh = new Gh(repo, br, tok);
                    checked = false;
                }
                gh.setNet(pickNet(app));
                if (!checked) {
                    gh.check();
                    checked = true;
                    log("Đã nối GitHub: " + repo + " nhánh " + br);
                    lastBeat = 0;
                }
                poll(app, st, gh);
                beat(gh);
                fail = 0;
                lastErr = "";
                Thread.sleep(4000);
            } catch (InterruptedException e) {
                break;
            } catch (Throwable e) {
                fail++;
                String m = Util.friendly(e);
                if (!m.equals(lastErr)) log("Lỗi: " + m);
                lastErr = m;
                if (e instanceof IllegalStateException) checked = false;
                try {
                    Thread.sleep(Math.min(30000, 4000L * fail));
                } catch (InterruptedException ie) {
                    break;
                }
            }
        }
    }

    private static void beat(Gh gh) {
        long now = System.currentTimeMillis();
        if (now - lastBeat < 120000) return;
        lastBeat = now;
        try {
            String js = "{\"t\":\"" + new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).format(new Date())
                + "\",\"ssh\":" + Ssh.up() + ",\"who\":" + org.json.JSONObject.quote(Ssh.up() ? Ssh.who() : "")
                + ",\"last\":" + org.json.JSONObject.quote(lastLastId) + ",\"app\":\"1.1.0\"}";
            String sha = gh.put("status.json", js.getBytes(StandardCharsets.UTF_8), statusSha);
            if (sha != null) statusSha = sha;
        } catch (Throwable e) {
            // nhịp tim hỏng không quan trọng
        }
    }

    private static void poll(Context app, Store st, Gh gh) throws Exception {
        // gửi lại kết quả chưa lên được
        for (String id : new ArrayList<>(unsent.keySet())) {
            Object[] u = unsent.get(id);
            gh.put("out/" + id + ".txt", (byte[]) u[0], (String) u[1]);
            unsent.remove(id);
            log("Đã gửi lại kết quả " + id);
        }
        List<String> cmds = gh.list("cmd");
        if (cmds.isEmpty()) return;
        HashSet<String> outs = new HashSet<>(gh.list("out"));
        ArrayList<String> pend = new ArrayList<>();
        for (String n : cmds) {
            if (!n.endsWith(".sh")) continue;
            String id = n.substring(0, n.length() - 3);
            if (outs.contains(id + ".txt") || handled.contains(id)) continue;
            pend.add(id);
        }
        Collections.sort(pend);
        for (String id : pend) {
            if (!running) return;
            handle(app, st, gh, id);
        }
    }

    private static final class Cap extends OutputStream {
        final ByteArrayOutputStream bo = new ByteArrayOutputStream();

        @Override
        public void write(int b) throws IOException {
            if (bo.size() + 1 > CAP_FILE) throw new IOException("Tệp lớn hơn 25 MB, không gửi qua GitHub được");
            bo.write(b);
        }

        @Override
        public void write(byte[] b, int o, int l) throws IOException {
            if (bo.size() + (long) l > CAP_FILE) throw new IOException("Tệp lớn hơn 25 MB, không gửi qua GitHub được");
            bo.write(b, o, l);
        }
    }

    private static void handle(Context app, Store st, Gh gh, final String id) throws Exception {
        final String outPath = "out/" + id + ".txt";
        log("Nhận lệnh " + id);
        // đánh dấu đã nhận trước khi chạy: mỗi lệnh chỉ chạy tối đa một lần
        String sha = gh.put(outPath, ("# đang chạy từ " + new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()) + "\n").getBytes(StandardCharsets.UTF_8), null);
        handled.add(id);
        lastLastId = id;

        String text = gh.readText("cmd/" + id + ".sh").replace("\r", "");
        int timeout = 120;
        ArrayList<String> pulls = new ArrayList<>();
        ArrayList<String> puts = new ArrayList<>();
        StringBuilder script = new StringBuilder();
        for (String line : text.split("\n", -1)) {
            if (line.startsWith("#@timeout ")) {
                try {
                    timeout = Math.max(5, Math.min(1800, Integer.parseInt(line.substring(10).trim())));
                } catch (Exception e) {
                    // giữ mặc định
                }
            } else if (line.startsWith("#@pull ")) pulls.add(line.substring(7).trim());
            else if (line.startsWith("#@put ")) puts.add(line.substring(6).trim());
            else script.append(line).append('\n');
        }

        final StringBuilder res = new StringBuilder();
        final boolean[] trunc = new boolean[1];
        Ssh.Out sink = new Ssh.Out() {
            @Override
            public void chunk(String s) {
                synchronized (res) {
                    res.append(s);
                    if (res.length() > CAP_TEXT) {
                        res.delete(0, res.length() - CAP_TEXT + 50000);
                        trunc[0] = true;
                    }
                }
            }
        };
        final Ssh.Job job = new Ssh.Job();
        cur = job;
        final boolean[] timedOut = new boolean[1];
        ScheduledFuture<?> f = TIMER.schedule(new Runnable() {
            @Override
            public void run() {
                timedOut[0] = true;
                job.cancel();
            }
        }, timeout, TimeUnit.SECONDS);
        long t0 = System.currentTimeMillis();
        int rc = 0;
        String err = null;
        try {
            Ssh.ensure(app, st);
            for (String pu : puts) {
                String[] w = pu.split("\\s+");
                if (w.length < 2) throw new IllegalStateException("#@put cần: đường-dẫn-trên-xe đường-dẫn-trong-repo [x]");
                byte[] d = gh.readBytes(w[1], CAP_FILE);
                Ssh.push(new ByteArrayInputStream(d), w[0], w.length > 2 && w[2].equals("x"), null, job);
                sink.chunk("[put] " + w[0] + " " + d.length + " byte\n");
            }
            if (script.toString().trim().length() > 0) rc = Ssh.run(script.toString(), sink, job);
            for (String pl : pulls) {
                Cap cap = new Cap();
                Ssh.pull("cat " + Util.sq(pl), cap, null, job);
                byte[] d = cap.bo.toByteArray();
                gh.put("files/" + id + "/" + Util.base(pl), d, null);
                sink.chunk("[pull] " + pl + " -> files/" + id + "/" + Util.base(pl) + " (" + d.length + " byte)\n");
            }
        } catch (Util.HostKeyChanged hk) {
            err = "khóa nhận dạng của đầu xe đã đổi, mở app, mục Kết nối để tin lại";
        } catch (Ssh.Cancelled c) {
            err = timedOut[0] ? "hết thời gian " + timeout + " giây" : "bị dừng";
        } catch (Throwable e) {
            err = Util.friendly(e);
        } finally {
            f.cancel(false);
            cur = null;
        }
        if (rc == -999 && err == null) err = timedOut[0] ? "hết thời gian " + timeout + " giây" : "bị dừng";
        double sec = (System.currentTimeMillis() - t0) / 1000.0;
        StringBuilder o = new StringBuilder();
        o.append("# rc=").append(rc == -999 ? "-" : String.valueOf(rc)).append(" sec=").append(String.format(Locale.US, "%.1f", sec));
        if (Ssh.up()) o.append(" host=").append(Ssh.who());
        if (err != null) o.append("\n# lỗi: ").append(err);
        if (trunc[0]) o.append("\n# (kết quả dài, đã cắt phần đầu)");
        o.append("\n\n");
        synchronized (res) {
            o.append(res);
        }
        byte[] data = o.toString().getBytes(StandardCharsets.UTF_8);
        try {
            gh.put(outPath, data, sha);
            log("Xong " + id + (err != null ? " (" + err + ")" : ", rc=" + rc));
        } catch (Throwable e) {
            unsent.put(id, new Object[]{data, sha});
            log("Chưa gửi được kết quả " + id + ", sẽ thử lại: " + Util.friendly(e));
        }
    }
}
