set -e
D=/var/opt/devlink-wifi
mkdir -p $D
cat > $D/wait-car-wifi.sh <<'EOF'
#!/bin/sh
# Chờ Wi-Fi của xe (Android Auto/CarPlay) lên rồi mới cho mgu-uplink chạy. Tối đa 90 giây.
up() { [ "$(cat /sys/class/net/p2p-wlan0-0/operstate 2>/dev/null)" = "up" ]; }
up && exit 0
i=0
while [ $i -lt 90 ]; do
  if up; then sleep 10; exit 0; fi
  sleep 1; i=$((i+1))
done
exit 0
EOF
cat > $D/bootlog.sh <<'EOF'
#!/bin/sh
# Ghi trạng thái Wi-Fi trong 3 phút đầu sau khi khởi động. Giữ 12 lần gần nhất.
D=/var/opt/devlink-wifi
cd $D || exit 0
ls -t boot-*.log 2>/dev/null | tail -n +12 | while read f; do rm -f "$f"; done
F=$D/boot-$(date +%Y%m%d-%H%M%S).log
i=0
while [ $i -lt 60 ]; do
  {
    echo "== t=$(cut -d' ' -f1 /proc/uptime) $(date +%H:%M:%S)"
    for n in wlan0 p2p-wlan0-0 p2p-wlan0-1 wlan_bridge; do echo "$n=$(cat /sys/class/net/$n/operstate 2>/dev/null || echo none)"; done | tr '\n' ' '; echo
    dbus-send --system --print-reply --dest=net.connman / net.connman.Manager.GetTechnologies 2>/dev/null | grep -A1 -E '"(Name|Powered|Connected)"' | grep variant | sed 's/.*variant *//' | tr '\n' ' '; echo
    echo "uplink=$(systemctl is-active mgu-uplink 2>/dev/null) wpa=$(systemctl is-active wpa_supplicant 2>/dev/null) aapd=$(systemctl is-active aapd 2>/dev/null)"
    tr -d '\n ' < /run/mgu-uplink/status.json 2>/dev/null | sed -E 's/.*"state":"([^"]*)".*"link":"([^"]*)".*"freq":([0-9]*).*/uplink_state=\1 link=\2 freq=\3/; s/.*"state":"([^"]*)".*"error":("[^"]*"|null).*/uplink_state=\1 err=\2/' | cut -c1-200; echo
  } >> "$F" 2>&1
  [ $i -eq 20 ] && dmesg | grep -E "CFG80211|wl_|dhd|brcm" | tail -40 >> "$F"
  sleep 3; i=$((i+1))
done
dmesg | grep -E "CFG80211|wl_|dhd|brcm" | tail -60 >> "$F"
EOF
chmod 755 $D/*.sh
cat > /etc/systemd/system/mgu-uplink.service.d/20-devlink-wait-car-wifi.conf <<'EOF'
# Thêm bởi DevLink 2026-11-22: chờ Wi-Fi của xe lên trước khi nối hotspot. Xoá file này để gỡ.
[Service]
ExecStartPre=-/bin/sh /var/opt/devlink-wifi/wait-car-wifi.sh
TimeoutStartSec=150
EOF
cat > /etc/systemd/system/devlink-wifilog.service <<'EOF'
[Unit]
Description=DevLink: ghi trạng thái Wi-Fi lúc khởi động (gỡ: systemctl disable devlink-wifilog)
RequiresMountsFor=/var/opt

[Service]
Type=simple
Nice=10
LimitCORE=1
ExecStart=/bin/sh /var/opt/devlink-wifi/bootlog.sh

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable devlink-wifilog.service 2>&1
systemctl start devlink-wifilog.service
sh $D/wait-car-wifi.sh; echo "wait rc=$?"
sleep 8
systemctl is-enabled devlink-wifilog; systemctl is-active devlink-wifilog mgu-uplink
systemctl show mgu-uplink -p ExecStartPre -p TimeoutStartUSec | cut -c1-200
ls -la $D; cat $D/boot-*.log | head -30
