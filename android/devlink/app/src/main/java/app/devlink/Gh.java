package app.devlink;

import android.net.Network;
import android.util.Base64;
import android.util.Base64OutputStream;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/** Máy khách GitHub Contents API nhỏ gọn, đi qua một Network chỉ định (4G) để không bị Wi-Fi xe không internet chặn. */
final class Gh {
    static final class Http extends IOException {
        final int code;

        Http(int code, String msg) {
            super("GitHub " + code + ": " + msg);
            this.code = code;
        }
    }

    final String repo, branch, token;
    private volatile Network net;
    private final HashMap<String, String[]> cache = new HashMap<>();

    Gh(String repo, String branch, String token) {
        this.repo = repo;
        this.branch = branch;
        this.token = token;
    }

    boolean same(String r, String b, String t) {
        return repo.equals(r) && branch.equals(b) && token.equals(t);
    }

    void setNet(Network n) {
        net = n;
    }

    private static String encPath(String p) throws IOException {
        StringBuilder b = new StringBuilder();
        for (String seg : p.split("/")) {
            if (seg.isEmpty()) continue;
            if (b.length() > 0) b.append('/');
            b.append(URLEncoder.encode(seg, "UTF-8").replace("+", "%20"));
        }
        return b.toString();
    }

    private HttpURLConnection open(String method, String url, int readMs) throws IOException {
        URL u = new URL(url);
        Network n = net;
        HttpURLConnection c = (HttpURLConnection) (n != null ? n.openConnection(u) : u.openConnection());
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(readMs);
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("User-Agent", "MGU-DevLink");
        c.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        return c;
    }

    private String contentsUrl(String path) throws IOException {
        return "https://api.github.com/repos/" + repo + "/contents/" + encPath(path)
            + "?ref=" + URLEncoder.encode(branch, "UTF-8");
    }

    private static byte[] readAll(InputStream in, long cap) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[32768];
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

    private Http err(HttpURLConnection c, int code) {
        String m = "";
        try {
            InputStream es = c.getErrorStream();
            if (es != null) {
                String body = new String(readAll(es, 20000), StandardCharsets.UTF_8);
                try {
                    m = new JSONObject(body).optString("message", body);
                } catch (Exception e) {
                    m = body;
                }
            }
        } catch (Exception e) {
            // bỏ qua
        }
        c.disconnect();
        return new Http(code, m);
    }

    /** kiểm tra token, repo và nhánh */
    void check() throws IOException {
        HttpURLConnection c = open("GET", "https://api.github.com/repos/" + repo + "/branches/" + encPath(branch), 20000);
        int code = c.getResponseCode();
        if (code == 200) {
            c.disconnect();
            return;
        }
        if (code == 404) throw new IllegalStateException("Không thấy repo hoặc nhánh \"" + branch + "\", hoặc token không có quyền vào repo này.");
        if (code == 401) throw new IllegalStateException("Token GitHub sai hoặc đã hết hạn.");
        throw err(c, code);
    }

    /** tên các tệp trong thư mục (rỗng nếu chưa có). Dùng ETag nên lần hỏi lại gần như miễn phí. */
    List<String> list(String dir) throws IOException {
        HttpURLConnection c = open("GET", contentsUrl(dir), 20000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        String[] ce = cache.get(dir);
        if (ce != null) c.setRequestProperty("If-None-Match", ce[0]);
        int code = c.getResponseCode();
        String body;
        if (code == 304 && ce != null) {
            body = ce[1];
            c.disconnect();
        } else if (code == 404) {
            c.disconnect();
            cache.remove(dir);
            return new ArrayList<>();
        } else if (code == 200) {
            body = new String(readAll(c.getInputStream(), 8000000), StandardCharsets.UTF_8);
            String et = c.getHeaderField("ETag");
            if (et != null) cache.put(dir, new String[]{et, body});
        } else {
            throw err(c, code);
        }
        ArrayList<String> names = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(body);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                if ("file".equals(o.optString("type"))) names.add(o.getString("name"));
            }
        } catch (Exception e) {
            throw new IOException("Phản hồi GitHub không đọc được");
        }
        return names;
    }

    byte[] readBytes(String path, long cap) throws IOException {
        HttpURLConnection c = open("GET", contentsUrl(path), 120000);
        c.setRequestProperty("Accept", "application/vnd.github.raw");
        int code = c.getResponseCode();
        if (code != 200) throw err(c, code);
        return readAll(c.getInputStream(), cap);
    }

    String readText(String path) throws IOException {
        return new String(readBytes(path, 2000000), StandardCharsets.UTF_8);
    }

    /** sha hiện tại của tệp, null nếu chưa có */
    String sha(String path) throws IOException {
        HttpURLConnection c = open("GET", contentsUrl(path), 20000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        int code = c.getResponseCode();
        if (code == 404) {
            c.disconnect();
            return null;
        }
        if (code != 200) throw err(c, code);
        try {
            return new JSONObject(new String(readAll(c.getInputStream(), 8000000), StandardCharsets.UTF_8)).optString("sha", null);
        } catch (Exception e) {
            throw new IOException("Phản hồi GitHub không đọc được");
        }
    }

    /** tạo hoặc ghi đè tệp, trả về sha mới. sha là bản đang có (nếu biết). */
    String put(String path, byte[] data, String sha) throws IOException {
        try {
            return doPut(path, data, sha);
        } catch (Http h) {
            if (h.code == 409 || h.code == 422) {
                String s = sha(path);
                if (s != null) return doPut(path, data, s);
            }
            throw h;
        }
    }

    private String doPut(String path, byte[] data, String sha) throws IOException {
        byte[] pre = ("{\"message\":" + JSONObject.quote("relay " + path) + ",\"branch\":" + JSONObject.quote(branch)
            + (sha != null ? ",\"sha\":" + JSONObject.quote(sha) : "") + ",\"content\":\"").getBytes(StandardCharsets.UTF_8);
        byte[] suf = "\"}".getBytes(StandardCharsets.UTF_8);
        long len = pre.length + 4L * ((data.length + 2) / 3) + suf.length;
        HttpURLConnection c = open("PUT", contentsUrl(path), 180000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("Content-Type", "application/json");
        c.setDoOutput(true);
        c.setFixedLengthStreamingMode((int) len);
        OutputStream os = c.getOutputStream();
        os.write(pre);
        Base64OutputStream b64 = new Base64OutputStream(os, Base64.NO_WRAP | Base64.NO_CLOSE);
        b64.write(data);
        b64.close();
        os.write(suf);
        os.close();
        int code = c.getResponseCode();
        if (code != 200 && code != 201) throw err(c, code);
        try {
            String body = new String(readAll(c.getInputStream(), 2000000), StandardCharsets.UTF_8);
            return new JSONObject(body).getJSONObject("content").getString("sha");
        } catch (Exception e) {
            return null;
        }
    }
}
