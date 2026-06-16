const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
let webpush=null; try{webpush=require('web-push');}catch(e){}
const app=express();
const PORT=process.env.PORT||3000;
const DATA_DIR=path.join(__dirname,'data');
app.use(cors());
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));

function ensureFile(n,f){if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});const p=path.join(DATA_DIR,n);if(!fs.existsSync(p))fs.writeFileSync(p,JSON.stringify(f,null,2));return p;}
function readJson(n,f){const p=ensureFile(n,f);try{return JSON.parse(fs.readFileSync(p,'utf8')||JSON.stringify(f));}catch{return f;}}
function writeJson(n,d){const p=ensureFile(n,Array.isArray(d)?[]:{});fs.writeFileSync(p,JSON.stringify(d,null,2));}
function nowIso(){return new Date().toISOString();}
function onlineStatus(t){return t&&(Date.now()-new Date(t).getTime())<300000?'ONLINE':'OFFLINE';}
function cleanMac(m){return String(m||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(0,12);}
function uidFromMac(m){const s=cleanMac(m);if(s.length!==12)return'';return'RT7-MASTER-'+(s.match(/../g)||[]).reverse().join('');}
function detectSource(mac){return String(mac||'').toUpperCase()==='AA:BB:CC:DD:EE:01'?'SIM':'ESP32';}
function setupWebPush(){
 if(!webpush)return{ok:false,error:'web-push package missing'};
 let keys=null; const pub=process.env.RT7_VAPID_PUBLIC_KEY||'', pri=process.env.RT7_VAPID_PRIVATE_KEY||'';
 if(pub&&pri)keys={publicKey:pub,privateKey:pri,source:'env'};
 else{keys=readJson('vapid_keys.json',null); if(!keys||!keys.publicKey||!keys.privateKey){keys=webpush.generateVAPIDKeys();writeJson('vapid_keys.json',keys);} keys.source='data/vapid_keys.json';}
 try{webpush.setVapidDetails(process.env.RT7_VAPID_SUBJECT||'mailto:rt7-edu@example.com',keys.publicKey,keys.privateKey);return{ok:true,publicKey:keys.publicKey,source:keys.source};}
 catch(e){return{ok:false,error:String(e.message||e)};}
}
async function sendPush(payload){
 const setup=setupWebPush(), logs=readJson('push_log.json',[]), subs=readJson('push_subscriptions.json',[]);
 if(!setup.ok){const item={time:nowIso(),ok:false,sent:0,removed:0,total:subs.length,status:'SETUP_FAILED',error:setup.error,failures:[{message:setup.error}],payload};logs.push(item);writeJson('push_log.json',logs.slice(-200));return item;}
 let sent=0,removed=0,failures=[],keep=[];
 for(const sub of subs){
   const subscription=sub.subscription||sub; const endpoint=String(subscription.endpoint||'').slice(0,90);
   try{await webpush.sendNotification(subscription,JSON.stringify(payload),{TTL:60,urgency:'high'});sent++;keep.push(sub);}
   catch(e){const code=e.statusCode||e.status||0;const msg=String(e.body||e.message||e).slice(0,500);failures.push({code,endpoint,message:msg}); if([400,403,404,410].includes(code))removed++; else keep.push(sub);}
 }
 if(removed)writeJson('push_subscriptions.json',keep);
 const item={time:nowIso(),ok:true,sent,removed,total:subs.length,status:sent>0?'SENT':(subs.length===0?'NO_SUBSCRIBERS':'FAILED'),failures,payload};
 logs.push(item); writeJson('push_log.json',logs.slice(-200)); return item;
}
['master_registry.json','commands.json'].forEach(n=>ensureFile(n,{}));
['communities.json','events.json','push_subscriptions.json','push_log.json'].forEach(n=>ensureFile(n,[]));

app.get('/',(_,res)=>res.redirect('/edu'));
app.get('/sw.js',(_,res)=>res.type('application/javascript').set('Service-Worker-Allowed','/').send(`
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){};e.waitUntil(self.registration.showNotification(d.title||'RT7 EDU 推播',{body:d.body||'收到事件',tag:d.tag||'rt7-edu',renotify:true,data:{url:d.url||'/edu'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/edu';e.waitUntil(clients.openWindow(u));});`));

app.get('/edu',(_,res)=>res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU V2B Android Push Diagnostic</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1040px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.red{background:#c0392b}.gray{background:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap;min-height:60px}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}.badp{background:#fee2e2;color:#b91c1c}.warnp{background:#fef3c7;color:#92400e}.hint{color:#607080;font-size:14px;line-height:1.6}</style></head><body><div class="wrap"><h1>RT7 EDU TEST V2B：Android Push Button Diagnostic</h1><p>修正：手機按「重新訂閱推播 / 檢查本機瀏覽器訂閱」沒反應時，會直接顯示錯誤。</p><div id="app">載入中...</div></div><script>
window.addEventListener('error',e=>showResult({ok:false,where:'window.onerror',message:e.message,source:e.filename,line:e.lineno}));
window.addEventListener('unhandledrejection',e=>showResult({ok:false,where:'unhandledrejection',message:String(e.reason&&e.reason.message||e.reason)}));

async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t);}catch(e){return{ok:false,http_status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function showResult(x){let e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function pill(l){if(!l)return'<span class="pill warnp">NO LOG</span>';if(l.sent>0)return'<span class="pill">SENT '+l.sent+'/'+l.total+'</span>';if(l.total===0)return'<span class="pill warnp">NO SUBSCRIBERS</span>';return'<span class="pill badp">FAILED '+l.sent+'/'+l.total+'</span>';}
function render(s){const ms=Object.values(s.masters||{}), latest=(s.push.logs&&s.push.logs[0])||null;let h='';
h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 heartbeat</th></tr>';ms.forEach(m=>h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source)+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>');h+='</table></div>';
h+='<div class="card"><h2>2. 推播訂閱與診斷</h2><p class="hint">若按鈕有錯誤，會出現在下方「即時診斷結果」。</p><button class="blue" onclick="safeRun(resubscribePush)">重新訂閱推播</button><button class="blue" onclick="safeRun(subscribePush)">啟用推播</button><button onclick="safeRun(testPush)">測試推播</button><button class="red" onclick="safeRun(()=>clearPush(true))">清除伺服器訂閱紀錄</button><button class="gray" onclick="safeRun(checkClientPush)">檢查本機瀏覽器訂閱</button><button class="gray" onclick="safeRun(foregroundNotify)">前景通知測試</button><p>訂閱數：<span class="pill '+(s.push.count>0?'':'warnp')+'">'+esc(s.push.count)+'</span>　最新推播：'+pill(latest)+'　最後時間：'+esc((latest&&latest.time)||'-')+'</p><details open><summary>最新 push log 詳細內容</summary><pre>'+esc(JSON.stringify(latest||{},null,2))+'</pre></details></div>';
h+='<div class="card"><h2>3. 門鈴 / 開門測試</h2><div class="grid"><input id="e_uid" placeholder="Master UID" value="'+esc((ms[0]&&ms[0].master_uid)||'')+'"><input id="e_msg" value="有人按門鈴"></div><button onclick="safeRun(doorbell)">送出門鈴事件 + 推播</button><button onclick="safeRun(openDoor)">送出開門命令</button></div>';
h+='<div class="card"><h2>4. 即時診斷結果</h2><pre id="out">READY</pre></div>';document.getElementById('app').innerHTML=h;}
async function load(){render(await api('/edu/state'));}
async function safeRun(fn){try{showResult({running:true,fn:fn.name||'anonymous'});await fn();}catch(e){showResult({ok:false,error:String(e.message||e),stack:String(e.stack||'').slice(0,800)});}}
function b64ToUint8Array(b){const p='='.repeat((4-b.length%4)%4),base64=(b+p).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function checkClientPush(){let data={url:location.href,isSecureContext,permission:('Notification'in window)?Notification.permission:'NO_NOTIFICATION_API',serviceWorker:'serviceWorker'in navigator,pushManager:'PushManager'in window,userAgent:navigator.userAgent};if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();data.registrations=[];for(const r of regs){const sub=await r.pushManager.getSubscription();data.registrations.push({scope:r.scope,active:!!r.active,installing:!!r.installing,waiting:!!r.waiting,subscribed:!!sub,endpoint:sub&&sub.endpoint});}}showResult(data);}
async function subscribePush(){if(!('serviceWorker'in navigator))throw new Error('serviceWorker not supported');if(!('PushManager'in window))throw new Error('PushManager not supported');if(!('Notification'in window))throw new Error('Notification not supported');const kr=await api('/api/push/public-key');if(!kr.publicKey)throw new Error('no VAPID public key: '+JSON.stringify(kr));const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;let perm=Notification.permission;if(perm!=='granted')perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('notification permission '+perm);let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8Array(kr.publicKey)});const r=await post('/api/push/subscribe',{subscription:sub});showResult({ok:true,step:'subscribePush',server:r,endpoint:sub.endpoint});await load();}
async function resubscribePush(){if(!('serviceWorker'in navigator))throw new Error('serviceWorker not supported');const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;const old=await reg.pushManager.getSubscription();if(old){await old.unsubscribe();}await post('/api/push/clear',{});await subscribePush();}
async function clearPush(show=true){const r=await post('/api/push/clear',{});if(show)showResult(r);await load();}
async function testPush(){const r=await post('/api/push/test',{title:'RT7 EDU 測試推播',body:'推播功能正常'});showResult(r);await load();}
async function foregroundNotify(){if(!('Notification'in window))throw new Error('Notification not supported');let perm=Notification.permission;if(perm!=='granted')perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('notification permission '+perm);new Notification('RT7 前景通知測試',{body:'如果看到這個，Android Chrome 通知可顯示'});showResult({ok:true,permission:perm});}
async function doorbell(){const r=await post('/edu/event/doorbell',{master_uid:e_uid.value,event:'doorbell',message:e_msg.value});showResult(r);await load();}
async function openDoor(){const r=await post('/edu/door/open',{master_uid:e_uid.value});showResult(r);await load();}
load();setInterval(async()=>{try{const s=await api('/edu/state'),a=document.activeElement;if(!a||!['INPUT','TEXTAREA'].includes(a.tagName))render(s);}catch(e){}},5000);
</script></body></html>`));

app.get('/edu/state',(_,res)=>{const masters=readJson('master_registry.json',{});Object.keys(masters).forEach(uid=>masters[uid].status=onlineStatus(masters[uid].last_heartbeat));const logs=readJson('push_log.json',[]).slice(-10).reverse();res.json({ok:true,masters,events:readJson('events.json',[]),commands:readJson('commands.json',{}),push:{count:readJson('push_subscriptions.json',[]).length,logs,webpush:!!webpush,setup:setupWebPush()}});});
app.post('/edu/master/heartbeat',(req,res)=>{let{master_uid,ip,mac}=req.body||{};if(!master_uid)master_uid=uidFromMac(mac);if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid_or_valid_mac'});const masters=readJson('master_registry.json',{}),source=detectSource(mac);masters[master_uid]={master_uid,ip:ip||req.ip,mac:mac||'',last_heartbeat:nowIso(),status:'ONLINE',source,uid_rule:'MAC_REVERSE_PAIRS'};writeJson('master_registry.json',masters);res.json({ok:true,master:masters[master_uid]});});
app.post('/edu/event/doorbell',async(req,res)=>{const{master_uid,event,message}=req.body||{};if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});const events=readJson('events.json',[]),item={time:nowIso(),master_uid,event:event||'doorbell',message:message||'有人按門鈴'};const push=await sendPush({type:'doorbell',title:'🔔 有人按門鈴',body:item.message,url:'/edu',tag:'rt7-edu-doorbell',master_uid});item.push_sent=push.sent||0;item.push_ok=!!(push.ok&&push.sent>0);item.push_status=push.status||'';events.push(item);writeJson('events.json',events.slice(-200));res.json({ok:true,event:item,push});});
app.post('/edu/door/open',(req,res)=>{const{master_uid}=req.body||{};if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});const commands=readJson('commands.json',{});commands[master_uid]=commands[master_uid]||[];const cmd={time:nowIso(),cmd:'OPEN_DOOR',pin:40,pulse_ms:800};commands[master_uid].push(cmd);writeJson('commands.json',commands);res.json({ok:true,command:cmd});});
app.get('/edu/device/command',(req,res)=>{const master_uid=String(req.query.master_uid||'');if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});const commands=readJson('commands.json',{}),q=commands[master_uid]||[],cmd=q.shift()||null;commands[master_uid]=q;writeJson('commands.json',commands);res.json({ok:true,command:cmd});});
app.get('/api/push/public-key',(_,res)=>{const setup=setupWebPush();res.json({ok:!!(setup.ok&&setup.publicKey),publicKey:setup.publicKey||'',webpush:!!webpush,setup});});
app.post('/api/push/subscribe',(req,res)=>{const sub=req.body&&req.body.subscription;if(!sub||!sub.endpoint)return res.status(400).json({ok:false,error:'missing subscription'});const arr=readJson('push_subscriptions.json',[]),idx=arr.findIndex(x=>(x.subscription||x).endpoint===sub.endpoint),item={subscription:sub,created_at:nowIso(),user_agent:req.headers['user-agent']||''};if(idx>=0)arr[idx]=item;else arr.push(item);writeJson('push_subscriptions.json',arr);res.json({ok:true,count:arr.length,endpoint:String(sub.endpoint).slice(0,80)});});
app.post('/api/push/test',async(req,res)=>{const p=req.body||{};res.json(await sendPush({type:'test',title:p.title||'RT7 EDU 測試推播',body:p.body||'推播功能正常',url:'/edu',tag:'rt7-edu-test'}));});
app.post('/api/push/clear',(_,res)=>{writeJson('push_subscriptions.json',[]);res.json({ok:true,count:0});});
app.get('/api/push/debug',(_,res)=>{const subs=readJson('push_subscriptions.json',[]),logs=readJson('push_log.json',[]).slice(-10).reverse();res.json({ok:true,count:subs.length,subscriptions:subs.map(s=>({created_at:s.created_at,endpoint:String((s.subscription||s).endpoint||'').slice(0,120),user_agent:s.user_agent||''})),logs,setup:setupWebPush()});});
app.listen(PORT,()=>console.log('[RT7_EDU_TEST_V2B_ANDROID_PUSH_DIAGNOSTIC] http://localhost:'+PORT+'/edu'));
