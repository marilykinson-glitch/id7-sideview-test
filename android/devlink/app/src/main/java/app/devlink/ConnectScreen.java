package app.devlink;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.text.method.PasswordTransformationMethod;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;

final class ConnectScreen extends Screen {
    private final ScrollView root;
    private final EditText host, port, user, pass, pw;
    private final TextView keyInfo, msg, found, help;
    private final LinearLayout chips;
    private final Button connect, disconnect, scan;

    ConnectScreen(final MainActivity a) {
        super(a);
        root = new ScrollView(a);
        LinearLayout col = Ui.col(a);
        col.setPadding(Ui.dp(a, 12), Ui.dp(a, 4), Ui.dp(a, 12), Ui.dp(a, 16));
        root.addView(col, new ScrollView.LayoutParams(Ui.MATCH, Ui.WRAP));

        // máy
        LinearLayout c1 = Ui.card(a);
        c1.addView(Ui.text(a, "Máy cần nối (đầu xe / bench)", 13, Ui.DIM));
        host = Ui.edit(a, "IP hoặc tên máy", true);
        c1.addView(host, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 6, 0, 0));
        LinearLayout r = Ui.row(a);
        port = Ui.edit(a, "Cổng", true);
        port.setInputType(InputType.TYPE_CLASS_NUMBER);
        user = Ui.edit(a, "Người dùng", true);
        r.addView(port, Ui.lp(a, 0, Ui.WRAP, 0.8f, 0, 0, 6, 0));
        r.addView(user, Ui.lp(a, 0, Ui.WRAP, 1.4f, 0, 0, 0, 0));
        c1.addView(r, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 6, 0, 0));

        scan = Ui.btn(a, "🔎 Tìm máy có SSH trong Wi-Fi", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doScan();
            }
        });
        c1.addView(scan, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));
        found = Ui.text(a, "", 12, Ui.DIM);
        c1.addView(found, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 4, 0, 0));
        HorizontalScrollView hs = new HorizontalScrollView(a);
        chips = Ui.row(a);
        hs.addView(chips);
        c1.addView(hs, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 2, 0, 0));
        col.addView(c1, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));

        // khóa
        LinearLayout c2 = Ui.card(a);
        c2.addView(Ui.text(a, "Khóa riêng SSH", 13, Ui.DIM));
        keyInfo = Ui.text(a, "", 14, Ui.TEXT);
        c2.addView(keyInfo, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 4, 0, 4));
        LinearLayout kr = Ui.row(a);
        kr.addView(Ui.btn(a, "📋 Dán khóa", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pasteKey();
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        kr.addView(Ui.btn(a, "📂 Chọn tệp", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                a.startActivityForResult(i, MainActivity.REQ_KEY);
            }
        }), Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 6, 0));
        kr.addView(Ui.btn(a, "Xóa", 2, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                a.confirm("Xóa khóa", "Xóa khóa riêng đã lưu trong máy này?", "Xóa", new Runnable() {
                    @Override
                    public void run() {
                        a.store.key("");
                        refreshKey();
                    }
                });
            }
        }), Ui.lp(a, 0, Ui.WRAP, 0.6f, 0, 0, 0, 0));
        c2.addView(kr);
        pass = Ui.edit(a, "Mật khẩu của khóa (nếu khóa có đặt)", false);
        pass.setTransformationMethod(PasswordTransformationMethod.getInstance());
        c2.addView(pass, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));
        pw = Ui.edit(a, "Hoặc mật khẩu đăng nhập (nếu không dùng khóa)", false);
        pw.setTransformationMethod(PasswordTransformationMethod.getInstance());
        c2.addView(pw, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 6, 0, 0));
        col.addView(c2, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));

        // nối
        LinearLayout c3 = Ui.card(a);
        LinearLayout br = Ui.row(a);
        connect = Ui.btn(a, "Kết nối", 0, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                connect();
            }
        });
        disconnect = Ui.btn(a, "Ngắt", 1, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                a.pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        Ssh.disconnect();
                        a.ui.post(new Runnable() {
                            @Override
                            public void run() {
                                a.refreshStatus();
                                setMsg("Đã ngắt.", Ui.DIM);
                            }
                        });
                    }
                });
            }
        });
        br.addView(connect, Ui.lp(a, 0, Ui.WRAP, 2f, 0, 0, 6, 0));
        br.addView(disconnect, Ui.lp(a, 0, Ui.WRAP, 1f, 0, 0, 0, 0));
        c3.addView(br);
        msg = Ui.text(a, "", 13, Ui.DIM);
        c3.addView(msg, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));
        col.addView(c3, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 0, 8, 0, 0));

        help = Ui.text(a,
            "Mẹo:\n"
                + "• Điện thoại phải nối cùng mạng với máy. App tự ép đi qua Wi-Fi, không bị Android đẩy sang 4G khi Wi-Fi của xe không có internet.\n"
                + "• Khóa riêng được mã hóa bằng Android Keystore, chỉ nằm trong máy này.\n"
                + "• Lần đầu nối app ghi nhớ dấu vân tay của máy; nếu đầu xe cài lại, app sẽ hỏi trước khi tin lại.",
            12, Ui.DIM);
        col.addView(help, Ui.lp(a, Ui.MATCH, Ui.WRAP, 0, 4, 4, 4, 0));
    }

    @Override
    View view() {
        return root;
    }

    @Override
    void onShow() {
        host.setText(a.store.host());
        port.setText(String.valueOf(a.store.port()));
        user.setText(a.store.user());
        refreshKey();
        String ips = Net.myWifiIps(a);
        found.setText(ips.isEmpty() ? "Điện thoại chưa nối Wi-Fi." : "IP của điện thoại: " + ips);
        if (Ssh.up()) setMsg("● Đang nối " + Ssh.who() + (Ssh.banner().isEmpty() ? "" : "\n" + Ssh.banner()), Ui.OK);
    }

    private void refreshKey() {
        boolean k = a.store.hasKey();
        keyInfo.setText(k ? "✔ Đã lưu (mã hóa trong máy)" : "Chưa có khóa. Dán nội dung file khóa (-----BEGIN ... PRIVATE KEY-----) hoặc chọn tệp.");
        keyInfo.setTextColor(k ? Ui.OK : Ui.WARN);
    }

    private void setMsg(String s, int color) {
        msg.setText(s);
        msg.setTextColor(color);
    }

    private void saveKey(String raw) {
        String k = Util.normKey(raw);
        if (!Util.looksLikeKey(k)) {
            a.toastLong("Đây không giống khóa riêng SSH (phải có dòng BEGIN ... PRIVATE KEY).");
            return;
        }
        try {
            a.store.key(k);
            refreshKey();
            a.toast("Đã lưu khóa");
        } catch (Exception e) {
            a.toastLong("Không lưu được khóa: " + e.getMessage());
        }
    }

    private void pasteKey() {
        saveKey(a.clip());
    }

    void onKeyPicked(final Uri u) {
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    InputStream in = a.getContentResolver().openInputStream(u);
                    if (in == null) throw new Exception("không mở được tệp");
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] b = new byte[4096];
                    int n;
                    while ((n = in.read(b)) != -1 && bo.size() < 200000) bo.write(b, 0, n);
                    in.close();
                    final String s = bo.toString("UTF-8");
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            saveKey(s);
                        }
                    });
                } catch (final Exception e) {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            a.toastLong("Không đọc được tệp: " + e.getMessage());
                        }
                    });
                }
            }
        });
    }

    private void busy(boolean b) {
        connect.setEnabled(!b);
        scan.setEnabled(!b);
    }

    private void doScan() {
        final int p = parsePort();
        final String cur = host.getText().toString().trim();
        busy(true);
        found.setText("Đang dò cổng " + p + " trong mạng Wi-Fi…");
        found.setTextColor(Ui.DIM);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                final List<String> ips = Net.scan(a, p, cur);
                a.ui.post(new Runnable() {
                    @Override
                    public void run() {
                        busy(false);
                        chips.removeAllViews();
                        if (ips.isEmpty()) {
                            found.setText("Không thấy máy nào mở cổng " + p + ". Kiểm tra Wi-Fi hoặc bật SSH trên máy.");
                            found.setTextColor(Ui.WARN);
                            return;
                        }
                        found.setText("Thấy " + ips.size() + " máy, chạm để chọn:");
                        found.setTextColor(Ui.OK);
                        for (final String ip : ips) {
                            Button b = Ui.btn(a, ip, 1, new View.OnClickListener() {
                                @Override
                                public void onClick(View v) {
                                    host.setText(ip);
                                }
                            });
                            chips.addView(b, Ui.lp(a, Ui.WRAP, Ui.WRAP, 0, 0, 0, 6, 0));
                        }
                    }
                });
            }
        });
    }

    private int parsePort() {
        try {
            int p = Integer.parseInt(port.getText().toString().trim());
            return p > 0 && p < 65536 ? p : 22;
        } catch (Exception e) {
            return 22;
        }
    }

    private void connect() {
        String h = host.getText().toString().trim();
        String u = user.getText().toString().trim();
        if (h.isEmpty()) {
            a.toast("Nhập IP của máy");
            return;
        }
        if (u.isEmpty()) u = "root";
        try {
            a.store.profile(h, parsePort(), u);
            a.store.pass(pass.getText().toString());
            a.store.password(pw.getText().toString());
        } catch (Exception e) {
            a.toastLong("Không lưu được: " + e.getMessage());
            return;
        }
        if (!a.store.hasKey() && pw.getText().toString().isEmpty()) {
            setMsg("Chưa có khóa riêng hoặc mật khẩu.", Ui.WARN);
            return;
        }
        busy(true);
        setMsg("Đang kết nối…", Ui.DIM);
        a.pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Ssh.connect(a, a.store);
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            busy(false);
                            a.refreshStatus();
                            setMsg("✔ Đã kết nối " + Ssh.who() + (Ssh.banner().isEmpty() ? "" : "\n" + Ssh.banner())
                                + "\nQua mục Lệnh, Quét hoặc Tệp để làm việc.", Ui.OK);
                        }
                    });
                } catch (final Util.HostKeyChanged hk) {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            busy(false);
                            a.refreshStatus();
                            askTrust(hk);
                        }
                    });
                } catch (final Throwable e) {
                    a.ui.post(new Runnable() {
                        @Override
                        public void run() {
                            busy(false);
                            a.refreshStatus();
                            setMsg("✖ " + Util.friendly(e), Ui.ERR);
                        }
                    });
                }
            }
        });
    }

    private void askTrust(final Util.HostKeyChanged hk) {
        setMsg("✖ Khóa nhận dạng của máy đã đổi.", Ui.ERR);
        new AlertDialog.Builder(a)
            .setTitle("Máy này đã đổi khóa nhận dạng")
            .setMessage("Máy " + hk.hostKey + " không còn khớp với lần nối trước. Thường là do đầu xe/bench vừa được cài lại, "
                + "nhưng cũng có thể bạn đang nối nhầm máy khác.\n\nDấu vân tay mới:\n" + hk.fingerprint + "\n\nTin máy này và nối lại?")
            .setPositiveButton("Tin & nối lại", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    a.store.forget(hk.hostKey);
                    connect();
                }
            })
            .setNegativeButton("Hủy", null)
            .show();
    }
}
