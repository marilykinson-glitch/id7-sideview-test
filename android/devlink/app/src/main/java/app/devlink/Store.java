package app.devlink;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Cài đặt và dữ liệu lưu trong máy. Khóa SSH và mật khẩu được mã hóa bằng Vault. */
final class Store {
    private final SharedPreferences sp;

    Store(Context c) {
        sp = c.getSharedPreferences("devlink", Context.MODE_PRIVATE);
    }

    String host() { return sp.getString("host", "169.254.213.49"); }
    int port() { return sp.getInt("port", 22); }
    String user() { return sp.getString("user", "root"); }

    void profile(String host, int port, String user) {
        sp.edit().putString("host", host).putInt("port", port).putString("user", user).apply();
    }

    boolean hasKey() { return sp.contains("key") && !key().isEmpty(); }
    String key() { return Vault.dec(sp.getString("key", "")); }
    void key(String k) {
        if (k == null || k.isEmpty()) sp.edit().remove("key").apply();
        else sp.edit().putString("key", Vault.enc(k)).apply();
    }

    String pass() { return Vault.dec(sp.getString("pass", "")); }
    void pass(String v) {
        if (v == null || v.isEmpty()) sp.edit().remove("pass").apply();
        else sp.edit().putString("pass", Vault.enc(v)).apply();
    }

    String password() { return Vault.dec(sp.getString("pw", "")); }
    void password(String v) {
        if (v == null || v.isEmpty()) sp.edit().remove("pw").apply();
        else sp.edit().putString("pw", Vault.enc(v)).apply();
    }

    String known(String hostKey) { return sp.getString("hk:" + hostKey, null); }
    void known(String hostKey, String fp) { sp.edit().putString("hk:" + hostKey, fp).apply(); }
    void forget(String hostKey) { sp.edit().remove("hk:" + hostKey).apply(); }

    // ---- lịch sử lệnh ----

    List<String> history() {
        ArrayList<String> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(sp.getString("hist", "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (Exception e) {
            // rỗng
        }
        return out;
    }

    void pushHistory(String cmd) {
        String c = cmd.trim();
        if (c.isEmpty()) return;
        List<String> h = history();
        h.remove(c);
        h.add(0, c);
        while (h.size() > 40) h.remove(h.size() - 1);
        sp.edit().putString("hist", new JSONArray(h).toString()).apply();
    }

    void clearHistory() { sp.edit().remove("hist").apply(); }

    // ---- mục Quét do người dùng lưu ----

    List<String[]> customScans() {
        ArrayList<String[]> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(sp.getString("scans", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                out.add(new String[]{o.getString("t"), o.getString("s")});
            }
        } catch (Exception e) {
            // rỗng
        }
        return out;
    }

    private void saveScans(List<String[]> l) {
        JSONArray a = new JSONArray();
        try {
            for (String[] s : l) a.put(new JSONObject().put("t", s[0]).put("s", s[1]));
        } catch (Exception e) {
            // bỏ qua
        }
        sp.edit().putString("scans", a.toString()).apply();
    }

    void addScan(String title, String script) {
        List<String[]> l = customScans();
        l.add(new String[]{title, script});
        saveScans(l);
    }

    void removeScan(int index) {
        List<String[]> l = customScans();
        if (index >= 0 && index < l.size()) l.remove(index);
        saveScans(l);
    }

    // ---- khác ----

    String lastReport() { return sp.getString("lastReport", ""); }
    void lastReport(String uri) { sp.edit().putString("lastReport", uri).apply(); }

    // ---- chế độ Claude điều khiển (relay qua GitHub) ----

    String relayRepo() { return sp.getString("rrepo", "marilykinson-glitch/id7-sideview-test"); }
    String relayBranch() { return sp.getString("rbranch", "relay"); }
    String relayToken() { return Vault.dec(sp.getString("rtoken", "")); }
    boolean relayOn() { return sp.getBoolean("ron", false); }

    void relay(String repo, String branch, String token) {
        SharedPreferences.Editor e = sp.edit().putString("rrepo", repo).putString("rbranch", branch);
        if (token != null && !token.isEmpty()) e.putString("rtoken", Vault.enc(token));
        e.apply();
    }

    void relayOn(boolean on) { sp.edit().putBoolean("ron", on).apply(); }
}
