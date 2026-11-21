package app.devlink;

import java.util.ArrayList;
import java.util.List;

/** Các mục quét có sẵn: mỗi mục là một danh sách lệnh chỉ-đọc, chạy được cả trên busybox. */
final class Scans {
    private Scans() {}

    static final class Item {
        final String title;
        final String desc;
        final String script;
        final boolean custom;
        final int index; // vị trí trong danh sách tự lưu (nếu custom)

        Item(String title, String desc, String script, boolean custom, int index) {
            this.title = title;
            this.desc = desc;
            this.script = script;
            this.custom = custom;
            this.index = index;
        }
    }

    private static Item p(String title, String desc, String... cmds) {
        return new Item(title, desc, Util.scanScript(cmds), false, -1);
    }

    static List<Item> builtin() {
        ArrayList<Item> l = new ArrayList<>();
        l.add(p("Hệ thống", "Phiên bản, bộ nhớ, ổ đĩa, thời gian chạy",
            "uname -a",
            "cat /etc/os-release 2>/dev/null || cat /etc/*release 2>/dev/null",
            "uptime",
            "date",
            "id; hostname",
            "cat /proc/cmdline",
            "cat /proc/cpuinfo | head -30",
            "free -m 2>/dev/null || head -5 /proc/meminfo",
            "df -h 2>/dev/null || df",
            "mount | head -60"));
        l.add(p("Mạng", "IP, tuyến, DNS, cổng đang mở",
            "ip -4 addr 2>/dev/null || ifconfig",
            "ip route 2>/dev/null || route -n",
            "cat /etc/resolv.conf",
            "ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || netstat -tuln",
            "ip neigh 2>/dev/null | head -20"));
        l.add(p("Tiến trình", "Cái gì đang chạy, tốn CPU/RAM",
            "ps -ef 2>/dev/null || ps aux 2>/dev/null || ps w",
            "top -bn1 2>/dev/null | head -25"));
        l.add(p("MGU / Store", "Thư mục MGU, tiến trình Store, node, uplink",
            "ls -la /run /var /opt 2>/dev/null | head -150",
            "ps -ef 2>/dev/null | grep -i -E 'mgu|render|store|node|uplink' | grep -v grep || ps w | grep -i -E 'mgu|render|store|node|uplink' | grep -v grep",
            "ls -la /run/mgu-uplink /run/thoi-tiet 2>/dev/null",
            "cat /run/mgu-uplink/lease.json 2>/dev/null",
            "which node nodejs python3 python perl busybox gdb strace tcpdump 2>/dev/null",
            "node -v 2>&1",
            "find / -xdev -maxdepth 4 \\( -iname '*mgu*' -o -iname '*mgustore*' \\) 2>/dev/null | head -80",
            "find / -xdev -maxdepth 5 -name app.json 2>/dev/null | head -40"));
        l.add(p("Dịch vụ & khởi động", "systemd, init, lịch chạy",
            "systemctl list-units --type=service --no-pager 2>/dev/null | head -80",
            "ls /etc/init.d /etc/systemd/system 2>/dev/null",
            "crontab -l 2>/dev/null"));
        l.add(p("Nhật ký", "dmesg, logread, journal, /var/log",
            "dmesg 2>/dev/null | tail -80",
            "logread 2>/dev/null | tail -80",
            "journalctl -n 120 --no-pager 2>/dev/null",
            "ls -la /var/log 2>/dev/null | head -40"));
        l.add(p("Tín hiệu xe / SOME/IP", "Dịch vụ SOME/IP, DLT, chẩn đoán",
            "netstat -lun 2>/dev/null | head -40 || ss -lun 2>/dev/null | head -40",
            "find / -xdev \\( -iname '*vsomeip*' -o -iname '*someip*' -o -iname '*dlt*' \\) 2>/dev/null | head -40",
            "ps -ef 2>/dev/null | grep -i -E 'someip|dlt|diag|ecu' | grep -v grep",
            "ls /dev | head -120"));
        l.add(p("Phần cứng & lưu trữ", "Phân vùng, USB, module, nhiệt độ",
            "cat /proc/partitions",
            "lsblk 2>/dev/null",
            "ls -la /dev/disk/by-label 2>/dev/null",
            "lsusb 2>/dev/null",
            "lsmod 2>/dev/null | head -50",
            "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head"));
        return l;
    }

    static List<Item> all(Store st) {
        ArrayList<Item> l = new ArrayList<>(builtin());
        List<String[]> c = st.customScans();
        for (int i = 0; i < c.size(); i++) l.add(new Item(c.get(i)[0], "Lệnh bạn đã lưu (giữ lâu để xóa)", c.get(i)[1], true, i));
        return l;
    }
}
