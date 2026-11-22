M=$(awk '$2=="/"{print $4}' /proc/mounts | cut -d, -f1 | tail -1)
[ "$M" = "ro" ] || { echo "/ đang $M, dừng"; exit 9; }
mount -o remount,rw / || { echo "không remount rw được"; exit 8; }
cat > /etc/systemd/system/mgu-uplink.service.d/20-devlink-wait-car-wifi.conf <<'EOF'
# Thêm bởi DevLink 2026-11-22: chờ Wi-Fi của xe lên trước khi nối hotspot. Xoá file này để gỡ.
[Service]
ExecStartPre=-/bin/sh /var/opt/devlink-wifi/wait-car-wifi.sh
TimeoutStartSec=150
EOF
R1=$?
cat > /etc/systemd/system/devlink-wifilog.service <<'EOF'
[Unit]
Description=DevLink: ghi trang thai Wi-Fi luc khoi dong
RequiresMountsFor=/var/opt

[Service]
Type=simple
Nice=10
LimitCORE=1
ExecStart=/bin/sh /var/opt/devlink-wifi/bootlog.sh

[Install]
WantedBy=multi-user.target
EOF
R2=$?
ln -sf ../devlink-wifilog.service /etc/systemd/system/multi-user.target.wants/devlink-wifilog.service; R3=$?
sync
mount -o remount,ro / ; R4=$?
echo "write=$R1/$R2/$R3 remount_ro=$R4 now=$(awk '$2=="/"{print $4}' /proc/mounts | cut -d, -f1 | tail -1)"
systemctl daemon-reload
systemctl start devlink-wifilog.service
sh /var/opt/devlink-wifi/wait-car-wifi.sh; echo "wait rc=$?"
sleep 8
systemctl is-enabled devlink-wifilog; systemctl is-active devlink-wifilog mgu-uplink
systemctl show mgu-uplink -p ExecStartPre -p TimeoutStartUSec | cut -c1-160
cat /var/opt/devlink-wifi/boot-*.log | head -24
