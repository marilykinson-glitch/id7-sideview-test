package app.devlink;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Cho Claude điều khiển đầu xe từ xa qua một nhánh GitHub, không cần máy tính. */
final class RelayScreen extends Screen {
    private final LinearLayout root;
    private final EditText repo, branch, token;
    private final TextView state;
    private final Button toggle;
    private final OutView log;
    private int shown = -1;
    private boolean ticking;

    static void startService(Context c) {
        Intent i = new Intent(c, RelayService.class);
        c.startForegroundService(i);
    }

    RelayScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 4), Ui.dp(a, 12), Ui.dp(a, 8));

        ScrollView sv = new ScrollView(a);
        LinearLayout box = Ui.col(a);
        sv.addView(box, new ScrollView.LayoutParams(Ui.MATCH, Ui.WRAP));
        root.addView(sv, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1.25f));

        box.addView(Ui.text(a, "Cho Claude lái đầu xe từ xa. Điện thoại nối đầu xe bằng Wi-Fi/cáp, còn 4G dùng để hỏi lệnh trên GitHub. Phải kết nối SSH ở mục Kết nối trước.", 13, Ui.DIM), Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 8));

        repo = Ui.edit(a, "Repo, dạng chủ/tên", true);
        repo.setSingleLine(true);
        repo.setText(a.store.relayRepo());
        box.addView(repo, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        branch = Ui.edit(a, "Nhánh (mặc định relay)", true);
        branch.setSingleLine(true);
        branch.setText(a.store.relayBranch());
        box.addView(branch, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        token = Ui.edit(a, a.store.relayToken().isEmpty() ? "Token GitHub (quyền Contents: đọc và ghi)" : "Token đã lưu. Để trống nếu giữ nguyên", true);
        token.setSingleLine(true);
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        box.addView(token, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        LinearLayout r = Ui.row(a);
        toggle = Ui.btn(a, "", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggle();
            }
        });
        r.addView(toggle, Ui.lp(a, 0, Ui.WRAP, 1.4f, 0, 0, 6, 0));
        r.addView(Ui.btn(a, "📋 Dán token", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                token.setText(a.clip().trim());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        r.addView(Ui.btn(a, "🔋", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    a.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e) {
                    a.toast("Mở cài đặt pin của máy, cho app này chạy nền không giới hạn");
                }
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 0, 0));
        box.addView(r, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        state = Ui.text(a, "", 13, Ui.DIM);
        box.addView(state, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 4));

        log = new OutView(a);
        log.setInfo("Nhật ký", Ui.DIM);
        root.addView(log, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
    }

    @Override
    View view() {
        return root;
    }

    @Override
    void onShow() {
        refresh();
        tick();
    }

    private void tick() {
        if (ticking) return;
        ticking = true;
        a.ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                ticking = false;
                if (!root.isAttachedToWindow()) return;
                refresh();
                tick();
            }
        }, 1500);
    }

    private void refresh() {
        boolean on = a.store.relayOn();
        toggle.setText(on ? "■ Tắt" : "▶ Bật cho Claude điều khiển");
        if (on) {
            state.setText(Relay.running() ? "● Đang chờ lệnh từ Claude" : "○ Đang khởi động…");
            state.setTextColor(Relay.running() ? Ui.OK : Ui.WARN);
        } else {
            state.setText("○ Đang tắt");
            state.setTextColor(Ui.DIM);
        }
        String t = Relay.logText();
        if (t.length() != shown) {
            shown = t.length();
            log.clear();
            log.append(t);
        }
    }

    private void toggle() {
        if (a.store.relayOn()) {
            a.store.relayOn(false);
            a.stopService(new Intent(a, RelayService.class));
            Relay.stop(a);
            refresh();
            return;
        }
        String rp = repo.getText().toString().trim();
        String br = branch.getText().toString().trim();
        if (!rp.matches("[\\w.-]+/[\\w.-]+")) {
            a.toast("Repo phải có dạng chủ/tên");
            return;
        }
        if (br.isEmpty()) br = "relay";
        a.store.relay(rp, br, token.getText().toString().trim());
        if (a.store.relayToken().isEmpty()) {
            a.toast("Chưa có token GitHub");
            return;
        }
        token.setText("");
        token.setHint("Token đã lưu. Để trống nếu giữ nguyên");
        a.store.relayOn(true);
        if (Build.VERSION.SDK_INT >= 33) {
            a.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 21);
        }
        startService(a);
        refresh();
    }
}
