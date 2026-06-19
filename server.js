// RT7_EDU_OPEN_DOOR_V5B_ESP32_COMMAND_NONE_FIX
// 第五堂課：開門控制 / Command Queue
// 保留第一堂 Heartbeat、第二堂 Community Register、第三堂 Login Auth
// 新增 API: POST /edu/command/open-door, GET /edu/master/command, POST /edu/master/command/ack

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const VERSION = 'RT7_EDU_OPEN_DOOR_V5B_ESP32_COMMAND_NONE_FIX';

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
ensureFile('doorbell_events.json', []);
ensureFile('commands.json', []);

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
  const doorbell_events = readJson('doorbell_events.json', []);
  const commands = readJson('commands.json', []);
  res.json({ ok: true, version: VERSION, masters, communities, users, sessions, sessions_count: sessions.length, doorbell_events, doorbell_count: doorbell_events.length, commands, command_count: commands.length });
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


// 第四堂：門鈴事件。ESP32 按 GPIO38 後 POST 到這裡。
app.post('/edu/event/doorbell', (req, res) => {
  const body = req.body || {};
  const master_uid = normalizeUid(body.master_uid);
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  const masters = refreshMasters(readJson('master_registry.json', {}));
  const master = masters[master_uid] || { master_uid, ip: body.ip || req.ip, mac: formatMac(body.mac || ''), status: 'UNKNOWN' };
  const communities = readJson('communities.json', []);
  const community = communities.find(c => c.master_uid === master_uid) || null;
  let events = readJson('doorbell_events.json', []);
  const event = {
    event_id: 'BELL-' + Date.now().toString(36).toUpperCase(),
    type: 'DOORBELL',
    message: '有人按門鈴',
    community_id: community ? community.community_id : '',
    community_name: community ? community.community_name : '',
    master_uid,
    master_ip: master.ip || body.ip || req.ip,
    master_mac: master.mac || formatMac(body.mac || ''),
    source: String(body.source || 'ESP32').toUpperCase(),
    created_at: nowIso(),
    lesson: VERSION
  };
  events.unshift(event);
  events = events.slice(0, 50);
  writeJson('doorbell_events.json', events);
  console.log('[EDU][V4][DOORBELL]', event.event_id, event.community_name || '-', master_uid);
  res.json({ ok: true, version: VERSION, event, count: events.length });
});

app.get('/edu/events/doorbell', (_req, res) => {
  res.json({ ok: true, version: VERSION, events: readJson('doorbell_events.json', []) });
});

// 第五堂：開門控制。網頁送出 OPEN_DOOR command，ESP32 輪詢後 GPIO40 pulse 800ms。
app.post('/edu/command/open-door', (req, res) => {
  const body = req.body || {};
  let community_id = safeText(body.community_id, 120);
  let master_uid = normalizeUid(body.master_uid);
  const communities = readJson('communities.json', []);
  let community = community_id ? communities.find(c => c.community_id === community_id) : null;
  if (!community && master_uid) community = communities.find(c => c.master_uid === master_uid) || null;
  if (!community) return res.status(404).json({ ok: false, error: 'community not found. Please register community first.' });
  master_uid = normalizeUid(community.master_uid || master_uid);
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  let commands = readJson('commands.json', []);
  const cmd = {
    command_id: 'CMD-' + Date.now().toString(36).toUpperCase(),
    command: 'OPEN_DOOR',
    status: 'PENDING',
    community_id: community.community_id,
    community_name: community.community_name,
    master_uid,
    relay_pin: 40,
    pulse_ms: 800,
    source: safeText(body.source || 'WEB', 20).toUpperCase(),
    created_at: nowIso(),
    delivered_at: '',
    ack_at: '',
    lesson: VERSION
  };
  commands.unshift(cmd);
  commands = commands.slice(0, 50);
  writeJson('commands.json', commands);
  console.log('[EDU][V5][OPEN_DOOR_QUEUED]', cmd.command_id, cmd.community_name, master_uid);
  res.json({ ok: true, version: VERSION, command: cmd, count: commands.length });
});

app.get('/edu/master/command', (req, res) => {
  const master_uid = normalizeUid(req.query.master_uid || req.query.uid || '');
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  let commands = readJson('commands.json', []);
  const cmd = commands.find(c => c.master_uid === master_uid && c.status === 'PENDING');
  if (!cmd) return res.json({ ok: true, version: VERSION, command: 'NONE' });
  cmd.status = 'DELIVERED';
  cmd.delivered_at = nowIso();
  writeJson('commands.json', commands);
  console.log('[EDU][V5][CMD_DELIVER]', cmd.command_id, master_uid, cmd.command);
  res.json({ ok: true, version: VERSION, command: cmd.command, command_id: cmd.command_id, relay_pin: cmd.relay_pin, pulse_ms: cmd.pulse_ms });
});

app.post('/edu/master/command/ack', (req, res) => {
  const body = req.body || {};
  const command_id = safeText(body.command_id, 80);
  const status = safeText(body.status || 'DONE', 20).toUpperCase();
  let commands = readJson('commands.json', []);
  const cmd = commands.find(c => c.command_id === command_id);
  if (!cmd) return res.status(404).json({ ok: false, error: 'command_id not found' });
  cmd.status = status;
  cmd.ack_at = nowIso();
  cmd.ack_note = safeText(body.note || '', 120);
  writeJson('commands.json', commands);
  console.log('[EDU][V5][CMD_ACK]', command_id, status);
  res.json({ ok: true, version: VERSION, command: cmd });
});

app.get('/edu/commands', (_req, res) => {
  res.json({ ok: true, version: VERSION, commands: readJson('commands.json', []) });
});

app.delete('/edu/commands', (_req, res) => {
  const before = readJson('commands.json', []);
  writeJson('commands.json', []);
  res.json({ ok: true, version: VERSION, deleted: before.length });
});


app.delete('/edu/events/doorbell', (_req, res) => {
  const before = readJson('doorbell_events.json', []);
  writeJson('doorbell_events.json', []);
  res.json({ ok: true, version: VERSION, deleted: before.length });
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
<title>RT7 EDU Open Door V5</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1120px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px;box-sizing:border-box}button{background:#0b9b5a;color:#fff;border:0;cursor:pointer}.danger{background:#c0392b}.blue{background:#0b6fa4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}.step{font-weight:bold;color:#0b5f8a}.loginok{background:#effaf4;border-left:5px solid #0b9b5a}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU OPEN DOOR V5BA</h1>
<p><span class="tag">第五堂課</span> Open Door / Command Queue / ESP32 GPIO40 Relay</p>
<p><button class="blue" onclick="location.href='/edu/community/register'">第二堂社區註冊</button> <button class="blue" onclick="location.href='/edu/login'">第三堂登入驗證</button> <button class="blue" onclick="location.href='/edu/doorbell'">第四堂門鈴事件</button> <button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button></p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json();}catch(e){} if(!r.ok)j.http_status=r.status;return j;}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});} async function del(path){return api(path,{method:'DELETE'});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function shortToken(t){t=String(t||''); return t.length>12 ? t.substring(0,12)+'...' : t;}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);} function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-UNKNOWN';}}
let STATE={};
function communityOptions(list){ if(!list.length)return '<option value="">請先完成第二堂：社區註冊</option>'; return list.map(function(c){return '<option value="'+esc(c.community_id)+'">'+esc(c.community_name)+' ('+esc(c.community_id)+')</option>';}).join(''); }
async function load(){
 const s=await api('/edu/state'); STATE=s; const masters=Object.values(s.masters||{}); const communities=s.communities||[]; const users=s.users||[]; const sessions=s.sessions||[];
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
 h+='<div class="card loginok"><h2>6. 目前登入使用者</h2>';
 if(!sessions.length){h+='<p class="hint">目前沒有 ACTIVE session。請先完成登入驗證。</p>'; }
 sessions.slice(0,1).forEach(function(x){h+='<div class="grid"><div><b>Community</b><br>'+esc(x.community_name)+'<br><span class="hint">'+esc(x.community_id)+'</span></div><div><b>Account</b><br>'+esc(x.account)+'</div><div><b>Role</b><br>'+esc(x.role)+'</div><div><b>Status</b><br><span class="ok">ACTIVE</span></div></div>';});
 h+='</div>';
 h+='<div class="card"><h2>7. Sessions</h2><table><tr><th>Status</th><th>Community</th><th>Account</th><th>Role</th><th>Login At</th><th>Expires At</th><th>Session Token</th></tr>';
 if(!sessions.length){h+='<tr><td colspan="7" class="hint">尚未登入，或 session 已過期。</td></tr>';}
 sessions.forEach(function(x){h+='<tr><td class="ok">ACTIVE</td><td>'+esc(x.community_name)+'<br><span class="hint">'+esc(x.community_id)+'</span></td><td><b>'+esc(x.account)+'</b></td><td>'+esc(x.role)+'</td><td>'+esc(x.login_at)+'</td><td>'+esc(x.expires_at)+'</td><td><span class="uidbox">'+esc(shortToken(x.token))+'</span></td></tr>';});
 h+='</table><p class="hint">教學顯示只保留前段 Session Token；後端仍保存完整 token。</p></div>';
 h+='<div class="card"><h2>8. Doorbell Events</h2><p class="hint">ESP32 GPIO38 按下後，POST /edu/event/doorbell，Railway 將事件寫入 doorbell_events.json。</p><p><button onclick="simulateDoorbell()">模擬按門鈴</button> <button class="danger" onclick="clearDoorbells()">清除門鈴事件</button></p><table><tr><th>Event ID</th><th>訊息</th><th>Community</th><th>Master UID</th><th>來源</th><th>時間</th></tr>';
 if(!(s.doorbell_events||[]).length){h+='<tr><td colspan="6" class="hint">尚未收到門鈴事件。</td></tr>';}
 (s.doorbell_events||[]).forEach(function(e){h+='<tr><td><b>'+esc(e.event_id)+'</b></td><td>'+esc(e.message)+'</td><td>'+esc(e.community_name||'未綁定')+'<br><span class="hint">'+esc(e.community_id||'')+'</span></td><td>'+esc(e.master_uid)+'</td><td>'+esc(e.source)+'</td><td>'+esc(e.created_at)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card"><h2>9. Open Door Commands</h2><p class="hint">第五堂：網頁送出 OPEN_DOOR，Railway 寫入 commands.json；ESP32 每 1~2 秒輪詢 /edu/master/command，收到後 GPIO40 pulse 800ms，最後 ACK。</p><p><button onclick="openDoorCmd()">送出開門命令</button> <button class="danger" onclick="clearCommands()">清除命令</button></p><table><tr><th>Command ID</th><th>Command</th><th>Status</th><th>Community</th><th>Master UID</th><th>GPIO</th><th>Created</th><th>Delivered</th><th>ACK</th></tr>';
 if(!(s.commands||[]).length){h+='<tr><td colspan="9" class="hint">尚未建立開門命令。</td></tr>';}
 (s.commands||[]).forEach(function(c){h+='<tr><td><b>'+esc(c.command_id)+'</b></td><td>'+esc(c.command)+'</td><td class="'+(c.status==='DONE'?'ok':(c.status==='PENDING'?'bad':''))+'">'+esc(c.status)+'</td><td>'+esc(c.community_name||'未綁定')+'<br><span class="hint">'+esc(c.community_id||'')+'</span></td><td>'+esc(c.master_uid)+'</td><td>GPIO'+esc(c.relay_pin)+' / '+esc(c.pulse_ms)+'ms</td><td>'+esc(c.created_at)+'</td><td>'+esc(c.delivered_at||'')+'</td><td>'+esc(c.ack_at||'')+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card warn"><h2>10. 第五堂課觀察重點</h2><pre>'+esc(['登入成功','↓','網頁按「送出開門命令」','↓','POST /edu/command/open-door','↓','Railway Command Queue','↓','ESP32 GET /edu/master/command','↓','收到 OPEN_DOOR','↓','GPIO40 relay pulse 800ms','↓','POST /edu/master/command/ack'].join('\n'))+'</pre><p class="hint">這堂只做開門控制；AI Face Match / Liveness 留到正式版 RT7 展示。</p></div>';
 h+='<div class="card"><h2>11. Heartbeat 模擬測試</h2><p class="hint">沒有 ESP32 時，可先用模擬 heartbeat 產生一台設備。</p><div class="grid"><input id="h_mac" value="14:C1:9F:29:F2:68" oninput="syncSimUid()" placeholder="MAC"><input id="h_uid" class="uidbox" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 Heartbeat</button></div>';
 h+='<div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function registerUser(){const data={community_id:document.getElementById('r_community').value,account:document.getElementById('r_account').value,display_name:document.getElementById('r_name').value,password:document.getElementById('r_pass').value}; out(await post('/edu/auth/register',data)); await load();}
async function loginUser(){const data={community_id:document.getElementById('l_community').value,account:document.getElementById('l_account').value,password:document.getElementById('l_pass').value}; const r=await post('/edu/auth/login',data); out(r); await load();}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'OPEN_DOOR_V5A'})); await load();}
async function simulateDoorbell(){var masters=Object.values((STATE&&STATE.masters)||{}); var uid=masters[0]?masters[0].master_uid:''; if(!uid){out({ok:false,error:'請先送出 heartbeat'});return;} out(await post('/edu/event/doorbell',{master_uid:uid,source:'SIM'})); await load();}
async function clearDoorbells(){out(await del('/edu/events/doorbell')); await load();}
async function openDoorCmd(){var communities=(STATE&&STATE.communities)||[]; var c=communities[0]; if(!c){out({ok:false,error:'請先完成第二堂社區註冊'});return;} out(await post('/edu/command/open-door',{community_id:c.community_id,source:'WEB'})); await load();}
async function clearCommands(){out(await del('/edu/commands')); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`;
}

app.get(['/edu', '/edu/doorbell', '/edu/login', '/edu/open-door'], (_req, res) => { res.type('html').send(renderEduPage()); });


// 第二堂頁面保留：/edu/community/register 必須顯示第二堂社區註冊頁，不可變成第三堂登入頁。
function renderCommunityRegisterPage() {
return String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU Community Register V2A1</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1080px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px;box-sizing:border-box}button{background:#0b9b5a;color:#fff;border:0;cursor:pointer}.danger{background:#c0392b}.blue{background:#0b6fa4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU COMMUNITY REGISTER V2A1</h1>
<p><span class="tag">第二堂課</span> 社區註冊 / Community ID / 主門禁 UID 綁定</p>
<p><button class="blue" onclick="location.href='/edu/login'">前往第三堂 Login Auth</button></p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json();}catch(e){} if(!r.ok)j.http_status=r.status;return j;}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});} async function del(path){return api(path,{method:'DELETE'});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function shortToken(t){t=String(t||''); return t.length>12 ? t.substring(0,12)+'...' : t;}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);} function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-UNKNOWN';}}
async function load(){
 const s=await api('/edu/state'); const masters=Object.values(s.masters||{}); const communities=s.communities||[]; var h='';
 h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 Heartbeat</th></tr>';
 if(!masters.length){h+='<tr><td colspan="6" class="hint">尚未收到 ESP32 heartbeat。請先完成第一堂：設備上線。</td></tr>';}
 masters.forEach(function(m){h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source||'')+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card"><h2>2. 社區註冊</h2><p class="hint">第二堂只做「社區資料 + Community ID + 主門禁 UID 綁定」，不做登入密碼驗證。</p><div class="grid"><input id="c_name" placeholder="社區名稱，例如：幸福社區"><input id="a_name" placeholder="管理員名稱，例如：admin"><input id="a_email" placeholder="管理員 Email，可留空"><select id="c_uid">';
 if(!masters.length){h+='<option value="">請先讓 ESP32 heartbeat 上線</option>';}
 masters.forEach(function(m){h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid)+' | '+esc(m.status)+' | '+esc(m.ip||'')+'</option>';});
 h+='</select></div><button onclick="registerCommunity()">註冊社區並綁定 UID</button></div>';
 h+='<div class="card"><h2>3. Communities</h2><table><tr><th>Community ID</th><th>社區</th><th>管理員</th><th>綁定 UID</th><th>Master IP</th><th>建立時間</th><th>操作</th></tr>';
 if(!communities.length){h+='<tr><td colspan="7" class="hint">尚未註冊社區。</td></tr>';}
 communities.forEach(function(c){h+='<tr><td><b>'+esc(c.community_id)+'</b></td><td>'+esc(c.community_name)+'</td><td>'+esc(c.admin_name)+'<br><span class="hint">'+esc(c.admin_email||'')+'</span></td><td>'+esc(c.master_uid)+'</td><td>'+esc(c.master_ip||'')+'</td><td>'+esc(c.created_at)+'</td><td><button class="danger" onclick="deleteCommunity(\''+esc(c.community_id)+'\')">刪除</button></td></tr>';});
 h+='</table></div>';
 h+='<div class="card warn"><h2>4. 第二堂課觀察重點</h2><pre>Heartbeat 讓設備出現在 Master Registry\n↓\n選擇一台 Master UID\n↓\n建立社區 Community\n↓\n產生 Community ID\n↓\n社區綁定這台主門禁 UID</pre><p class="hint">下一堂才加入：登入驗證。第四堂才加入：門鈴事件。</p></div>';
 h+='<div class="card"><h2>5. Heartbeat 模擬測試</h2><p class="hint">沒有 ESP32 時，可先用模擬 heartbeat 產生一台設備。</p><div class="grid"><input id="h_mac" value="14:C1:9F:29:F2:68" oninput="syncSimUid()" placeholder="MAC"><input id="h_uid" class="uidbox" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 Heartbeat</button></div>';
 h+='<div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function registerCommunity(){const data={community_name:document.getElementById('c_name').value,admin_name:document.getElementById('a_name').value,admin_email:document.getElementById('a_email').value,master_uid:document.getElementById('c_uid').value}; out(await post('/edu/community/register',data)); await load();}
async function deleteCommunity(id){out(await del('/edu/community/'+encodeURIComponent(id))); await load();}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'COMMUNITY_REGISTER_V2A1'})); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`;
}
app.get('/edu/community/register', (_req, res) => { res.type('html').send(renderCommunityRegisterPage()); });

app.listen(PORT, () => console.log('[' + VERSION + '] http://localhost:' + PORT + '/edu/open-door'));
