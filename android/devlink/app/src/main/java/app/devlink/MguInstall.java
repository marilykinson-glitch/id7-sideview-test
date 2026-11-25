package app.devlink;

import android.content.Context;
import android.net.Network;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Cài / cập nhật mgu-store lên đầu máy NGAY TỪ ĐIỆN THOẠI, không cần PC.
 * Làm đúng như `mgu-install.js first-install` của bản Windows, viết lại bằng Java:
 *   1) Tải catalog.json của robertnisipeanu/mgu-store (qua mạng internet của điện thoại).
 *   2) Tải từng gói component (.tgz), kiểm size + sha256.
 *   3) Dựng một tar.gz trong RAM: file của mgu-deploy ở gốc + artifacts/ (bắt buộc)
 *      + with/ (tùy chọn: renderer, uplink) + run.sh.
 *   4) Đẩy tar.gz qua SSH vào `tar -xzf -` rồi chạy run.sh trên đầu máy.
 * Phần seed updater-sources BỎ QUA (thêm nguồn trong Store bằng tay — dán chuỗi nguồn).
 */
final class MguInstall {

    private MguInstall() {}

    /** catalog mặc định: release "catalog" của upstream mgu-store */
    static final String DEFAULT_CATALOG =
        "https://github.com/robertnisipeanu/mgu-store/releases/download/catalog/catalog.json";

    static final class Opts {
        boolean renderer = true;   // mgu-render
        boolean uplink = true;     // mgu-uplink
        String catalogUrl = DEFAULT_CATALOG;
        String token = "";         // GitHub token (tùy chọn, cho repo private / né rate-limit)
    }

    private static final class Comp {
        String id, name, url, sha256;
        long size;
        boolean optional;
    }

    /** Chạy toàn bộ: tải + dựng + cài. Log đổ dần vào `out`. Ném lỗi nếu thất bại. */
    static void run(Context ctx, Store st, Opts opts, Ssh.Out out, Ssh.Job job) throws Exception {
        log(out, "### Cài mgu-store từ điện thoại ###");

        Network net = Net.internet(ctx);
        if (net == null)
            throw new IOException("Điện thoại không có internet để tải gói. Bật dữ liệu di động (vẫn giữ Wi-Fi nối xe).");

        // 1) catalog
        log(out, "Tải catalog: " + opts.catalogUrl);
        byte[] catBytes = httpGet(net, opts.catalogUrl, opts.token, 25000, 4_000_000);
        JSONObject cat = new JSONObject(new String(catBytes, StandardCharsets.UTF_8));
        JSONArray comps = cat.getJSONArray("components");

        List<Comp> list = new ArrayList<>();
        boolean hasDeploy = false;
        for (int i = 0; i < comps.length(); i++) {
            JSONObject o = comps.getJSONObject(i);
            Comp c = new Comp();
            c.id = o.getString("id");
            c.optional = o.optBoolean("optional", false);
            JSONObject art = o.getJSONObject("artifact");
            c.name = art.getString("name");
            c.size = art.optLong("size", -1);
            c.sha256 = art.optString("sha256", "");
            c.url = resolve(opts.catalogUrl, art.getString("url"));
            // bỏ bớt optional theo lựa chọn người dùng
            if (c.optional) {
                boolean isRender = c.id.contains("render");
                boolean isUplink = c.id.contains("uplink");
                if (isRender && !opts.renderer) { log(out, "  (bỏ renderer) " + c.id); continue; }
                if (isUplink && !opts.uplink) { log(out, "  (bỏ uplink) " + c.id); continue; }
            }
            if ("mgu-deploy".equals(c.id)) hasDeploy = true;
            list.add(c);
        }
        if (!hasDeploy)
            throw new IOException("catalog.json thiếu thành phần 'mgu-deploy' — không cài được.");
        log(out, "Có " + list.size() + " gói cần tải.");

        // 2) tải + kiểm, 3) dựng archive
        TarGz.Writer tar = new TarGz.Writer();
        long now = System.currentTimeMillis() / 1000L;
        tar.addDir("artifacts", 0755, now);
        boolean anyWith = false;

        for (Comp c : list) {
            if (job.stopped) throw new Ssh.Cancelled();
            log(out, "Tải " + c.name + " …");
            byte[] data = httpGet(net, c.url, opts.token, 120000, 80_000_000);
            if (c.size >= 0 && data.length != c.size)
                throw new IOException(c.name + ": sai kích thước (" + data.length + " ≠ " + c.size + ")");
            if (!c.sha256.isEmpty()) {
                String got = sha256(data);
                if (!got.equalsIgnoreCase(c.sha256))
                    throw new IOException(c.name + ": sai sha256 (gói tải về không khớp catalog)");
            }
            // mgu-deploy: giải nén file ra gốc (để bootstrap chạy mgu-deploy.sh)
            if ("mgu-deploy".equals(c.id)) {
                Map<String, byte[]> files = TarGz.read(data);
                for (Map.Entry<String, byte[]> e : files.entrySet()) {
                    String n = e.getKey();
                    int mode = n.endsWith(".sh") ? 0755 : 0644;
                    tar.addFile(n, mode, now, e.getValue());
                }
            }
            // mọi component: đưa .tgz vào artifacts/ (bắt buộc) hoặc with/ (tùy chọn)
            if (c.optional) {
                if (!anyWith) { tar.addDir("with", 0755, now); anyWith = true; }
                tar.addFile("with/" + c.name, 0644, now, data);
            } else {
                tar.addFile("artifacts/" + c.name, 0644, now, data);
            }
        }

        // 3b) run.sh — đúng trình tự mgu-install.js (bỏ updater-sources)
        tar.addFile("run.sh", 0755, now, RUN_SH.getBytes(StandardCharsets.UTF_8));

        byte[] archive = tar.finishGz();
        log(out, "Đã dựng gói cài: " + Util.human(archive.length) + ". Đang đẩy qua SSH…");

        // 4) SSH: bung vào STAGE rồi chạy run.sh
        Ssh.ensure(ctx, st);
        String stage = "/var/opt/mgu-deploy-kit-" + Long.toHexString(System.nanoTime());
        String q = Util.sq(stage);
        String cmd = "rm -rf " + q + " && umask 077 && mkdir -p " + q
            + " && tar -xzf - -C " + q
            + " && { sh " + q + "/run.sh; st=$?; rm -rf " + q + "; exit $st; }";
        int rc = Ssh.runIn(cmd, new ByteArrayInputStream(archive), out, job);
        if (rc == -999) throw new Ssh.Cancelled();
        if (rc != 0)
            throw new IOException("Cài thất bại (mã " + rc + "). Xem log phía trên. "
                + "Thường do đầu máy chưa vào HMI (App Manager chưa chạy) hoặc coding chưa restore.");
        log(out, "### XONG. Khởi động lại đầu máy để hiện tile Store (hoặc Settings → Restart head unit). ###");
    }

    // run.sh chạy TRÊN đầu máy, trong thư mục STAGE
    private static final String RUN_SH =
        "#!/bin/sh\n"
        + "set -e\n"
        + "cd \"$(dirname \"$0\")\"\n"
        + "A=\"\"\n"
        + "for f in artifacts/*.tgz; do [ -e \"$f\" ] && A=\"$A --artifact $f\"; done\n"
        + "echo \">> cài các gói bắt buộc\"\n"
        + "sh mgu-deploy.sh install $A --skip-older --yes\n"
        + "for f in with/*.tgz; do\n"
        + "  [ -e \"$f\" ] || continue\n"
        + "  echo \">> cài tùy chọn $f\"\n"
        + "  sh mgu-deploy.sh install --artifact \"$f\" --skip-older --yes || { c=$?; if [ \"$c\" = 2 ]; then echo \"   (để lại $f, mã 2)\"; else exit $c; fi; }\n"
        + "done\n"
        + "echo \">> trạng thái\"\n"
        + "sh /var/opt/mgu-deploy/mgu-deploy.sh status 2>&1 || true\n";

    // ----------------------------------------------------------------
    // tiện ích
    // ----------------------------------------------------------------
    private static void log(Ssh.Out out, String s) {
        out.chunk(s + "\n");
    }

    /** resolve url tương đối theo url của catalog */
    private static String resolve(String base, String url) {
        try {
            return URI.create(base).resolve(url).toString();
        } catch (Exception e) {
            return url;
        }
    }

    private static String sha256(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] d = md.digest(data);
        StringBuilder sb = new StringBuilder(d.length * 2);
        for (byte b : d) sb.append(String.format(Locale.US, "%02x", b & 0xFF));
        return sb.toString();
    }

    /** GET có theo redirect (GitHub release chuyển hướng sang objects.githubusercontent.com). */
    private static byte[] httpGet(Network net, String url, String token, int readMs, long cap) throws IOException {
        String cur = url;
        for (int hop = 0; hop < 6; hop++) {
            URL u = new URL(cur);
            HttpURLConnection c = (HttpURLConnection) (net != null ? net.openConnection(u) : u.openConnection());
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(readMs);
            c.setRequestProperty("User-Agent", "MGU-DevLink");
            // chỉ gửi token tới host github (đừng lộ token sang CDN khi redirect)
            if (token != null && !token.isEmpty() && u.getHost().endsWith("github.com"))
                c.setRequestProperty("Authorization", "Bearer " + token);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect thiếu Location (" + code + ")");
                cur = URI.create(cur).resolve(loc).toString();
                continue;
            }
            if (code != 200) {
                String msg = "";
                try {
                    InputStream es = c.getErrorStream();
                    if (es != null) msg = new String(readAll(es, 20000), StandardCharsets.UTF_8);
                } catch (Exception ignore) {
                    // bỏ qua
                }
                c.disconnect();
                throw new IOException("Tải lỗi HTTP " + code + " " + cur + (msg.isEmpty() ? "" : " — " + msg));
            }
            try {
                return readAll(c.getInputStream(), cap);
            } finally {
                c.disconnect();
            }
        }
        throw new IOException("Quá nhiều redirect: " + url);
    }

    private static byte[] readAll(InputStream in, long cap) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        try {
            while ((n = in.read(buf)) > 0) {
                bo.write(buf, 0, n);
                if (bo.size() > cap) throw new IOException("Tệp lớn hơn giới hạn " + Util.human(cap));
            }
        } finally {
            in.close();
        }
        return bo.toByteArray();
    }
}
