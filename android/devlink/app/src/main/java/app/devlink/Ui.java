package app.devlink;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Dựng giao diện bằng mã: màu, nút, thẻ. */
final class Ui {
    private Ui() {}

    static final int BG = 0xFF0D131E;
    static final int CARD = 0xFF172131;
    static final int CARD2 = 0xFF1F2D44;
    static final int LINE = 0xFF2A3850;
    static final int TEXT = 0xFFE8EEF7;
    static final int DIM = 0xFF8EA0BA;
    static final int ACC = 0xFF3DA5FF;
    static final int OK = 0xFF3DD68C;
    static final int WARN = 0xFFFFB454;
    static final int ERR = 0xFFFF5C6C;

    static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    static int dp(Context c, float v) {
        return (int) (v * c.getResources().getDisplayMetrics().density + 0.5f);
    }

    static GradientDrawable round(Context c, int color, float rDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(c, rDp));
        return g;
    }

    static LinearLayout.LayoutParams lp(int w, int h, float weight) {
        return new LinearLayout.LayoutParams(w, h, weight);
    }

    static LinearLayout.LayoutParams lp(Context c, int w, int h, float weight, int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h, weight);
        p.setMargins(dp(c, l), dp(c, t), dp(c, r), dp(c, b));
        return p;
    }

    /** kind: 0 nút chính (xanh), 1 nút phụ, 2 nút nguy hiểm */
    static Button btn(Context c, String text, int kind, View.OnClickListener l) {
        Button b = new Button(c);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setStateListAnimator(null);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(c, 12), dp(c, 10), dp(c, 12), dp(c, 10));
        int bg = kind == 0 ? ACC : kind == 2 ? 0xFF4A2630 : CARD2;
        b.setTextColor(kind == 0 ? 0xFF06101C : kind == 2 ? ERR : TEXT);
        GradientDrawable g = round(c, bg, 10);
        b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x44FFFFFF), g, null));
        b.setOnClickListener(l);
        return b;
    }

    static TextView text(Context c, String s, float sp, int color) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    static EditText edit(Context c, String hint, boolean mono) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setHintTextColor(0xFF5E6F88);
        e.setTextColor(TEXT);
        e.setTextSize(14);
        if (mono) e.setTypeface(Typeface.MONOSPACE);
        e.setPadding(dp(c, 12), dp(c, 10), dp(c, 12), dp(c, 10));
        e.setBackground(round(c, 0xFF0F1826, 10));
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        return e;
    }

    static LinearLayout col(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    static LinearLayout card(Context c) {
        LinearLayout l = col(c);
        l.setBackground(round(c, CARD, 14));
        l.setPadding(dp(c, 12), dp(c, 12), dp(c, 12), dp(c, 12));
        return l;
    }

    static View space(Context c, int hDp) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(MATCH, dp(c, hDp)));
        return v;
    }
}
