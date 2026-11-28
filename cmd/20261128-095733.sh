#@timeout 90
/tmp/msdk-probe media_transport.avb_streaming.1 20 2>/tmp/msdk-probe.err; echo "rc=$?"
grep -iv "^$" /tmp/msdk-probe.err | tail -15 | cut -c1-200
cat /proc/loadavg
