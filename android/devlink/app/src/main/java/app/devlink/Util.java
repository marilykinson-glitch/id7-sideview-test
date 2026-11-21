package app.devlink;

import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;

/** Phần logic thuần (không phụ thuộc Android) để kiểm thử được trên máy tính. */
final class Util {
    private Util() {}

    /** thêm vào đầu mọi script chạy trên đầu xe: exec của SSH thường có PATH rất ngắn */
    static final String PRE = "PATH=\"$PATH:/usr/local/bin:/usr/sbin:/sbin:/opt/bin:/opt/sbin\"; export PATH\n";

    /** bọc chuỗi vào nháy đơn cho shell */
    static String sq(String s) {
        return "'" + s.replace("'", "'\\''") + "'";
    }

    static String normText(String s) {
        if (s == null) return "";
        return s.replace("\r\n", "\n").replace('\r', '\n');
    }

    /** khóa dán từ Windows hay có \r\n và khoảng trắng thừa */
    static String normKey(String k) {
        String t = normText(k).trim();
        return t.isEmpty() ? "" : t + "\n";
    }

    static boolean looksLikeKey(String k) {
        return k != null && (k.contains("PRIVATE KEY") || k.contains("PuTTY-User-Key-File"));
    }

    static String human(long n) {
        if (n < 0) return "?";
        if (n < 1024) return n + " B";
        double v = n;
        String[] u = {"KB", "MB", "GB", "TB"};
        int i = -1;
        do {
            v /= 1024;
            i++;
        } while (v >= 1024 && i < u.length - 1);
        return String.format(Locale.US, v >= 100 ? "%.0f %s" : "%.1f %s", v, u[i]);
    }

    static String cleanPath(String p) {
        if (p == null) return "/";
        p = p.trim();
        if (p.isEmpty()) return "/";
        if (!p.startsWith("/")) p = "/" + p;
        ArrayList<String> st = new ArrayList<>();
        for (String part : p.split("/")) {
            if (part.isEmpty() || part.equals(".")) continue;
            if (part.equals("..")) {
                if (!st.isEmpty()) st.remove(st.size() - 1);
                continue;
            }
            st.add(part);
        }
        StringBuilder b = new StringBuilder();
        for (String s : st) b.append('/').append(s);
        return b.length() == 0 ? "/" : b.toString();
    }

    static String parent(String p) {
        p = cleanPath(p);
        int i = p.lastIndexOf('/');
        return i <= 0 ? "/" : p.substring(0, i);
    }

    static String join(String dir, String name) {
        return dir.equals("/") ? "/" + name : dir + "/" + name;
    }

    static String base(String p) {
        p = cleanPath(p);
        return p.substring(p.lastIndexOf('/') + 1);
    }

    // ---- danh sách thư mục ----

    static final class Entry {
        final char type; // d thư mục, f tệp, l liên kết
        final long size;
        final String name;

        Entry(char type, long size, String name) {
            this.type = type;
            this.size = size;
            this.name = name;
        }
    }

    static final class Listing {
        char kind = 'N'; // D thư mục, F tệp, N không có
        long fileSize = -1;
        final ArrayList<Entry> items = new ArrayList<>();
    }

    /** script liệt kê: dòng đầu D/F/N, rồi mỗi dòng "loại<TAB>cỡ<TAB>tên" (chạy được trên busybox) */
    static String listScript(String dir) {
        return "p=" + sq(dir) + "\n"
            + "if [ -d \"$p\" ]; then echo D; cd \"$p\" || exit 0\n"
            + "for f in .[!.]* ..?* *; do\n"
            + "  [ -e \"$f\" ] || [ -L \"$f\" ] || continue\n"
            + "  if [ -d \"$f\" ]; then t=d; elif [ -L \"$f\" ]; then t=l; else t=f; fi\n"
            + "  s=$(stat -c %s \"$f\" 2>/dev/null) || s=-1\n"
            + "  printf '%s\\t%s\\t%s\\n' \"$t\" \"$s\" \"$f\"\n"
            + "done | head -3000\n"
            + "elif [ -e \"$p\" ]; then echo F; stat -c %s \"$p\" 2>/dev/null\n"
            + "else echo N; fi\n";
    }

    static Listing parseListing(String out) {
        Listing l = new Listing();
        String[] lines = normText(out).split("\n");
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            if (i == 0) {
                String k = line.trim();
                if (!k.isEmpty()) l.kind = k.charAt(0);
                continue;
            }
            if (l.kind == 'F') {
                try {
                    l.fileSize = Long.parseLong(line.trim());
                } catch (Exception e) {
                    // bỏ qua
                }
                break;
            }
            if (l.kind != 'D' || line.isEmpty()) continue;
            String[] f = line.split("\t", 3);
            if (f.length < 3) continue;
            long sz = -1;
            try {
                sz = Long.parseLong(f[1].trim());
            } catch (Exception e) {
                // cỡ không rõ
            }
            l.items.add(new Entry(f[0].isEmpty() ? 'f' : f[0].charAt(0), sz, f[2]));
        }
        Collections.sort(l.items, (a, b) -> {
            boolean da = a.type == 'd', db = b.type == 'd';
            if (da != db) return da ? -1 : 1;
            return a.name.compareToIgnoreCase(b.name);
        });
        return l;
    }

    // ---- quét ----

    /** mỗi dòng là một lệnh: in "$ lệnh", chạy (gộp lỗi vào kết quả), rồi một dòng trống */
    static String scanScript(String[] cmds) {
        StringBuilder b = new StringBuilder();
        for (String c : cmds) {
            b.append("echo ").append(sq("$ " + c)).append("\n");
            b.append("{ ").append(c).append("\n} 2>&1\n");
            b.append("echo\n");
        }
        return b.toString();
    }

    static String stamp(Date d) {
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(d);
    }

    static String stampNice(Date d) {
        return new SimpleDateFormat("dd/MM/yyyy HH:mm:ss", Locale.US).format(d);
    }

    static String fingerprint(byte[] key) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(key);
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < d.length; i++) {
                if (i > 0) s.append(':');
                s.append(String.format(Locale.US, "%02x", d[i] & 255));
            }
            return s.toString();
        } catch (Exception e) {
            return "?";
        }
    }

    // ---- lỗi ----

    static final class HostKeyChanged extends Exception {
        final String hostKey;
        final String fingerprint;

        HostKeyChanged(String hostKey, String fingerprint) {
            super("HOSTKEY_CHANGED");
            this.hostKey = hostKey;
            this.fingerprint = fingerprint;
        }
    }

    static String friendly(Throwable t) {
        if (t == null) return "Lỗi không rõ";
        if (t instanceof IllegalStateException && t.getMessage() != null) return t.getMessage();
        Throwable r = t;
        int guard = 0;
        while (r.getCause() != null && r.getCause() != r && guard++ < 8) r = r.getCause();
        String all = (t.getClass().getName() + " " + t.getMessage() + " " + r.getClass().getName() + " " + r.getMessage())
            .toLowerCase(Locale.ROOT);
        if (all.contains("userauth") || all.contains("exhausted available authentication") || all.contains("auth fail"))
            return "Máy không nhận khóa (hoặc mật khẩu) này. Kiểm tra lại khóa riêng, tên người dùng và mật khẩu của khóa.";
        if (all.contains("connection refused"))
            return "Máy từ chối kết nối: SSH chưa chạy hoặc sai cổng.";
        if (all.contains("timed out") || all.contains("sockettimeout"))
            return "Hết thời gian chờ: IP sai, máy chưa bật hoặc điện thoại không cùng mạng với máy.";
        if (all.contains("unreachable") || all.contains("no route"))
            return "Điện thoại không có đường tới IP này. Nối Wi-Fi cùng mạng với máy rồi thử lại.";
        if (all.contains("unknownhost") || all.contains("unable to resolve"))
            return "Không tìm ra tên máy này. Nhập IP thay vì tên.";
        if (all.contains("connection reset") || all.contains("broken pipe") || all.contains("eof") || all.contains("disconnect"))
            return "Kết nối bị ngắt giữa chừng. Bấm lại để kết nối lại.";
        String m = t.getMessage();
        return (m == null || m.isEmpty()) ? t.getClass().getSimpleName() : m;
    }
}
