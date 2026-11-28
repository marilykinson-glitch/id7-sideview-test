cd /var/opt/bmw-voice/current && cat > /tmp/ttsdiag.js <<'JS'
const Up=require('/var/opt/bmw-voice/current/uplink.js');
const key=JSON.parse(require('fs').readFileSync('/var/opt/bmw-voice/settings.json','utf8')).apiKey||'';
const o=Up.options({stateDir:'/var/opt/bmw-voice/state',log:()=>{}});
async function go(){
 try{const r=await Up.request(o,{host:'generativelanguage.googleapis.com',path:'/v1beta/models?pageSize=200&key='+encodeURIComponent(key),method:'GET',timeoutMs:9000});
  console.log('list',r.status);try{console.log((JSON.parse(r.body).models||[]).map(m=>m.name.replace('models/','')).filter(n=>/tts|audio|live/i.test(n)).join(' '))}catch(e){console.log(String(r.body).slice(0,200))}}catch(e){console.log('list err',e.message)}
 for(const m of ['gemini-3.8-flash-lite-tts','gemini-3.1-flash-tts-preview','gemini-2.5-flash-preview-tts']){
  const t0=Date.now();
  try{const r=await Up.request(o,{host:'generativelanguage.googleapis.com',path:'/v1beta/models/'+m+':generateContent?key='+encodeURIComponent(key),method:'POST',headers:{'Content-Type':'application/json'},timeoutMs:12000,body:JSON.stringify({contents:[{role:'user',parts:[{text:'Đã chỉnh điều hoà 22 độ'}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Kore'}}}}})});
   let msg='';try{const d=JSON.parse(r.body);msg=d.error?d.error.message:('audio bytes '+((d.candidates[0].content.parts[0].inlineData||{}).data||'').length)}catch(e){msg=String(r.body).slice(0,120)}
   console.log(m,r.status,(Date.now()-t0)+'ms',String(msg).slice(0,160));
  }catch(e){console.log(m,'ERR',(Date.now()-t0)+'ms',e.message)}
 }}
go();
JS
node /tmp/ttsdiag.js 2>&1 | sed 's/key=[^& ]*/key=***/g' | cut -c1-600
