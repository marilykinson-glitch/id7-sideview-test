#@timeout 100
node -e "
const fs=require('fs');let n=0,prev=null;const P=require('child_process').execSync('pidof mgu-sidecam').toString().trim();
const cpu=()=>{const l=fs.readFileSync('/proc/'+P+'/stat','utf8');const f=l.slice(l.lastIndexOf(')')+2).split(' ');return +f[11]+ +f[12];};let c0=cpu();
const t=setInterval(()=>{let s;try{s=JSON.parse(fs.readFileSync('/run/bimmer-drive/status.json','utf8')).native}catch(e){return}
const c=cpu();const line=[new Date().toISOString().slice(11,19),'view='+s.view,'shown='+s.shown,'pics='+s.pictures,'age='+s.picture_age_ms,'corrupt='+s.corrupt,'err='+s.decode_errors,'dec='+s.decoder,'dec_us='+s.decode_us,'view_us='+s.view_us,'sent='+s.frames_sent,'cpu='+(c-c0)+'%',s.why||''].join(' ');c0=c;
if(s.view!=='none'||n%10===0)console.log(line);if(++n>=75){clearInterval(t)}},1000);"
