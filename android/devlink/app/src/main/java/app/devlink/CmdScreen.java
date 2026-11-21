package app.devlink;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;

/** Dán lệnh (từ Claude hay bất kỳ đâu) → chạy → sao chép kết quả gửi lại. */
final class CmdScreen extends Screen {
    private final LinearLayout root;
    private final EditText input;
    private final OutView out;
    private final Button run, stop;
    private Ssh.Job job;
    private String lastScript = "";

    CmdScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 4), Ui.dp(a, 12), Ui.dp(a, 8));

        // một chạm: lấy lệnh trong clipboard và chạy luôn
        root.addView(Ui.btn(a, "⚡ Dán lệnh từ clipboard & chạy", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String s = a.clip();
                if (s.trim().isEmpty()) {
                    a.toast("Clipboard đang trống");
                    return;
                }
                input.setText(s);
                start(s);
            }
        }), Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        input = Ui.edit(a, "Hoặc gõ / dán lệnh vào đây (nhiều dòng cũng được)", true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        input.setMinLines(2);
        input.setMaxLines(6);
        input.setGravity(android.view.Gravity.TOP);
        root.addView(input, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        LinearLayout r1 = Ui.row(a);
        run = Ui.btn(a, "▶ Chạy", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                start(input.getText().toString());
            }
        });
        stop = Ui.btn(a, "■ Dừng", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Ssh.Job j = job;
                if (j != null) j.cancel();
            }
        });
        stop.setEnabled(false);
        r1.addView(run, Ui.lp(a, 0, Ui.WRAP, 1.4f, 0, 0, 6, 0));
        r1.addView(stop, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        r1.addView(Ui.btn(a, "📋 Dán", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                input.setText(a.clip());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        r1.addView(Ui.btn(a, "🕘", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showHistory();
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 0, 0));
        root.addView(r1, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        out = new OutView(a);
        root.addView(out, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));

        LinearLayout r2 = Ui.row(a);
        r2.addView(Ui.btn(a, "📋 Sao chép kết quả", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (out.isEmpty()) {
                    a.toast("Chưa có kết quả");
                    return;
                }
                a.copy("kết quả", out.text());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1.5f, 0, 6, 6, 0));
        r2.addView(Ui.btn(a, "Kèm lệnh", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (out.isEmpty()) {
                    a.toast("Chưa có kết quả");
                    return;
                }
                a.copy("lệnh và kết quả", withCommand());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 6, 0));
        r2.addView(Ui.btn(a, "Chia sẻ", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                shareOut();
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 6, 0));
        r2.addView(Ui.btn(a, "Lưu quét", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveAsScan();
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 0, 0));
        root.addView(r2);
    }

    @Override
    View view() {
        return root;
    }

    /** các mục khác gọi để chạy một lệnh ngay trong tab này */
    void runText(String script) {
        input.setText(script);
        start(script);
    }

    private String withCommand() {
        return "$ " + lastScript.trim() + "\n" + out.text();
    }

    private void busy(boolean b) {
        run.setEnabled(!b);
        stop.setEnabled(b);
    }

    private void start(final String raw) {
        final String script = Util.normText(raw).trim();
        if (script.isEmpty()) {
            a.toast("Chưa có lệnh");
            return;
        }
        if (job != null) {
            a.toast("Đang chạy lệnh khác");
            return;
        }
        lastScript = script;
        a.store.pushHistory(script);
        out.clear();
        out.setInfo("Đang chạy…", Ui.DIM);
        final Ssh.Job j = new Ssh.Job();
        job = j;
        busy(true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                long t0 = System.currentTimeMillis();
                String info;
                int color = Ui.OK;
                try {
                    Ssh.ensure(a, a.store);
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            a.refreshStatus();
                        }
                    });
                    int rc = Ssh.run(script, new Ssh.Out() {
                        @Override
                        public void chunk(String s) {
                            out.append(s);
                        }
                    }, j);
                    double sec = (System.currentTimeMillis() - t0) / 1000.0;
                    if (rc == -999) {
                        info = "Đã dừng sau " + String.format(java.util.Locale.US, "%.1f", sec) + " giây";
                        color = Ui.WARN;
                    } else {
                        info = "Xong, mã thoát " + rc + ", " + String.format(java.util.Locale.US, "%.1f", sec) + " giây"
                            + (out.wasTruncated() ? " (kết quả rất dài, đã cắt phần đầu)" : "");
                        if (rc != 0) color = Ui.WARN;
                    }
                } catch (final Util.HostKeyChanged hk) {
                    info = "Khóa nhận dạng của máy đã đổi. Vào mục Kết nối để tin lại.";
                    color = Ui.ERR;
                } catch (Throwable e) {
                    info = "Lỗi: " + Util.friendly(e);
                    color = Ui.ERR;
                    out.append("\n[" + Util.friendly(e) + "]\n");
                }
                final String fi = info;
                final int fc = color;
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

    private void shareOut() {
        if (out.isEmpty()) {
            a.toast("Chưa có kết quả");
            return;
        }
        final String text = withCommand();
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final Uri u = a.saveDownload("ket-qua-" + Util.stamp(new Date()) + ".txt", "text/plain", new MainActivity.Writer() {
                        @Override
                        public void write(java.io.OutputStream os) throws Exception {
                            os.write(text.getBytes(StandardCharsets.UTF_8));
                        }
                    });
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            a.shareUri(u, "text/plain");
                        }
                    });
                } catch (final Exception e) {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            a.toastLong("Không chia sẻ được: " + e.getMessage());
                        }
                    });
                }
            }
        });
    }

    private void saveAsScan() {
        final String script = Util.normText(input.getText().toString()).trim();
        if (script.isEmpty()) {
            a.toast("Chưa có lệnh để lưu");
            return;
        }
        final EditText name = Ui.edit(a, "Tên mục quét", false);
        int pad = Ui.dp(a, 16);
        LinearLayout box = Ui.col(a);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(name);
        new AlertDialog.Builder(a)
            .setTitle("Lưu vào mục Quét")
            .setView(box)
            .setPositiveButton("Lưu", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    String n = name.getText().toString().trim();
                    if (n.isEmpty()) n = script.split("\n")[0];
                    if (n.length() > 40) n = n.substring(0, 40);
                    a.store.addScan(n, script);
                    a.toast("Đã lưu vào mục Quét");
                }
            })
            .setNegativeButton("Hủy", null)
            .show();
    }

    private void showHistory() {
        final List<String> h = a.store.history();
        if (h.isEmpty()) {
            a.toast("Chưa có lịch sử");
            return;
        }
        String[] items = new String[h.size()];
        for (int i = 0; i < items.length; i++) {
            String s = h.get(i).replace('\n', ' ');
            items[i] = s.length() > 80 ? s.substring(0, 80) + "…" : s;
        }
        new AlertDialog.Builder(a)
            .setTitle("Lệnh đã chạy")
            .setItems(items, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int which) {
                    input.setText(h.get(which));
                }
            })
            .setNeutralButton("Xóa lịch sử", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    a.store.clearHistory();
                }
            })
            .setNegativeButton("Đóng", null)
            .show();
    }
}
