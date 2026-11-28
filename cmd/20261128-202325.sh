#@timeout 60
echo "== uname"; uname -a
echo "== bt tools"; which hciconfig hcitool bluetoothctl bluetoothd btmgmt sdptool rfcomm hciattach btattach 2>&1
find / -xdev \( -name "bluetoothd" -o -name "hciconfig" -o -name "libbluetooth*" -o -name "rfcomm*" -o -name "btusb*" -o -name "bluetooth.ko*" \) 2>/dev/null | head -30
echo "== hci"; ls /sys/class/bluetooth 2>&1; cat /sys/class/bluetooth/*/address 2>&1
echo "== usb"; for d in /sys/bus/usb/devices/*; do [ -f $d/product ] && echo "$d $(cat $d/idVendor):$(cat $d/idProduct) $(cat $d/product)"; done
echo "== kernel bt"; ls /sys/module | grep -i -E "bluetooth|btusb|btintel|rfcomm|hci|l2cap|bnep"; zcat /proc/config.gz 2>/dev/null | grep -E "CONFIG_BT" | head -30; ls /lib/modules/$(uname -r)/kernel/net/bluetooth /lib/modules/$(uname -r)/kernel/drivers/bluetooth 2>&1 | head -20
grep -i -E "bluetooth|rfcomm|l2cap|hci" /proc/net/protocols /proc/modules 2>/dev/null | head
echo "== procs"; ps | grep -i -E "blue|bt|hci|wicome|conn" | grep -v grep | head -20
echo "== dbus"; ls /var/run/dbus /run/dbus 2>&1; which dbus-daemon python python3 node
echo "== rfkill"; for r in /sys/class/rfkill/*; do echo "$r $(cat $r/name) $(cat $r/type) soft=$(cat $r/soft)"; done 2>&1
echo "== tty"; ls /dev/ttyS* /dev/ttyUSB* /dev/ttyACM* /dev/rfcomm* 2>&1 | head
