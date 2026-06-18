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


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 第6章：RT7 Community AI Visitor Assistant
// New page:
//   /rt7_ch6_ai_visitor
// New APIs:
//   GET  /api/ch6/state
//   POST /api/ch6/visitor/snapshot
//   POST /api/ch6/visitor/check
//   POST /api/ch6/visitor/question
//   POST /api/ch6/visitor/open
//   GET  /api/ch6/visitor/log
// ======================================================

const CH6_UPLOAD_DIR=path.join(DATA_DIR,'visitor_uploads');
if(!fs.existsSync(CH6_UPLOAD_DIR))fs.mkdirSync(CH6_UPLOAD_DIR,{recursive:true});
ensureFile('visitor_events.json',[]);

function ch6CleanBase64Image(image){
  if(!image)return null;
  return String(image).replace(/^data:image\/\w+;base64,/,'');
}
function ch6SafeJsonParse(txt){
  const raw=String(txt||'').trim();
  try{return JSON.parse(raw);}catch(e){}
  const m=raw.match(/\{[\s\S]*\}/);
  if(m){try{return JSON.parse(m[0]);}catch(e){}}
  return {
    visitor_type:'unknown',
    people_count:0,
    delivery:false,
    carrier:'',
    risk:'UNKNOWN',
    confidence:0,
    summary:'JSON_PARSE_FAILED',
    raw:raw.slice(0,500)
  };
}
function ch6GetOpenAI(){
  if(!OpenAI)return null;
  if(!process.env.OPENAI_API_KEY)return null;
  return new OpenAI({apiKey:process.env.OPENAI_API_KEY});
}
function ch6CommunityById(community_id){
  return readJson('communities.json',[]).find(x=>x.community_id===community_id)||null;
}
function ch6CommunityByMaster(master_uid){
  return readJson('communities.json',[]).find(x=>x.master_uid===master_uid)||null;
}
async function ch6PushCommunity(community_id,payload){
  const groups=readJson('community_push_groups.json',[]).filter(g=>g.community_id===community_id);
  return await sendPushToSubs(groups,payload);
}
function ch6QueueOpenDoor(master_uid,community_id,community_name,source,reason){
  const commands=readJson('commands.json',{});
  commands[master_uid]=commands[master_uid]||[];
  const cmd={
    time:nowIso(),
    cmd:'OPEN_DOOR',
    pin:40,
    pulse_ms:800,
    source:source||'ai_visitor',
    community_id,
    community_name,
    reason:reason||'VISITOR_APPROVED'
  };
  commands[master_uid].push(cmd);
  writeJson('commands.json',commands);
  return cmd;
}
async function ch6AnalyzeVisitorImage(imageFile,question){
  const openai=ch6GetOpenAI();
  if(!openai){
    return {ok:false,error:'OPENAI_API_KEY_MISSING_OR_OPENAI_PACKAGE_MISSING'};
  }
  const img64=fs.readFileSync(imageFile).toString('base64');
  const prompt = question || `請分析門口訪客畫面，並做「訪客分類」。只輸出 JSON，不要 Markdown。

visitor_type 必須從以下選一個：
delivery_package      = 包裹/宅配物流人員，例如黑貓、郵局、新竹物流、宅急便
delivery_food         = 外送員，例如 UberEats、FoodPanda
resident              = 看起來像社區住戶/熟悉住戶，但若無法確認不要選
guest                 = 一般訪客/親友/拜訪者
maintenance           = 維修/水電/清潔/工程人員
security              = 保全/管理員
unknown               = 無法分類
suspicious            = 可疑人士

carrier 必須從以下選一個：
黑貓宅急便|郵局|新竹物流|宅配通|DHL|FedEx|UPS|UberEats|FoodPanda|Lalamove|none|unknown

輸出格式：
{
 "visitor_type":"delivery_package|delivery_food|resident|guest|maintenance|security|unknown|suspicious",
 "visitor_label":"繁體中文短標籤，例如 包裹物流/外送員/一般訪客/維修人員/可疑訪客",
 "people_count":1,
 "person_description":"簡短描述，避免臆測身份",
 "delivery":true,
 "carrier":"黑貓宅急便|郵局|新竹物流|UberEats|FoodPanda|none|unknown",
 "package":true,
 "uniform_or_logo":false,
 "vehicle_or_bag":false,
 "risk":"LOW|MEDIUM|HIGH",
 "risk_reason":"原因",
 "confidence":92,
 "action_suggestion":"NOTIFY_ONLY|ASK_VISITOR|ALLOW_OPTION|SECURITY_ALERT",
 "summary":"給住戶看的繁體中文摘要"
}`;
  const r=await openai.chat.completions.create({
    model:process.env.RT7_VISITOR_MODEL||'gpt-4o',
    messages:[
      {role:'system',content:'你是 RT7 社區門禁 AI 訪客分類器。根據單張門口照片做訪客類型分類、包裹/外送/維修/保全/可疑分析。不要做真實身份認定，只描述畫面特徵與風險。只輸出 JSON。'},
      {role:'user',content:[
        {type:'text',text:prompt},
        {type:'image_url',image_url:{url:`data:image/jpeg;base64,${img64}`}}
      ]}
    ],
    temperature:0
  });
  const parsed=ch6SafeJsonParse(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content);
  parsed.ok=true;
  return parsed;
}
function ch6SaveEvent(event){
  const logs=readJson('visitor_events.json',[]);
  logs.unshift(event);
  writeJson('visitor_events.json',logs.slice(0,300));
  return event;
}

app.get('/rt7_ch6_ai_visitor',(_,res)=>res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH6E Visitor Appointment</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1050px;margin:18px auto;padding:14px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button,textarea{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}textarea{width:95%;min-height:70px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.red{background:#c0392b}.gray{background:#64748b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 CH6E Visitor Appointment</h1><p>AI 訪客分類 + 白名單 + 訪客預約：邀請碼、預約時段與自動放行。</p><div id="app">載入中...</div></div><script>
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function show(x){document.getElementById('out').textContent=JSON.stringify(x,null,2);}
function fileDataUrl(input){return new Promise((resolve,reject)=>{const f=input.files&&input.files[0];if(!f)return reject(new Error('NO_FILE'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});}
async function render(){
 const st=await api('/api/ch6/state');
 const comms=st.communities||[]; const masters=Object.values(st.masters||{});
 let h='';
 h+='<div class="card"><h2>1. AI 訪客分析</h2><div class="grid"><select id="comm"><option value="">選擇社區</option>';
 comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');
 h+='</select><select id="master"><option value="">選擇 Master UID</option>';
 masters.forEach(m=>h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid+'</option>'));
 h+='</select></div><input id="visitor_photo" type="file" accept="image/*" capture="environment"><button class="blue" onclick="visitorCheck()">上傳 Snapshot + AI 分類</button></div>';
 h+='<div class="card"><h2>2. Safe Visitor QA 安全訪客問答</h2><p>只問包裹、制服、外送箱、工作證、人數與風險；不問人物身份。</p><select id="q"><option>是否有包裹？</option><option>是否有物流制服或公司標誌？</option><option>是否有外送箱？</option><option>是否有工作證？</option><option>是否有工具或維修用品？</option><option>現場有幾個人？</option><option>是否多人聚集？</option><option>是否有危險物品或可疑行為？</option><option>風險高不高？</option><option>建議住戶如何處理？</option></select><button onclick="safeQA()">詢問 AI Safe QA</button></div>';
 h+='<div class="card"><h2>3. Delivery Detector 物流偵測</h2><p>判斷宅配員、外送員、郵差、維修人員、一般訪客、可疑訪客。</p><button class="blue" onclick="deliveryDetect()">上傳 Snapshot + Delivery Detector</button></div>';h+='<div class="card"><h2>4. Visitor Whitelist 白名單</h2><p>新增常客、保全、管委會、維修人員。可用關鍵字比對 AI 分析結果。</p><div class="grid"><input id="wl_name" placeholder="名稱，例如 張先生"><select id="wl_type"><option value="regular_visitor">常客</option><option value="security">保全</option><option value="committee">管委會</option><option value="maintenance">維修人員</option><option value="delivery">固定物流</option></select><input id="wl_keywords" placeholder="關鍵字，用逗號分隔"></div><label><input type="checkbox" id="wl_auto"> 允許白名單自動開門</label><br><button onclick="addWhitelist()">新增白名單</button><button class="blue" onclick="whitelistCheck()">上傳 Snapshot + 白名單檢查</button></div>';h+='<div class="card"><h2>5. Visitor Appointment 訪客預約</h2><p>建立邀請碼、預約時段、訪客到達後檢查預約並可自動開門。</p><div class="grid"><input id="apt_name" placeholder="訪客姓名，例如 李小姐"><input id="apt_host" value="user01" placeholder="拜訪住戶"><input id="apt_purpose" value="訪客到訪" placeholder="目的"><input id="apt_code" placeholder="邀請碼，空白自動產生"><input id="apt_keywords" placeholder="關鍵字，用逗號分隔"></div><label><input type="checkbox" id="apt_auto"> 預約有效時自動開門</label><br><button onclick="addAppointment()">新增訪客預約</button><button class="blue" onclick="appointmentCheck()">上傳 Snapshot + 預約檢查</button></div>';h+='<div class="card"><h2>6. 遠端允許進入</h2><button class="blue" onclick="visitorOpen()">允許進入 OPEN_DOOR</button></div>';
 h+='<div class="card"><h2>7. Visitor Event Log <span class="pill">'+esc((st.visitor_events||[]).length)+'</span></h2><pre>'+esc(JSON.stringify((st.visitor_events||[]).slice(0,20),null,2))+'</pre></div>';
 h+='<div class="card"><h2>8. 最新結果</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h;
}
async function uploadSnapshot(){
 const image=await fileDataUrl(document.getElementById('visitor_photo'));
 return await post('/api/ch6/visitor/snapshot',{community_id:comm.value,master_uid:master.value,image});
}
async function visitorCheck(){
 const up=await uploadSnapshot();
 if(!up.ok){show(up);return;}
 const ck=await post('/api/ch6/visitor/check',{community_id:comm.value,master_uid:master.value,snapshot_file:up.file});
 show({snapshot:up,check:ck}); setTimeout(render,1000);
}
async function safeQA(){
 const up=await uploadSnapshot();
 if(!up.ok){show(up);return;}
 const r=await post('/api/ch6/visitor/safe_qa',{community_id:comm.value,master_uid:master.value,snapshot_file:up.file,question:q.value});
 show({snapshot:up,safe_qa:r}); setTimeout(render,1000);
}
async function visitorQuestion(){ return safeQA(); }
async function deliveryDetect(){
 const up=await uploadSnapshot();
 if(!up.ok){show(up);return;}
 const r=await post('/api/ch6/delivery/detect',{community_id:comm.value,master_uid:master.value,snapshot_file:up.file});
 show({snapshot:up,delivery_detector:r}); setTimeout(render,1000);
}
async function addWhitelist(){
 const r=await post('/api/ch6/whitelist/add',{
   community_id:comm.value,
   name:wl_name.value,
   type:wl_type.value,
   role_label:wl_type.options[wl_type.selectedIndex].text,
   keywords:wl_keywords.value.split(',').map(x=>x.trim()).filter(Boolean),
   allow_auto_open:wl_auto.checked,
   notify_only:true
 });
 show(r); setTimeout(render,1000);
}
async function whitelistCheck(){
 const up=await uploadSnapshot();
 if(!up.ok){show(up);return;}
 const r=await post('/api/ch6/whitelist/check',{community_id:comm.value,master_uid:master.value,snapshot_file:up.file});
 show({snapshot:up,whitelist:r}); setTimeout(render,1000);
}
async function addAppointment(){
 const r=await post('/api/ch6/appointments/add',{
   community_id:comm.value,
   visitor_name:apt_name.value,
   host_username:apt_host.value,
   purpose:apt_purpose.value,
   invite_code:apt_code.value,
   keywords:apt_keywords.value.split(',').map(x=>x.trim()).filter(Boolean),
   allow_auto_open:apt_auto.checked
 });
 show(r); setTimeout(render,1000);
}
async function appointmentCheck(){
 const up=await uploadSnapshot();
 if(!up.ok){show(up);return;}
 const r=await post('/api/ch6/appointments/check',{community_id:comm.value,master_uid:master.value,snapshot_file:up.file,invite_code:apt_code.value});
 show({snapshot:up,appointment:r}); setTimeout(render,1000);
}
async function visitorOpen(){
 show(await post('/api/ch6/visitor/open',{community_id:comm.value,master_uid:master.value,reason:'VISITOR_APPROVED_BY_USER'}));
 setTimeout(render,1000);
}
render();
</script></body></html>`));

app.get('/api/ch6/state',(_,res)=>{
  const masters=readJson('master_registry.json',{});
  Object.keys(masters).forEach(uid=>masters[uid].status=onlineStatus(masters[uid].last_heartbeat));
  const communities=readJson('communities.json',[]).map(c=>({...c,master_status:masters[c.master_uid]?onlineStatus(masters[c.master_uid].last_heartbeat):'OFFLINE'}));
  res.json({
    ok:true,
    ch6a:true,
    openai_package:!!OpenAI,
    openai_key:!!process.env.OPENAI_API_KEY,
    visitor_model:process.env.RT7_VISITOR_MODEL||'gpt-4o',
    upload_dir:CH6_UPLOAD_DIR,
    masters,
    communities,
    visitor_events:readJson('visitor_events.json',[]).slice(0,100),
    push:{count:readJson('push_subscriptions.json',[]).length,groups:readJson('community_push_groups.json',[]).length}
  });
});

app.post('/api/ch6/visitor/snapshot',(req,res)=>{
  try{
    const {master_uid,community_id,image}=req.body||{};
    if(!image)return res.status(400).json({ok:false,error:'missing image'});
    const file='visitor_'+Date.now()+'.jpg';
    fs.writeFileSync(path.join(CH6_UPLOAD_DIR,file),Buffer.from(ch6CleanBase64Image(image),'base64'));
    res.json({ok:true,file,master_uid,community_id});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch6/visitor/check',async(req,res)=>{
  const started=Date.now();
  try{
    const {master_uid,community_id,snapshot_file}=req.body||{};
    if(!master_uid||!community_id||!snapshot_file)return res.status(400).json({ok:false,error:'missing master_uid/community_id/snapshot_file'});
    const community=ch6CommunityById(community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    const fp=path.join(CH6_UPLOAD_DIR,snapshot_file);
    if(!fs.existsSync(fp))return res.status(404).json({ok:false,error:'snapshot_not_found'});

    const analysis=await ch6AnalyzeVisitorImage(fp);
    const risk=String(analysis.risk||'UNKNOWN').toUpperCase();
    const visitorType=String(analysis.visitor_type||'unknown');
    const label=analysis.visitor_label||visitorType;
    const delivery=visitorType==='delivery_package'||visitorType==='delivery_food'||!!analysis.delivery;
    let icon='🔔';
    if(visitorType==='delivery_package')icon='📦';
    else if(visitorType==='delivery_food')icon='🍱';
    else if(visitorType==='maintenance')icon='🛠️';
    else if(visitorType==='security')icon='🛡️';
    else if(visitorType==='suspicious'||risk==='HIGH')icon='⚠️';
    const title = icon+' '+community.name+' '+label;
    const body = analysis.summary || (label+' / risk '+risk+' / confidence '+(analysis.confidence||0)+'%');

    const push=await ch6PushCommunity(community_id,{
      type:'visitor_analysis',
      title,
      body,
      url:'/rt7_ch6_ai_visitor',
      tag:'rt7-ai-visitor',
      community_id,
      master_uid
    });

    const event=ch6SaveEvent({
      time:nowIso(),
      community_id,
      community_name:community.name,
      master_uid,
      snapshot_file,
      kind:'visitor_check',
      analysis,
      risk,
      delivery,
      result:'ANALYZED',
      push_status:push.status,
      push_sent:push.sent||0,
      elapsed_ms:Date.now()-started
    });
    res.json({ok:true,event});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'visitor_check',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});

app.post('/api/ch6/visitor/question',async(req,res)=>{
  const started=Date.now();
  try{
    const {master_uid,community_id,snapshot_file,question}=req.body||{};
    if(!community_id||!snapshot_file)return res.status(400).json({ok:false,error:'missing community_id/snapshot_file'});
    const community=ch6CommunityById(community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    const fp=path.join(CH6_UPLOAD_DIR,snapshot_file);
    if(!fs.existsSync(fp))return res.status(404).json({ok:false,error:'snapshot_not_found'});

    const analysis=await ch6AnalyzeVisitorImage(fp,`請用繁體中文回答住戶問題：「${question||'請分析訪客'}」。只輸出 JSON，格式：{"answer":"回答內容","risk":"LOW|MEDIUM|HIGH","confidence":90,"summary":"摘要"}`);
    const event=ch6SaveEvent({
      time:nowIso(),
      community_id,
      community_name:community.name,
      master_uid,
      snapshot_file,
      kind:'visitor_question',
      question,
      analysis,
      result:'ANSWERED',
      elapsed_ms:Date.now()-started
    });
    res.json({ok:true,event,answer:analysis.answer||analysis.summary||''});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'visitor_question',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});

app.post('/api/ch6/visitor/open',(req,res)=>{
  try{
    let {master_uid,community_id,reason}=req.body||{};
    let community=community_id?ch6CommunityById(community_id):null;
    if(!community&&master_uid)community=ch6CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    master_uid=master_uid||community.master_uid;
    const cmd=ch6QueueOpenDoor(master_uid,community.community_id,community.name,'ai_visitor',reason||'VISITOR_APPROVED');
    const event=ch6SaveEvent({
      time:nowIso(),
      community_id:community.community_id,
      community_name:community.name,
      master_uid,
      kind:'visitor_open',
      result:'OPEN_DOOR_QUEUED',
      command:cmd
    });
    res.json({ok:true,event,command:cmd});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});


app.post('/api/ch6/visitor/classify',async(req,res)=>{
  req.url='/api/ch6/visitor/check';
  app._router.handle(req,res,()=>{});
});

app.get('/api/ch6/classifier/types',(_,res)=>{
  res.json({
    ok:true,
    version:'RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR',
    visitor_types:[
      {id:'delivery_package',label:'包裹物流'},
      {id:'delivery_food',label:'外送員'},
      {id:'resident',label:'住戶'},
      {id:'guest',label:'一般訪客'},
      {id:'maintenance',label:'維修人員'},
      {id:'security',label:'保全/管理員'},
      {id:'unknown',label:'無法分類'},
      {id:'suspicious',label:'可疑訪客'}
    ],
    carriers:['黑貓宅急便','郵局','新竹物流','宅配通','DHL','FedEx','UPS','UberEats','FoodPanda','Lalamove','none','unknown'],
    actions:['NOTIFY_ONLY','ASK_VISITOR','ALLOW_OPTION','SECURITY_ALERT']
  });
});


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 安全訪客問答：只回答包裹、制服、外送箱、工作證、風險、人數。
// 避免詢問「他是誰 / 是否為特定人物 / 是否住戶」。
// ======================================================

function ch6b1LatestVisitorImage(community_id){
  const logs=readJson('visitor_events.json',[]);
  const ev=logs.find(x=>x.snapshot_file && (!community_id || x.community_id===community_id));
  if(!ev)return null;
  const fp=path.join(CH6_UPLOAD_DIR,ev.snapshot_file);
  if(!fs.existsSync(fp))return null;
  return {event:ev,path:fp};
}

function ch6b1SanitizeQuestion(q){
  let s=String(q||'').trim();
  const banned=[
    '是誰','誰','姓名','名字','住戶','是不是住戶','user01','admin',
    '王先生','李先生','張先生','某個人','認識','身份','身分',
    '同一人','是不是同一人','臉','人臉','長相'
  ];
  for(const b of banned){
    if(s.includes(b)){
      return '請只分析畫面中是否有包裹、制服、外送箱、工作證、人數與安全風險，不要辨識人物身份。';
    }
  }
  if(!s)s='是否有包裹、制服、外送箱、工作證？風險高不高？';
  return s;
}

async function ch6b1SafeVisitorQA(imagePath,question){
  const openai=ch6GetOpenAI();
  if(!openai){
    return {ok:false,error:'OPENAI_API_KEY_MISSING_OR_OPENAI_PACKAGE_MISSING'};
  }
  const img64=fs.readFileSync(imagePath).toString('base64');
  const safeQuestion=ch6b1SanitizeQuestion(question);

  const prompt=`你是 RT7 社區門禁「安全訪客問答」助理。

重要規則：
1. 不要辨識、猜測或確認畫面中人物的真實身份。
2. 不要回答「他是誰」、「是否為某人」、「是否為住戶」、「是否為 user01/admin」。
3. 只能根據畫面描述可見物件與安全狀態。
4. 可以回答：包裹、制服、公司標誌、外送箱、工作證、工具、車輛、危險物品、人數、是否多人聚集、風險高低。
5. 使用繁體中文。
6. 只輸出 JSON，不要 Markdown。

問題：
${safeQuestion}

輸出格式：
{
 "ok": true,
 "question": "安全化後的問題",
 "answer": "繁體中文回答",
 "visible_items": ["包裹","制服","外送箱","工作證","工具","其他"],
 "people_count": 1,
 "package": false,
 "uniform_or_logo": false,
 "delivery_bag": false,
 "id_badge": false,
 "tools": false,
 "risk": "LOW|MEDIUM|HIGH",
 "risk_reason": "原因",
 "suggestion": "NOTIFY_ONLY|ASK_VISITOR|ALLOW_OPTION|SECURITY_ALERT",
 "confidence": 85
}`;

  const r=await openai.chat.completions.create({
    model:process.env.RT7_VISITOR_MODEL||'gpt-4o',
    messages:[
      {role:'system',content:'你是安全訪客問答助理。你不辨識人物身份，只分析可見物件、行為與安全風險。只輸出 JSON。'},
      {role:'user',content:[
        {type:'text',text:prompt},
        {type:'image_url',image_url:{url:`data:image/jpeg;base64,${img64}`}}
      ]}
    ],
    temperature:0
  });

  const parsed=ch6SafeJsonParse(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content);
  parsed.ok=true;
  parsed.question=safeQuestion;
  return parsed;
}

app.post('/api/ch6/visitor/safe_qa',async(req,res)=>{
  const started=Date.now();
  try{
    const {community_id,master_uid,question,snapshot_file,image}=req.body||{};
    let community=community_id?ch6CommunityById(community_id):null;
    if(!community&&master_uid)community=ch6CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    let imagePath=null;
    let file=snapshot_file||'';

    // 可選：直接上傳 image；若沒有 image，就使用 snapshot_file；若也沒有，就取最新 visitor event 圖片。
    if(image){
      file='safeqa_'+Date.now()+'.jpg';
      imagePath=path.join(CH6_UPLOAD_DIR,file);
      fs.writeFileSync(imagePath,Buffer.from(ch6CleanBase64Image(image),'base64'));
    }else if(snapshot_file){
      imagePath=path.join(CH6_UPLOAD_DIR,snapshot_file);
      if(!fs.existsSync(imagePath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    }else{
      const latest=ch6b1LatestVisitorImage(community.community_id);
      if(!latest)return res.status(404).json({ok:false,error:'NO_VISITOR_EVENT_IMAGE'});
      imagePath=latest.path;
      file=latest.event.snapshot_file;
    }

    const answer=await ch6b1SafeVisitorQA(imagePath,question);

    const event=ch6SaveEvent({
      time:nowIso(),
      community_id:community.community_id,
      community_name:community.name,
      master_uid:master_uid||community.master_uid,
      snapshot_file:file,
      kind:'safe_qa',
      question,
      safe_question:answer.question,
      analysis:answer,
      result:'SAFE_QA_ANSWERED',
      elapsed_ms:Date.now()-started
    });

    res.json({ok:true,event,answer});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'safe_qa',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});

app.get('/api/ch6/safe_qa/questions',(_,res)=>{
  res.json({
    ok:true,
    version:'RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR',
    allowed_questions:[
      '是否有包裹？',
      '是否有物流制服或公司標誌？',
      '是否有外送箱？',
      '是否有工作證？',
      '是否有工具或維修用品？',
      '現場有幾個人？',
      '是否多人聚集？',
      '是否有危險物品或可疑行為？',
      '風險高不高？',
      '建議住戶如何處理？'
    ],
    banned_examples:[
      '他是誰？',
      '是不是王先生？',
      '是不是住戶？',
      '是不是 user01？',
      '是不是同一人？'
    ]
  });
});
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 物流/外送/郵差/維修/一般訪客/可疑訪客偵測
// New APIs:
//   GET  /api/ch6/delivery/types
//   POST /api/ch6/delivery/detect
// ======================================================

function ch6cDeliveryIcon(visitorType, risk){
  if(String(risk||'').toUpperCase()==='HIGH')return '⚠️';
  if(visitorType==='delivery_package')return '📦';
  if(visitorType==='delivery_food')return '🍔';
  if(visitorType==='postman')return '📮';
  if(visitorType==='maintenance')return '🔧';
  if(visitorType==='suspicious')return '⚠️';
  return '👤';
}

function ch6cDeliveryTitle(communityName, analysis){
  const vt=analysis.visitor_type||'visitor';
  const icon=ch6cDeliveryIcon(vt, analysis.risk);
  const label=analysis.visitor_label||'一般訪客';
  return `${icon} ${communityName} ${label}`;
}

async function ch6cDetectDelivery(imagePath){
  const openai=ch6GetOpenAI();
  if(!openai){
    return {ok:false,error:'OPENAI_API_KEY_MISSING_OR_OPENAI_PACKAGE_MISSING'};
  }

  const img64=fs.readFileSync(imagePath).toString('base64');

  const prompt=`你是 RT7 社區門禁 Delivery Detector。

請依據門口照片，判斷訪客是否屬於以下類型：

visitor_type 必須從以下選一個：
delivery_package = 宅配/包裹物流，例如黑貓、郵局、新竹物流、宅配通、DHL、FedEx、UPS、Lalamove
delivery_food    = 外送員，例如 UberEats、FoodPanda
postman          = 郵差/郵務人員
maintenance      = 維修/水電/清潔/工程人員
visitor          = 一般訪客
suspicious       = 可疑訪客
unknown          = 無法判斷

請只分析「可見物件與行為」，不要辨識人物身份，不要判斷是否為特定住戶。

請輸出 JSON，不要 Markdown：
{
 "ok": true,
 "visitor_type":"delivery_package|delivery_food|postman|maintenance|visitor|suspicious|unknown",
 "visitor_label":"宅配員|外送員|郵差|維修人員|一般訪客|可疑訪客|無法判斷",
 "delivery_company":"黑貓宅急便|郵局|新竹物流|宅配通|DHL|FedEx|UPS|UberEats|FoodPanda|Lalamove|none|unknown",
 "package_detected":false,
 "food_delivery_bag":false,
 "uniform_detected":false,
 "logo_detected":false,
 "tool_detected":false,
 "id_badge":false,
 "people_count":1,
 "risk":"LOW|MEDIUM|HIGH",
 "risk_reason":"原因",
 "confidence":85,
 "push_title":"給手機推播的標題",
 "push_body":"給手機推播的內容",
 "action_suggestion":"NOTIFY_ONLY|ASK_VISITOR|ALLOW_OPTION|SECURITY_ALERT",
 "summary":"繁體中文摘要"
}`;

  const r=await openai.chat.completions.create({
    model:process.env.RT7_VISITOR_MODEL||'gpt-4o',
    messages:[
      {role:'system',content:'你是 RT7 Delivery Detector。只分析可見的包裹、外送箱、制服、標誌、工具、工作證、風險；不要辨識人物身份。只輸出 JSON。'},
      {role:'user',content:[
        {type:'text',text:prompt},
        {type:'image_url',image_url:{url:`data:image/jpeg;base64,${img64}`}}
      ]}
    ],
    temperature:0
  });

  const parsed=ch6SafeJsonParse(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content);
  parsed.ok=true;
  return parsed;
}

app.get('/api/ch6/delivery/types',(_,res)=>{
  res.json({
    ok:true,
    version:'RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR',
    visitor_types:[
      {id:'delivery_package',label:'📦 宅配員'},
      {id:'delivery_food',label:'🍔 外送員'},
      {id:'postman',label:'📮 郵差'},
      {id:'maintenance',label:'🔧 維修人員'},
      {id:'visitor',label:'👤 一般訪客'},
      {id:'suspicious',label:'⚠️ 可疑訪客'},
      {id:'unknown',label:'❔ 無法判斷'}
    ],
    companies:['黑貓宅急便','郵局','新竹物流','宅配通','DHL','FedEx','UPS','UberEats','FoodPanda','Lalamove','none','unknown']
  });
});


function ch6c1NormalizeDeliveryAnalysis(analysis){
  analysis = analysis || {};
  const people = Number(analysis.people_count || 0);
  const risk = String(analysis.risk || 'LOW').toUpperCase();

  if(!analysis.visitor_type) analysis.visitor_type = 'unknown';
  if(!analysis.visitor_label) analysis.visitor_label = '無法判斷';

  // HIGH risk becomes suspicious unless already clear delivery/maintenance/postman.
  if(
    risk === 'HIGH' &&
    !['delivery_package','delivery_food','postman','maintenance'].includes(analysis.visitor_type)
  ){
    analysis.visitor_type = 'suspicious';
    analysis.visitor_label = '可疑訪客';
    analysis.action_suggestion = 'SECURITY_ALERT';
    if(!analysis.summary) analysis.summary = '偵測到高風險訪客，建議立即查看。';
    if(!analysis.push_title) analysis.push_title = '⚠️ 可疑訪客';
    if(!analysis.push_body) analysis.push_body = analysis.summary;
    return analysis;
  }

  // CH6C1 fallback:
  // If at least one person exists but no clear category is detected,
  // classify as general visitor instead of unknown.
  if(
    (analysis.visitor_type === 'unknown' || analysis.visitor_label === '無法判斷') &&
    people > 0
  ){
    analysis.visitor_type = 'visitor';
    analysis.visitor_label = '一般訪客';
    analysis.delivery_company = analysis.delivery_company || 'none';
    analysis.action_suggestion = analysis.action_suggestion || 'ASK_VISITOR';
    analysis.risk = analysis.risk || 'LOW';
    analysis.risk_reason = analysis.risk_reason || '畫面中有人，但沒有明顯包裹、外送箱、制服、標誌或工具。';
    analysis.summary = '有一般訪客到訪，建議詢問來意。';
    analysis.push_title = '👤 一般訪客';
    analysis.push_body = '有一般訪客到訪，建議詢問來意。';
  }

  return analysis;
}

app.post('/api/ch6/delivery/detect',async(req,res)=>{
  const started=Date.now();
  try{
    const {community_id,master_uid,snapshot_file,image}=req.body||{};
    let community=community_id?ch6CommunityById(community_id):null;
    if(!community&&master_uid)community=ch6CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    let imagePath=null;
    let file=snapshot_file||'';

    if(image){
      file='delivery_'+Date.now()+'.jpg';
      imagePath=path.join(CH6_UPLOAD_DIR,file);
      fs.writeFileSync(imagePath,Buffer.from(ch6CleanBase64Image(image),'base64'));
    }else if(snapshot_file){
      imagePath=path.join(CH6_UPLOAD_DIR,snapshot_file);
      if(!fs.existsSync(imagePath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    }else{
      const latest=ch6b1LatestVisitorImage(community.community_id);
      if(!latest)return res.status(404).json({ok:false,error:'NO_VISITOR_EVENT_IMAGE'});
      imagePath=latest.path;
      file=latest.event.snapshot_file;
    }

    let analysis=await ch6cDetectDelivery(imagePath);
    analysis=ch6c1NormalizeDeliveryAnalysis(analysis);

    const title=analysis.push_title || ch6cDeliveryTitle(community.name, analysis);
    const body=analysis.push_body || analysis.summary || `${analysis.visitor_label||analysis.visitor_type||'訪客'} / ${analysis.delivery_company||''} / confidence ${analysis.confidence||0}%`;

    const push=await ch6PushCommunity(community.community_id,{
      type:'delivery_detector',
      title,
      body,
      url:'/rt7_ch6_ai_visitor',
      tag:'rt7-delivery-detector',
      community_id:community.community_id,
      master_uid:master_uid||community.master_uid,
      visitor_type:analysis.visitor_type,
      visitor_label:analysis.visitor_label
    });

    const event=ch6SaveEvent({
      time:nowIso(),
      community_id:community.community_id,
      community_name:community.name,
      master_uid:master_uid||community.master_uid,
      snapshot_file:file,
      kind:'delivery_detector',
      analysis,
      result:'DETECTED',
      visitor_type:analysis.visitor_type||'unknown',
      visitor_label:analysis.visitor_label||'無法判斷',
      delivery_company:analysis.delivery_company||'unknown',
      push_status:push.status,
      push_sent:push.sent||0,
      elapsed_ms:Date.now()-started
    });

    res.json({ok:true,event,analysis,push});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'delivery_detector',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 常客/保全/管委會/維修白名單
// New APIs:
//   GET  /api/ch6/whitelist
//   POST /api/ch6/whitelist/add
//   POST /api/ch6/whitelist/delete
//   POST /api/ch6/whitelist/check
// ======================================================

ensureFile('visitor_whitelist.json',[]);

function ch6dGetWhitelist(community_id){
  return readJson('visitor_whitelist.json',[])
    .filter(x=>!community_id || x.community_id===community_id);
}

function ch6dNormalizeText(s){
  return String(s||'').trim().toLowerCase();
}

function ch6dMatchWhitelist(community_id, analysis){
  const list=ch6dGetWhitelist(community_id).filter(x=>x.status!=='DISABLED');
  const txt=[
    analysis.visitor_type,
    analysis.visitor_label,
    analysis.delivery_company,
    analysis.summary,
    analysis.person_description,
    analysis.push_body,
    analysis.push_title
  ].map(ch6dNormalizeText).join(' ');

  for(const w of list){
    const keywords=(w.keywords||[]).map(ch6dNormalizeText).filter(Boolean);
    const hit=keywords.some(k=>txt.includes(k));
    if(hit){
      return {
        matched:true,
        whitelist_id:w.whitelist_id,
        name:w.name,
        type:w.type,
        role_label:w.role_label,
        allow_auto_open:!!w.allow_auto_open,
        notify_only:!!w.notify_only,
        reason:'KEYWORD_MATCH',
        keywords
      };
    }
  }

  return {matched:false};
}

function ch6dApplyWhitelist(community, master_uid, analysis){
  const hit=ch6dMatchWhitelist(community.community_id, analysis);
  if(!hit.matched)return {analysis,whitelist:hit,command:null};

  analysis.whitelist_matched=true;
  analysis.whitelist_name=hit.name;
  analysis.whitelist_type=hit.type;
  analysis.whitelist_role=hit.role_label;
  analysis.visitor_label=`${hit.role_label||'白名單'}：${hit.name}`;
  analysis.push_title=`✅ ${community.name} ${analysis.visitor_label}`;
  analysis.push_body=`白名單訪客到訪：${hit.name}`;
  analysis.summary=`白名單訪客 ${hit.name} 到訪。`;
  analysis.action_suggestion=hit.allow_auto_open?'ALLOW_OPTION':'NOTIFY_ONLY';

  let command=null;
  if(hit.allow_auto_open){
    command=ch6QueueOpenDoor(
      master_uid||community.master_uid,
      community.community_id,
      community.name,
      'visitor_whitelist',
      `WHITELIST_${hit.type||'VISITOR'}_${hit.name}`
    );
    analysis.auto_open_queued=true;
  }

  return {analysis,whitelist:hit,command};
}

app.get('/api/ch6/whitelist',(req,res)=>{
  const community_id=req.query.community_id||'';
  res.json({
    ok:true,
    total:ch6dGetWhitelist(community_id).length,
    whitelist:ch6dGetWhitelist(community_id)
  });
});

app.post('/api/ch6/whitelist/add',(req,res)=>{
  try{
    const {
      community_id,
      name,
      type,
      role_label,
      keywords,
      allow_auto_open,
      notify_only
    }=req.body||{};

    if(!community_id||!name)return res.status(400).json({ok:false,error:'missing community_id/name'});
    const community=ch6CommunityById(community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    const list=readJson('visitor_whitelist.json',[]);
    const rec={
      whitelist_id:id('wl'),
      community_id,
      community_name:community.name,
      name,
      type:type||'regular_visitor',
      role_label:role_label||'常客',
      keywords:Array.isArray(keywords)?keywords:String(keywords||name).split(',').map(s=>s.trim()).filter(Boolean),
      allow_auto_open:!!allow_auto_open,
      notify_only:notify_only!==false,
      status:'ACTIVE',
      created_at:nowIso()
    };
    list.push(rec);
    writeJson('visitor_whitelist.json',list);
    res.json({ok:true,record:rec});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch6/whitelist/delete',(req,res)=>{
  const {whitelist_id}=req.body||{};
  let list=readJson('visitor_whitelist.json',[]);
  const before=list.length;
  list=list.filter(x=>x.whitelist_id!==whitelist_id);
  writeJson('visitor_whitelist.json',list);
  res.json({ok:true,deleted:before-list.length});
});

app.post('/api/ch6/whitelist/check',async(req,res)=>{
  const started=Date.now();
  try{
    const {community_id,master_uid,snapshot_file,image}=req.body||{};
    let community=community_id?ch6CommunityById(community_id):null;
    if(!community&&master_uid)community=ch6CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    let imagePath=null;
    let file=snapshot_file||'';

    if(image){
      file='whitelist_'+Date.now()+'.jpg';
      imagePath=path.join(CH6_UPLOAD_DIR,file);
      fs.writeFileSync(imagePath,Buffer.from(ch6CleanBase64Image(image),'base64'));
    }else if(snapshot_file){
      imagePath=path.join(CH6_UPLOAD_DIR,snapshot_file);
      if(!fs.existsSync(imagePath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    }else{
      const latest=ch6b1LatestVisitorImage(community.community_id);
      if(!latest)return res.status(404).json({ok:false,error:'NO_VISITOR_EVENT_IMAGE'});
      imagePath=latest.path;
      file=latest.event.snapshot_file;
    }

    let analysis=await ch6cDetectDelivery(imagePath);
    analysis=ch6c1NormalizeDeliveryAnalysis(analysis);
    const applied=ch6dApplyWhitelist(community, master_uid||community.master_uid, analysis);

    const push=await ch6PushCommunity(community.community_id,{
      type:'visitor_whitelist',
      title:applied.analysis.push_title || ch6cDeliveryTitle(community.name, applied.analysis),
      body:applied.analysis.push_body || applied.analysis.summary || '白名單檢查完成',
      url:'/rt7_ch6_ai_visitor',
      tag:'rt7-visitor-whitelist',
      community_id:community.community_id,
      master_uid:master_uid||community.master_uid
    });

    const event=ch6SaveEvent({
      time:nowIso(),
      community_id:community.community_id,
      community_name:community.name,
      master_uid:master_uid||community.master_uid,
      snapshot_file:file,
      kind:'visitor_whitelist',
      analysis:applied.analysis,
      whitelist:applied.whitelist,
      command:applied.command,
      result:applied.whitelist.matched?'WHITELIST_MATCH':'NO_WHITELIST_MATCH',
      push_status:push.status,
      push_sent:push.sent||0,
      elapsed_ms:Date.now()-started
    });

    res.json({ok:true,event,analysis:applied.analysis,whitelist:applied.whitelist,command:applied.command,push});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'visitor_whitelist',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 訪客預約 / 邀請碼 / 時段驗證 / 自動放行
// New APIs:
//   GET  /api/ch6/appointments
//   POST /api/ch6/appointments/add
//   POST /api/ch6/appointments/delete
//   POST /api/ch6/appointments/check
// ======================================================

ensureFile('visitor_appointments.json',[]);

function ch6eCode(){
  return 'RT7-' + Math.random().toString(36).slice(2,8).toUpperCase();
}
function ch6eNowMs(){ return Date.now(); }
function ch6eTimeMs(s){
  const t=Date.parse(s||'');
  return Number.isFinite(t)?t:0;
}
function ch6eActiveAppointment(a){
  const now=ch6eNowMs();
  const start=ch6eTimeMs(a.start_time);
  const end=ch6eTimeMs(a.end_time);
  return a.status==='ACTIVE' && start>0 && end>0 && now>=start && now<=end;
}
function ch6eGetAppointments(community_id){
  return readJson('visitor_appointments.json',[])
    .filter(x=>!community_id || x.community_id===community_id);
}
function ch6eMatchAppointment(community_id, code, analysis){
  const list=ch6eGetAppointments(community_id).filter(ch6eActiveAppointment);
  const c=String(code||'').trim().toUpperCase();
  const text=[
    analysis.visitor_label,
    analysis.visitor_type,
    analysis.person_description,
    analysis.summary,
    analysis.push_body,
    analysis.push_title
  ].map(x=>String(x||'').toLowerCase()).join(' ');

  for(const a of list){
    if(c && String(a.invite_code||'').toUpperCase()===c){
      return {matched:true,appointment:a,reason:'INVITE_CODE_MATCH'};
    }
    const ks=(a.keywords||[]).map(x=>String(x||'').toLowerCase()).filter(Boolean);
    if(ks.length && ks.some(k=>text.includes(k))){
      return {matched:true,appointment:a,reason:'KEYWORD_MATCH'};
    }
  }
  return {matched:false,reason:'NO_ACTIVE_APPOINTMENT'};
}
function ch6eApplyAppointment(community, master_uid, analysis, code){
  const hit=ch6eMatchAppointment(community.community_id, code, analysis);
  if(!hit.matched)return {analysis,appointment:hit,command:null};

  const a=hit.appointment;
  analysis.appointment_matched=true;
  analysis.appointment_id=a.appointment_id;
  analysis.appointment_visitor=a.visitor_name;
  analysis.appointment_host=a.host_username;
  analysis.appointment_reason=a.purpose;
  analysis.appointment_code=a.invite_code;
  analysis.visitor_label=`預約訪客：${a.visitor_name}`;
  analysis.push_title=`📅 ${community.name} 預約訪客：${a.visitor_name}`;
  analysis.push_body=`拜訪 ${a.host_username||'住戶'}｜${a.purpose||'訪客預約'}`;
  analysis.summary=`預約訪客 ${a.visitor_name} 到訪，預約有效。`;
  analysis.action_suggestion=a.allow_auto_open?'ALLOW_OPTION':'NOTIFY_ONLY';

  let command=null;
  if(a.allow_auto_open){
    command=ch6QueueOpenDoor(
      master_uid||community.master_uid,
      community.community_id,
      community.name,
      'visitor_appointment',
      `APPOINTMENT_${a.invite_code}_${a.visitor_name}`
    );
    analysis.auto_open_queued=true;
  }

  return {analysis,appointment:hit,command};
}

app.get('/api/ch6/appointments',(req,res)=>{
  const community_id=req.query.community_id||'';
  res.json({
    ok:true,
    total:ch6eGetAppointments(community_id).length,
    appointments:ch6eGetAppointments(community_id)
  });
});

app.post('/api/ch6/appointments/add',(req,res)=>{
  try{
    const {
      community_id,
      visitor_name,
      host_username,
      purpose,
      start_time,
      end_time,
      invite_code,
      keywords,
      allow_auto_open
    }=req.body||{};

    if(!community_id||!visitor_name)return res.status(400).json({ok:false,error:'missing community_id/visitor_name'});
    const community=ch6CommunityById(community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    const now=new Date();
    const defaultStart=new Date(now.getTime()-10*60*1000).toISOString();
    const defaultEnd=new Date(now.getTime()+2*60*60*1000).toISOString();

    const list=readJson('visitor_appointments.json',[]);
    const rec={
      appointment_id:id('apt'),
      community_id,
      community_name:community.name,
      visitor_name,
      host_username:host_username||'user01',
      purpose:purpose||'訪客到訪',
      invite_code:String(invite_code||ch6eCode()).toUpperCase(),
      keywords:Array.isArray(keywords)?keywords:String(keywords||visitor_name).split(',').map(s=>s.trim()).filter(Boolean),
      start_time:start_time||defaultStart,
      end_time:end_time||defaultEnd,
      allow_auto_open:!!allow_auto_open,
      status:'ACTIVE',
      created_at:nowIso()
    };
    list.push(rec);
    writeJson('visitor_appointments.json',list);
    res.json({ok:true,appointment:rec});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch6/appointments/delete',(req,res)=>{
  const {appointment_id}=req.body||{};
  let list=readJson('visitor_appointments.json',[]);
  const before=list.length;
  list=list.filter(x=>x.appointment_id!==appointment_id);
  writeJson('visitor_appointments.json',list);
  res.json({ok:true,deleted:before-list.length});
});

app.post('/api/ch6/appointments/check',async(req,res)=>{
  const started=Date.now();
  try{
    const {community_id,master_uid,snapshot_file,image,invite_code}=req.body||{};
    let community=community_id?ch6CommunityById(community_id):null;
    if(!community&&master_uid)community=ch6CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});

    let imagePath=null;
    let file=snapshot_file||'';

    if(image){
      file='appointment_'+Date.now()+'.jpg';
      imagePath=path.join(CH6_UPLOAD_DIR,file);
      fs.writeFileSync(imagePath,Buffer.from(ch6CleanBase64Image(image),'base64'));
    }else if(snapshot_file){
      imagePath=path.join(CH6_UPLOAD_DIR,snapshot_file);
      if(!fs.existsSync(imagePath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    }else{
      const latest=ch6b1LatestVisitorImage(community.community_id);
      if(!latest)return res.status(404).json({ok:false,error:'NO_VISITOR_EVENT_IMAGE'});
      imagePath=latest.path;
      file=latest.event.snapshot_file;
    }

    let analysis=await ch6cDetectDelivery(imagePath);
    analysis=ch6c1NormalizeDeliveryAnalysis(analysis);
    const applied=ch6eApplyAppointment(community, master_uid||community.master_uid, analysis, invite_code);

    const push=await ch6PushCommunity(community.community_id,{
      type:'visitor_appointment',
      title:applied.analysis.push_title || ch6cDeliveryTitle(community.name, applied.analysis),
      body:applied.analysis.push_body || applied.analysis.summary || '預約訪客檢查完成',
      url:'/rt7_ch6_ai_visitor',
      tag:'rt7-visitor-appointment',
      community_id:community.community_id,
      master_uid:master_uid||community.master_uid
    });

    const event=ch6SaveEvent({
      time:nowIso(),
      community_id:community.community_id,
      community_name:community.name,
      master_uid:master_uid||community.master_uid,
      snapshot_file:file,
      kind:'visitor_appointment',
      invite_code:String(invite_code||'').toUpperCase(),
      analysis:applied.analysis,
      appointment:applied.appointment,
      command:applied.command,
      result:applied.appointment.matched?'APPOINTMENT_MATCH':'NO_APPOINTMENT_MATCH',
      push_status:push.status,
      push_sent:push.sent||0,
      elapsed_ms:Date.now()-started
    });

    res.json({ok:true,event,analysis:applied.analysis,appointment:applied.appointment,command:applied.command,push});
  }catch(e){
    const event=ch6SaveEvent({time:nowIso(),kind:'visitor_appointment',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================

app.get('/api/ch6/visitor/log',(_,res)=>{
  res.json({ok:true,logs:readJson('visitor_events.json',[]).slice(0,100)});
});
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 第7章：RT7 Community AI Security Guard - Intruder Detector
// New page: /rt7_ch7_ai_security
// New APIs:
//   GET  /api/ch7/state
//   POST /api/ch7/intruder/snapshot
//   POST /api/ch7/intruder/check
//   GET  /api/ch7/intruder/log
// ======================================================

const CH7_UPLOAD_DIR=path.join(DATA_DIR,'security_uploads');
if(!fs.existsSync(CH7_UPLOAD_DIR))fs.mkdirSync(CH7_UPLOAD_DIR,{recursive:true});
ensureFile('intruder_events.json',[]);

function ch7CleanBase64Image(image){return image?String(image).replace(/^data:image\/\w+;base64,/,''):null;}
function ch7SafeJsonParse(txt){
  const raw=String(txt||'').trim();
  try{return JSON.parse(raw);}catch(e){}
  const m=raw.match(/\{[\s\S]*\}/);
  if(m){try{return JSON.parse(m[0]);}catch(e){}}
  return {ok:false,people_count:0,face_visible:true,mask:false,helmet:false,face_covered:false,suspicious:false,intruder:false,risk:'LOW',reason:'JSON_PARSE_FAILED',raw:raw.slice(0,500)};
}
function ch7GetOpenAI(){
  if(!OpenAI||!process.env.OPENAI_API_KEY)return null;
  return new OpenAI({apiKey:process.env.OPENAI_API_KEY});
}
function ch7CommunityById(community_id){return readJson('communities.json',[]).find(x=>x.community_id===community_id)||null;}
function ch7CommunityByMaster(master_uid){return readJson('communities.json',[]).find(x=>x.master_uid===master_uid)||null;}
async function ch7PushCommunity(community_id,payload){
  const groups=readJson('community_push_groups.json',[]).filter(g=>g.community_id===community_id);
  return await sendPushToSubs(groups,payload);
}
function ch7SaveIntruderEvent(event){
  const logs=readJson('intruder_events.json',[]);
  logs.unshift(event);
  writeJson('intruder_events.json',logs.slice(0,500));
  return event;
}
function ch7NormalizeIntruderRisk(ai){
  ai=ai||{};
  let risk=String(ai.risk||'LOW').toUpperCase();
  let intruder=!!ai.intruder;
  if(Number(ai.people_count||0)<=0){risk='LOW';intruder=false;ai.reason=ai.reason||'畫面中未偵測到人。';}
  if(ai.mask||ai.helmet){if(risk==='LOW')risk='MEDIUM';}
  if(ai.face_covered||ai.face_visible===false){risk='HIGH';intruder=true;ai.reason=ai.reason||'臉部被遮蔽或無法清楚看見。';}
  if(ai.suspicious||ai.climbing||ai.forced_entry||ai.dangerous_object){risk='HIGH';intruder=true;ai.reason=ai.reason||'偵測到可疑行為或危險物品。';}
  ai.risk=risk; ai.intruder=intruder; return ai;
}
function ch7SecurityTitle(communityName, ai){
  const risk=String(ai.risk||'LOW').toUpperCase();
  if(risk==='HIGH')return '🚨 '+communityName+' 入侵警報';
  if(risk==='MEDIUM')return '⚠️ '+communityName+' 可疑訪客';
  return '🛡️ '+communityName+' 安全巡檢';
}
async function ch7AnalyzeIntruderImage(imagePath){
  const openai=ch7GetOpenAI();
  if(!openai)return {ok:false,error:'OPENAI_API_KEY_MISSING_OR_OPENAI_PACKAGE_MISSING',risk:'LOW',intruder:false};
  const img64=fs.readFileSync(imagePath).toString('base64');
  const prompt=`你是 RT7 社區 AI 保全系統。請依據門口/社區攝影機畫面判斷是否有入侵或可疑行為。

請只分析可見畫面，不要辨識人物身份，不要判斷是否為特定人物。

請判斷：
1. 畫面中有幾個人
2. 臉是否清楚可見
3. 是否戴口罩
4. 是否戴安全帽
5. 是否遮臉或刻意遮蔽
6. 是否翻牆、攀爬、闖入、破壞
7. 是否長時間滯留或可疑徘徊
8. 是否有危險物品
9. 整體風險 LOW / MEDIUM / HIGH

只輸出 JSON，不要 Markdown：
{
 "ok": true,
 "people_count":0,
 "person_description":"畫面描述",
 "face_visible":true,
 "mask":false,
 "helmet":false,
 "face_covered":false,
 "climbing":false,
 "forced_entry":false,
 "loitering":false,
 "dangerous_object":false,
 "suspicious":false,
 "intruder":false,
 "risk":"LOW|MEDIUM|HIGH",
 "reason":"繁體中文原因",
 "suggestion":"NOTIFY_ONLY|WATCH|SECURITY_ALERT",
 "confidence":85,
 "summary":"給保全/住戶看的繁體中文摘要"
}`;
  const r=await openai.chat.completions.create({
    model:process.env.RT7_SECURITY_MODEL||process.env.RT7_VISITOR_MODEL||'gpt-4o',
    messages:[
      {role:'system',content:'你是社區 AI 保全，只分析可見行為、遮蔽、物品、風險，不辨識人物身份。只輸出 JSON。'},
      {role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${img64}`}}]}
    ],
    temperature:0
  });
  const parsed=ch7SafeJsonParse(r.choices&&r.choices[0]&&r.choices[0].message&&r.choices[0].message.content);
  parsed.ok=true;
  return ch7NormalizeIntruderRisk(parsed);
}

app.get('/rt7_ch7_ai_security',(_,res)=>res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH7A AI Security Guard</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1050px;margin:18px auto;padding:14px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.blue{background:#0b78d0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 CH7A AI Security Guard</h1><p>入侵者偵測、遮臉/安全帽/可疑行為、高風險推播警報。</p><div id="app">載入中...</div></div><script>
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function show(x){document.getElementById('out').textContent=JSON.stringify(x,null,2);}
function fileDataUrl(input){return new Promise((resolve,reject)=>{const f=input.files&&input.files[0];if(!f)return reject(new Error('NO_FILE'));const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});}
async function render(){
 const st=await api('/api/ch7/state');
 const comms=st.communities||[]; const masters=Object.values(st.masters||{});
 let h='';
 h+='<div class="card"><h2>1. Intruder Detector 入侵者偵測</h2><div class="grid"><select id="comm"><option value="">選擇社區</option>';
 comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name)+'</option>');
 h+='</select><select id="master"><option value="">選擇 Master UID</option>';
 masters.forEach(m=>h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid+'</option>'));
 h+='</select></div><input id="sec_photo" type="file" accept="image/*" capture="environment"><button class="blue" onclick="intruderCheck()">上傳 Snapshot + 入侵偵測</button></div>';
 h+='<div class="card"><h2>2. Intruder Event Log <span class="pill">'+esc((st.intruder_events||[]).length)+'</span></h2><pre>'+esc(JSON.stringify((st.intruder_events||[]).slice(0,20),null,2))+'</pre></div>';
 h+='<div class="card"><h2>3. 最新結果</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h;
}
async function intruderCheck(){
 const image=await fileDataUrl(document.getElementById('sec_photo'));
 const r=await post('/api/ch7/intruder/check',{community_id:comm.value,master_uid:master.value,image});
 show(r); setTimeout(render,1000);
}
render();
</script></body></html>`));

app.get('/api/ch7/state',(_,res)=>{
  const masters=readJson('master_registry.json',{});
  Object.keys(masters).forEach(uid=>masters[uid].status=onlineStatus(masters[uid].last_heartbeat));
  const communities=readJson('communities.json',[]).map(c=>({...c,master_status:masters[c.master_uid]?onlineStatus(masters[c.master_uid].last_heartbeat):'OFFLINE'}));
  res.json({
    ok:true,ch7a:true,openai_package:!!OpenAI,openai_key:!!process.env.OPENAI_API_KEY,
    security_model:process.env.RT7_SECURITY_MODEL||process.env.RT7_VISITOR_MODEL||'gpt-4o',
    upload_dir:CH7_UPLOAD_DIR,masters,communities,
    intruder_events:readJson('intruder_events.json',[]).slice(0,100),
    push:{count:readJson('push_subscriptions.json',[]).length,groups:readJson('community_push_groups.json',[]).length}
  });
});

app.post('/api/ch7/intruder/snapshot',(req,res)=>{
  try{
    const {master_uid,community_id,image}=req.body||{};
    if(!image)return res.status(400).json({ok:false,error:'missing image'});
    const file='intruder_'+Date.now()+'.jpg';
    fs.writeFileSync(path.join(CH7_UPLOAD_DIR,file),Buffer.from(ch7CleanBase64Image(image),'base64'));
    res.json({ok:true,file,master_uid,community_id});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.post('/api/ch7/intruder/check',async(req,res)=>{
  const started=Date.now();
  try{
    const {community_id,master_uid,snapshot_file,image}=req.body||{};
    let community=community_id?ch7CommunityById(community_id):null;
    if(!community&&master_uid)community=ch7CommunityByMaster(master_uid);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    let imagePath=null,file=snapshot_file||'';
    if(image){
      file='intruder_'+Date.now()+'.jpg';
      imagePath=path.join(CH7_UPLOAD_DIR,file);
      fs.writeFileSync(imagePath,Buffer.from(ch7CleanBase64Image(image),'base64'));
    }else if(snapshot_file){
      imagePath=path.join(CH7_UPLOAD_DIR,snapshot_file);
      if(!fs.existsSync(imagePath))return res.status(404).json({ok:false,error:'snapshot_not_found'});
    }else return res.status(400).json({ok:false,error:'missing image_or_snapshot_file'});
    const ai=await ch7AnalyzeIntruderImage(imagePath);
    const risk=String(ai.risk||'LOW').toUpperCase();
    const title=ch7SecurityTitle(community.name, ai);
    const body=ai.summary||ai.reason||('風險：'+risk);
    let push={sent:0,total:0,status:'SKIPPED_LOW_RISK'};
    if(risk==='HIGH'||risk==='MEDIUM'){
      push=await ch7PushCommunity(community.community_id,{
        type:risk==='HIGH'?'intruder_alarm':'suspicious_visitor',
        title,body,url:'/rt7_ch7_ai_security',tag:'rt7-ai-security',
        community_id:community.community_id,master_uid:master_uid||community.master_uid,risk,intruder:!!ai.intruder
      });
    }
    const event=ch7SaveIntruderEvent({
      time:nowIso(),community_id:community.community_id,community_name:community.name,
      master_uid:master_uid||community.master_uid,snapshot_file:file,kind:'intruder_check',
      analysis:ai,intruder:!!ai.intruder,risk,result:ai.intruder?'INTRUDER':'SAFE',
      push_status:push.status,push_sent:push.sent||0,elapsed_ms:Date.now()-started
    });
    res.json({ok:true,event,analysis:ai,push});
  }catch(e){
    const event=ch7SaveIntruderEvent({time:nowIso(),kind:'intruder_check',result:'ERROR',error:String(e.message||e),elapsed_ms:Date.now()-started});
    res.status(500).json({ok:false,event,error:String(e.message||e)});
  }
});

app.get('/api/ch7/intruder/log',(_,res)=>res.json({ok:true,logs:readJson('intruder_events.json',[]).slice(0,100)}));
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================
function rt7PushDebugState(){
  const subs=readJson('push_subscriptions.json',[]);
  const groups=readJson('community_push_groups.json',[]);
  const logs=readJson('push_log.json',[]);
  const comms=readJson('communities.json',[]);
  return {
    ok:true,
    version:'RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR',
    global_subscriptions:subs.length,
    community_group_total:groups.length,
    communities:comms.map(c=>({
      community_id:c.community_id,
      name:c.name,
      master_uid:c.master_uid,
      master_status:c.master_status||'',
      group_count:groups.filter(g=>g.community_id===c.community_id).length
    })),
    last_push_log:logs[0]||null,
    push_logs:logs.slice(0,20),
    raw:{
      subscriptions:subs.map(s=>({endpoint:String(s.endpoint||'').slice(0,100)+'...',created_at:s.created_at||s.time||''})),
      groups:groups.map(g=>({community_id:g.community_id,endpoint:String(g.endpoint||'').slice(0,100)+'...',created_at:g.created_at||g.time||''}))
    }
  };
}
app.get('/api/rt7/push/debug',(_,res)=>res.json(rt7PushDebugState()));
app.get('/api/rt7/push/groups',(_,res)=>res.json({ok:true,groups:readJson('community_push_groups.json',[]),subscriptions:readJson('push_subscriptions.json',[])}));
app.get('/api/rt7/push/log',(_,res)=>res.json({ok:true,logs:readJson('push_log.json',[]).slice(0,100)}));
app.post('/api/rt7/push/test',async(req,res)=>{
  try{
    const {community_id,title,body}=req.body||{};
    if(!community_id)return res.status(400).json({ok:false,error:'missing community_id'});
    const comm=readJson('communities.json',[]).find(c=>c.community_id===community_id);
    const push=await ch7PushCommunity(community_id,{
      type:'push_debug_test',
      title:title||'RT7 CH7A1 推播偵錯測試',
      body:body||((comm?comm.name:'社區')+' 推播功能測試'),
      url:'/rt7_push_debug_panel',
      tag:'rt7-push-debug',
      community_id
    });
    res.json({ok:true,push,state:rt7PushDebugState()});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});
app.get('/rt7_push_debug_panel',(_,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 Push Debug</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1100px;margin:18px auto;padding:14px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,select{font-size:16px;padding:10px;margin:4px;border-radius:8px;border:1px solid #ccd6dc}button{background:#0b78d0;color:white;border:0}.green{background:#0b9b5a}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}.bad{background:#fdecec;color:#a4261d}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 CH7A1 Push Debug Panel</h1><div id="app">載入中...</div></div><script>
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cls(n){return n>0?'pill':'pill bad'}
async function render(){const st=await api('/api/rt7/push/debug');let h='';
h+='<div class="card"><h2>1. Push 狀態摘要</h2><p>全域訂閱數：<span class="'+cls(st.global_subscriptions)+'">'+esc(st.global_subscriptions)+'</span></p><p>社區群組數：<span class="'+cls(st.community_group_total)+'">'+esc(st.community_group_total)+'</span></p></div>';
h+='<div class="card"><h2>2. 社區群組</h2><select id="community">';
(st.communities||[]).forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name+' | groups='+c.group_count+' | '+c.community_id)+'</option>');
h+='</select><button class="green" onclick="testPush()">測試選取社區推播</button><button onclick="render()">重新整理</button><pre>'+esc(JSON.stringify(st.communities,null,2))+'</pre></div>';
h+='<div class="card"><h2>3. 最新 Push Log</h2><pre>'+esc(JSON.stringify(st.last_push_log,null,2))+'</pre></div>';
h+='<div class="card"><h2>4. Raw Debug</h2><pre>'+esc(JSON.stringify(st.raw,null,2))+'</pre></div>';
h+='<div class="card"><h2>5. 測試結果</h2><pre id="out">READY</pre></div>';app.innerHTML=h;}
async function testPush(){const cid=community.value;const r=await post('/api/rt7/push/test',{community_id:cid,title:'RT7 CH7A1 推播偵錯測試',body:'如果手機收到，表示該社區推播群組正常。'});out.textContent=JSON.stringify(r,null,2);setTimeout(render,1200)}
render();
</script></body></html>`));
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================
app.get('/api/rt7/push/public-key',(_,res)=>{
  res.json({ok:true,publicKey:PUBLIC_VAPID_KEY||null,time:nowIso()});
});

app.post('/api/rt7/push/auto-repair',(req,res)=>{
  try{
    const {community_id,subscription,endpoint,user_agent}=req.body||{};
    if(!community_id)return res.status(400).json({ok:false,error:'missing community_id'});
    if(!subscription||!subscription.endpoint)return res.status(400).json({ok:false,error:'missing subscription'});
    const community=readJson('communities.json',[]).find(c=>c.community_id===community_id);
    if(!community)return res.status(404).json({ok:false,error:'community_not_found'});
    const ep=subscription.endpoint||endpoint;

    let subs=readJson('push_subscriptions.json',[]);
    const beforeSubs=subs.length;
    subs=subs.filter(s=>s.endpoint!==ep);
    subs.unshift({endpoint:ep,subscription,created_at:nowIso(),updated_at:nowIso(),source:'CH7A3_AUTO_REPAIR',user_agent:user_agent||''});
    writeJson('push_subscriptions.json',subs.slice(0,50));

    let groups=readJson('community_push_groups.json',[]);
    const beforeGroups=groups.length;
    groups=groups.filter(g=>g.community_id!==community_id);
    groups.unshift({community_id,community_name:community.name,endpoint:ep,subscription,created_at:nowIso(),updated_at:nowIso(),source:'CH7A3_AUTO_REPAIR',user_agent:user_agent||''});
    writeJson('community_push_groups.json',groups.slice(0,50));

    res.json({ok:true,repaired:true,community_id,community_name:community.name,endpoint:ep,before:{subscriptions:beforeSubs,groups:beforeGroups},after:{subscriptions:subs.length,groups:groups.length}});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});

app.get('/rt7_auto_push_repair',(_,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH7A3 Auto Push Repair</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1050px;margin:18px auto;padding:14px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,select{font-size:16px;padding:10px;margin:4px;border-radius:8px;border:1px solid #ccd6dc}button{background:#0b78d0;color:#fff;border:0}.green{background:#0b9b5a}.gray{background:#64748b}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}.bad{background:#fdecec;color:#a4261d}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 CH7A3 Auto Subscription Repair</h1><p>自動修復推播訂閱與社區群組，不必再手動清除、重新訂閱、加入群組。</p><div id="app">載入中...</div></div><script>
let VAPID_PUBLIC_KEY='';
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function u8(b64){const pad='='.repeat((4-b64.length%4)%4);const base=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
function out(x){document.getElementById('out').textContent=typeof x==='string'?x:JSON.stringify(x,null,2);}
async function ensureSW(){if(!('serviceWorker' in navigator))throw new Error('NO_SERVICE_WORKER');let reg=await navigator.serviceWorker.getRegistration('/');if(!reg)reg=await navigator.serviceWorker.register('/sw.js?v=CH7A3_'+Date.now(),{scope:'/'});await navigator.serviceWorker.ready;return reg;}
async function getLocalState(){let reg=await navigator.serviceWorker.getRegistration('/');let sub=null;try{sub=reg&&reg.pushManager?await reg.pushManager.getSubscription():null;}catch(e){}const dbg=await api('/api/rt7/push/debug');return {permission:window.Notification?Notification.permission:'NO_NOTIFICATION_API',serviceWorker:'serviceWorker' in navigator,pushManager:'PushManager' in window,subscription:sub?{endpoint:sub.endpoint}:null,debug:dbg};}
async function render(){const key=await api('/api/rt7/push/public-key');VAPID_PUBLIC_KEY=key.publicKey||'';const st=await getLocalState();const comms=(st.debug&&st.debug.communities)||[];let h='';h+='<div class="card"><h2>1. 狀態</h2><p>Notification：<span class="'+(st.permission==='granted'?'pill':'pill bad')+'">'+esc(st.permission)+'</span></p><p>本機 Subscription：<span class="'+(st.subscription?'pill':'pill bad')+'">'+esc(st.subscription?'YES':'NO')+'</span></p></div>';h+='<div class="card"><h2>2. 自動修復</h2><select id="community">';comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name+' | groups='+c.group_count+' | '+c.community_id)+'</option>');h+='</select><button class="green" onclick="autoRepair()">自動修復推播訂閱/群組</button><button class="gray" onclick="render()">重新整理</button></div>';h+='<div class="card"><h2>3. 測試推播</h2><button onclick="testPush()">測試社區推播</button></div>';h+='<div class="card"><h2>4. Debug JSON</h2><pre>'+esc(JSON.stringify(st,null,2))+'</pre></div><div class="card"><h2>5. 執行結果</h2><pre id="out">READY</pre></div>';app.innerHTML=h;}
async function autoRepair(){try{if(!('Notification' in window))throw new Error('NO_NOTIFICATION_API');let perm=Notification.permission;if(perm!=='granted')perm=await Notification.requestPermission();if(perm!=='granted')throw new Error('NOTIFICATION_PERMISSION_'+perm);const reg=await ensureSW();let old=await reg.pushManager.getSubscription();if(old)await old.unsubscribe();const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(VAPID_PUBLIC_KEY)});const r=await post('/api/rt7/push/auto-repair',{community_id:community.value,subscription:sub,endpoint:sub.endpoint,user_agent:navigator.userAgent});out({ok:true,auto_repair:r,endpoint:sub.endpoint});setTimeout(render,1200);}catch(e){out({ok:false,error:String(e)});}}
async function testPush(){const r=await post('/api/rt7/push/test',{community_id:community.value,title:'RT7 CH7A3 自動修復測試',body:'如果手機收到，表示推播訂閱與社區群組已自動修復。'});out(r);setTimeout(render,1200)}
render();
</script></body></html>`));
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================


// ======================================================
// RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// 修正 CH7A3：不先 unsubscribe，避免 YES 變 NO。
// ======================================================
app.get('/rt7_auto_push_repair_safe',(_,res)=>res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 CH7A3A Safe Repair</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1050px;margin:auto;padding:16px}.card{background:#fff;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,select{font-size:16px;padding:10px;margin:4px;border-radius:8px;border:1px solid #ccd6dc}button{background:#0b78d0;color:#fff;border:0}.green{background:#0b9b5a}.red{background:#c0392b}.gray{background:#64748b}.pill{display:inline-block;padding:3px 9px;border-radius:999px;background:#e9f7ef;color:#0b7a43;font-weight:bold}.bad{background:#fdecec;color:#a4261d}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 CH7A3A Safe Auto Subscription Repair</h1><p>安全修正版：先使用現有 Subscription；只有沒有 Subscription 時才建立新的。</p><div id="app">載入中...</div></div><script>
let VAPID='';
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let t=await r.text();try{return JSON.parse(t)}catch{return{ok:false,status:r.status,text:t.slice(0,500)}}}
async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function u8(b64){const pad='='.repeat((4-b64.length%4)%4);const base=(b64+pad).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
function out(x){document.getElementById('out').textContent=JSON.stringify(x,null,2);}
async function regSW(){let reg=await navigator.serviceWorker.getRegistration('/');if(!reg)reg=await navigator.serviceWorker.register('/sw.js?v=CH7A3A_'+Date.now(),{scope:'/'});await navigator.serviceWorker.ready;return await navigator.serviceWorker.getRegistration('/')||reg;}
async function local(){let reg=null,sub=null;try{reg=await navigator.serviceWorker.getRegistration('/');sub=reg&&reg.pushManager?await reg.pushManager.getSubscription():null;}catch(e){}const dbg=await api('/api/rt7/push/debug');return{permission:Notification.permission,subscription:sub?{endpoint:sub.endpoint}:null,debug:dbg};}
async function render(){const key=await api('/api/rt7/push/public-key');VAPID=key.publicKey||'';const st=await local();const comms=(st.debug&&st.debug.communities)||[];let h='';h+='<div class="card"><h2>1. 狀態</h2><p>Notification：<span class="'+(st.permission==='granted'?'pill':'pill bad')+'">'+esc(st.permission)+'</span></p><p>本機 Subscription：<span class="'+(st.subscription?'pill':'pill bad')+'">'+esc(st.subscription?'YES':'NO')+'</span></p></div>';h+='<div class="card"><h2>2. 安全自動修復</h2><select id="community">';comms.forEach(c=>h+='<option value="'+esc(c.community_id)+'">'+esc(c.name+' | groups='+c.group_count+' | '+c.community_id)+'</option>');h+='</select><button class="green" onclick="safeRepair()">安全修復：不先取消訂閱</button><button class="gray" onclick="render()">重新整理</button></div>';h+='<div class="card"><h2>3. 必要時重建</h2><button class="red" onclick="rebuild()">本機 Subscription 一直 NO 時才按</button></div>';h+='<div class="card"><h2>4. 測試推播</h2><button onclick="testPush()">測試社區推播</button></div><div class="card"><h2>5. Debug JSON</h2><pre>'+esc(JSON.stringify(st,null,2))+'</pre></div><div class="card"><h2>6. 執行結果</h2><pre id="out">READY</pre></div>';app.innerHTML=h;}
async function safeRepair(){try{let p=Notification.permission;if(p!=='granted')p=await Notification.requestPermission();if(p!=='granted')throw new Error('permission '+p);const reg=await regSW();let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(VAPID)});const r=await post('/api/rt7/push/auto-repair',{community_id:community.value,subscription:sub,endpoint:sub.endpoint,user_agent:navigator.userAgent});out({ok:true,mode:'safeRepair',r,endpoint:sub.endpoint});setTimeout(render,1000);}catch(e){out({ok:false,error:String(e)});}}
async function rebuild(){try{let p=Notification.permission;if(p!=='granted')p=await Notification.requestPermission();if(p!=='granted')throw new Error('permission '+p);const reg=await regSW();let old=await reg.pushManager.getSubscription();if(old)await old.unsubscribe();const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(VAPID)});const r=await post('/api/rt7/push/auto-repair',{community_id:community.value,subscription:sub,endpoint:sub.endpoint,user_agent:navigator.userAgent});out({ok:true,mode:'rebuild',r,endpoint:sub.endpoint});setTimeout(render,1000);}catch(e){out({ok:false,error:String(e)});}}
async function testPush(){const r=await post('/api/rt7/push/test',{community_id:community.value,title:'RT7 CH7A3A 安全修復測試',body:'如果手機收到，表示訂閱與社區群組正常。'});out(r);setTimeout(render,1000)}
render();
</script></body></html>`));
// ======================================================
// End RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR
// ======================================================

app.listen(PORT,()=>console.log('[RT7_CH7A3A_SAFE_AUTO_SUBSCRIPTION_REPAIR] http://localhost:'+PORT+'/rt7_ch6_ai_visitor'));
