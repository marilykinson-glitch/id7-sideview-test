for p in $(ps | grep "devlink-wifi/bootlog.sh" | grep -v grep | awk '{print $1}'); do kill -STOP $p && echo "đóng băng $p"; done
cat /proc/uptime
mount -o remount,rw / && rm -f /etc/systemd/system/multi-user.target.wants/devlink-wifilog.service /etc/systemd/system/devlink-wifilog.service; sync; mount -o remount,ro /
echo "root=$(awk '$2=="/"{print $4}' /proc/mounts | cut -d, -f1 | tail -1)"; ls /etc/systemd/system | grep -c devlink-wifilog
printf '#!/bin/sh\nexit 0\n' > /var/opt/devlink-wifi/bootlog.sh
cat /proc/uptime
