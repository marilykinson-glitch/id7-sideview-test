package app.devlink;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final int REQ_KEY = 11;
    static final int REQ_UPLOAD = 12;

    static final int TAB_CONNECT = 0, TAB_CMD = 1, TAB_SCAN = 2, TAB_FILES = 3, TAB_RELAY = 4, TAB_MGU = 5, TAB_FLASH = 6;
    static final int TABS = 7;

    interface Writer {
        void write(OutputStream os) throws Exception;
    }

    final Handler ui = new Handler(Looper.getMainLooper());
    final ExecutorService pool = Executors.newCachedThreadPool();
    Store store;

    private FrameLayout content;
    private TextView status;
    private final TextView[] tabViews = new TextView[TABS];
    private Screen[] screens;
    private int cur = -1;

    ConnectScreen connectScreen;
    CmdScreen cmdScreen;
    ScanScreen scanScreen;
    FilesScreen filesScreen;
    RelayScreen relayScreen;
    MguScreen mguScreen;
    FlashScreen flashScreen;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        store = new Store(this);
        getWindow().setStatusBarColor(Ui.BG);
        getWindow().setNavigationBarColor(Ui.BG);

        LinearLayout root = Ui.col(this);
        root.setBackgroundColor(Ui.BG);

        // thanh trên: tên app + trạng thái kết nối
        LinearLayout top = Ui.row(this);
        top.setPadding(Ui.dp(this, 14), Ui.dp(this, 10), Ui.dp(this, 14), Ui.dp(this, 8));
        TextView title = Ui.text(this, "MGU DevLink", 18, Ui.TEXT);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        top.addView(title, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        status = Ui.text(this, "", 12, Ui.DIM);
        status.setGravity(Gravity.END);
        top.addView(status, new LinearLayout.LayoutParams(0, Ui.WRAP, 1.6f));
        root.addView(top, new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP));

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));

        // thanh dưới
        LinearLayout nav = Ui.row(this);
        nav.setBackgroundColor(0xFF111A29);
        String[] names = {"🔌 Kết nối", "⌨ Lệnh", "🔎 Quét", "📁 Tệp", "🤖 Claude", "📦 Cài MGU", "🔑 Mở SSH"};
        for (int i = 0; i < TABS; i++) {
            final int idx = i;
            TextView t = Ui.text(this, names[i], 13, Ui.DIM);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
            t.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showTab(idx);
                }
            });
            tabViews[i] = t;
            nav.addView(t, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        }
        root.addView(nav, new LinearLayout.LayoutParams(Ui.MATCH, Ui.WRAP));
        setContentView(root);

        connectScreen = new ConnectScreen(this);
        cmdScreen = new CmdScreen(this);
        scanScreen = new ScanScreen(this);
        filesScreen = new FilesScreen(this);
        relayScreen = new RelayScreen(this);
        mguScreen = new MguScreen(this);
        flashScreen = new FlashScreen(this);
        screens = new Screen[]{connectScreen, cmdScreen, scanScreen, filesScreen, relayScreen, mguScreen, flashScreen};
        showTab(store.hasKey() || !store.password().isEmpty() ? TAB_CMD : TAB_CONNECT);
        refreshStatus();
        if (store.relayOn()) RelayScreen.startService(this);
    }

    void showTab(int i) {
        if (i == cur) return;
        cur = i;
        content.removeAllViews();
        content.addView(screens[i].view(), new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        for (int k = 0; k < TABS; k++) {
            tabViews[k].setTextColor(k == i ? Ui.ACC : Ui.DIM);
            tabViews[k].setTypeface(k == i ? android.graphics.Typeface.DEFAULT_BOLD : android.graphics.Typeface.DEFAULT);
        }
        screens[i].onShow();
    }

    void refreshStatus() {
        final boolean up = Ssh.up();
        status.setText(up ? "● " + Ssh.who() : "○ chưa kết nối");
        status.setTextColor(up ? Ui.OK : Ui.DIM);
        if (up) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---- tiện ích dùng chung ----

    void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    void toastLong(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }

    String clip() {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) return "";
        ClipData d = cm.getPrimaryClip();
        if (d == null || d.getItemCount() == 0) return "";
        CharSequence t = d.getItemAt(0).coerceToText(this);
        return t == null ? "" : t.toString();
    }

    /** sao chép vào clipboard; văn bản quá dài thì chỉ lấy phần cuối (Android giới hạn ~1 MB mỗi lần) */
    void copy(String label, String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        String t = text;
        boolean cut = false;
        if (t.length() > 300000) {
            t = t.substring(t.length() - 300000);
            cut = true;
        }
        try {
            cm.setPrimaryClip(ClipData.newPlainText(label, t));
            toast(cut ? "Dài quá, chỉ copy 300.000 ký tự cuối. Dùng Chia sẻ để gửi đủ." : "Đã sao chép " + t.length() + " ký tự");
        } catch (Exception e) {
            toastLong("Không sao chép được (quá dài). Dùng Chia sẻ.");
        }
    }

    Uri saveDownload(String name, String mime, Writer w) throws Exception {
        ContentResolver r = getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MGU-DevLink");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri u = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (u == null) throw new IOException("Không tạo được tệp trong Tải xuống");
        try {
            OutputStream os = r.openOutputStream(u);
            if (os == null) throw new IOException("Không ghi được tệp");
            try {
                w.write(os);
            } finally {
                os.close();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            r.update(u, done, null, null);
            return u;
        } catch (Exception e) {
            try {
                r.delete(u, null, null);
            } catch (Exception x) {
                // bỏ qua
            }
            throw e;
        }
    }

    void shareUri(Uri u, String mime) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_STREAM, u);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivity(Intent.createChooser(i, "Chia sẻ"));
    }

    void shareText(String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        String t = text.length() > 200000 ? text.substring(text.length() - 200000) : text;
        i.putExtra(Intent.EXTRA_TEXT, t);
        startActivity(Intent.createChooser(i, "Chia sẻ"));
    }

    void confirm(String title, String msg, String yes, final Runnable onYes) {
        new AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(msg)
            .setPositiveButton(yes, new android.content.DialogInterface.OnClickListener() {
                @Override
                public void onClick(android.content.DialogInterface d, int w) {
                    onYes.run();
                }
            })
            .setNegativeButton("Hủy", null)
            .show();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null) return;
        if (req == REQ_KEY && data.getData() != null) {
            connectScreen.onKeyPicked(data.getData());
        } else if (req == REQ_UPLOAD) {
            ArrayList<Uri> l = new ArrayList<>();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) l.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) {
                l.add(data.getData());
            }
            filesScreen.onUploadPicked(l);
        }
    }

    @Override
    public void onBackPressed() {
        if (cur == TAB_FILES && filesScreen.up()) return;
        super.onBackPressed();
    }
}
