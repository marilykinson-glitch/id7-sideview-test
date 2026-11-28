#@put /tmp/msdk-probe files/up/msdk-probe x
#@timeout 90
md5sum /tmp/msdk-probe; cat /proc/loadavg
timeout 40 /tmp/msdk-probe media_transport.avb_streaming.1 20 2>/tmp/msdk-probe.err; echo "rc=$?"
tail -15 /tmp/msdk-probe.err | cut -c1-200
cat /proc/loadavg
