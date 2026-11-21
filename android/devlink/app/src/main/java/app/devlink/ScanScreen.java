package app.devlink;

import android.net.Uri;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** Quét đầu xe bằng các lệnh chỉ-đọc: một chạm là ra báo cáo, sao chép hoặc chia sẻ cho Claude. */
final class ScanScreen extends Screen {
    private final LinearLayout root;
    private final LinearLayout list;
    private final OutView out;
    private final Button all, stop, shareFile;
    private Ssh.Job job;
    private Uri lastReport;

    ScanScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 4), Ui.dp(a, 12), Ui.dp(a, 8));

        LinearLayout top = Ui.row(a);
        all = Ui.btn(a, "▶ Quét tất cả → Báo cáo", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                runItems(Scans.all(a.store), true, "Báo cáo đầy đủ");
            }
        });
        stop = Ui.btn(a, "■", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Ssh.Job j = job;
                if (j != null) j.cancel();
            }
        });
        stop.setEnabled(false);
        top.addView(all, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        top.addView(stop, Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 0, 0));
        root.addView(top, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));

        ScrollView sv = new ScrollView(a);
        list = Ui.col(a);
        sv.addView(list, new ScrollView.LayoutParams(Ui.MATCH, Ui.WRAP));
        root.addView(sv, new LinearLayout.LayoutParams(Ui.MATCH, 0, 0.85f));

        out = new OutView(a);
        root.addView(out, Ui.lp(a, Ui.MATCH, 0, 1.2f, 0, 6, 0, 0));

        LinearLayout r2 = Ui.row(a);
        r2.addView(Ui.btn(a, "📋 Sao chép", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (out.isEmpty()) {
                    a.toast("Chưa có kết quả");
                    return;
                }
                a.copy("báo cáo quét", out.text());
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 6, 0));
        shareFile = Ui.btn(a, "📤 Chia sẻ tệp", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                shareReport();
            }
        });
        r2.addView(shareFile, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 6, 0, 0));
        root.addView(r2);
    }

    @Override
    View view() {
        return root;
    }

    @Override
    void onShow() {
        list.removeAllViews();
        for (final Scans.Item it : Scans.all(a.store)) {
            LinearLayout card = Ui.card(a);
            card.setPadding(Ui.dp(a, 12), Ui.dp(a, 8), Ui.dp(a, 8), Ui.dp(a, 8));
            LinearLayout row = Ui.row(a);
            LinearLayout txt = Ui.col(a);
            TextView t = Ui.text(a, (it.custom ? "★ " : "") + it.title, 15, Ui.TEXT);
            t.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
            txt.addView(t);
            txt.addView(Ui.text(a, it.desc, 12, Ui.DIM));
            row.addView(txt, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
            row.addView(Ui.btn(a, "▶", 1, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    ArrayList<Scans.Item> one = new ArrayList<>();
                    one.add(it);
                    runItems(one, false, it.title);
                }
            }), new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP));
            card.addView(row);
            if (it.custom) {
                card.setOnLongClickListener(new View.OnLongClickListener() {
                    @Override
                    public boolean onLongClick(View v) {
                        a.confirm("Xóa mục quét", "Xóa \"" + it.title + "\"?", "Xóa", new Runnable() {
                            @Override
                            public void run() {
                                a.store.removeScan(it.index);
                                onShow();
                            }
                        });
                        return true;
                    }
                });
            }
            list.addView(card, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));
        }
    }

    private void busy(boolean b) {
        all.setEnabled(!b);
        stop.setEnabled(b);
    }

    private void runItems(final List<Scans.Item> items, final boolean report, final String name) {
        if (job != null) {
            a.toast("Đang quét");
            return;
        }
        out.clear();
        lastReport = null;
        out.setInfo("Đang quét…", Ui.DIM);
        final Ssh.Job j = new Ssh.Job();
        job = j;
        busy(true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                String info;
                int color = Ui.OK;
                try {
                    Ssh.ensure(a, a.store);
                    final Ssh.Out sink = new Ssh.Out() {
                        @Override
                        public void chunk(String s) {
                            out.append(s);
                        }
                    };
                    out.append("MGU DevLink - " + name + "\n" + Util.stampNice(new Date()) + " (giờ điện thoại)\n"
                        + Ssh.who() + (Ssh.banner().isEmpty() ? "" : "  " + Ssh.banner()) + "\n\n");
                    int n = 0;
                    for (Scans.Item it : items) {
                        if (j.stopped) break;
                        n++;
                        final String head = "===== " + it.title + " =====\n";
                        out.append(head);
                        out.setInfo("Đang quét " + n + "/" + items.size() + ": " + it.title, Ui.DIM);
                        Ssh.run(it.script, sink, j);
                        out.append("\n");
                    }
                    if (j.stopped) {
                        info = "Đã dừng";
                        color = Ui.WARN;
                    } else if (report) {
                        final String text = out.text();
                        final String fname = "bao-cao-" + Util.stamp(new Date()) + ".txt";
                        Uri u = a.saveDownload(fname, "text/plain", new MainActivity.Writer() {
                            @Override
                            public void write(java.io.OutputStream os) throws Exception {
                                os.write(text.getBytes(StandardCharsets.UTF_8));
                            }
                        });
                        lastReport = u;
                        a.store.lastReport(u.toString());
                        info = "Xong. Đã lưu Tải xuống/MGU-DevLink/" + fname + ". Bấm Sao chép hoặc Chia sẻ tệp để gửi.";
                    } else {
                        info = "Xong.";
                    }
                } catch (Util.HostKeyChanged hk) {
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

    private void shareReport() {
        Uri u = lastReport;
        if (u == null) {
            String s = a.store.lastReport();
            if (!s.isEmpty()) u = Uri.parse(s);
        }
        if (u != null) {
            try {
                a.shareUri(u, "text/plain");
                return;
            } catch (Exception e) {
                // báo cáo cũ có thể đã bị xóa: rơi xuống chia sẻ chữ
            }
        }
        if (out.isEmpty()) {
            a.toast("Chưa có kết quả");
            return;
        }
        a.shareText(out.text());
    }
}
