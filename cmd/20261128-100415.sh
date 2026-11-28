P=$(pidof mgu-sidecam); echo "pid=$P"; ls -l /proc/$P/exe; md5sum /proc/$P/exe /var/opt/bimmer-drive/versions/1.0.3/mgu-sidecam /var/opt/bimmer-drive/versions/1.0.3/mgu-sidecam.sw-bak
tr '\0' ' ' < /proc/$P/cmdline; echo; grep -E "libmfx|libva" /proc/$P/maps | awk '{print $6}' | sort -u
grep -n "sidecam" /var/opt/bimmer-drive/current/bimmer-drive.js | grep -iE "spawn|path|bin" | head -8
node -e "const s=require('/run/bimmer-drive/status.json');console.log(s.at, JSON.stringify(s.native).slice(0,300))"
