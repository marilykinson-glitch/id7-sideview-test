package app.devlink;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Duyệt tệp trên đầu xe, tải về / tải lên / dán thành tệp. Không cần SFTP: dùng cat và tar qua SSH. */
final class FilesScreen extends Screen {
    private final LinearLayout root;
    private final EditText path;
    private final ListView listView;
    private final TextView info, prog;
    private final Button stop;
    private final ArrayList<Util.Entry> items = new ArrayList<>();
    private String cwd = "/tmp";
    private Ssh.Job job;
    private boolean loaded;

    private final BaseAdapter adapter = new BaseAdapter() {
        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Object getItem(int i) {
            return items.get(i);
        }

        @Override
        public long getItemId(int i) {
            return i;
        }

        @Override
        public View getView(int i, View v, ViewGroup parent) {
            LinearLayout row;
            TextView ic, name, size;
            if (v == null) {
                row = Ui.row(a);
                row.setPadding(Ui.dp(a, 8), Ui.dp(a, 11), Ui.dp(a, 8), Ui.dp(a, 11));
                ic = Ui.text(a, "", 18, Ui.TEXT);
                name = Ui.text(a, "", 15, Ui.TEXT);
                name.setSingleLine(true);
                name.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
                size = Ui.text(a, "", 12, Ui.DIM);
                size.setGravity(Gravity.END);
                row.addView(ic, new LinearLayout.LayoutParams(Ui.dp(a, 30), Ui.WRAP));
                row.addView(name, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
                row.addView(size, new LinearLayout.LayoutParams(Ui.dp(a, 74), Ui.WRAP));
                row.setTag(new TextView[]{ic, name, size});
            } else {
                row = (LinearLayout) v;
            }
            TextView[] t = (TextView[]) row.getTag();
            Util.Entry e = items.get(i);
            t[0].setText(e.type == 'd' ? "📁" : e.type == 'l' ? "🔗" : "📄");
            t[1].setText(e.name);
            t[1].setTextColor(e.type == 'd' ? Ui.ACC : Ui.TEXT);
            t[2].setText(e.type == 'd' ? "" : Util.human(e.size));
            return row;
        }
    };

    FilesScreen(final MainActivity a) {
        super(a);
        root = Ui.col(a);
        root.setPadding(Ui.dp(a, 12), Ui.dp(a, 4), Ui.dp(a, 12), Ui.dp(a, 8));

        LinearLayout r1 = Ui.row(a);
        r1.addView(Ui.btn(a, "⬆", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                up();
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 6, 0));
        path = Ui.edit(a, "/đường/dẫn (thư mục hay tệp)", true);
        path.setSingleLine(true);
        path.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        path.setOnEditorActionListener(new android.widget.TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, android.view.KeyEvent ev) {
                go(path.getText().toString());
                return true;
            }
        });
        r1.addView(path, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        r1.addView(Ui.btn(a, "Đi", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                go(path.getText().toString());
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 0, 0));
        root.addView(r1, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 4));

        HorizontalScrollView hs = new HorizontalScrollView(a);
        LinearLayout chips = Ui.row(a);
        String[] quick = {"/tmp", "/run", "/var", "/opt", "/etc", "/"};
        for (final String q : quick) {
            chips.addView(Ui.btn(a, q, 1, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    go(q);
                }
            }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 6, 0));
        }
        hs.addView(chips);
        root.addView(hs, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 4));

        info = Ui.text(a, "", 12, Ui.DIM);
        root.addView(info);

        listView = new ListView(a);
        listView.setBackground(Ui.round(a, 0xFF0F1826, 12));
        listView.setDivider(new android.graphics.drawable.ColorDrawable(Ui.LINE));
        listView.setDividerHeight(1);
        listView.setAdapter(adapter);
        listView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> p, View v, int i, long id) {
                Util.Entry e = items.get(i);
                String full = Util.join(cwd, e.name);
                if (e.type == 'f') fileMenu(full, e.size);
                else go(full);
            }
        });
        listView.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(AdapterView<?> p, View v, int i, long id) {
                Util.Entry e = items.get(i);
                String full = Util.join(cwd, e.name);
                if (e.type == 'f') fileMenu(full, e.size);
                else dirMenu(full);
                return true;
            }
        });
        root.addView(listView, Ui.lp(a, Ui.MATCH, 0, 1f, 0, 0, 0, 0));

        LinearLayout pr = Ui.row(a);
        prog = Ui.text(a, "", 12, Ui.ACC);
        stop = Ui.btn(a, "■", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Ssh.Job j = job;
                if (j != null) j.cancel();
            }
        });
        stop.setVisibility(View.GONE);
        pr.addView(prog, new LinearLayout.LayoutParams(0, Ui.WRAP, 1f));
        pr.addView(stop, new LinearLayout.LayoutParams(Ui.WRAP, Ui.WRAP));
        root.addView(pr, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 4, 0, 0));

        LinearLayout r2 = Ui.row(a);
        r2.addView(Ui.btn(a, "⬆ Tải lên", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                a.startActivityForResult(i, MainActivity.REQ_UPLOAD);
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 4, 6, 0));
        r2.addView(Ui.btn(a, "📋 Dán thành tệp", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pasteAsFile();
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1.3f, 0, 4, 6, 0));
        r2.addView(Ui.btn(a, "📁+", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                newFolder();
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 4, 6, 0));
        r2.addView(Ui.btn(a, "⟳", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                go(cwd);
            }
        }), Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 4, 0, 0));
        root.addView(r2);
    }

    @Override
    View view() {
        return root;
    }

    @Override
    void onShow() {
        path.setText(cwd);
        if (!loaded) {
            loaded = true;
            go(cwd);
        }
    }

    /** true nếu đã xử lý (lên một cấp) */
    boolean up() {
        if (cwd.equals("/")) return false;
        go(Util.parent(cwd));
        return true;
    }

    private void showProg(final String s, final boolean running) {
        a.ui.post(new Runnable() {
            @Override
            public void run() {
                prog.setText(s);
                stop.setVisibility(running ? View.VISIBLE : View.GONE);
            }
        });
    }

    private void err(final Throwable e) {
        a.ui.post(new Runnable() {
            @Override
            public void run() {
                info.setText("✖ " + (e instanceof Util.HostKeyChanged ? "Khóa nhận dạng của máy đã đổi. Vào mục Kết nối." : Util.friendly(e)));
                info.setTextColor(Ui.ERR);
                a.refreshStatus();
            }
        });
    }

    // ---- duyệt ----

    void go(String p) {
        final String target = Util.cleanPath(p);
        info.setText("Đang đọc " + target + "…");
        info.setTextColor(Ui.DIM);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Ssh.ensure(a, a.store);
                    Ssh.Res r = Ssh.capture(Util.listScript(target));
                    final Util.Listing l = Util.parseListing(r.out);
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            a.refreshStatus();
                            if (l.kind == 'D') {
                                cwd = target;
                                items.clear();
                                items.addAll(l.items);
                                adapter.notifyDataSetChanged();
                                listView.setSelection(0);
                                path.setText(cwd);
                                info.setText(items.size() + " mục" + (items.size() >= 3000 ? " (chỉ hiện 3000 đầu)" : "") + "  •  chạm tệp để tải, giữ để thêm tuỳ chọn");
                                info.setTextColor(Ui.DIM);
                            } else if (l.kind == 'F') {
                                info.setText(target);
                                info.setTextColor(Ui.DIM);
                                fileMenu(target, l.fileSize);
                            } else {
                                info.setText("Không có: " + target);
                                info.setTextColor(Ui.WARN);
                            }
                        }
                    });
                } catch (Throwable e) {
                    err(e);
                }
            }
        });
    }

    // ---- menu ----

    private void fileMenu(final String full, final long size) {
        String[] it = {
            "⬇ Tải về (lưu vào Tải xuống)",
            "📤 Tải về rồi chia sẻ",
            "👁 Xem nội dung (200 KB đầu)",
            "📋 Sao chép đường dẫn",
            "🗑 Xóa…"
        };
        new AlertDialog.Builder(a)
            .setTitle(Util.base(full) + (size >= 0 ? "  (" + Util.human(size) + ")" : ""))
            .setItems(it, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int which) {
                    if (which == 0) download(full, size, false, false);
                    else if (which == 1) download(full, size, true, false);
                    else if (which == 2) {
                        a.showTab(MainActivity.TAB_CMD);
                        a.cmdScreen.runText("head -c 200000 " + Util.sq(full));
                    } else if (which == 3) a.copy("đường dẫn", full);
                    else deleteIt(full, false);
                }
            })
            .show();
    }

    private void dirMenu(final String full) {
        String[] it = {
            "⬇ Nén (tar) rồi tải về",
            "📋 Sao chép đường dẫn",
            "🗑 Xóa cả thư mục…"
        };
        new AlertDialog.Builder(a)
            .setTitle(Util.base(full) + "/")
            .setItems(it, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int which) {
                    if (which == 0) {
                        if (full.equals("/")) a.toast("Không nén cả thư mục gốc");
                        else download(full, -1, false, true);
                    } else if (which == 1) a.copy("đường dẫn", full);
                    else deleteIt(full, true);
                }
            })
            .show();
    }

    private void deleteIt(final String full, final boolean dir) {
        a.confirm("Xóa trên máy", "Xóa " + (dir ? "CẢ THƯ MỤC " : "tệp ") + full + "?\nKhông khôi phục được.", "Xóa", new Runnable() {
            @Override
            public void run() {
                a.pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Ssh.ensure(a, a.store);
                            Ssh.Res r = Ssh.capture((dir ? "rm -rf " : "rm -f ") + Util.sq(full));
                            if (r.code != 0) throw new IllegalStateException("Không xóa được: " + r.err.trim());
                            a.ui.post(new Runnable() {
                                @Override
                                public void run() {
                                    a.toast("Đã xóa");
                                    go(cwd);
                                }
                            });
                        } catch (Throwable e) {
                            err(e);
                        }
                    }
                });
            }
        });
    }

    // ---- tải về ----

    private void download(final String remote, final long total, final boolean share, final boolean tar) {
        if (job != null) {
            a.toast("Đang truyền tệp khác");
            return;
        }
        final String name = Util.base(remote) + (tar ? ".tar" : "");
        final String cmd = tar
            ? "tar cf - -C " + Util.sq(Util.parent(remote)) + " " + Util.sq(Util.base(remote))
            : "cat " + Util.sq(remote);
        final Ssh.Job j = new Ssh.Job();
        job = j;
        showProg("Đang tải " + name + "…", true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Ssh.ensure(a, a.store);
                    final long[] got = new long[1];
                    final Uri u = a.saveDownload(name, tar ? "application/x-tar" : "application/octet-stream", new MainActivity.Writer() {
                        @Override
                        public void write(OutputStream os) throws Exception {
                            got[0] = Ssh.pull(cmd, os, new Ssh.Prog() {
                                @Override
                                public void on(long b) {
                                    showProg("Đang tải " + name + ": " + Util.human(b) + (total > 0 ? " / " + Util.human(total) : ""), true);
                                }
                            }, j);
                        }
                    });
                    showProg("✔ Đã lưu " + name + " (" + Util.human(got[0]) + ") vào Tải xuống/MGU-DevLink", false);
                    if (share) {
                        a.ui.post(new Runnable() {
                            @Override
                            public void run() {
                                a.shareUri(u, tar ? "application/x-tar" : "application/octet-stream");
                            }
                        });
                    }
                } catch (final Ssh.Cancelled c) {
                    showProg("Đã dừng.", false);
                } catch (Throwable e) {
                    showProg("✖ " + Util.friendly(e), false);
                } finally {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            job = null;
                            a.refreshStatus();
                        }
                    });
                }
            }
        });
    }

    // ---- tải lên ----

    private void exeDialog(String title, String msg, View extra, final CheckBox exe, final Runnable ok) {
        LinearLayout box = Ui.col(a);
        int pad = Ui.dp(a, 16);
        box.setPadding(pad, pad / 2, pad, 0);
        if (extra != null) box.addView(extra);
        box.addView(exe);
        new AlertDialog.Builder(a)
            .setTitle(title)
            .setMessage(msg)
            .setView(box)
            .setPositiveButton("Tải lên", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    ok.run();
                }
            })
            .setNegativeButton("Hủy", null)
            .show();
    }

    private CheckBox exeBox() {
        CheckBox c = new CheckBox(a);
        c.setText("Cho phép chạy (chmod +x)");
        c.setTextColor(Ui.TEXT);
        return c;
    }

    void onUploadPicked(final List<Uri> uris) {
        if (uris.isEmpty()) return;
        final CheckBox exe = exeBox();
        exeDialog("Tải " + uris.size() + " tệp lên " + cwd, "Tệp trùng tên sẽ bị ghi đè.", null, exe, new Runnable() {
            @Override
            public void run() {
                uploadAll(uris, exe.isChecked());
            }
        });
    }

    private String displayName(Uri u) {
        Cursor c = null;
        try {
            c = a.getContentResolver().query(u, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) return c.getString(i);
            }
        } catch (Exception e) {
            // dùng tên dự phòng
        } finally {
            if (c != null) c.close();
        }
        String s = u.getLastPathSegment();
        return s == null ? "tep" : s.substring(s.lastIndexOf('/') + 1);
    }

    private void uploadAll(final List<Uri> uris, final boolean exe) {
        if (job != null) {
            a.toast("Đang truyền tệp khác");
            return;
        }
        final String dir = cwd;
        final Ssh.Job j = new Ssh.Job();
        job = j;
        showProg("Đang tải lên…", true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                int ok = 0;
                try {
                    Ssh.ensure(a, a.store);
                    for (Uri u : uris) {
                        final String name = displayName(u);
                        InputStream in = a.getContentResolver().openInputStream(u);
                        if (in == null) throw new IllegalStateException("Không mở được " + name);
                        try {
                            Ssh.push(in, Util.join(dir, name), exe, new Ssh.Prog() {
                                @Override
                                public void on(long b) {
                                    showProg("Đang tải lên " + name + ": " + Util.human(b), true);
                                }
                            }, j);
                        } finally {
                            in.close();
                        }
                        ok++;
                    }
                    showProg("✔ Đã tải lên " + ok + " tệp vào " + dir, false);
                } catch (final Ssh.Cancelled c) {
                    showProg("Đã dừng (xong " + ok + " tệp).", false);
                } catch (Throwable e) {
                    showProg("✖ " + Util.friendly(e), false);
                } finally {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            job = null;
                            go(cwd);
                        }
                    });
                }
            }
        });
    }

    private void pasteAsFile() {
        final EditText name = Ui.edit(a, "Tên tệp, ví dụ chay.sh", true);
        final EditText body = Ui.edit(a, "Nội dung", true);
        body.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        body.setMinLines(4);
        body.setMaxLines(10);
        body.setGravity(Gravity.TOP);
        body.setText(a.clip());
        LinearLayout holder = Ui.col(a);
        holder.addView(name, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 0, 0, 6));
        holder.addView(body);
        final CheckBox exe = exeBox();
        exeDialog("Dán thành tệp trong " + cwd, "Nội dung lấy từ clipboard, sửa được trước khi tải lên.", holder, exe, new Runnable() {
            @Override
            public void run() {
                String n = name.getText().toString().trim();
                if (n.isEmpty() || n.contains("/")) {
                    a.toast("Tên tệp không hợp lệ");
                    return;
                }
                final byte[] data = Util.normText(body.getText().toString()).getBytes(StandardCharsets.UTF_8);
                uploadBytes(n, data, exe.isChecked());
            }
        });
    }

    private void uploadBytes(final String name, final byte[] data, final boolean exe) {
        if (job != null) {
            a.toast("Đang truyền tệp khác");
            return;
        }
        final String dir = cwd;
        final Ssh.Job j = new Ssh.Job();
        job = j;
        showProg("Đang ghi " + name + "…", true);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Ssh.ensure(a, a.store);
                    Ssh.push(new ByteArrayInputStream(data), Util.join(dir, name), exe, null, j);
                    showProg("✔ Đã ghi " + Util.join(dir, name) + " (" + Util.human(data.length) + ")", false);
                } catch (Throwable e) {
                    showProg("✖ " + Util.friendly(e), false);
                } finally {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            job = null;
                            go(cwd);
                        }
                    });
                }
            }
        });
    }

    private void newFolder() {
        final EditText name = Ui.edit(a, "Tên thư mục mới", true);
        LinearLayout box = Ui.col(a);
        int pad = Ui.dp(a, 16);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(name);
        new AlertDialog.Builder(a)
            .setTitle("Thư mục mới trong " + cwd)
            .setView(box)
            .setPositiveButton("Tạo", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    final String n = name.getText().toString().trim();
                    if (n.isEmpty()) return;
                    final String full = Util.join(cwd, n);
                    a.pool.execute(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                Ssh.ensure(a, a.store);
                                Ssh.Res r = Ssh.capture("mkdir -p " + Util.sq(full));
                                if (r.code != 0) throw new IllegalStateException("Không tạo được: " + r.err.trim());
                                a.ui.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        go(cwd);
                                    }
                                });
                            } catch (Throwable e) {
                                err(e);
                            }
                        }
                    });
                }
            })
            .setNegativeButton("Hủy", null)
            .show();
    }
}
