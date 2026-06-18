// RT7_EDU_LOGIN_AUTH_V3
// 第三堂課：登入驗證 / Community ID / Admin Account / Password / Session
// 保留第一堂 Heartbeat、第二堂 Community Register
// API: POST /edu/master/heartbeat, GET/POST /edu/community/register, GET/POST /edu/login, POST /edu/auth/register, POST /edu/auth/login

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const VERSION = 'RT7_EDU_LOGIN_AUTH_V3';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function ensureFile(name, fallback) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback, null, 2), 'utf8');
  return p;
}
function readJson(name, fallback) {
  const p = ensureFile(name, fallback);
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeJson(name, data) {
  const p = ensureFile(name, Array.isArray(data) ? [] : {});
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}
function nowIso() { return new Date().toISOString(); }
function onlineStatus(lastSeen) {
  if (!lastSeen) return 'OFFLINE';
  return (Date.now() - new Date(lastSeen).getTime()) < 90000 ? 'ONLINE' : 'OFFLINE';
}
function cleanMac(mac) { return String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(-12); }
function formatMac(mac) {
  const h = cleanMac(mac);
  if (h.length !== 12) return String(mac || '').trim().toUpperCase();
  return h.match(/.{2}/g).join(':');
}
function uidFromMac(mac) {
  const h = cleanMac(mac);
  if (h.length !== 12) return '';
  return 'RT7-MASTER-' + h.match(/.{2}/g).reverse().join('');
}
function normalizeUid(uid) { return String(uid || '').trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '').slice(0, 80); }
function safeText(s, max = 80) { return String(s || '').trim().replace(/[<>]/g, '').slice(0, max); }
function communityIdFromName(name) {
  const base = safeText(name, 40).toUpperCase().replace(/[^A-Z0-9\u4E00-\u9FFF]+/g, '-').replace(/^-+|-+$/g, '');
  return 'COMM-' + (base || 'UNKNOWN') + '-' + Date.now().toString(36).toUpperCase();
}
function resolveHeartbeatUid(body) {
  const macUid = uidFromMac(body && body.mac);
  const reqUid = normalizeUid(body && body.master_uid);
  return macUid || reqUid;
}
function refreshMasters(masters) {
  Object.keys(masters).forEach(uid => { masters[uid].status = onlineStatus(masters[uid].last_heartbeat); });
  return masters;
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(salt) + ':' + String(password)).digest('hex');
}
function makeToken() { return crypto.randomBytes(18).toString('hex'); }
function getCommunity(id) {
  return readJson('communities.json', []).find(c => c.community_id === String(id || ''));
}

ensureFile('master_registry.json', {});
ensureFile('communities.json', []);
ensureFile('users.json', []);
ensureFile('sessions.json', []);

app.get('/', (_req, res) => res.redirect('/edu'));
app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION, time: nowIso() }));

app.get('/edu/state', (_req, res) => {
  const masters = refreshMasters(readJson('master_registry.json', {}));
  const communities = readJson('communities.json', []);
  const users = readJson('users.json', []).map(u => ({
    user_id: u.user_id,
    community_id: u.community_id,
    account: u.account,
    display_name: u.display_name,
    role: u.role,
    created_at: u.created_at,
    last_login: u.last_login || ''
  }));
  const sessions = readJson('sessions.json', []).filter(s => Date.now() < new Date(s.expires_at).getTime());
  if (sessions.length !== readJson('sessions.json', []).length) writeJson('sessions.json', sessions);
  res.json({ ok: true, version: VERSION, masters, communities, users, sessions_count: sessions.length });
});

app.post('/edu/master/heartbeat', (req, res) => {
  const body = req.body || {};
  const uid = resolveHeartbeatUid(body);
  if (!uid) return res.status(400).json({ ok: false, error: 'missing master_uid or valid mac' });
  const mac = formatMac(body.mac || '');
  const ip = body.ip || req.ip;
  const source = String(body.source || 'ESP32').toUpperCase();
  const masters = readJson('master_registry.json', {});
  masters[uid] = {
    master_uid: uid,
    ip,
    mac,
    source,
    lesson: body.lesson || VERSION,
    last_heartbeat: nowIso(),
    status: 'ONLINE',
    uid_rule: mac ? 'MAC_REVERSE_PAIRS' : 'REQUEST_UID'
  };
  writeJson('master_registry.json', masters);
  console.log('[EDU][V3][HEARTBEAT]', uid, ip, mac, source);
  res.json({ ok: true, version: VERSION, master: masters[uid] });
});

app.post('/edu/community/register', (req, res) => {
  const body = req.body || {};
  const community_name = safeText(body.community_name, 60);
  const admin_name = safeText(body.admin_name || 'admin', 60);
  const admin_email = safeText(body.admin_email, 120).toLowerCase();
  const master_uid = normalizeUid(body.master_uid);
  if (!community_name) return res.status(400).json({ ok: false, error: 'missing community_name' });
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  const masters = refreshMasters(readJson('master_registry.json', {}));
  const master = masters[master_uid];
  if (!master) return res.status(404).json({ ok: false, error: 'master_uid not found. Please run ESP32 heartbeat first.' });
  let communities = readJson('communities.json', []);
  const used = communities.find(c => c.master_uid === master_uid);
  if (used) return res.status(409).json({ ok: false, error: 'master_uid already bound', community: used });
  const community = {
    community_id: communityIdFromName(community_name),
    community_name,
    admin_name,
    admin_email,
    master_uid,
    master_ip: master.ip,
    master_mac: master.mac,
    master_status: master.status,
    created_at: nowIso(),
    lesson: VERSION
  };
  communities.push(community);
  writeJson('communities.json', communities);
  console.log('[EDU][V3][COMMUNITY_REGISTER]', community.community_id, community.community_name, master_uid);
  res.json({ ok: true, version: VERSION, community });
});

app.delete('/edu/community/:community_id', (req, res) => {
  const id = String(req.params.community_id || '');
  const before = readJson('communities.json', []);
  const after = before.filter(c => c.community_id !== id);
  writeJson('communities.json', after);
  // 教學版：刪除社區時，同步刪除該社區帳號與 session，避免學生測試混淆。
  writeJson('users.json', readJson('users.json', []).filter(u => u.community_id !== id));
  writeJson('sessions.json', readJson('sessions.json', []).filter(s => s.community_id !== id));
  res.json({ ok: true, deleted: before.length - after.length, version: VERSION });
});

app.post('/edu/auth/register', (req, res) => {
  const body = req.body || {};
  const community_id = safeText(body.community_id, 120);
  const account = safeText(body.account, 40).toLowerCase();
  const display_name = safeText(body.display_name || account || 'admin', 60);
  const password = String(body.password || '');
  if (!community_id) return res.status(400).json({ ok: false, error: 'missing community_id' });
  if (!getCommunity(community_id)) return res.status(404).json({ ok: false, error: 'community_id not found. Please register community first.' });
  if (!account) return res.status(400).json({ ok: false, error: 'missing account' });
  if (password.length < 4) return res.status(400).json({ ok: false, error: 'password too short. Lesson V3 needs at least 4 characters.' });
  let users = readJson('users.json', []);
  if (users.find(u => u.community_id === community_id && u.account === account)) return res.status(409).json({ ok: false, error: 'account already exists in this community' });
  const salt = crypto.randomBytes(8).toString('hex');
  const user = {
    user_id: 'USER-' + Date.now().toString(36).toUpperCase(),
    community_id,
    account,
    display_name,
    role: 'admin',
    salt,
    password_hash: hashPassword(password, salt),
    created_at: nowIso(),
    lesson: VERSION
  };
  users.push(user);
  writeJson('users.json', users);
  console.log('[EDU][V3][AUTH_REGISTER]', community_id, account);
  res.json({ ok: true, version: VERSION, user: { user_id: user.user_id, community_id, account, display_name, role: user.role, created_at: user.created_at } });
});

app.post('/edu/auth/login', (req, res) => {
  const body = req.body || {};
  const community_id = safeText(body.community_id, 120);
  const account = safeText(body.account, 40).toLowerCase();
  const password = String(body.password || '');
  const community = getCommunity(community_id);
  if (!community) return res.status(404).json({ ok: false, error: 'community_id not found' });
  let users = readJson('users.json', []);
  const user = users.find(u => u.community_id === community_id && u.account === account);
  if (!user) return res.status(401).json({ ok: false, error: 'account not found in this community' });
  if (hashPassword(password, user.salt) !== user.password_hash) return res.status(401).json({ ok: false, error: 'wrong password' });
  user.last_login = nowIso();
  writeJson('users.json', users);
  let sessions = readJson('sessions.json', []);
  const session = {
    token: 'SESS-' + makeToken(),
    community_id,
    community_name: community.community_name,
    account: user.account,
    role: user.role,
    login_at: nowIso(),
    expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    lesson: VERSION
  };
  sessions.push(session);
  writeJson('sessions.json', sessions);
  console.log('[EDU][V3][LOGIN_OK]', community_id, account);
  res.json({ ok: true, version: VERSION, login: { token: session.token, community_id, community_name: community.community_name, account: user.account, role: user.role, login_at: session.login_at, expires_at: session.expires_at } });
});

app.post('/edu/auth/logout', (req, res) => {
  const token = String((req.body || {}).token || '');
  const before = readJson('sessions.json', []);
  const after = before.filter(s => s.token !== token);
  writeJson('sessions.json', after);
  res.json({ ok: true, deleted: before.length - after.length, version: VERSION });
});

function renderEduPage() {
return String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU Login Auth V3</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1120px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px;box-sizing:border-box}button{background:#0b9b5a;color:#fff;border:0;cursor:pointer}.danger{background:#c0392b}.blue{background:#0b6fa4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}.step{font-weight:bold;color:#0b5f8a}.loginok{background:#effaf4;border-left:5px solid #0b9b5a}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU LOGIN AUTH V3</h1>
<p><span class="tag">第三堂課</span> Community ID / Admin Account / Password / Session</p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json();}catch(e){} if(!r.ok)j.http_status=r.status;return j;}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});} async function del(path){return api(path,{method:'DELETE'});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);} function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-UNKNOWN';}}
let STATE={};
function communityOptions(list){ if(!list.length)return '<option value="">請先完成第二堂：社區註冊</option>'; return list.map(function(c){return '<option value="'+esc(c.community_id)+'">'+esc(c.community_id)+' | '+esc(c.community_name)+'</option>';}).join(''); }
async function load(){
 const s=await api('/edu/state'); STATE=s; const masters=Object.values(s.masters||{}); const communities=s.communities||[]; const users=s.users||[];
 var h='';
 h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 Heartbeat</th></tr>';
 if(!masters.length){h+='<tr><td colspan="6" class="hint">尚未收到 ESP32 heartbeat。請先完成第一堂：設備上線。</td></tr>';}
 masters.forEach(function(m){h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source||'')+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card"><h2>2. Communities</h2><table><tr><th>Community ID</th><th>社區</th><th>管理員</th><th>綁定 UID</th><th>Master IP</th><th>建立時間</th></tr>';
 if(!communities.length){h+='<tr><td colspan="6" class="hint">尚未註冊社區。可先到 /edu/community/register 建立。</td></tr>';}
 communities.forEach(function(c){h+='<tr><td><b>'+esc(c.community_id)+'</b></td><td>'+esc(c.community_name)+'</td><td>'+esc(c.admin_name)+'</td><td>'+esc(c.master_uid)+'</td><td>'+esc(c.master_ip||'')+'</td><td>'+esc(c.created_at)+'</td></tr>';});
 h+='</table><p><button class="blue" onclick="location.href=\'/edu/community/register\'">前往第二堂社區註冊頁</button></p></div>';
 h+='<div class="card"><h2>3. 建立管理員帳號</h2><p class="hint">第三堂才加入帳號與密碼。每個 Community ID 可以有自己的 admin 帳號。</p><div class="grid"><select id="r_community">'+communityOptions(communities)+'</select><input id="r_account" placeholder="帳號，例如：admin"><input id="r_name" placeholder="顯示名稱，例如：老師"><input id="r_pass" type="password" placeholder="密碼，至少 4 碼"></div><button onclick="registerUser()">建立帳號</button></div>';
 h+='<div class="card"><h2>4. 登入驗證</h2><div class="grid"><select id="l_community">'+communityOptions(communities)+'</select><input id="l_account" placeholder="帳號"><input id="l_pass" type="password" placeholder="密碼"></div><button onclick="loginUser()">登入</button><div id="loginBox"></div></div>';
 h+='<div class="card"><h2>5. Users</h2><table><tr><th>Community ID</th><th>Account</th><th>Name</th><th>Role</th><th>Created</th><th>Last Login</th></tr>';
 if(!users.length){h+='<tr><td colspan="6" class="hint">尚未建立帳號。</td></tr>';}
 users.forEach(function(u){h+='<tr><td>'+esc(u.community_id)+'</td><td><b>'+esc(u.account)+'</b></td><td>'+esc(u.display_name)+'</td><td>'+esc(u.role)+'</td><td>'+esc(u.created_at)+'</td><td>'+esc(u.last_login||'')+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card warn"><h2>6. 第三堂課觀察重點</h2><pre>Community ID\n↓\nAdmin Account\n↓\nPassword Hash\n↓\nLogin Success\n↓\nSession Token</pre><p class="hint">第四堂才加入：門鈴事件。第五堂才加入：開門控制。</p></div>';
 h+='<div class="card"><h2>7. Heartbeat 模擬測試</h2><p class="hint">沒有 ESP32 時，可先用模擬 heartbeat 產生一台設備。</p><div class="grid"><input id="h_mac" value="14:C1:9F:29:F2:68" oninput="syncSimUid()" placeholder="MAC"><input id="h_uid" class="uidbox" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 Heartbeat</button></div>';
 h+='<div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function registerUser(){const data={community_id:document.getElementById('r_community').value,account:document.getElementById('r_account').value,display_name:document.getElementById('r_name').value,password:document.getElementById('r_pass').value}; out(await post('/edu/auth/register',data)); await load();}
async function loginUser(){const data={community_id:document.getElementById('l_community').value,account:document.getElementById('l_account').value,password:document.getElementById('l_pass').value}; const r=await post('/edu/auth/login',data); out(r); if(r.ok){document.getElementById('loginBox').innerHTML='<div class="card loginok"><h3>Login Success</h3><p><b>Community:</b> '+esc(r.login.community_name)+'</p><p><b>Community ID:</b> '+esc(r.login.community_id)+'</p><p><b>Account:</b> '+esc(r.login.account)+'</p><p><b>Role:</b> '+esc(r.login.role)+'</p><p><b>Session Token:</b><br><span class="uidbox">'+esc(r.login.token)+'</span></p></div>'; } await load();}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'LOGIN_AUTH_V3'})); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`;
}

app.get(['/edu', '/edu/login'], (_req, res) => { res.type('html').send(renderEduPage()); });

// 第二堂頁面保留，讓課程可以回頭看 Community Register。
app.get('/edu/community/register', (_req, res) => {
  res.type('html').send(renderEduPage().replace('RT7 EDU LOGIN AUTH V3', 'RT7 EDU LOGIN AUTH V3<br><small>Community Register page is preserved; use the Communities section and /edu for Login Auth.</small>'));
});

app.listen(PORT, () => console.log('[' + VERSION + '] http://localhost:' + PORT + '/edu'));
