// RT7_EDU_HEARTBEAT_ONLY_V1
// 第一堂課：Heartbeat / 設備上線 ONLY
// API: POST /edu/master/heartbeat, GET /edu/state, GET /edu

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
function resolveHeartbeatUid(body) {
  const macUid = uidFromMac(body && body.mac);
  const reqUid = normalizeUid(body && body.master_uid);
  return macUid || reqUid;
}

ensureFile('master_registry.json', {});

app.get('/', (_req, res) => res.redirect('/edu'));

app.get('/edu/state', (_req, res) => {
  const masters = readJson('master_registry.json', {});
  Object.keys(masters).forEach(uid => {
    masters[uid].status = onlineStatus(masters[uid].last_heartbeat);
  });
  res.json({ ok: true, version: 'RT7_EDU_HEARTBEAT_ONLY_V1', masters });
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
    lesson: body.lesson || 'HEARTBEAT_ONLY_V1',
    last_heartbeat: nowIso(),
    status: 'ONLINE',
    uid_rule: mac ? 'MAC_REVERSE_PAIRS' : 'REQUEST_UID'
  };

  writeJson('master_registry.json', masters);
  console.log('[EDU][HEARTBEAT_ONLY_V1]', uid, ip, mac, source);
  res.json({ ok: true, version: 'RT7_EDU_HEARTBEAT_ONLY_V1', master: masters[uid] });
});

app.get('/edu', (_req, res) => {
  res.type('html').send(String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU Heartbeat Only V1</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:#fff;border:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU HEARTBEAT ONLY V1</h1>
<p><span class="tag">第一堂課</span> Heartbeat / 設備上線</p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));return r.json();}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function out(x){var e=document.getElementById('out'); if(e)e.textContent=JSON.stringify(x,null,2);}
function cleanMac(mac){return String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'').slice(-12);}
function uidFromMac(mac){var h=cleanMac(mac); if(h.length!==12)return ''; var p=h.match(/.{2}/g); return 'RT7-MASTER-'+p.reverse().join('');}
function syncSimUid(){var mac=document.getElementById('h_mac'), uid=document.getElementById('h_uid'); if(mac&&uid){uid.value=uidFromMac(mac.value)||'RT7-MASTER-UNKNOWN';}}
async function load(){
 const s=await api('/edu/state'); const masters=Object.values(s.masters||{});
 var h='';
 h+='<div class="card"><h2>1. Master Registry</h2><table><tr><th>UID</th><th>IP</th><th>MAC</th><th>狀態</th><th>來源</th><th>最後 Heartbeat</th></tr>';
 if(!masters.length){h+='<tr><td colspan="6" class="hint">尚未收到 ESP32 heartbeat。</td></tr>';}
 masters.forEach(function(m){h+='<tr><td>'+esc(m.master_uid)+'</td><td>'+esc(m.ip)+'</td><td>'+esc(m.mac)+'</td><td class="'+(m.status==='ONLINE'?'ok':'bad')+'">'+esc(m.status)+'</td><td>'+esc(m.source||'')+'</td><td>'+esc(m.last_heartbeat)+'</td></tr>';});
 h+='</table><p class="hint">本頁只觀察設備上線，不包含社區註冊、登入、門鈴、開門。</p></div>';
 h+='<div class="card"><h2>2. Heartbeat 模擬測試</h2><p class="hint">沒有 ESP32 時，可用模擬 heartbeat 教學。真機上線時以 ESP32 串口與 Master Registry 為主。</p><div class="grid"><input id="h_mac" value="14:C1:9F:29:F2:68" oninput="syncSimUid()" placeholder="MAC"><input id="h_uid" class="uidbox" readonly><input id="h_ip" value="192.168.0.179"></div><button onclick="sendHeartbeat()">送出模擬 Heartbeat</button></div>';
 h+='<div class="card"><h2>3. 第一堂課觀察重點</h2><pre>ESP32\n↓ WiFi 連線\n↓ MAC 產生 UID\n↓ POST /edu/master/heartbeat\n↓ Railway Master Registry\n↓ ONLINE</pre></div>';
 h+='<div class="card"><h2>回應</h2><pre id="out">READY</pre></div>';
 document.getElementById('app').innerHTML=h; syncSimUid();
}
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'HEARTBEAT_ONLY_V1'})); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`);
});

app.listen(PORT, () => console.log('[RT7_EDU_HEARTBEAT_ONLY_V1] http://localhost:' + PORT + '/edu'));
