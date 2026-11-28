#@timeout 120
L=/var/opt/bimmer-drive/bimmer-drive.log; S=$(wc -c < $L)
node -e "
const fs=require('fs');let n=0;
const t=setInterval(()=>{let s;try{s=JSON.parse(fs.readFileSync('/run/bimmer-drive/status.json','utf8')).native}catch(e){return}
const line=[new Date().toISOString().slice(11,19),'view='+s.view,'shown='+s.shown,'layer='+s.layer,'tgt='+s.target_state,'pics='+s.pictures,'aus='+s.access_units,'age='+s.picture_age_ms,'w='+s.picture_w,'pair='+s.pair,'sei='+(s.sei||'').slice(0,40),'why='+s.why,'lr='+s.layer_reason,'sent='+s.frames_sent].join(' ');
if(s.view!=='none'||n%10===0)console.log(line);if(++n>=40){clearInterval(t)}},1000);"
echo ---log; tail -c +$S $L | grep -v "^$" | tail -30 | cut -c1-220
V=/var/opt/bimmer-drive/versions/1.1.1
cp -p $V/mgu-sidecam $V/mgu-sidecam.hw && cp -p $V/mgu-sidecam.sw-bak $V/mgu-sidecam.new && mv -f $V/mgu-sidecam.new $V/mgu-sidecam && kill $(pidof mgu-sidecam); sleep 4; md5sum /proc/$(pidof mgu-sidecam)/exe; echo rolled-back
