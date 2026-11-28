#@put /tmp/mgu-sidecam-gc files/up/mgu-sidecam-hw x
#@timeout 150
V=/var/opt/bimmer-drive/versions/1.1.1
cp -p $V/mgu-sidecam $V/mgu-sidecam.hw-cpucopy
cp /tmp/mgu-sidecam-gc $V/mgu-sidecam.new && chmod 755 $V/mgu-sidecam.new && mv -f $V/mgu-sidecam.new $V/mgu-sidecam && kill $(pidof mgu-sidecam)
sleep 3
node -e "
const fs=require('fs'),cp=require('child_process');let n=0,sawView=0,sawShown=0,bad=0,vs=[],is=[];
const pid=()=>{try{return cp.execSync('pidof mgu-sidecam').toString().trim()}catch(e){return ''}};
let P=pid(),c0=null;const cpu=()=>{try{const l=fs.readFileSync('/proc/'+P+'/stat','utf8');const f=l.slice(l.lastIndexOf(')')+2).split(' ');return +f[11]+ +f[12];}catch(e){return null}};
const t=setInterval(()=>{let s;try{s=JSON.parse(fs.readFileSync('/run/bimmer-drive/status.json','utf8')).native}catch(e){return}
if(!P){P=pid();c0=cpu();}const c=cpu();const pct=(c!==null&&c0!==null)?(c-c0):null;c0=c;
if(s.view&&s.view!=='none'){sawView++;if(pct!==null&&s.shown)vs.push(pct)}else if(pct!==null&&n>3)is.push(pct);if(s.shown)sawShown++;
if(n===15&&!(s.picture_age_ms>=0&&s.picture_age_ms<2200))bad=1;
if(s.view!=='none'||n%10===0)console.log([new Date().toISOString().slice(11,19),'dec='+s.decoder,'view='+s.view,'shown='+s.shown,'age='+s.picture_age_ms,'pics='+s.pictures,'pair='+s.pair,'corrupt='+s.corrupt,'sent='+s.frames_sent,'cpu='+pct+'%',s.why||''].join(' '));
if(bad||++n>=100){clearInterval(t);const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):'-';console.log('RESULT bad='+bad+' sawView='+sawView+' sawShown='+sawShown+' cpu_view_avg='+avg(vs)+' cpu_idle_avg='+avg(is));fs.writeFileSync('/tmp/hwcheck',(bad||(sawView>3&&sawShown===0))?'rollback':'keep');}},1000);"
grep -iE "decoder:|GPU copy|CM copy" /var/opt/bimmer-drive/bimmer-drive.log | tail -4 | cut -c1-200
R=$(cat /tmp/hwcheck); echo "decision=$R"
if [ "$R" = rollback ]; then cp -p $V/mgu-sidecam.hw-cpucopy $V/mgu-sidecam.new && mv -f $V/mgu-sidecam.new $V/mgu-sidecam && kill $(pidof mgu-sidecam); sleep 3; echo rolled-back-to-cpucopy; fi
md5sum /proc/$(pidof mgu-sidecam)/exe
