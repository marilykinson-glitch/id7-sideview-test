package app.devlink;

import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Locale;

/** Tab "Cài MGU": cài / cập nhật mgu-store lên đầu máy ngay từ điện thoại (qua SSH). */
final class MguScreen extends Screen {
    private final LinearLayout root;
    private final OutView out;
    private final Button install, stop;
    private final CheckBox cbRender, cbUplink;
    private Ssh.Job job;

    MguScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 6), Ui.dp(a, 12), Ui.dp(a, 8));

        TextView head = Ui.text(a, "Cài / cập nhật mgu-store", 16, Ui.TEXT);
        head.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(head, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 2));
        root.addView(Ui.text(a,
            "Tải gói từ GitHub (cần dữ liệu di động) rồi đẩy thẳng vào đầu máy qua SSH. "
            + "Đầu máy phải ĐÃ mở SSH và đang ở màn hình xe (HMI chạy).", 12, Ui.DIM),
            Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        cbRender = check(a, "Cài renderer (mgu-render) — vẽ Store/đồng hồ", true);
        cbUplink = check(a, "Cài uplink (mgu-uplink) — internet qua USB/Wi-Fi", true);
        root.addView(cbRender, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 2));
        root.addView(cbUplink, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        LinearLayout r1 = Ui.row(a);
        install = Ui.btn(a, "⬇ Cài / cập nhật", 0, new View.OnClickListener() {
            @Override public void onClick(View v) { start(); }
        });
        stop = Ui.btn(a, "■ Dừng", 2, new View.OnClickListener() {
            @Override public void onClick(View v) { Ssh.Job j = job; if (j != null) j.cancel(); }
        });
        stop.setEnabled(false);
        r1.addView(install, Ui.lp(a, 0, Ui.WRAP, 2f, 0, 0, 6, 0));
        r1.addView(stop, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 0, 0));
        root.addView(r1, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        out = new OutView(a);
        root.addView(out, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));

        LinearLayout r2 = Ui.row(a);
        r2.addView(Ui.btn(a, "📋 Sao chép log", 1, new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (out.isEmpty()) { a.toast("Chưa có log"); return; }
                a.copy("log cài mgu-store", out.text());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 6, 0));
        r2.addView(Ui.btn(a, "Chia sẻ", 1, new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (out.isEmpty()) { a.toast("Chưa có log"); return; }
                a.shareText(out.text());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 0, 0));
        root.addView(r2, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        // ghi chú: flash (mở SSH qua ENET) đang làm
        TextView note = Ui.text(a,
            "Mở SSH / flash qua ENET đang được bổ sung (cần cáp USB-OTG Ethernet). "
            + "Hiện màn này dùng cho đầu máy đã mở SSH sẵn.", 11, Ui.WARN);
        root.addView(note, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 0));
    }

    private static CheckBox check(MainActivity a, String label, boolean on) {
        CheckBox cb = new CheckBox(a);
        cb.setText(label);
        cb.setChecked(on);
        cb.setTextColor(Ui.TEXT);
        cb.setTextSize(13);
        cb.setButtonTintList(android.content.res.ColorStateList.valueOf(Ui.ACC));
        return cb;
    }

    @Override
    View view() { return root; }

    private void busy(boolean b) {
        install.setEnabled(!b);
        stop.setEnabled(b);
        cbRender.setEnabled(!b);
        cbUplink.setEnabled(!b);
    }

    private void start() {
        if (job != null) { a.toast("Đang chạy"); return; }
        if (!a.store.hasKey() && a.store.password().isEmpty()) {
            a.toast("Chưa có khóa/mật khẩu SSH. Vào mục Kết nối trước.");
            return;
        }
        final MguInstall.Opts opts = new MguInstall.Opts();
        opts.renderer = cbRender.isChecked();
        opts.uplink = cbUplink.isChecked();

        out.clear();
        out.setInfo("Đang cài…", Ui.DIM);
        final Ssh.Job j = new Ssh.Job();
        job = j;
        busy(true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                long t0 = System.currentTimeMillis();
                String info; int color = Ui.OK;
                try {
                    MguInstall.run(a, a.store, opts, new Ssh.Out() {
                        @Override public void chunk(String s) { out.append(s); }
                    }, j);
                    double sec = (System.currentTimeMillis() - t0) / 1000.0;
                    info = "Cài xong trong " + String.format(Locale.US, "%.1f", sec) + " giây. "
                        + "Khởi động lại đầu máy để hiện Store.";
                } catch (Ssh.Cancelled c) {
                    info = "Đã dừng."; color = Ui.WARN;
                } catch (Util.HostKeyChanged hk) {
                    info = "Khóa nhận dạng của máy đã đổi. Vào mục Kết nối để tin lại."; color = Ui.ERR;
                } catch (Throwable e) {
                    info = "Lỗi: " + Util.friendly(e); color = Ui.ERR;
                    out.append("\n[" + Util.friendly(e) + "]\n");
                }
                final String fi = info; final int fc = color;
                a.ui.post(new Runnable() {
                    @Override
                    public void run() {
                        job = null;
                        busy(false);
                        a.refreshStatus();
                        out.setInfo(fi, fc);
                    }
                });
            }
        });
    }
}
