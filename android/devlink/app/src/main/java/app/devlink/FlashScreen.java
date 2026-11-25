package app.devlink;

import android.graphics.Typeface;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** Tab "Mở SSH": flash + enroll mở root SSH qua ENET (chạy mgu7 bằng Python/Chaquopy). */
final class FlashScreen extends Screen {
    private final LinearLayout root;
    private final EditText vin, gateway;
    private final OutView out;
    private final Button runBtn, detectBtn, loadKeyBtn;
    private final CheckBox backup;
    private final String[] archVals = {"id7", "id8-bdc3", "id8-bcp"};
    private int archIdx = 0;     // id7
    private int modeIdx = 1;     // 0 = flash, 1 = enroll (an toàn mặc định)
    private volatile boolean running;
    private String lastVin = "", lastMguIp = "";

    FlashScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 6), Ui.dp(a, 12), Ui.dp(a, 8));

        TextView h = Ui.text(a, "Mở SSH qua ENET (flash + enroll)", 16, Ui.TEXT);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(h, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 2));
        root.addView(Ui.text(a,
            "Cần cáp USB-OTG Ethernet cắm vào OBD (ENET). Dùng cho đầu máy CHƯA mở SSH.", 12, Ui.DIM),
            Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        // chế độ
        root.addView(Ui.text(a, "Chế độ", 12, Ui.DIM), Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 2));
        root.addView(seg(a, new String[]{"Flash (lần đầu)", "Enroll (đã flash rồi)"}, modeIdx,
            new Seg() { public void on(int i) { modeIdx = i; syncWarn(); } }),
            Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        // dòng máy
        root.addView(Ui.text(a, "Dòng máy", 12, Ui.DIM), Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 2));
        root.addView(seg(a, new String[]{"iDrive 7", "iD8 BDC3", "iD8 BCP"}, archIdx,
            new Seg() { public void on(int i) { archIdx = i; } }),
            Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        // VIN + dò
        LinearLayout rv = Ui.row(a);
        vin = Ui.edit(a, "VIN 17 ký tự (để trống + Dò)", false);
        rv.addView(vin, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        detectBtn = Ui.btn(a, "Dò VIN", 1, new View.OnClickListener() {
            @Override public void onClick(View v) { detect(); }
        });
        rv.addView(detectBtn, Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 0, 0));
        root.addView(rv, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        gateway = Ui.edit(a, "Gateway ENET (để trống = tự dò UDP 6811)", false);
        root.addView(gateway, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        // cảnh báo
        LinearLayout warn = Ui.card(a);
        warn.setBackground(Ui.round(a, 0xFF2A1D08, 12));
        TextView wt = Ui.text(a,
            "⚠️ FLASH có thể LÀM MẤT CODING / BRICK đầu máy. Backup coding (BimmerCode) TRƯỚC. "
            + "KHÔNG flash đầu máy đã có SSH (vd bench G20). Flash xong phải RESTORE coding rồi mới cài Store.",
            12, 0xFFFDE68A);
        warn.addView(wt);
        backup = new CheckBox(a);
        backup.setText("Tôi đã backup coding và chấp nhận rủi ro.");
        backup.setTextColor(0xFFFDE68A);
        backup.setTextSize(12);
        backup.setButtonTintList(android.content.res.ColorStateList.valueOf(Ui.WARN));
        warn.addView(backup, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 6, 0, 0));
        warnBox = warn;
        root.addView(warn, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        // nút chạy
        runBtn = Ui.btn(a, "▶ Chạy", 0, new View.OnClickListener() {
            @Override public void onClick(View v) { start(); }
        });
        root.addView(runBtn, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        out = new OutView(a);
        root.addView(out, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));

        LinearLayout rb = Ui.row(a);
        loadKeyBtn = Ui.btn(a, "Nạp khóa → Kết nối", 1, new View.OnClickListener() {
            @Override public void onClick(View v) { loadKey(); }
        });
        loadKeyBtn.setEnabled(false);
        rb.addView(loadKeyBtn, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 6, 0));
        rb.addView(Ui.btn(a, "📋 Log", 1, new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (out.isEmpty()) { a.toast("Chưa có log"); return; }
                a.copy("log flash", out.text());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 0, 0));
        root.addView(rb, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 0));

        syncWarn();
    }

    private LinearLayout warnBox;

    private void syncWarn() {
        if (warnBox != null) warnBox.setVisibility(modeIdx == 0 ? View.VISIBLE : View.GONE);
    }

    @Override
    View view() { return root; }

    // ---- segmented control nhỏ ----
    private interface Seg { void on(int i); }

    private LinearLayout seg(final MainActivity a, final String[] labels, final int init, final Seg cb) {
        final LinearLayout row = Ui.row(a);
        final Button[] bs = new Button[labels.length];
        final int[] sel = {init};
        for (int i = 0; i < labels.length; i++) {
            final int idx = i;
            final Button b = Ui.btn(a, labels[i], idx == init ? 0 : 1, new View.OnClickListener() {
                @Override public void onClick(View v) {
                    sel[0] = idx;
                    for (int k = 0; k < bs.length; k++) paint(a, bs[k], k == idx);
                    cb.on(idx);
                }
            });
            bs[i] = b;
            row.addView(b, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, i < labels.length - 1 ? 6 : 0, 0));
        }
        return row;
    }

    private void paint(MainActivity a, Button b, boolean on) {
        b.setBackground(Ui.round(a, on ? Ui.ACC : Ui.CARD2, 10));
        b.setTextColor(on ? 0xFF06101C : Ui.TEXT);
    }

    private void busy(boolean b) {
        running = b;
        runBtn.setEnabled(!b);
        detectBtn.setEnabled(!b);
    }

    private final PyFlash.Line sink = new PyFlash.Line() {
        @Override public void line(String s) { out.append(s); }
    };

    private void detect() {
        if (running) return;
        out.clear();
        out.setInfo("Đang dò ENET…", Ui.DIM);
        busy(true);
        a.pool.execute(new Runnable() {
            @Override public void run() {
                String info; int color = Ui.OK;
                boolean eth = Net.bindEthernet(a);
                if (!eth) out.append("[cảnh báo] không thấy cổng USB-Ethernet; dùng mạng mặc định.\n");
                try {
                    String r = PyFlash.discover(a, sink);
                    if (r == null || r.isEmpty()) {
                        info = "Không thấy gateway. Kiểm tra cáp USB-OTG Ethernet + xe thức."; color = Ui.WARN;
                    } else {
                        final String[] p = r.split("\\|", 2);
                        final String ip = p[0];
                        final String v = p.length > 1 ? p[1] : "";
                        info = "Thấy gateway " + ip + (v.isEmpty() ? "" : " • VIN " + v);
                        a.ui.post(new Runnable() {
                            @Override public void run() {
                                if (!ip.isEmpty()) gateway.setText(ip);
                                if (!v.isEmpty()) vin.setText(v);
                            }
                        });
                    }
                } catch (Throwable e) {
                    info = "Lỗi dò: " + Util.friendly(e); color = Ui.ERR;
                } finally {
                    Net.unbind(a);
                }
                finish(info, color);
            }
        });
    }

    private void start() {
        if (running) return;
        final boolean flash = modeIdx == 0;
        final String vinS = vin.getText().toString().trim();
        final String gwS = gateway.getText().toString().trim();
        final String arch = archVals[archIdx];
        if (flash && !backup.isChecked()) {
            a.toast("Phải tick xác nhận đã backup coding trước khi Flash.");
            return;
        }
        if (flash && !vinS.isEmpty() && vinS.length() != 17) {
            a.toast("VIN phải đủ 17 ký tự (hoặc để trống + Dò).");
            return;
        }
        a.confirm(flash ? "Flash đầu máy?" : "Enroll mở SSH?",
            flash ? "Flash GHI LẠI đầu máy — chỉ làm khi đã backup coding và đây KHÔNG phải đầu máy đã có SSH."
                  : "Enroll mở lại SSH trên đầu máy đã flash.",
            flash ? "Flash" : "Enroll",
            new Runnable() {
                @Override public void run() { doRun(flash, vinS, gwS, arch); }
            });
    }

    private void doRun(final boolean flash, final String vinS, final String gwS, final String arch) {
        out.clear();
        out.setInfo(flash ? "Đang flash…" : "Đang enroll…", Ui.DIM);
        busy(true);
        lastVin = vinS;
        a.pool.execute(new Runnable() {
            @Override public void run() {
                long t0 = System.currentTimeMillis();
                String info; int color = Ui.OK;
                boolean eth = Net.bindEthernet(a);
                if (!eth) out.append("[cảnh báo] không thấy cổng USB-Ethernet; ENET có thể không tới được.\n");
                int rc = -1;
                try {
                    rc = PyFlash.run(a, flash ? "flash" : "enable", vinS, arch,
                        gwS.isEmpty() ? null : gwS, null, sink);
                    double sec = (System.currentTimeMillis() - t0) / 1000.0;
                    if (rc == 0) {
                        info = (flash ? "Flash + mở SSH xong" : "Enroll xong")
                            + " trong " + String.format(Locale.US, "%.1f", sec) + "s. "
                            + (flash ? "Giờ RESTORE coding rồi dùng tab Cài MGU." : "Có thể nạp khóa → Kết nối.");
                        a.ui.post(new Runnable() { @Override public void run() { loadKeyBtn.setEnabled(true); } });
                    } else {
                        info = "Thất bại (mã " + rc + "). Xem log."; color = Ui.ERR;
                    }
                } catch (Throwable e) {
                    info = "Lỗi: " + Util.friendly(e); color = Ui.ERR;
                    out.append("\n[" + Util.friendly(e) + "]\n");
                } finally {
                    Net.unbind(a);
                }
                finish(info, color);
            }
        });
    }

    private void loadKey() {
        a.pool.execute(new Runnable() {
            @Override public void run() {
                try {
                    String pem = PyFlash.enrolledKey(a, lastVin, sink);
                    if (pem == null || pem.trim().isEmpty()) { a.ui.post(new Runnable() {
                        @Override public void run() { a.toast("Chưa thấy khóa enroll."); } }); return; }
                    a.store.key(pem);
                    a.ui.post(new Runnable() {
                        @Override public void run() {
                            a.toast("Đã nạp khóa. Vào Kết nối để nối SSH.");
                            a.showTab(MainActivity.TAB_CONNECT);
                        }
                    });
                } catch (Throwable e) {
                    final String m = Util.friendly(e);
                    a.ui.post(new Runnable() { @Override public void run() { a.toast("Lỗi: " + m); } });
                }
            }
        });
    }

    private void finish(final String info, final int color) {
        a.ui.post(new Runnable() {
            @Override public void run() {
                busy(false);
                out.setInfo(info, color);
            }
        });
    }
}
