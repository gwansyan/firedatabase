// RT7_EDU_COMMUNITY_REGISTER_V2
// 第二堂課：社區註冊 / 主門禁 UID 綁定
// 保留第一堂 Heartbeat，新增 Community Register
// API: POST /edu/master/heartbeat, POST /edu/community/register, GET /edu/state, GET /edu

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

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
  return 'RT7-MASTER-' + h.match(/.{2}/g).reverse().join('');
}
function normalizeUid(uid) {
  return String(uid || '').trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '').slice(0, 80);
}
function safeText(s, max = 80) {
  return String(s || '').trim().replace(/[<>]/g, '').slice(0, max);
}
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

ensureFile('master_registry.json', {});
ensureFile('communities.json', []);

app.get('/', (_req, res) => res.redirect('/edu'));

app.get('/health', (_req, res) => res.json({ ok: true, version: 'RT7_EDU_COMMUNITY_REGISTER_V2', time: nowIso() }));

app.get('/edu/state', (_req, res) => {
  const masters = refreshMasters(readJson('master_registry.json', {}));
  const communities = readJson('communities.json', []);
  res.json({ ok: true, version: 'RT7_EDU_COMMUNITY_REGISTER_V2', masters, communities });
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
    lesson: body.lesson || 'COMMUNITY_REGISTER_V2',
    last_heartbeat: nowIso(),
    status: 'ONLINE',
    uid_rule: mac ? 'MAC_REVERSE_PAIRS' : 'REQUEST_UID'
  };

  writeJson('master_registry.json', masters);
  console.log('[EDU][V2][HEARTBEAT]', uid, ip, mac, source);
  res.json({ ok: true, version: 'RT7_EDU_COMMUNITY_REGISTER_V2', master: masters[uid] });
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
  if (used) {
    return res.status(409).json({ ok: false, error: 'master_uid already bound', community: used });
  }

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
    lesson: 'COMMUNITY_REGISTER_V2'
  };
  communities.push(community);
  writeJson('communities.json', communities);
  console.log('[EDU][V2][COMMUNITY_REGISTER]', community.community_id, community.community_name, master_uid);
  res.json({ ok: true, version: 'RT7_EDU_COMMUNITY_REGISTER_V2', community });
});

app.delete('/edu/community/:community_id', (req, res) => {
  const id = String(req.params.community_id || '');
  const before = readJson('communities.json', []);
  const after = before.filter(c => c.community_id !== id);
  writeJson('communities.json', after);
  res.json({ ok: true, deleted: before.length - after.length, version: 'RT7_EDU_COMMUNITY_REGISTER_V2' });
});

app.get('/edu', (_req, res) => {
  res.type('html').send(String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU Community Register V2</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1080px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px;box-sizing:border-box}button{background:#0b9b5a;color:#fff;border:0;cursor:pointer}.danger{background:#c0392b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}.step{font-weight:bold;color:#0b5f8a}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU COMMUNITY REGISTER V2</h1>
<p><span class="tag">第二堂課</span> 社區註冊 / 主門禁 UID 綁定</p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json();}catch(e){} if(!r.ok)j.http_status=r.status;return j;}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});}
async function del(path){return api(path,{method:'DELETE'});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);}
function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-UNKNOWN';}}
let STATE={masters:{},communities:[]};
async function load(){
 const s=await api('/edu/state'); STATE=s; const masters=Object.values(s.masters||{}); const communities=s.communities||[];
 var h='';
 h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 Heartbeat</th></tr>';
 if(!masters.length){h+='<tr><td colspan="6" class="hint">尚未收到 ESP32 heartbeat。請先完成第一堂：設備上線。</td></tr>';}
 masters.forEach(function(m){h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source||'')+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card"><h2>2. 社區註冊</h2><p class="hint">第二堂只做「社區資料 + 主門禁 UID 綁定」，不做登入密碼驗證。</p><div class="grid"><input id="c_name" placeholder="社區名稱，例如：幸福社區"><input id="a_name" placeholder="管理員名稱，例如：admin"><input id="a_email" placeholder="管理員 Email，可留空"><select id="c_uid">';
 if(!masters.length){h+='<option value="">請先讓 ESP32 heartbeat 上線</option>';}
 masters.forEach(function(m){h+='<option value="'+esc(m.master_uid)+'">'+esc(m.master_uid)+' | '+esc(m.status)+' | '+esc(m.ip||'')+'</option>';});
 h+='</select></div><button onclick="registerCommunity()">註冊社區並綁定 UID</button></div>';
 h+='<div class="card"><h2>3. Communities</h2><table><tr><th>社區</th><th>管理員</th><th>綁定 UID</th><th>Master IP</th><th>建立時間</th><th>操作</th></tr>';
 if(!communities.length){h+='<tr><td colspan="6" class="hint">尚未註冊社區。</td></tr>';}
 communities.forEach(function(c){h+='<tr><td>'+esc(c.community_name)+'<br><span class="hint">'+esc(c.community_id)+'</span></td><td>'+esc(c.admin_name)+'<br><span class="hint">'+esc(c.admin_email||'')+'</span></td><td>'+esc(c.master_uid)+'</td><td>'+esc(c.master_ip||'')+'</td><td>'+esc(c.created_at)+'</td><td><button class="danger" onclick="deleteCommunity(\''+esc(c.community_id)+'\')">刪除</button></td></tr>';});
 h+='</table></div>';
 h+='<div class="card warn"><h2>4. 第二堂課觀察重點</h2><pre>Heartbeat 讓設備出現在 Master Registry\n↓\n選擇一台 Master UID\n↓\n建立社區 Community\n↓\n社區綁定這台主門禁 UID</pre><p class="hint">下一堂才加入：登入驗證。第四堂才加入：門鈴事件。</p></div>';
 h+='<div class="card"><h2>5. Heartbeat 模擬測試</h2><p class="hint">沒有 ESP32 時，可先用模擬 heartbeat 產生一台設備。</p><div class="grid"><input id="h_mac" value="14:C1:9F:29:F2:68" oninput="syncSimUid()" placeholder="MAC"><input id="h_uid" class="uidbox" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 Heartbeat</button></div>';
 h+='<div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function registerCommunity(){
 const data={community_name:document.getElementById('c_name').value,admin_name:document.getElementById('a_name').value,admin_email:document.getElementById('a_email').value,master_uid:document.getElementById('c_uid').value};
 out(await post('/edu/community/register',data)); await load();
}
async function deleteCommunity(id){out(await del('/edu/community/'+encodeURIComponent(id))); await load();}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'COMMUNITY_REGISTER_V2'})); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`);
});

app.listen(PORT, () => console.log('[RT7_EDU_COMMUNITY_REGISTER_V2] http://localhost:' + PORT + '/edu'));
