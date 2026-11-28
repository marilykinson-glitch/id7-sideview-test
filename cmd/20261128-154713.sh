#@timeout 60
echo "== uname"; uname -a
echo "== bt tools"; which hciconfig hcitool bluetoothctl bluetoothd btmgmt sdptool rfcomm 2>&1
ls /usr/sbin/bluetoothd /usr/libexec/bluetooth 2>&1
echo "== bluez libs"; ls /usr/lib/x86_64-linux-gnu 2>/dev/null | grep -i -E "bluetooth|bluez" ; ls /usr/lib | grep -i blue
echo "== hci"; ls /sys/class/bluetooth 2>&1; cat /sys/class/bluetooth/*/address 2>&1
echo "== usb"; (lsusb 2>&1 || (for d in /sys/bus/usb/devices/*; do [ -f $d/product ] && echo "$d $(cat $d/idVendor):$(cat $d/idProduct) $(cat $d/product)"; done))
echo "== kernel bt"; ls /sys/module | grep -i -E "bluetooth|btusb|btintel|rfcomm|hci|l2cap"; zcat /proc/config.gz 2>/dev/null | grep -E "CONFIG_BT(=|_RFCOMM|_HCIBTUSB|_INTEL)" ; ls /lib/modules/$(uname -r)/kernel/net/bluetooth 2>&1 | head
echo "== procs"; ps | grep -i -E "blue|bt|hci" | grep -v grep
echo "== dbus"; ls /var/run/dbus 2>&1; which dbus-daemon
echo "== rfkill"; cat /sys/class/rfkill/*/name 2>&1
