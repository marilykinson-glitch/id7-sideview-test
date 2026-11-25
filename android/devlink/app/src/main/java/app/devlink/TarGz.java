package app.devlink;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Đọc/ghi tar (định dạng ustar) nén gzip, hoàn toàn trong RAM.
 * Dùng để dựng gói cài mgu-store (gửi qua SSH vào `tar -xzf -`) và để mở gói
 * mgu-deploy tải từ GitHub. Chỉ phụ thuộc thư viện chuẩn Java (chạy được cả
 * trên Android lẫn khi compile-test bằng javac).
 */
final class TarGz {

    private TarGz() {}

    static final int BLOCK = 512;

    // ----------------------------------------------------------------
    // GHI
    // ----------------------------------------------------------------
    static final class Writer {
        private final ByteArrayOutputStream raw = new ByteArrayOutputStream();

        /** Thêm một tệp thường. mode ví dụ 0644 hoặc 0755 (hệ 8). mtime tính bằng giây. */
        Writer addFile(String name, int mode, long mtime, byte[] data) {
            header(name, mode, mtime, data.length, '0');
            raw.write(data, 0, data.length);
            pad(data.length);
            return this;
        }

        /** Thêm một thư mục (để chắc cây thư mục tồn tại khi giải nén). */
        Writer addDir(String name, int mode, long mtime) {
            String n = name.endsWith("/") ? name : name + "/";
            header(n, mode, mtime, 0, '5');
            return this;
        }

        /** Kết thúc tar (2 block 0) rồi nén gzip, trả về byte[]. */
        byte[] finishGz() throws IOException {
            raw.write(new byte[BLOCK * 2], 0, BLOCK * 2); // dấu kết thúc
            ByteArrayOutputStream gz = new ByteArrayOutputStream();
            GZIPOutputStream g = new GZIPOutputStream(gz);
            byte[] body = raw.toByteArray();
            g.write(body, 0, body.length);
            g.finish();
            g.close();
            return gz.toByteArray();
        }

        private void pad(int size) {
            int rem = size % BLOCK;
            if (rem != 0) raw.write(new byte[BLOCK - rem], 0, BLOCK - rem);
        }

        private void header(String name, int mode, long mtime, long size, char type) {
            byte[] h = new byte[BLOCK];
            byte[] nb = name.getBytes(StandardCharsets.UTF_8);
            if (nb.length > 100) throw new IllegalArgumentException("Tên quá dài cho ustar: " + name);
            System.arraycopy(nb, 0, h, 0, nb.length);
            putOctal(h, 100, 8, mode);         // mode
            putOctal(h, 108, 8, 0);            // uid
            putOctal(h, 116, 8, 0);            // gid
            putOctal(h, 124, 12, size);        // size
            putOctal(h, 136, 12, mtime);       // mtime
            for (int i = 148; i < 156; i++) h[i] = ' '; // checksum = khoảng trắng khi tính
            h[156] = (byte) type;              // typeflag
            // magic "ustar\0" + version "00"
            byte[] magic = "ustar".getBytes(StandardCharsets.US_ASCII);
            System.arraycopy(magic, 0, h, 257, magic.length);
            h[262] = 0;
            h[263] = '0';
            h[264] = '0';
            // checksum
            int sum = 0;
            for (byte b : h) sum += (b & 0xFF);
            String cs = String.format("%06o", sum);
            byte[] csb = cs.getBytes(StandardCharsets.US_ASCII);
            System.arraycopy(csb, 0, h, 148, csb.length);
            h[148 + 6] = 0;
            h[148 + 7] = ' ';
            raw.write(h, 0, BLOCK);
        }

        private static void putOctal(byte[] h, int off, int len, long v) {
            // (len-1) chữ số octal, canh phải, đệm '0', kết thúc bằng null
            String s = String.format("%0" + (len - 1) + "o", v);
            byte[] b = s.getBytes(StandardCharsets.US_ASCII);
            int start = off + (len - 1) - b.length;
            System.arraycopy(b, 0, h, start, b.length);
            h[off + len - 1] = 0;
        }
    }

    // ----------------------------------------------------------------
    // ĐỌC
    // ----------------------------------------------------------------
    /** Giải nén một .tgz thành map đường-dẫn -> nội dung (chỉ tệp thường). Thứ tự giữ nguyên. */
    static Map<String, byte[]> read(byte[] tgz) throws IOException {
        LinkedHashMap<String, byte[]> out = new LinkedHashMap<>();
        GZIPInputStream g = new GZIPInputStream(new ByteArrayInputStream(tgz));
        try {
            byte[] h = new byte[BLOCK];
            while (true) {
                if (!readFully(g, h, BLOCK)) break;
                if (isZero(h)) break; // block kết thúc
                String name = cstr(h, 0, 100);
                String prefix = cstr(h, 345, 155);
                if (!prefix.isEmpty()) name = prefix + "/" + name;
                long size = parseOctal(h, 124, 12);
                char type = (char) (h[156] & 0xFF);
                byte[] data = new byte[(int) size];
                if (!readFully(g, data, (int) size)) throw new IOException("tar cụt");
                long rem = size % BLOCK;
                if (rem != 0) skip(g, (int) (BLOCK - rem));
                if (type == '0' || type == 0 || type == '\0') out.put(name, data);
                // bỏ qua thư mục ('5'), symlink...
            }
        } finally {
            g.close();
        }
        return out;
    }

    private static boolean readFully(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) return false; // hết luồng trước khi đủ
            off += n;
        }
        return true;
    }

    private static void skip(InputStream in, int n) throws IOException {
        byte[] t = new byte[n];
        readFully(in, t, n);
    }

    private static boolean isZero(byte[] h) {
        for (byte b : h) if (b != 0) return false;
        return true;
    }

    private static String cstr(byte[] h, int off, int len) {
        int end = off;
        int max = off + len;
        while (end < max && h[end] != 0) end++;
        return new String(h, off, end - off, StandardCharsets.UTF_8);
    }

    private static long parseOctal(byte[] h, int off, int len) {
        long v = 0;
        int i = off;
        int max = off + len;
        while (i < max && (h[i] == ' ' || h[i] == 0)) i++;
        while (i < max && h[i] >= '0' && h[i] <= '7') {
            v = (v << 3) + (h[i] - '0');
            i++;
        }
        return v;
    }

    /** Tiện ích: đọc hết một InputStream. */
    static byte[] drain(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    /** Tiện ích: ghi byte ra OutputStream. */
    static void writeTo(OutputStream os, byte[] b) throws IOException {
        os.write(b, 0, b.length);
    }
}
