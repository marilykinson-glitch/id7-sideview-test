package app.devlink;

public class UtilTest {
    static int fails = 0;
    static void eq(Object a, Object b, String n) {
        if (!String.valueOf(a).equals(String.valueOf(b))) { fails++; System.out.println("FAIL " + n + ": " + a + " != " + b); }
        else System.out.println("ok   " + n);
    }
    public static void main(String[] x) throws Exception {
        eq(Util.sq("a'b"), "'a'\\''b'", "sq");
        eq(Util.sq("/tmp/x y"), "'/tmp/x y'", "sq space");
        eq(Util.cleanPath("tmp//a/../b/"), "/tmp/b", "clean");
        eq(Util.cleanPath("/.."), "/", "clean up root");
        eq(Util.parent("/tmp/x.tar"), "/tmp", "parent");
        eq(Util.parent("/tmp"), "/", "parent root");
        eq(Util.join("/", "a"), "/a", "join root");
        eq(Util.join("/tmp", "a"), "/tmp/a", "join");
        eq(Util.base("/tmp/x.tar"), "x.tar", "base");
        eq(Util.human(1536), "1.5 KB", "human");
        eq(Util.human(5L * 1024 * 1024 * 1024), "5.0 GB", "human gb");
        eq(Util.normKey("  -----BEGIN\r\nabc\r\n-----END  \r\n\r\n"), "-----BEGIN\nabc\n-----END\n", "normKey");
        eq(Util.looksLikeKey("-----BEGIN OPENSSH PRIVATE KEY-----"), true, "looksLikeKey");
        Util.Listing l = Util.parseListing("D\nf\t10\tb.txt\nd\t-1\tzdir\nl\t5\tlink\nf\t2\tA.txt\nbad\n");
        eq(l.kind, 'D', "kind");
        eq(l.items.size(), 4, "items");
        eq(l.items.get(0).name, "zdir", "dirs first");
        eq(l.items.get(1).name, "A.txt", "sorted");
        Util.Listing f = Util.parseListing("F\n123\n");
        eq(f.kind, 'F', "file kind");
        eq(f.fileSize, 123L, "file size");
        eq(Util.parseListing("N\n").kind, 'N', "none");
        String s = Util.scanScript(new String[]{"uname -a", "echo it's"});
        eq(s.contains("echo '$ echo it'\\''s'"), true, "scan quoting");
        eq(Util.friendly(new java.net.ConnectException("Connection refused")).startsWith("Máy từ chối"), true, "friendly refused");
        eq(Util.friendly(new RuntimeException("x", new java.net.SocketTimeoutException("connect timed out"))).startsWith("Hết thời gian"), true, "friendly timeout");
        // script phải chạy được thật trên shell của máy này
        Process p = new ProcessBuilder("sh", "-c", "mkdir -p /tmp/lt/sub && echo hi > /tmp/lt/a.txt && echo x > '/tmp/lt/.h' && " + "sh -c " + Util.sq(Util.PRE + Util.listScript("/tmp/lt"))).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), "UTF-8"); p.waitFor();
        Util.Listing r = Util.parseListing(out);
        eq(r.kind, 'D', "real list kind");
        StringBuilder names = new StringBuilder(); for (Util.Entry e : r.items) names.append(e.type).append(e.name).append(',');
        eq(names, "dsub,f.h,fa.txt,", "real list");
        Process q = new ProcessBuilder("sh", "-c", "sh -c " + Util.sq(Util.PRE + Util.scanScript(new String[]{"echo a | tr a b", "false || echo fb", "nonexistent_cmd"}))).redirectErrorStream(true).start();
        String qo = new String(q.getInputStream().readAllBytes(), "UTF-8"); q.waitFor();
        System.out.println(qo);
        eq(qo.contains("$ echo a | tr a b\nb\n"), true, "real scan");
        System.out.println(fails == 0 ? "ALL OK" : fails + " FAILS");
        System.exit(fails == 0 ? 0 : 1);
    }
}
