const express=require('express');
const cors=require('cors');
const fs=require('fs');
const path=require('path');
let OpenAI=null;try{OpenAI=require('openai').OpenAI||require('openai');}catch(e){OpenAI=null;}
let webpush=null;try{webpush=require('web-push');}catch(e){}
const app=express();const PORT=process.env.PORT||3000;const DATA_DIR=path.join(__dirname,'data');
app.use(cors());app.use(express.json({limit:'20mb'}));app.use(express.urlencoded({extended:true,limit:'20mb'}));
function ensureFile(n,f){if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});const p=path.join(DATA_DIR,n);if(!fs.existsSync(p))fs.writeFileSync(p,JSON.stringify(f,null,2));return p;}
function readJson(n,f){const p=ensureFile(n,f);try{return JSON.parse(fs.readFileSync(p,'utf8')||JSON.stringify(f));}catch{return f;}}
function writeJson(n,d){const p=ensureFile(n,Array.isArray(d)?[]:{});fs.writeFileSync(p,JSON.stringify(d,null,2));}
function nowIso(){return new Date().toISOString();}
function id(prefix){return prefix+'_'+Math.random().toString(16).slice(2)+Date.now().toString(16);}
function onlineStatus(t){return t&&(Date.now()-new Date(t).getTime())<300000?'ONLINE':'OFFLINE';}
function cleanMac(m){return String(m||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(0,12);}
function uidFromMac(m){const s=cleanMac(m);if(s.length!==12)return'';return'RT7-MASTER-'+(s.match(/../g)||[]).reverse().join('');}
function detectSource(mac){return String(mac||'').toUpperCase()==='AA:BB:CC:DD:EE:01'?'SIM':'ESP32';}
function safeUser(u){let x={...u};delete x.password;return x;}
function endpointShort(e){return String(e||'').slice(0,90);}
function setupWebPush(){if(!webpush)return{ok:false,error:'web-push package missing'};const pub=process.env.RT7_VAPID_PUBLIC_KEY||'',pri=process.env.RT7_VAPID_PRIVATE_KEY||'';let keys=null;if(pub&&pri)keys={publicKey:pub,privateKey:pri,source:'env'};else{keys=readJson('vapid_keys.json',null);if(!keys||!keys.publicKey||!keys.privateKey){keys=webpush.generateVAPIDKeys();writeJson('vapid_keys.json',keys);}keys.source='data/vapid_keys.json';}try{webpush.setVapidDetails(process.env.RT7_VAPID_SUBJECT||'mailto:rt7-ch4@example.com',keys.publicKey,keys.privateKey);return{ok:true,publicKey:keys.publicKey,source:keys.source};}catch(e){return{ok:false,error:String(e.message||e)};}}
function removeBadEndpoints(badEndpoints){if(!badEndpoints||!badEndpoints.length)return{removed_subs:0,removed_groups:0};const bad=new Set(badEndpoints);const subs=readJson('push_subscriptions.json',[]);const groups=readJson('community_push_groups.json',[]);const keptSubs=subs.filter(s=>!bad.has((s.subscription||s).endpoint));const keptGroups=groups.filter(g=>!bad.has(g.endpoint||((g.subscription||{}).endpoint)));writeJson('push_subscriptions.json',keptSubs);writeJson('community_push_groups.json',keptGroups);return{removed_subs:subs.length-keptSubs.length,removed_groups:groups.length-keptGroups.length};}
async function sendPushToSubs(subs,payload){const setup=setupWebPush(),logs=readJson('push_log.json',[]);if(!setup.ok){const item={time:nowIso(),ok:false,sent:0,total:subs.length,status:'SETUP_FAILED',failures:[{message:setup.error}],payload};logs.push(item);writeJson('push_log.json',logs.slice(-200));return item;}let sent=0,removed=0,failures=[],bad=[];for(const wrap of subs){const sub=wrap.subscription||wrap;try{await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:60,urgency:'high'});sent++;}catch(e){const code=e.statusCode||e.status||0;const endpoint=sub.endpoint||wrap.endpoint||'';failures.push({code,endpoint:endpointShort(endpoint),message:String(e.body||e.message||e).slice(0,400)});if([400,403,404,410].includes(code)){removed++;if(endpoint)bad.push(endpoint);}}}const cleanup=removeBadEndpoints(bad);const item={time:nowIso(),ok:true,sent,total:subs.length,removed,status:sent>0?'SENT':(subs.length===0?'NO_SUBSCRIBERS':'FAILED'),failures,cleanup,payload};logs.push(item);writeJson('push_log.json',logs.slice(-200));return item;}
['master_registry.json','commands.json'].forEach(n=>ensureFile(n,{}));['communities.json','users.json','events.json','push_subscriptions.json','community_push_groups.json','push_log.json','door_access_log.json'].forEach(n=>ensureFile(n,[]));
app.get('/',(_,res)=>res.redirect('/rt7_ch4_door_access'));
app.get('/sw.js',(_,res)=>res.type('application/javascript').set('Service-Worker-Allowed','/').send(`self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){};e.waitUntil(self.registration.showNotification(d.title||'RT7 門禁通知',{body:d.body||'收到通知',tag:d.tag||'rt7-door-access',renotify:true,data:{url:d.url||'/rt7_ch4_door_access'}}));});self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'/rt7_ch4_door_access';e.waitUntil(clients.openWindow(u));});`));
app.get('/rt7_ch4_door_access',(_,res)=>res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH4 V4A</title><style>body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1120px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.red{background:#c0392b}.gray{background:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;vertical-align:top}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap;min-height:50px}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#607080;font-size:14px;line-height:1.6}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 CH4 Push Group Auto Replace Subscription</h1><p>加入社區推播群組時，自動刪除同社區舊 endpoint，只保留最新手機 subscription。</p><div id="app">載入中...</div></div><script>
window.addEventListener('error',e=>show({ok:false,where:'window.onerror',message:e.message,line:e.lineno}));window.addEventListener('unhandledrejection',e=>show({ok:false,where:'unhandledrejection',message:String(e.reason&&e.reason.message||e.reason)}));
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function show(x){let e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}async function safe(fn){try{show({running:true,fn:fn.name});await fn();}catch(e){show({ok:false,error:String(e.message||e),stack:String(e.stack||'').slice(0,600)});}}
function render(s){const masters=Object.values(s.masters||{}),communities=s.communities||[],users=s.users||[],access=s.door_access_log||[],cmds=s.commands||{},logs=(s.push&&s.push.logs)||[],groups=s.community_push_groups||[];let h='';h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 heartbeat</th></tr>';masters.forEach(m=>h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source)+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>');h+='</table></div>';
h+='<div class="card"><h2>2. 建立社區與帳號</h2><div class="grid"><input id="new_comm" placeholder="社區名稱，例如 A社區"><input id="new_admin" value="admin"><input id="new_pass" value="1234"><select id="new_master"><option value="">選擇在線主門禁</option>';masters.forEach(m=>h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid+' / '+(m.ip||''))+'</option>');h+='</select></div><button onclick="safe(createCommunity)">建立社區</button><div class="grid"><select id="user_comm"><option value="">選擇社區</option>';communities.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');h+='</select><input id="user_name" placeholder="住戶帳號，例如 user01"><input id="user_pass" value="1111"></div><button onclick="safe(addUser)">新增住戶</button></div>';
h+='<div class="card"><h2>3. 社區推播群組</h2><p class="hint">V4A：按「加入社區推播群組」會自動刪除同社區舊 endpoint，只保留最新手機 subscription。</p><div class="grid"><select id="push_comm"><option value="">選擇社區</option>';communities.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');h+='</select></div><button class="blue" onclick="safe(resubscribe)">重新訂閱推播</button><button onclick="safe(bindPush)">加入社區推播群組</button><button class="gray" onclick="safe(testCommunityPush)">測試社區推播</button><button class="red" onclick="safe(clearAllPush)">清除全部推播訂閱/群組</button><p>全域訂閱數：<span class="pill">'+esc(s.push.count)+'</span>　社區群組數：<span class="pill">'+esc(groups.length)+'</span></p><details><summary>社區群組 endpoint</summary><pre>'+esc(JSON.stringify(groups.map(g=>({community_id:g.community_id,endpoint:(g.endpoint||'').slice(0,80),updated_at:g.updated_at,replace_note:g.replace_note})),null,2))+'</pre></details></div>';
h+='<div class="card"><h2>4. 遠端開門 Access Control</h2><div class="grid"><select id="open_comm"><option value="">選擇社區</option>';communities.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name+' / '+c.master_uid)+'</option>');h+='</select><input id="open_user" value="user01" placeholder="帳號"><select id="open_reason"><option value="REMOTE_OPEN">REMOTE_OPEN</option><option value="DOORBELL_APPROVE">DOORBELL_APPROVE</option><option value="ADMIN_TEST">ADMIN_TEST</option></select></div><button class="blue" onclick="safe(openDoor)">遠端開門</button><button class="gray" onclick="safe(pollCmd)">模擬 ESP32 取命令</button></div>';
h+='<div class="card"><h2>5. 門鈴 → 社區推播</h2><div class="grid"><input id="door_uid" placeholder="Master UID" value="'+esc((masters[0]&&masters[0].master_uid)||'')+'"><input id="door_msg" value="有人按門鈴"></div><button onclick="safe(doorbell)">送出門鈴事件 → 該社區推播</button></div>';
h+='<div class="card"><h2>6. 社區清單</h2><table><tr><th>社區</th><th>Master UID</th><th>Master狀態</th><th>建立時間</th></tr>';communities.forEach(c=>h+='<tr><td>'+esc(c.name)+'</td><td>'+esc(c.master_uid)+'</td><td>'+esc(c.master_status||'-')+'</td><td>'+esc(c.created_at)+'</td></tr>');h+='</table></div><div class="card"><h2>7. 帳號清單</h2><table><tr><th>社區</th><th>帳號</th><th>角色</th><th>狀態</th></tr>';users.forEach(u=>h+='<tr><td>'+esc(u.community_name||u.community_id)+'</td><td>'+esc(u.username)+'</td><td>'+esc(u.role)+'</td><td>'+esc(u.status||'ACTIVE')+'</td></tr>');h+='</table></div>';
h+='<div class="card"><h2>8. Command Queue</h2><pre>'+esc(JSON.stringify(cmds,null,2))+'</pre></div><div class="card"><h2>9. Door Access Log</h2><table><tr><th>時間</th><th>社區</th><th>使用者</th><th>Master UID</th><th>動作</th><th>結果</th></tr>';access.slice(0,20).forEach(x=>h+='<tr><td>'+esc(x.time)+'</td><td>'+esc(x.community_name)+'</td><td>'+esc(x.username)+'</td><td>'+esc(x.master_uid)+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.result)+'</td></tr>');h+='</table></div><div class="card"><h2>10. 最新 Push Log</h2><pre>'+esc(JSON.stringify(logs[0]||{},null,2))+'</pre></div><div class="card"><h2>11. 即時結果</h2><pre id="out">READY</pre></div>';document.getElementById('app').innerHTML=h;}
async function load(){render(await api('/api/ch4/state'));}function b64ToUint8Array(b){const p='='.repeat((4-b.length%4)%4),base64=(b+p).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}async function createCommunity(){show(await post('/api/community/create',{name:new_comm.value,admin_username:new_admin.value,password:new_pass.value,master_uid:new_master.value}));await load();}async function addUser(){show(await post('/api/community/user/add',{community_id:user_comm.value,username:user_name.value,password:user_pass.value,role:'USER'}));await load();}async function subscribe(){if(!('serviceWorker'in navigator))throw new Error('serviceWorker not supported');if(!('PushManager'in window))throw new Error('PushManager not supported');const kr=await api('/api/push/public-key');if(!kr.publicKey)throw new Error('no VAPID key');const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;let perm=Notification.permission;if(perm!=='granted')perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('notification permission '+perm);let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToUint8Array(kr.publicKey)});return sub;}async function resubscribe(){const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;const old=await reg.pushManager.getSubscription();if(old)await old.unsubscribe();const sub=await subscribe();show(await post('/api/push/subscribe',{subscription:sub}));await load();}async function bindPush(){const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub)sub=await subscribe();show(await post('/api/community/push/bind',{community_id:push_comm.value,subscription:sub,replace:true}));await load();}async function testCommunityPush(){show(await post('/api/community/push/test',{community_id:push_comm.value,title:'RT7 社區推播測試',body:'社區推播功能正常'}));await load();}async function clearAllPush(){show(await post('/api/push/clear',{}));await load();}async function openDoor(){show(await post('/api/rt7/community/open',{community_id:open_comm.value,username:open_user.value,reason:open_reason.value}));await load();}async function pollCmd(){const c=open_comm.value;const s=await api('/api/ch4/state');const comm=(s.communities||[]).find(x=>x.community_id===c);if(!comm)throw new Error('select community first');show(await api('/api/rt7/device/command?master_uid='+encodeURIComponent(comm.master_uid)));await load();}async function doorbell(){show(await post('/api/rt7/community/doorbell',{master_uid:door_uid.value,message:door_msg.value}));await load();}load();setInterval(async()=>{try{const s=await api('/api/ch4/state'),a=document.activeElement;if(!a||!['INPUT','SELECT','TEXTAREA'].includes(a.tagName))render(s);}catch(e){}},5000);
</script></body></html>`));
app.get('/api/ch4/state',(_,res)=>{const masters=readJson('master_registry.json',{});Object.keys(masters).forEach(uid=>masters[uid].status=onlineStatus(masters[uid].last_heartbeat));const communities=readJson('communities.json',[]).map(c=>({...c,master_status:masters[c.master_uid]?onlineStatus(masters[c.master_uid].last_heartbeat):'OFFLINE'}));const users=readJson('users.json',[]).map(safeUser);res.json({ok:true,masters,communities,users,commands:readJson('commands.json',{}),community_push_groups:readJson('community_push_groups.json',[]),events:readJson('events.json',[]).slice(-50).reverse(),door_access_log:readJson('door_access_log.json',[]).slice(0,100),push:{count:readJson('push_subscriptions.json',[]).length,logs:readJson('push_log.json',[]).slice(-10).reverse(),setup:setupWebPush()}});});
app.get('/api/rt7/community/list',(_,res)=>{const masters=readJson('master_registry.json',{});const communities=readJson('communities.json',[]).map(c=>({...c,master_status:masters[c.master_uid]?onlineStatus(masters[c.master_uid].last_heartbeat):'OFFLINE'}));res.json({ok:true,communities});});
app.get('/api/rt7/community/subscriptions',(_,res)=>res.json({ok:true,count:readJson('community_push_groups.json',[]).length,subscriptions:readJson('community_push_groups.json',[]).map(g=>({community_id:g.community_id,endpoint:endpointShort(g.endpoint),updated_at:g.updated_at,created_at:g.created_at,replace_note:g.replace_note}))}));
app.get('/api/community/state',(req,res)=>app._router.handle(Object.assign(req,{url:'/api/ch4/state'}),res,()=>{}));
app.post('/api/rt7/master/heartbeat',(req,res)=>{let{master_uid,ip,mac}=req.body||{};if(!master_uid)master_uid=uidFromMac(mac);if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid_or_valid_mac'});const masters=readJson('master_registry.json',{});masters[master_uid]={master_uid,ip:ip||req.ip,mac:mac||'',last_heartbeat:nowIso(),status:'ONLINE',source:detectSource(mac),uid_rule:'MAC_REVERSE_PAIRS'};writeJson('master_registry.json',masters);res.json({ok:true,master:masters[master_uid]});});
app.post('/api/community/create',(req,res)=>{const{name,admin_username,password,master_uid}=req.body||{};if(!name||!admin_username||!password||!master_uid)return res.status(400).json({ok:false,error:'missing name/admin/password/master_uid'});const masters=readJson('master_registry.json',{});if(!masters[master_uid])return res.status(400).json({ok:false,error:'master not online'});const communities=readJson('communities.json',[]),users=readJson('users.json',[]);if(communities.some(c=>c.name===name))return res.status(409).json({ok:false,error:'community exists'});if(communities.some(c=>c.master_uid===master_uid))return res.status(409).json({ok:false,error:'master already bound'});const community={community_id:id('comm'),name,master_uid,master_ip:masters[master_uid].ip||'',created_at:nowIso()};const user={user_id:id('user'),community_id:community.community_id,community_name:name,username:admin_username,password,role:'ADMIN',status:'ACTIVE',can_open:true,created_at:nowIso()};communities.push(community);users.push(user);writeJson('communities.json',communities);writeJson('users.json',users);res.json({ok:true,community,user:safeUser(user)});});
app.post('/api/community/user/add',(req,res)=>{const{community_id,username,password,role}=req.body||{};if(!community_id||!username||!password)return res.status(400).json({ok:false,error:'missing community_id/username/password'});const communities=readJson('communities.json',[]),c=communities.find(x=>x.community_id===community_id);if(!c)return res.status(404).json({ok:false,error:'community not found'});const users=readJson('users.json',[]);if(users.some(u=>u.community_id===community_id&&u.username===username))return res.status(409).json({ok:false,error:'user exists in community'});const user={user_id:id('user'),community_id,community_name:c.name,username,password,role:role||'USER',status:'ACTIVE',can_open:true,created_at:nowIso()};users.push(user);writeJson('users.json',users);res.json({ok:true,user:safeUser(user)});});
app.post('/api/community/login',(req,res)=>{const{community,username,password}=req.body||{};const users=readJson('users.json',[]);const u=users.find(x=>(x.community_name===community||x.community_id===community)&&x.username===username&&x.password===password);if(!u)return res.status(401).json({ok:false,error:'login failed'});const c=readJson('communities.json',[]).find(x=>x.community_id===u.community_id);res.json({ok:true,user:safeUser(u),community:c});});
app.get('/api/push/public-key',(_,res)=>{const setup=setupWebPush();res.json({ok:!!setup.ok,publicKey:setup.publicKey||'',setup});});
app.post('/api/push/subscribe',(req,res)=>{const sub=req.body&&req.body.subscription;if(!sub||!sub.endpoint)return res.status(400).json({ok:false,error:'missing subscription'});let arr=readJson('push_subscriptions.json',[]);arr=arr.filter(x=>(x.subscription||x).endpoint!==sub.endpoint);arr.push({subscription:sub,endpoint:sub.endpoint,created_at:nowIso(),updated_at:nowIso(),user_agent:req.headers['user-agent']||'',replace_note:'V4A_GLOBAL_REPLACED_BY_ENDPOINT'});writeJson('push_subscriptions.json',arr);res.json({ok:true,count:arr.length,endpoint:endpointShort(sub.endpoint)});});
app.post('/api/push/clear',(_,res)=>{writeJson('push_subscriptions.json',[]);writeJson('community_push_groups.json',[]);res.json({ok:true,count:0,cleared:['push_subscriptions','community_push_groups']});});
app.post('/api/community/push/bind',(req,res)=>{const{community_id,subscription}=req.body||{};if(!community_id||!subscription||!subscription.endpoint)return res.status(400).json({ok:false,error:'missing community_id/subscription'});const communities=readJson('communities.json',[]);if(!communities.find(c=>c.community_id===community_id))return res.status(404).json({ok:false,error:'community not found'});const endpoint=subscription.endpoint;let subs=readJson('push_subscriptions.json',[]);const beforeSubs=subs.length;subs=subs.filter(s=>(s.subscription||s).endpoint!==endpoint);subs.push({subscription,endpoint,created_at:nowIso(),updated_at:nowIso(),user_agent:req.headers['user-agent']||'',replace_note:'V4A_GLOBAL_REPLACED_BY_ENDPOINT'});writeJson('push_subscriptions.json',subs);let groups=readJson('community_push_groups.json',[]);const beforeGroups=groups.length;groups=groups.filter(g=>g.community_id!==community_id && (g.endpoint||((g.subscription||{}).endpoint))!==endpoint);const item={community_id,endpoint,subscription,created_at:nowIso(),updated_at:nowIso(),replace_note:'V4A_AUTO_REPLACE_COMMUNITY_SUBSCRIPTION'};groups.push(item);writeJson('community_push_groups.json',groups);res.json({ok:true,community_id,count:groups.filter(g=>g.community_id===community_id).length,before:{global_subscriptions:beforeSubs,community_groups:beforeGroups},after:{global_subscriptions:subs.length,community_groups:groups.length},replaced:true,endpoint:endpointShort(endpoint)});});
app.post('/api/community/push/test',async(req,res)=>{const{community_id,title,body}=req.body||{};if(!community_id)return res.status(400).json({ok:false,error:'missing community_id'});const groups=readJson('community_push_groups.json',[]).filter(g=>g.community_id===community_id);const result=await sendPushToSubs(groups,{type:'community_test',title:title||'RT7 社區推播測試',body:body||'社區推播功能正常',url:'/rt7_ch4_door_access',community_id});res.json({ok:true,result});});
app.post('/api/rt7/community/doorbell',async(req,res)=>{const{master_uid,message}=req.body||{};if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});const communities=readJson('communities.json',[]),c=communities.find(x=>x.master_uid===master_uid);const events=readJson('events.json',[]);const event={time:nowIso(),master_uid,community_id:c&&c.community_id,community_name:c&&c.name,event:'doorbell',message:message||'有人按門鈴'};let push={sent:0,total:0,status:'NO_COMMUNITY'};if(c){const groups=readJson('community_push_groups.json',[]).filter(g=>g.community_id===c.community_id);push=await sendPushToSubs(groups,{type:'doorbell',title:'🔔 '+c.name+' 有人按門鈴',body:event.message,url:'/rt7_ch4_door_access',tag:'rt7-community-doorbell',master_uid,community_id:c.community_id});}event.push_sent=push.sent||0;event.push_status=push.status||'';events.push(event);writeJson('events.json',events.slice(-200));res.json({ok:true,event,push});});
app.post('/api/rt7/community/open',(req,res)=>{const{community_id,username,reason}=req.body||{};if(!community_id||!username)return res.status(400).json({ok:false,error:'missing community_id/username'});const communities=readJson('communities.json',[]),community=communities.find(c=>c.community_id===community_id);if(!community)return res.status(404).json({ok:false,error:'community_not_found'});const users=readJson('users.json',[]);const user=users.find(u=>u.community_id===community_id&&u.username===username&&u.status==='ACTIVE');if(!user)return res.status(403).json({ok:false,error:'user_not_allowed'});if(user.can_open===false||user.role==='GUEST')return res.status(403).json({ok:false,error:'open_permission_denied'});const master_uid=community.master_uid;const commands=readJson('commands.json',{});commands[master_uid]=commands[master_uid]||[];const cmd={time:nowIso(),cmd:'OPEN_DOOR',pin:40,pulse_ms:800,source:'community',community_id,community_name:community.name,username,reason:reason||'REMOTE_OPEN'};commands[master_uid].push(cmd);writeJson('commands.json',commands);const logs=readJson('door_access_log.json',[]);const log={time:nowIso(),community_id,community_name:community.name,username,role:user.role,master_uid,action:'OPEN_DOOR',result:'QUEUED',reason:reason||'REMOTE_OPEN'};logs.unshift(log);writeJson('door_access_log.json',logs.slice(0,300));res.json({ok:true,command:cmd,log});});
app.get('/api/rt7/community/access_logs',(_,res)=>res.json({ok:true,logs:readJson('door_access_log.json',[]).slice(0,100)}));
app.get('/api/rt7/device/command',(req,res)=>{const master_uid=String(req.query.master_uid||'');if(!master_uid)return res.status(400).json({ok:false,error:'missing master_uid'});const commands=readJson('commands.json',{}),q=commands[master_uid]||[],cmd=q.shift()||null;commands[master_uid]=q;writeJson('commands.json',commands);res.json({ok:true,command:cmd});});
app.post('/edu/master/heartbeat',(req,res)=>{req.url='/api/rt7/master/heartbeat';app._router.handle(req,res,()=>{});});app.post('/edu/event/doorbell',(req,res)=>{req.url='/api/rt7/community/doorbell';app._router.handle(req,res,()=>{});});app.get('/edu/device/command',(req,res)=>{req.url='/api/rt7/device/command';app._router.handle(req,res,()=>{});});

// ======================================================
// RT7_CH5B_OPENAI_REAL_FACE_MATCH_SERVER_PATCH
// Add-on for RT7_CH4_PUSH_GROUP_AUTO_REPLACE_SUBSCRIPTION
// Requires Railway env: OPENAI_API_KEY
// New pages:
//   /rt7_ch5_face_register
// New APIs:
//   GET  /api/ch5/faces
//   POST /api/ch5/face/register
//   POST /api/ch5/snapshot
//   POST /api/ch5/face/check
//   GET  /api/ch5/face/log
// ======================================================

const CH5_UPLOAD_DIR=path.join(DATA_DIR,'uploads');
if(!fs.existsSync(CH5_UPLOAD_DIR))fs.mkdirSync(CH5_UPLOAD_DIR,{recursive:true});
ensureFile('faces.json',[]);
ensureFile('face_access_log.json',[]);

function ch5CleanBase64Image(image){
  if(!image)return null;
  return String(image).replace(/^data:image\/\w+;base64,/,'');
}
function ch5SafeJsonParse(txt){
  const raw=String(txt||'').trim();
  try{return JSON.parse(raw);}catch(e){}
  const m=raw.match(/\{[\s\S]*\}/);
  if(m){try{return JSON.parse(m[0]);}catch(e){}}
  return {match:false,confidence:0,reason:'JSON_PARSE_FAILED',raw:raw.slice(0,500)};
}
function ch5GetOpenAI(){
  if(!OpenAI)return null;
  if(!process.env.OPENAI_API_KEY)return null;
  return new OpenAI({apiKey:process.env.OPENAI_API_KEY});
}
function ch5CommunityName(community_id){
  const c=readJson('communities.json',[]).find(x=>x.community_id===community_id);
  return c?c.name:'';
}
async function ch5PushCommunity(community_id,payload){
  const groups=readJson('community_push_groups.json',[]).filter(g=>g.community_id===community_id);
  return await sendPushToSubs(groups,payload);
}
function ch5QueueOpenDoor(master_uid,community_id,community_name,username,confidence){
  const commands=readJson('commands.json',{});
  commands[master_uid]=commands[master_uid]||[];
  const cmd={
    time:nowIso(),
    cmd:'OPEN_DOOR',
    pin:40,
    pulse_ms:800,
    source:'face_recognition',
    community_id,
    community_name,
    username,
    confidence
  };
  commands[master_uid].push(cmd);
  writeJson('commands.json',commands);
  return cmd;
}
async function ch5OpenAiFaceMatch(registeredFile,snapshotFile){
  const openai=ch5GetOpenAI();
  if(!openai){
    return {match:false,confidence:0,reason:'OPENAI_API_KEY_MISSING_OR_OPENAI_PACKAGE_MISSING'};
  }
  const reg64=fs.readFileSync(registeredFile).toString('base64');
  const snap64=fs.readFileSync(snapshotFile).toString('base64');
  const r=await openai.chat.completions.create({
    model:process.env.RT7_FACE_MODEL||'gpt-4o',
    messages:[
      {
        role:'system',
        content:'你是社區門禁人臉辨識系統。比較兩張照片中的主要人臉是否為同一人。只輸出JSON，不要Markdown。格式：{"match":true,"confidence":95,"reason":"same person"}。confidence為0到100整數。若照片無清楚人臉，match=false，confidence低於50。'
      },
      {
        role:'user',
        content:[
          {type:'text',text:'請比較第1張註冊照片與第2張即時門口照片是否同一人。'},
          {type:'image_url',image_url:{url:`data:image/jpeg;base64,${reg64}`}},
          {type:'image_url',image_url:{url:`data:image/jpeg;base64,${snap64}`}}
        ]
      }
    ],
    temperature:0
  });
  return ch5SafeJsonParse(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content);
}

app.get('/rt7_ch5_face_register',(_,res)=>res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH5B Face Register</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1000px;margin:18px auto;padding:14px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.red{background:#c0392b}.gray{background:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}img{max-width:100%;border-radius:10px;margin-top:8px}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 CH5B OpenAI Real Face Match</h1><p>手機註冊人臉、上傳 Snapshot、OpenAI 真實比對、自動開門。</p><div id="app">載入中...</div></div><script>
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function show(x){document.getElementById('out').textContent=JSON.stringify(x,null,2);}
function fileDataUrl(input){return new Promise((resolve,reject)=>{const f=input.files&&input.files[0];if(!f)return reject(new Error('NO_FILE'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});}
async function render(){
 const st=await api('/api/ch4/state'); const faces=await api('/api/ch5/faces'); const logs=await api('/api/ch5/face/log');
 const comms=st.communities||[]; const masters=Object.values(st.masters||{});
 let h='';
 h+='<div class="card"><h2>1. 人臉註冊 Face Register</h2><div class="grid"><select id="reg_comm"><option value="">選擇社區</option>';
 comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');
 h+='</select><input id="reg_user" value="user01" placeholder="username"></div><input id="reg_photo" type="file" accept="image/*" capture="user"><button class="blue" onclick="registerFace()">上傳註冊人臉</button></div>';
 h+='<div class="card"><h2>2. Snapshot 測試 / OpenAI Face Match</h2><div class="grid"><select id="chk_comm"><option value="">選擇社區</option>';
 comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');
 h+='</select><select id="chk_master"><option value="">選擇 Master UID</option>';
 masters.forEach(m=>h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid+'</option>'));
 h+='</select></div><input id="snap_photo" type="file" accept="image/*" capture="environment"><button onclick="snapshotOnly()">只上傳 Snapshot</button><button class="blue" onclick="snapshotAndCheck()">上傳 Snapshot + OpenAI 比對</button></div>';
 h+='<div class="card"><h2>3. Face DB <span class="pill">'+esc(faces.total||0)+'</span></h2><pre>'+esc(JSON.stringify(faces,null,2))+'</pre></div>';
 h+='<div class="card"><h2>4. Face Access Log</h2><pre>'+esc(JSON.stringify((logs.logs||[]).slice(0,20),null,2))+'</pre></div>';
 h+='<div class="card"><h2>5. 即時結果</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h;
}
async function registerFace(){
 const image=await fileDataUrl(document.getElementById('reg_photo'));
 const r=await post('/api/ch5/face/register',{community_id:reg_comm.value,username:reg_user.value,image});
 show(r); setTimeout(render,800);
}
async function snapshotOnly(){
 const image=await fileDataUrl(document.getElementById('snap_photo'));
 show(await post('/api/ch5/snapshot',{community_id:chk_comm.value,master_uid:chk_master.value,image}));
}
async function snapshotAndCheck(){
 const image=await fileDataUrl(document.getElementById('snap_photo'));
 const up=await post('/api/ch5/snapshot',{community_id:chk_comm.value,master_uid:chk_master.value,image});
 if(!up.ok){show(up);return;}
 const ck=await post('/api/ch5/face/check',{community_id:chk_comm.value,master_uid:chk_master.value,snapshot_file:up.file});
 show({snapshot:up,check:ck}); setTimeout(render,1000);
}
render();
</script></body></html>`));

app.get('/api/ch5/faces',(_,res)=>{
  const faces=readJson('faces.json',[]);
  res.json({ok:true,total:faces.length,faces});
});

app.post('/api/ch5/face/register',(req,res)=>{
  try{
    const {community_id,username,image}=req.body||{};
    if(!community_id||!username||!image)return res.status(400).json({ok:false,error:'missing community_id/username/image'});
    const communities=readJson('communities.json',[]);
    const c=communities.find(x=>x.community_id===community_id);
    if(!c)return res.status(404).json({ok:false,error:'community_not_found'});
    const users=readJson('users.json',[]);
    const u=users.find(x=>x.community_id===community_id&&x.username===username);
    if(!u)return res.status(404).json({ok:false,error:'user_not_found_in_community'});
    const face_id=id('face');
    const file=face_id+'.jpg';
    fs.writeFileSync(path.join(CH5_UPLOAD_DIR,file),Buffer.from(ch5CleanBase64Image(image),'base64'));
    const faces=readJson('faces.json',[]);
    // Same user can update by adding multiple samples. Keep history for teaching.
    const rec={face_id,community_id,community_name:c.name,username,file,status:'ACTIVE',created_at:nowIso()};
    faces.push(rec);
    writeJson('faces.json',faces);
    res.json({ok:true,face:rec});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch5/face/delete',(req,res)=>{
  const {face_id}=req.body||{};
  let faces=readJson('faces.json',[]);
  const target=faces.find(x=>x.face_id===face_id);
  faces=faces.filter(x=>x.face_id!==face_id);
  writeJson('faces.json',faces);
  if(target&&target.file){
    try{fs.unlinkSync(path.join(CH5_UPLOAD_DIR,target.file));}catch(e){}
  }
  res.json({ok:true,deleted:!!target});
});

app.post('/api/ch5/snapshot',(req,res)=>{
  try{
    const {master_uid,community_id,image}=req.body||{};
    if(!image)return res.status(400).json({ok:false,error:'missing image'});
    const file='snapshot_'+Date.now()+'.jpg';
    fs.writeFileSync(path.join(CH5_UPLOAD_DIR,file),Buffer.from(ch5CleanBase64Image(image),'base64'));
    res.json({ok:true,file,master_uid,community_id});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch5/face/check',async(req,res)=>{
  const started=Date.now();
  try{
    const {master_uid,community_id,snapshot_file}=req.body||{};
    if(!master_uid||!community_id||!snapshot_file)return res.status(400).json({ok:false,error:'missing master_uid/community_id/snapshot_file'});
    const communities=readJson('communities.json',[]);
    const community=communities.find(x=>x.community_id===community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    const snapshotPath=path.join(CH5_UPLOAD_DIR,snapshot_file);
    if(!fs.existsSync(snapshotPath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    const faces=readJson('faces.json',[]).filter(f=>f.community_id===community_id&&f.status!=='DISABLED');
    if(!faces.length)return res.json({ok:true,match:false,confidence:0,result:'NO_FACE_DB',faces:0});

    let best=null, checked=[];
    for(const f of faces){
      const regPath=path.join(CH5_UPLOAD_DIR,f.file);
      if(!fs.existsSync(regPath))continue;
      let r=await ch5OpenAiFaceMatch(regPath,snapshotPath);
      r={match:!!r.match,confidence:Number(r.confidence||0),reason:r.reason||'',username:f.username,face_id:f.face_id,file:f.file};
      checked.push(r);
      if(!best||r.confidence>best.confidence)best=r;
    }

    const threshold=Number(process.env.RT7_FACE_THRESHOLD||85);
    const accepted=!!(best&&best.match&&best.confidence>=threshold);
    let command=null;
    if(accepted){
      command=ch5QueueOpenDoor(master_uid,community_id,community.name,best.username,best.confidence);
    }

    const faceLogs=readJson('face_access_log.json',[]);
    const log={
      time:nowIso(),
      community_id,
      community_name:community.name,
      master_uid,
      snapshot_file,
      username:best&&best.username||'UNKNOWN',
      face_id:best&&best.face_id||'',
      match:!!(best&&best.match),
      confidence:best&&best.confidence||0,
      threshold,
      result:accepted?'OPEN_DOOR':'DENY',
      reason:best&&best.reason||'NO_MATCH',
      elapsed_ms:Date.now()-started
    };
    faceLogs.unshift(log);
    writeJson('face_access_log.json',faceLogs.slice(0,300));

    await ch5PushCommunity(community_id,{
      type:accepted?'face_match':'face_fail',
      title:accepted?'🟢 '+community.name+' 人臉辨識成功':'🔴 '+community.name+' 人臉辨識失敗',
      body:accepted?`${best.username} MATCH ${best.confidence}% 已自動開門`:`陌生人 / MATCH ${(best&&best.confidence)||0}% 拒絕進入`,
      url:'/rt7_ch5_face_register',
      tag:'rt7-face-recognition',
      community_id,
      master_uid
    });

    res.json({ok:true,accepted,match:!!(best&&best.match),username:best&&best.username||'',confidence:best&&best.confidence||0,threshold,result:log.result,command,checked});
  }catch(e){
    const logs=readJson('face_access_log.json',[]);
    logs.unshift({time:nowIso(),result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    writeJson('face_access_log.json',logs.slice(0,300));
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});

app.get('/api/ch5/face/log',(_,res)=>{
  res.json({ok:true,logs:readJson('face_access_log.json',[]).slice(0,100)});
});
// ======================================================
// End RT7_CH5B_OPENAI_REAL_FACE_MATCH_SERVER_PATCH
// ======================================================


app.get('/api/ch5/state',(_,res)=>{
  res.json({
    ok:true,
    ch5b:true,
    openai_package:!!OpenAI,
    openai_key:!!process.env.OPENAI_API_KEY,
    face_model:process.env.RT7_FACE_MODEL||'gpt-4o',
    threshold:Number(process.env.RT7_FACE_THRESHOLD||85),
    upload_dir:CH5_UPLOAD_DIR,
    faces:readJson('faces.json',[]).length,
    face_logs:readJson('face_access_log.json',[]).length,
    commands:Object.keys(readJson('commands.json',{})).length,
    time:nowIso()
  });
});

app.listen(PORT,()=>console.log('[RT7_CH5B_OPENAI_REAL_FACE_MATCH] http://localhost:'+PORT+'/rt7_ch5_face_register'));