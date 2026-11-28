journalctl -u bmw-voice -b --no-pager -n 600 | grep -iE "TTS|piper|gemini|speak|play" | tail -25 | cut -c1-260
echo ---; ls -la /var/opt/bmw-voice/tts-cache | tail -8
echo ---; node -e "const h=require('/run/bmw-voice/hmi.json');console.log(JSON.stringify(h.lastTurn))" | cut -c1-600
echo ---SIDECAM; P=$(pidof mgu-sidecam); echo pid=$P; tr '\0' ' ' < /proc/$P/cmdline; echo; grep -E "Threads|VmRSS" /proc/$P/status
for t in /proc/$P/task/*; do read -r l < $t/stat; set -- ${l#*) }; echo "$(( ${12} + ${13} )) $(cat $t/comm)"; done | sort -rn | head -8
echo ---; ls /var/opt/bimmer-drive/; readlink -f /var/opt/bimmer-drive/current; ls /run/bimmer-drive 2>&1 | head
node -e "try{const s=require('/run/bimmer-drive/status.json');console.log(JSON.stringify({ver:s.version,view:s.view||(s.cam&&s.cam.view),cam:s.cam,sidecam:s.sidecam}).slice(0,900))}catch(e){console.log(e.message)}"
journalctl -u bimmer-drive -b --no-pager -n 200 | grep -iE "sidecam|view|decoder|sleep" | tail -12 | cut -c1-220
