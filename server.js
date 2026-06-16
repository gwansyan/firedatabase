// RT7_EDU_TEST_V2_PUSH_NOTIFICATION
// 教學版：Heartbeat / 社區綁定 / 門鈴 / 開門 / Web Push 推播 / Node-RED 分章 Flow
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
let webpush = null;
try { webpush = require('web-push'); } catch(e) { webpush = null; }

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function ensureFile(name, fallback){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
  const p=path.join(DATA_DIR,name);
  if(!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback,null,2));
  return p;
}
function readJson(name, fallback){
  const p=ensureFile(name,fallback);
  try { return JSON.parse(fs.readFileSync(p,'utf8') || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeJson(name, data){
  const p=ensureFile(name, Array.isArray(data)?[]:{});
  fs.writeFileSync(p, JSON.stringify(data,null,2));
}
function nowIso(){ return new Date().toISOString(); }
function onlineStatus(lastSeen){ if(!lastSeen) return 'OFFLINE'; return (Date.now()-new Date(lastSeen).getTime())<300000 ? 'ONLINE':'OFFLINE'; }
function cleanMac(mac){ return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(0,12); }
function uidFromMac(mac){
  const s=cleanMac(mac);
  if(s.length !== 12) return '';
  const pairs = s.match(/../g) || [];
  return 'RT7-MASTER-' + pairs.reverse().join('');
}
function detectSource(mac){
  const m=String(mac||'').toUpperCase();
  if(m === 'AA:BB:CC:DD:EE:01') return 'SIM';
  return 'ESP32';
}
function publicKey(){
  if(!webpush) return '';
  const envPub = process.env.RT7_VAPID_PUBLIC_KEY || '';
  const envPri = process.env.RT7_VAPID_PRIVATE_KEY || '';
  if(envPub && envPri) return envPub;
  let keys = readJson('vapid_keys.json', null);
  if(!keys || !keys.publicKey || !keys.privateKey){
    keys = webpush.generateVAPIDKeys();
    writeJson('vapid_keys.json', keys);
  }
  return keys.publicKey;
}
function setupWebPush(){
  if(!webpush) return {ok:false,error:'web-push package missing'};
  const envPub = process.env.RT7_VAPID_PUBLIC_KEY || '';
  const envPri = process.env.RT7_VAPID_PRIVATE_KEY || '';
  let keys = null;
  if(envPub && envPri) keys = {publicKey:envPub, privateKey:envPri, source:'env'};
  else {
    keys = readJson('vapid_keys.json', null);
    if(!keys || !keys.publicKey || !keys.privateKey){
      keys = webpush.generateVAPIDKeys();
      writeJson('vapid_keys.json', keys);
    }
    keys.source = 'data/vapid_keys.json';
  }
  try {
    webpush.setVapidDetails(process.env.RT7_VAPID_SUBJECT || 'mailto:rt7-edu@example.com', keys.publicKey, keys.privateKey);
    return {ok:true, publicKey:keys.publicKey, source:keys.source};
  } catch(e){ return {ok:false,error:String(e.message||e)}; }
}
async function sendPush(payload){
  const setup = setupWebPush();
  const logs = readJson('push_log.json', []);
  if(!setup.ok){
    const item = {time:nowIso(), ok:false, sent:0, error:setup.error, payload};
    logs.push(item); writeJson('push_log.json', logs.slice(-200));
    return item;
  }
  const subs = readJson('push_subscriptions.json', []);
  let sent=0, removed=0, failures=[];
  const keep=[];
  for(const sub of subs){
    try {
      await webpush.sendNotification(sub.subscription || sub, JSON.stringify(payload), {TTL:60, urgency:'high'});
      sent++; keep.push(sub);
    } catch(e){
      const code=e.statusCode||e.status||0;
      failures.push({code, message:String(e.body||e.message||e).slice(0,200)});
      if([400,403,404,410].includes(code)) removed++;
      else keep.push(sub);
    }
  }
  if(removed) writeJson('push_subscriptions.json', keep);
  const item = {time:nowIso(), ok:true, sent, removed, total:subs.length, failures, payload};
  logs.push(item); writeJson('push_log.json', logs.slice(-200));
  return item;
}

ensureFile('master_registry.json',{});
ensureFile('communities.json',[]);
ensureFile('events.json',[]);
ensureFile('commands.json',{});
ensureFile('push_subscriptions.json',[]);
ensureFile('push_log.json',[]);

app.get('/',(_req,res)=>res.redirect('/edu'));
app.get('/sw.js',(_req,res)=>{
  res.type('application/javascript').send(`
self.addEventListener('push', function(event){
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  const title = data.title || 'RT7 EDU 推播';
  const opt = { body: data.body || '收到事件', icon: data.icon || '', badge: data.badge || '', tag: data.tag || 'rt7-edu', data: { url: data.url || '/edu' } };
  event.waitUntil(self.registration.showNotification(title, opt));
});
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/edu';
  event.waitUntil(clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(const c of list){ if(c.url.indexOf(url)>=0 && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});`);
});
app.get('/edu',(_req,res)=>{res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU TEST V2 Push</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.red{background:#c0392b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#607080;font-size:14px}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 EDU TEST V2：Push Notification</h1><p>第2章：ESP32 門鈴事件 → Railway → Web Push → 手機通知；Node-RED 分開 Flow 監看。</p><div id="app">載入中...</div></div><script>
let STATE={};
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));return r.json();}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function out(x){let e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function render(s){
 const masters=Object.values(s.masters||{}); STATE=s;
 let h='';
 h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 heartbeat</th></tr>';
 masters.forEach(m=>h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source)+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>');
 h+='</table></div>';
 h+='<div class="card"><h2>2. 推播訂閱</h2><p class="hint">手機 Chrome 開此頁，按「啟用推播」。若 HTTPS + 通知允許成功，Doorbell 會推播到手機。</p><button class="blue" onclick="subscribePush()">啟用推播</button><button onclick="testPush()">測試推播</button><button class="red" onclick="clearPush()">清除本頁訂閱紀錄</button><p>訂閱數：<span class="pill">'+esc(s.push.count)+'</span>　最後推播：'+esc((s.push.logs[0]&&s.push.logs[0].time)||'-')+'</p></div>';
 h+='<div class="card"><h2>3. Heartbeat 測試</h2><div class="grid"><input id="h_mac" value="AA:BB:CC:DD:EE:01"><input id="h_uid" placeholder="自動由 MAC 產生 UID"><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 heartbeat</button></div>';
 h+='<div class="card"><h2>4. 社區註冊 / 綁定主門禁</h2><div class="grid"><input id="c_name" placeholder="社區名稱，例如 A社區"><input id="c_user" value="admin"><input id="c_pass" value="1234"><select id="c_master"><option value="">選擇在線主門禁</option>';
 masters.forEach(m=>h+='<option value="'+esc(m.master_uid+'|'+(m.ip||''))+'">'+esc(m.master_uid+' / '+(m.ip||''))+'</option>');
 h+='</select></div><button onclick="regCommunity()">建立帳號並綁定</button></div>';
 h+='<div class="card"><h2>5. 門鈴 / 開門 / 推播測試</h2><div class="grid"><input id="e_uid" placeholder="Master UID" value="'+esc((masters[0]&&masters[0].master_uid)||'')+'"><input id="e_msg" value="有人按門鈴"></div><button onclick="doorbell()">送出門鈴事件 + 推播</button><button onclick="openDoor()">送出開門命令</button><button onclick="pollCmd()">ESP32 輪詢命令</button></div>';
 h+='<div class="card"><h2>6. 事件紀錄</h2><table><tr><th>時間</th><th>UID</th><th>事件</th><th>訊息</th><th>Push</th></tr>';
 (s.events||[]).slice(-10).reverse().forEach(e=>h+='<tr><td>'+esc(e.time)+'</td><td>'+esc(e.master_uid)+'</td><td>'+esc(e.event)+'</td><td>'+esc(e.message)+'</td><td>'+esc(e.push_sent==null?'-':e.push_sent)+'</td></tr>');
 h+='</table></div>';
 h+='<div class="card"><h2>7. 回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h;
}
async function load(){ render(await api('/edu/state')); }
function b64ToUint8Array(base64String){ const padding='='.repeat((4-base64String.length%4)%4); const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(base64); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i); return out; }
async function subscribePush(){
 if(!('serviceWorker' in navigator) || !('PushManager' in window)){ out({ok:false,error:'browser_not_supported'}); return; }
 const key = (await api('/api/push/public-key')).publicKey;
 if(!key){ out({ok:false,error:'no_vapid_key'}); return; }
 const reg = await navigator.serviceWorker.register('/sw.js');
 let sub = await reg.pushManager.getSubscription();
 if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToUint8Array(key)});
 out(await post('/api/push/subscribe',{subscription:sub}));
 await load();
}
async function testPush(){ out(await post('/api/push/test',{title:'RT7 EDU 測試推播',body:'推播功能正常'})); await load(); }
async function clearPush(){ out(await post('/api/push/clear',{})); await load(); }
async function sendHeartbeat(){out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,mac:h_mac.value,ip:h_ip.value})); await load();}
async function regCommunity(){const pair=(c_master.value||'|').split('|'); out(await post('/edu/community/register',{community:c_name.value,username:c_user.value,password:c_pass.value,master_uid:pair[0],master_ip:pair[1]})); await load();}
async function doorbell(){out(await post('/edu/event/doorbell',{master_uid:e_uid.value,event:'doorbell',message:e_msg.value})); await load();}
async function openDoor(){out(await post('/edu/door/open',{master_uid:e_uid.value})); await load();}
async function pollCmd(){out(await api('/edu/device/command?master_uid='+encodeURIComponent(e_uid.value))); await load();}
load(); setInterval(async()=>{try{const s=await api('/edu/state'); const active=document.activeElement; if(!active || !['INPUT','SELECT','TEXTAREA'].includes(active.tagName)) render(s);}catch(e){}},5000);
</script></body></html>`);});

app.get('/edu/state',(_req,res)=>{
  const masters=readJson('master_registry.json',{});
  Object.keys(masters).forEach(uid=>masters[uid].status=onlineStatus(masters[uid].last_heartbeat));
  const logs = readJson('push_log.json', []).slice(-10).reverse();
  res.json({ok:true,masters,communities:readJson('communities.json',[]),events:readJson('events.json',[]),commands:readJson('commands.json',{}),push:{count:readJson('push_subscriptions.json',[]).length,logs}});
});
app.post('/edu/master/heartbeat',(req,res)=>{
  let {master_uid,ip,mac}=req.body||{};
  if(!master_uid) master_uid = uidFromMac(mac);
  if(!master_uid) return res.status(400).json({ok:false,error:'missing master_uid_or_valid_mac'});
  const masters=readJson('master_registry.json',{});
  const existing=masters[master_uid]||{};
  const source=detectSource(mac);
  if(existing.source==='ESP32' && source==='SIM'){
    existing.last_sim_heartbeat = nowIso();
    masters[master_uid]=existing;
  } else {
    masters[master_uid]={master_uid,ip:ip||req.ip,mac:mac||existing.mac||'',last_heartbeat:nowIso(),status:'ONLINE',source,uid_rule:'MAC_REVERSE_PAIRS'};
  }
  writeJson('master_registry.json',masters);
  console.log('[EDU][HEARTBEAT]',master_uid,ip||req.ip,mac||'',source);
  res.json({ok:true,master:masters[master_uid]});
});
app.post('/edu/community/register',(req,res)=>{
  const {community,username,password,master_uid,master_ip}=req.body||{};
  if(!community||!username||!password||!master_uid)return res.status(400).json({ok:false,error:'missing community/username/password/master_uid'});
  const masters=readJson('master_registry.json',{});
  if(!masters[master_uid])return res.status(400).json({ok:false,error:'master_uid not online in registry'});
  const communities=readJson('communities.json',[]);
  if(communities.some(u=>u.community===community&&u.username===username))return res.status(409).json({ok:false,error:'account exists in same community'});
  if(communities.some(u=>u.community!==community&&u.master_uid===master_uid))return res.status(409).json({ok:false,error:'master_uid already bound by another community'});
  const role=communities.some(u=>u.community===community)?'user':'admin';
  const user={id:'u_'+Math.random().toString(16).slice(2)+Date.now().toString(16),community,username,password,role,master_uid,master_ip:master_ip||masters[master_uid].ip||'',created_at:nowIso()};
  communities.push(user); writeJson('communities.json',communities);
  res.json({ok:true,user:{...user,password:'***'}});
});
app.post('/edu/login',(req,res)=>{
  const {community,username,password}=req.body||{};
  const communities=readJson('communities.json',[]);
  const user=communities.find(u=>u.community===community&&u.username===username&&u.password===password);
  if(!user)return res.status(401).json({ok:false,error:'login failed'});
  const masters=readJson('master_registry.json',{});
  const master=masters[user.master_uid];
  res.json({ok:true,message:'login success',user:{community:user.community,username:user.username,role:user.role,master_uid:user.master_uid,master_status:master?onlineStatus(master.last_heartbeat):'OFFLINE'}});
});
app.post('/edu/event/doorbell', async (req,res)=>{
  const {master_uid,event,message}=req.body||{};
  if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});
  const events=readJson('events.json',[]);
  const item={time:nowIso(),master_uid,event:event||'doorbell',message:message||'有人按門鈴'};
  const push = await sendPush({type:'doorbell',title:'🔔 有人按門鈴',body:item.message,url:'/edu',tag:'rt7-edu-doorbell',master_uid});
  item.push_sent = push.sent || 0;
  item.push_ok = !!push.ok;
  events.push(item); writeJson('events.json',events.slice(-200));
  res.json({ok:true,event:item,push});
});
app.post('/edu/door/open',(req,res)=>{
  const {master_uid}=req.body||{};
  if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});
  const commands=readJson('commands.json',{});
  commands[master_uid]=commands[master_uid]||[];
  const cmd={time:nowIso(),cmd:'OPEN_DOOR',pin:40,pulse_ms:800};
  commands[master_uid].push(cmd); writeJson('commands.json',commands);
  res.json({ok:true,command:cmd});
});
app.get('/edu/device/command',(req,res)=>{
  const master_uid=String(req.query.master_uid||'');
  if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});
  const commands=readJson('commands.json',{});
  const queue=commands[master_uid]||[];
  const cmd=queue.shift()||null;
  commands[master_uid]=queue; writeJson('commands.json',commands);
  res.json({ok:true,command:cmd});
});

app.get('/api/push/public-key',(_req,res)=>res.json({ok:!!publicKey(),publicKey:publicKey(),webpush:!!webpush}));
app.post('/api/push/subscribe',(req,res)=>{
  const sub=req.body && req.body.subscription;
  if(!sub || !sub.endpoint)return res.status(400).json({ok:false,error:'missing subscription'});
  const arr=readJson('push_subscriptions.json',[]);
  const idx=arr.findIndex(x=>(x.subscription||x).endpoint===sub.endpoint);
  const item={subscription:sub,created_at:nowIso(),user_agent:req.headers['user-agent']||''};
  if(idx>=0) arr[idx]=item; else arr.push(item);
  writeJson('push_subscriptions.json',arr);
  res.json({ok:true,count:arr.length});
});
app.post('/api/push/test',async(req,res)=>{
  const p=req.body||{};
  res.json(await sendPush({type:'test',title:p.title||'RT7 EDU 測試推播',body:p.body||'推播功能正常',url:'/edu',tag:'rt7-edu-test'}));
});
app.post('/api/push/clear',(_req,res)=>{ writeJson('push_subscriptions.json',[]); res.json({ok:true,count:0}); });

app.listen(PORT,()=>console.log('[RT7_EDU_TEST_V2_PUSH] http://localhost:'+PORT+'/edu'));
