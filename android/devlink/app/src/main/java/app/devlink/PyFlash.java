package app.devlink;

import android.content.Context;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Cầu nối Java ↔ Python (Chaquopy) để chạy flash/enroll (mở root SSH qua ENET)
 * bằng chính code idrive7-8-ssh-root đã nhúng trong app.
 */
final class PyFlash {
    private PyFlash() {}

    /** callback nhận log từ Python */
    interface Line { void line(String s); }

    /** Python gọi phương thức public line(String) trên đối tượng này */
    public static final class Sink {
        private final Line cb;
        Sink(Line cb) { this.cb = cb; }
        public void line(String s) { if (s != null) cb.line(s); }
    }

    private static synchronized void ensure(Context c) {
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(c.getApplicationContext()));
        }
    }

    /** Copy assets/mgu-flash (PEM/bin) ra filesDir/mgu-flash để Python đọc được bằng open(). */
    private static String assetsDir(Context c) throws Exception {
        File dir = new File(c.getFilesDir(), "mgu-flash");
        dir.mkdirs();
        String[] names = c.getAssets().list("mgu-flash");
        if (names != null) {
            for (String n : names) {
                File out = new File(dir, n);
                InputStream in = c.getAssets().open("mgu-flash/" + n);
                OutputStream os = new FileOutputStream(out);
                try {
                    byte[] b = new byte[65536];
                    int k;
                    while ((k = in.read(b)) > 0) os.write(b, 0, k);
                } finally {
                    try { os.close(); } catch (Exception e) { /* bỏ qua */ }
                    try { in.close(); } catch (Exception e) { /* bỏ qua */ }
                }
            }
        }
        return dir.getAbsolutePath();
    }

    private static String workDir(Context c) {
        File w = new File(c.getFilesDir(), "mgu-work");
        w.mkdirs();
        return w.getAbsolutePath();
    }

    /** Chạy flash/enable/status... Trả về mã thoát (0 = xong). Log đổ về cb. */
    static int run(Context c, String action, String vin, String arch,
                   String gateway, String mguIp, Line cb) throws Exception {
        ensure(c);
        String assets = assetsDir(c);
        String work = workDir(c);
        Python py = Python.getInstance();
        PyObject mod = py.getModule("android_flash");
        PyObject res = mod.callAttr("run_flash",
            action, vin == null ? "" : vin, arch,
            gateway == null ? "" : gateway, mguIp == null ? "" : mguIp,
            assets, work, new Sink(cb));
        try {
            return res.asList().get(0).toJava(Integer.class);
        } catch (Exception e) {
            return -1;
        }
    }

    /** Dò gateway + VIN qua ENET. Trả về "ip|vin" hoặc "". */
    static String discover(Context c, Line cb) throws Exception {
        ensure(c);
        Python py = Python.getInstance();
        PyObject mod = py.getModule("android_flash");
        PyObject res = mod.callAttr("discover", new Sink(cb));
        return res == null ? "" : res.toString();
    }

    /** Đọc khóa OpenSSH vừa enroll (để nạp vào mục Kết nối). Trả về PEM hoặc "". */
    static String enrolledKey(Context c, String vin, Line cb) throws Exception {
        ensure(c);
        String work = workDir(c);
        Python py = Python.getInstance();
        PyObject mod = py.getModule("android_flash");
        PyObject res = mod.callAttr("read_enrolled_key",
            new File(work, "enrollments").getAbsolutePath(), vin == null ? "" : vin);
        return res == null ? "" : res.toString();
    }
}
