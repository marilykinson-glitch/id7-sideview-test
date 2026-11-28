echo "== dri"; ls -la /dev/dri 2>&1
echo "== libs"; for d in /usr/lib /usr/lib64 /lib /usr/lib/x86_64-linux-gnu /usr/lib/dri /usr/lib64/dri /opt; do ls $d 2>/dev/null | grep -iE "^libva|_drv_video|iHD|i965|libmfx|libvpl|libmfx|libigfx|libdrm|libgst.*va|libgstmsdk" | sed "s#^#$d/#"; done
echo "== find"; find / -xdev \( -name "*drv_video*" -o -name "libva*.so*" -o -name "libmfx*" -o -name "libvpl*" -o -name "vainfo" \) 2>/dev/null | head -20
echo "== gst"; ls /usr/lib/gstreamer-1.0 2>/dev/null | grep -iE "va|msdk|vaapi|h264|avdec|libav" | head; which gst-inspect-1.0 2>&1
echo "== who uses dri"; for p in /proc/[0-9]*; do ls -l $p/fd 2>/dev/null | grep -q "/dev/dri" && echo "$(cat $p/comm) $(ls -l $p/fd 2>/dev/null | grep -c /dev/dri)"; done | sort | uniq | head
echo "== gpu"; cat /sys/class/drm/card*/device/uevent 2>/dev/null | head -8; cat /proc/cpuinfo | grep -m1 "model name"
echo "== media"; for p in /proc/[0-9]*; do grep -lE "libva|libmfx|iHD|i965|libvpl" $p/maps 2>/dev/null; done | head | while read m; do d=${m%/maps}; echo "$(cat $d/comm): $(grep -oE '/[^ ]*(libva|libmfx|iHD|i965|libvpl)[^ ]*' $d/maps | sort -u | tr '\n' ' ')"; done
