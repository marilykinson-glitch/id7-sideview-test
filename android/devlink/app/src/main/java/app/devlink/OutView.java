package app.devlink;

import android.content.Context;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Khung hiện kết quả chạy lệnh: nhận chữ từ luồng nền, giữ đủ bản đầy để sao chép/chia sẻ, chỉ hiện phần cuối cho nhẹ máy. */
final class OutView extends LinearLayout {
    private static final int CAP = 2000000;
    private static final int SHOW = 60000;

    private final TextView tv;
    private final TextView info;
    private final ScrollView sv;
    private final StringBuilder buf = new StringBuilder();
    private final Handler h = new Handler(Looper.getMainLooper());
    private boolean pending;
    private boolean truncated;

    private final Runnable flush = new Runnable() {
        @Override
        public void run() {
            String s;
            synchronized (buf) {
                pending = false;
                int st = Math.max(0, buf.length() - SHOW);
                s = (st > 0 ? "… (đã ẩn phần đầu; Sao chép/Chia sẻ vẫn lấy đủ)\n" : "") + buf.substring(st);
            }
            tv.setText(s);
            sv.post(new Runnable() {
                @Override
                public void run() {
                    sv.fullScroll(View.FOCUS_DOWN);
                }
            });
        }
    };

    OutView(Context c) {
        super(c);
        setOrientation(VERTICAL);
        setBackground(Ui.round(c, 0xFF0A0F18, 12));
        setPadding(Ui.dp(c, 10), Ui.dp(c, 8), Ui.dp(c, 10), Ui.dp(c, 8));
        info = Ui.text(c, "Kết quả sẽ hiện ở đây.", 12, Ui.DIM);
        addView(info, new LayoutParams(Ui.MATCH, Ui.WRAP));
        sv = new ScrollView(c);
        tv = Ui.text(c, "", 12, Ui.TEXT);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setTextIsSelectable(true);
        sv.addView(tv, new ScrollView.LayoutParams(Ui.MATCH, Ui.WRAP));
        addView(sv, new LayoutParams(Ui.MATCH, 0, 1f));
    }

    /** gọi từ luồng nền hay luồng giao diện đều được */
    void append(String s) {
        synchronized (buf) {
            buf.append(s);
            if (buf.length() > CAP) {
                buf.delete(0, buf.length() - CAP + 400000);
                truncated = true;
            }
            if (!pending) {
                pending = true;
                h.postDelayed(flush, 120);
            }
        }
    }

    void clear() {
        synchronized (buf) {
            buf.setLength(0);
            truncated = false;
            pending = true;
            h.postDelayed(flush, 0);
        }
    }

    String text() {
        synchronized (buf) {
            return buf.toString();
        }
    }

    boolean wasTruncated() {
        synchronized (buf) {
            return truncated;
        }
    }

    boolean isEmpty() {
        synchronized (buf) {
            return buf.length() == 0;
        }
    }

    void setInfo(final String s, final int color) {
        h.post(new Runnable() {
            @Override
            public void run() {
                info.setText(s);
                info.setTextColor(color);
            }
        });
    }
}
