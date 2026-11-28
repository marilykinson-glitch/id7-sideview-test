#@timeout 120
O=/var/opt/bimmer-drive/versions/1.0.3; V=/var/opt/bimmer-drive/versions/1.1.1
mv -f $O/mgu-sidecam.sw-bak $O/mgu-sidecam; md5sum $O/mgu-sidecam
readlink -f /var/opt/bimmer-drive/current
[ -f $V/mgu-sidecam.sw-bak ] || cp -p $V/mgu-sidecam $V/mgu-sidecam.sw-bak
cp /tmp/mgu-sidecam-hw $V/mgu-sidecam.new && chmod 755 $V/mgu-sidecam.new && mv -f $V/mgu-sidecam.new $V/mgu-sidecam; md5sum $V/mgu-sidecam $V/mgu-sidecam.sw-bak
kill $(pidof mgu-sidecam); sleep 12
P=$(pidof mgu-sidecam); echo "pid=$P"; md5sum /proc/$P/exe
grep -E "libmfx|libva" /proc/$P/maps | awk '{print $6}' | sort -u
read -r l < /proc/$P/stat; set -- ${l#*) }; a=$(( ${12} + ${13} )); sleep 5; read -r l < /proc/$P/stat; set -- ${l#*) }; b=$(( ${12} + ${13} )); echo "cpu_pct=$(( (b-a) / 5 ))"
node -e "const s=require('/run/bimmer-drive/status.json').native;console.log(JSON.stringify({decoder:s.decoder,avb:s.avb,aus:s.access_units,pictures:s.pictures,corrupt:s.corrupt,err:s.decode_errors,restarts:s.restarts,w:s.picture_w,h:s.picture_h,age:s.picture_age_ms,decode_us:s.decode_us,view:s.view,shown:s.shown,pair:s.pair,fr:s.frames_sent}))"
grep -iE "decoder|hardware|libavcodec" /var/opt/bimmer-drive/bimmer-drive.log | tail -4 | cut -c1-200
cat /proc/loadavg
