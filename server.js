// RT7_EDU_TEST_V1C_REAL_UID_FROM_MAC
// 教學版：Heartbeat / 多社區綁定 / 登入 / 門鈴事件 / 開門命令
// V1C：ESP32 UID 由 WiFi MAC 自動產生，格式與正式 RT7 Cloud 一致。
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SIM_MAC = 'AA:BB:CC:DD:EE:01';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function ensureFile(name, fallback) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
  return (Date.now() - new Date(lastSeen).getTime()) < 300000 ? 'ONLINE' : 'OFFLINE';
}
function cleanMac(mac) {
  return String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(-12);
}
function formatMac(mac) {
  const h = cleanMac(mac);
  if (h.length !== 12) return String(mac || '').trim().toUpperCase();
  return h.match(/.{2}/g).join(':');
}
function uidFromMac(mac) {
  const h = cleanMac(mac);
  if (h.length !== 12) return '';
  const pairs = h.match(/.{2}/g);
  return 'RT7-MASTER-' + pairs.reverse().join('');
}
function normalizeUid(uid) {
  return String(uid || '').trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '').slice(0, 80);
}
function isTestUid(uid) {
  uid = normalizeUid(uid);
  return !uid || uid.startsWith('RT7-MASTER-TEST-') || uid === 'RT7-MASTER-A001';
}
function detectSource(mac, source) {
  const m = formatMac(mac);
  const s = String(source || '').trim().toUpperCase();
  if (s === 'SIM' || m === SIM_MAC) return 'SIM';
  if (cleanMac(m).length === 12) return 'ESP32';
  return s || 'UNKNOWN';
}
function resolveHeartbeatUid(body) {
  const macUid = uidFromMac(body && body.mac);
  const reqUid = normalizeUid(body && body.master_uid);
  const source = detectSource(body && body.mac, body && body.source);

  // V1C: 真實 ESP32 以 MAC 產生 UID；如果舊韌體仍送 TEST UID，Railway 教學版會自動改成真實 UID。
  if (source === 'ESP32' && macUid && isTestUid(reqUid)) return macUid;
  if (reqUid) return reqUid;
  return macUid;
}

ensureFile('master_registry.json', {});
ensureFile('communities.json', []);
ensureFile('events.json', []);
ensureFile('commands.json', {});

app.get('/', (_req, res) => res.redirect('/edu'));

app.get('/edu', (_req, res) => {
  res.type('html').send(String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU TEST V1C</title><style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.sim{color:#8a5a00;font-weight:bold}.real{color:#005bbb;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.5}.small{font-size:13px;color:#64748b}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.warn{background:#fff7d6;border-radius:10px;padding:10px;color:#664500}</style></head><body><div class="wrap"><h1>RT7 EDU TEST V1C</h1><p>教學版：Heartbeat / 多社區綁定 / 登入 / 門鈴事件 / 開門命令</p><p style="color:#64748b">V1C：ESP32 真實 MAC 自動產生 Master UID，與正式 RT7 Cloud 規則一致。</p><div id="app">載入中...</div></div><script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));return r.json();}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);}
function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-SIM-UNKNOWN';}}
async function load(){
 const s=await api('/edu/state'); const masters=Object.values(s.masters||{});
 var h='';
 h+='<div class="card"><h2>1. 模組上線 Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 heartbeat</th></tr>';
 masters.forEach(function(m){h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td class="'+(m.source==='ESP32'?'real':'sim')+'">'+esc(m.source||'UNKNOWN')+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>';});
 h+='</table><div class="hint">正式 UID 範例：MAC 14:C1:9F:29:F2:68 → UID RT7-MASTER-68F2299FC114。</div></div>';
 h+='<div class="card"><h2>2. Heartbeat 測試</h2><div class="warn">真實 ESP32 會送自己的 MAC，Server 會自動換算 UID。網頁模擬器只在沒有 ESP32 時教學使用。</div><label class="small"><input type="checkbox" id="sim_enable"> 啟用網頁模擬器自動 heartbeat</label><div class="grid"><input id="h_mac" value="AA:BB:CC:DD:EE:01" oninput="syncSimUid()" placeholder="模擬 MAC"><input id="h_uid" class="uidbox" value="RT7-MASTER-01EEDDCCBBAA" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 heartbeat</button></div>';
 h+='<div class="card"><h2>3. 社區註冊 / 綁定主門禁</h2><div class="grid"><input id="c_name" placeholder="社區名稱，例如 A社區"><input id="c_user" placeholder="帳號" value="admin"><input id="c_pass" placeholder="密碼" value="1234"><select id="c_master"><option value="">選擇在線主門禁</option>';
 masters.forEach(function(m){h+='<option value="'+esc(m.master_uid+'|'+(m.ip||''))+'">'+esc(m.master_uid+' / '+(m.ip||'')+' / '+(m.source||''))+'</option>';});
 h+='</select></div><button onclick="regCommunity()">建立帳號並綁定</button></div>';
 h+='<div class="card"><h2>4. 登入測試</h2><div class="grid"><input id="l_comm" placeholder="社區名稱"><input id="l_user" placeholder="帳號" value="admin"><input id="l_pass" placeholder="密碼" value="1234"></div><button onclick="loginTest()">登入</button></div>';
 h+='<div class="card"><h2>5. 社區帳號</h2><table><tr><th>社區</th><th>帳號</th><th>角色</th><th>Master UID</th><th>IP</th></tr>';
 (s.communities||[]).forEach(function(c){h+='<tr><td>'+esc(c.community)+'</td><td>'+esc(c.username)+'</td><td>'+esc(c.role)+'</td><td>'+esc(c.master_uid)+'</td><td>'+esc(c.master_ip)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card"><h2>6. 門鈴與開門測試</h2><div class="grid"><input id="e_uid" placeholder="Master UID" value="'+esc((masters[0]&&masters[0].master_uid)||'')+'"><input id="e_msg" value="有人按門鈴"></div><button onclick="doorbell()">送出門鈴事件</button><button onclick="openDoor()">送出開門命令</button><button onclick="pollCmd()">ESP32 輪詢命令</button></div>';
 h+='<div class="card"><h2>7. 事件紀錄</h2><table><tr><th>時間</th><th>UID</th><th>事件</th><th>訊息</th></tr>';
 (s.events||[]).slice(-10).reverse().forEach(function(e){h+='<tr><td>'+esc(e.time)+'</td><td>'+esc(e.master_uid)+'</td><td>'+esc(e.event)+'</td><td>'+esc(e.message)+'</td></tr>';});
 h+='</table></div><div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM'})); await load();}
async function regCommunity(){const pair=(c_master.value||'|').split('|'); out(await post('/edu/community/register',{community:c_name.value,username:c_user.value,password:c_pass.value,master_uid:pair[0],master_ip:pair[1]})); await load();}
async function loginTest(){out(await post('/edu/login',{community:l_comm.value,username:l_user.value,password:l_pass.value}));}
async function doorbell(){out(await post('/edu/event/doorbell',{master_uid:e_uid.value,event:'doorbell',message:e_msg.value})); await load();}
async function openDoor(){out(await post('/edu/door/open',{master_uid:e_uid.value})); await load();}
async function pollCmd(){out(await api('/edu/device/command?master_uid='+encodeURIComponent(e_uid.value))); await load();}
function isTypingNow(){var el=document.activeElement;if(!el)return false;var tag=(el.tagName||'').toUpperCase();return tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA';}
async function autoHeartbeatKeepOnline(){try{var sim=document.getElementById('sim_enable'); if(sim&&sim.checked){syncSimUid(); await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM'}); if(!isTypingNow()) await load();}}catch(e){console.log('[EDU][AUTO_HEARTBEAT_FAIL]',e);}}
load(); setInterval(autoHeartbeatKeepOnline,30000);
</script></body></html>`);
});

app.get('/edu/state', (_req, res) => {
  const masters = readJson('master_registry.json', {});
  Object.keys(masters).forEach(uid => {
    masters[uid].status = onlineStatus(masters[uid].last_heartbeat);
    masters[uid].source = masters[uid].source || detectSource(masters[uid].mac);
  });
  res.json({ ok: true, masters, communities: readJson('communities.json', []), events: readJson('events.json', []), commands: readJson('commands.json', {}) });
});

app.post('/edu/master/heartbeat', (req, res) => {
  const body = req.body || {};
  const uid = resolveHeartbeatUid(body);
  if (!uid) return res.status(400).json({ ok: false, error: 'missing master_uid or valid mac' });

  const mac = formatMac(body.mac || '');
  const source = detectSource(mac, body.source);
  const ip = body.ip || req.ip;
  const masters = readJson('master_registry.json', {});

  // V1C: 如果舊的 TEST UID 已存在，且現在收到同一台真機 MAC，將舊 TEST 紀錄遷移到真實 UID。
  const legacyUid = normalizeUid(body.master_uid);
  if (source === 'ESP32' && legacyUid && legacyUid !== uid && masters[legacyUid]) {
    delete masters[legacyUid];
  }

  const old = masters[uid] || {};
  const oldSource = old.source || detectSource(old.mac, old.source);
  if (old.master_uid && oldSource === 'ESP32' && source === 'SIM') {
    masters[uid] = { ...old, last_heartbeat: nowIso(), status: 'ONLINE', source: 'ESP32', sim_last_heartbeat: nowIso(), sim_mac: mac, sim_ip: ip };
    writeJson('master_registry.json', masters);
    console.log('[EDU][HEARTBEAT][SIM_IGNORED_REAL_KEPT]', uid, 'real_mac=' + old.mac, 'sim_mac=' + mac);
    return res.json({ ok: true, priority: 'ESP32_REAL_KEPT', master: masters[uid] });
  }

  masters[uid] = { master_uid: uid, ip, mac, last_heartbeat: nowIso(), status: 'ONLINE', source, uid_rule: 'MAC_REVERSE_PAIRS' };
  writeJson('master_registry.json', masters);
  console.log('[EDU][HEARTBEAT][V1C]', uid, ip, mac, source);
  res.json({ ok: true, master: masters[uid] });
});

app.post('/edu/community/register', (req, res) => {
  const { community, username, password, master_uid, master_ip } = req.body || {};
  if (!community || !username || !password || !master_uid) return res.status(400).json({ ok: false, error: 'missing community/username/password/master_uid' });
  const masters = readJson('master_registry.json', {});
  if (!masters[master_uid]) return res.status(400).json({ ok: false, error: 'master_uid not online in registry' });
  const communities = readJson('communities.json', []);
  if (communities.some(u => u.community === community && u.username === username)) return res.status(409).json({ ok: false, error: 'account exists in same community' });
  if (communities.some(u => u.community !== community && u.master_uid === master_uid)) return res.status(409).json({ ok: false, error: 'master_uid already bound by another community' });
  const role = communities.some(u => u.community === community) ? 'user' : 'admin';
  const user = { id: 'u_' + Math.random().toString(16).slice(2) + Date.now().toString(16), community, username, password, role, master_uid, master_ip: master_ip || masters[master_uid].ip || '', created_at: nowIso() };
  communities.push(user);
  writeJson('communities.json', communities);
  res.json({ ok: true, user: { ...user, password: '***' } });
});
app.post('/edu/login', (req, res) => {
  const { community, username, password } = req.body || {};
  const communities = readJson('communities.json', []);
  const user = communities.find(u => u.community === community && u.username === username && u.password === password);
  if (!user) return res.status(401).json({ ok: false, error: 'login failed' });
  const masters = readJson('master_registry.json', {});
  const master = masters[user.master_uid];
  res.json({ ok: true, message: 'login success', user: { community: user.community, username: user.username, role: user.role, master_uid: user.master_uid, master_status: master ? onlineStatus(master.last_heartbeat) : 'OFFLINE' } });
});
app.post('/edu/event/doorbell', (req, res) => {
  const { master_uid, event, message } = req.body || {};
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  const events = readJson('events.json', []);
  const item = { time: nowIso(), master_uid, event: event || 'doorbell', message: message || '有人按門鈴' };
  events.push(item);
  writeJson('events.json', events.slice(-200));
  res.json({ ok: true, event: item });
});
app.post('/edu/door/open', (req, res) => {
  const { master_uid } = req.body || {};
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  const commands = readJson('commands.json', {});
  commands[master_uid] = commands[master_uid] || [];
  const cmd = { time: nowIso(), cmd: 'OPEN_DOOR', pin: 40, pulse_ms: 800 };
  commands[master_uid].push(cmd);
  writeJson('commands.json', commands);
  res.json({ ok: true, command: cmd });
});
app.get('/edu/device/command', (req, res) => {
  const master_uid = String(req.query.master_uid || '');
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid' });
  const commands = readJson('commands.json', {});
  const queue = commands[master_uid] || [];
  const cmd = queue.shift() || null;
  commands[master_uid] = queue;
  writeJson('commands.json', commands);
  res.json({ ok: true, command: cmd });
});

app.listen(PORT, () => console.log('[RT7_EDU_TEST_V1C] http://localhost:' + PORT + '/edu'));
