package app.devlink;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Mạng: ép kết nối đi qua Wi-Fi (Android hay đẩy sang 4G khi Wi-Fi của xe không có internet) và dò IP có SSH. */
final class Net {
    private Net() {}

    static boolean isLocal(String host) {
        return host.matches("^(10\\..*|192\\.168\\..*|169\\.254\\..*|172\\.(1[6-9]|2[0-9]|3[01])\\..*)$");
    }

    private static Network wifi(ConnectivityManager cm) {
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc == null) continue;
                if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
                    return n;
            }
        } catch (Exception e) {
            // dùng mạng mặc định
        }
        return null;
    }

    /** một mạng CÓ internet (ưu tiên đã kiểm chứng) để tải GitHub, kể cả khi đang nối Wi-Fi xe không internet.
     *  Trả về null nếu không có (máy chỉ đang nối mạng xe) -> cần bật dữ liệu di động. */
    static Network internet(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return null;
        Network best = null;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc == null) continue;
                if (!nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue;
                if (nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return n; // tốt nhất
                if (best == null) best = n;
            }
        } catch (Exception e) {
            // bỏ qua
        }
        return best;
    }

    /** ÉP cả tiến trình đi qua cổng Ethernet (USB-OTG) để flash qua ENET.
     *  Trả về true nếu tìm thấy và bind được; false nếu không có cổng Ethernet. */
    static boolean bindEthernet(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                    cm.bindProcessToNetwork(n);
                    return true;
                }
            }
        } catch (Exception e) {
            // bỏ qua
        }
        return false;
    }

    /** gỡ ràng buộc mạng của tiến trình (về mặc định) */
    static void unbind(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        try {
            cm.bindProcessToNetwork(null);
        } catch (Exception e) {
            // bỏ qua
        }
    }

    /** địa chỉ nội bộ thì đi qua Wi-Fi, còn lại dùng mạng mặc định */
    static void bindFor(Context c, String host) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        try {
            Network w = isLocal(host) ? wifi(cm) : null;
            cm.bindProcessToNetwork(w);
        } catch (Exception e) {
            // bỏ qua
        }
    }

    /** các địa chỉ IPv4 của điện thoại trên Wi-Fi, để hiện cho người dùng */
    static String myWifiIps(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return "";
        Network w = wifi(cm);
        if (w == null) return "";
        LinkProperties lp = cm.getLinkProperties(w);
        if (lp == null) return "";
        StringBuilder b = new StringBuilder();
        for (LinkAddress la : lp.getLinkAddresses()) {
            InetAddress a = la.getAddress();
            if (a instanceof Inet4Address) {
                if (b.length() > 0) b.append(", ");
                b.append(a.getHostAddress());
            }
        }
        return b.toString();
    }

    /** thử cổng SSH trên cả mạng /24 của điện thoại, cộng với IP đang nhập và IP bench quen thuộc */
    static List<String> scan(Context c, int port, String extra) {
        final List<String> found = Collections.synchronizedList(new ArrayList<String>());
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        ArrayList<String> cand = new ArrayList<>();
        if (cm != null) {
            Network w = wifi(cm);
            if (w != null) {
                try {
                    cm.bindProcessToNetwork(w);
                } catch (Exception e) {
                    // bỏ qua
                }
                LinkProperties lp = cm.getLinkProperties(w);
                if (lp != null) {
                    for (LinkAddress la : lp.getLinkAddresses()) {
                        InetAddress a = la.getAddress();
                        if (!(a instanceof Inet4Address)) continue;
                        byte[] b = a.getAddress();
                        for (int i = 1; i <= 254; i++)
                            cand.add((b[0] & 255) + "." + (b[1] & 255) + "." + (b[2] & 255) + "." + i);
                    }
                }
            }
        }
        if (extra != null && !extra.isEmpty() && !cand.contains(extra)) cand.add(extra);
        if (!cand.contains("169.254.213.49")) cand.add("169.254.213.49");

        ExecutorService ex = Executors.newFixedThreadPool(48);
        for (final String ip : cand) {
            ex.execute(new Runnable() {
                @Override
                public void run() {
                    Socket s = new Socket();
                    try {
                        s.connect(new InetSocketAddress(ip, port), 400);
                        found.add(ip);
                    } catch (Exception e) {
                        // không mở
                    } finally {
                        try {
                            s.close();
                        } catch (Exception e) {
                            // bỏ qua
                        }
                    }
                }
            });
        }
        ex.shutdown();
        try {
            ex.awaitTermination(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            // bỏ qua
        }
        ArrayList<String> out = new ArrayList<>(found);
        Collections.sort(out);
        return out;
    }
}
