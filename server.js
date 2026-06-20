const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const VERSION = 'RT7_EDU_FACE_RECOGNITION_V9D2_RESTORE_COMMUNITY_REGISTER';
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.RT7_DATA_DIR || __dirname;

app.use(cors());
app.use(express.urlencoded({ extended: true }));

function p(name){ return path.join(DATA_DIR, name); }
function nowIso(){ return new Date().toISOString(); }
function readJson(name, fallback){
  try { if (fs.existsSync(p(name))) return JSON.parse(fs.readFileSync(p(name), 'utf8')); } catch(e){}
  return fallback;
}
function writeJson(name, data){
  fs.writeFileSync(p(name), JSON.stringify(data, null, 2));
}
function safeText(v, max=120){
  return String(v || '').replace(/[<>]/g, '').slice(0, max);
}
function normalizeUid(v){
  return safeText(v, 120).trim();
}
function uidToCommunity(master_uid){
  const communities = readJson('communities.json', []);
  const found = Array.isArray(communities) ? communities.find(c => c.master_uid === master_uid) : null;
  if (found) return found;
  const defaultCommunity = {
    community_id: 'COMM-A社區-' + Date.now().toString(36).toUpperCase(),
    community_name: 'A社區',
    master_uid
  };
  writeJson('communities.json', [defaultCommunity]);
  return defaultCommunity;
}
function latestSnapshot(){
  const arr = readJson('face_snapshots.json', []);
  if (!Array.isArray(arr) || !arr.length) return null;
  arr.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return arr.find(s => String(s.face_gate || '').toUpperCase() === 'PASS' && Number(s.face_count || 0) > 0) || arr[0];
}
function faceDb(){
  const arr = readJson('edu_face_db.json', []);
  return Array.isArray(arr) ? arr : [];
}
function writeFaceDb(db){ writeJson('edu_face_db.json', Array.isArray(db) ? db.slice(0, 80) : []); }
function fingerprint(snapshot){
  const seed = Buffer.from(JSON.stringify(snapshot || {}));
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed[i]; h = Math.imul(h, 16777619) >>> 0; }
  h ^= Number(snapshot && snapshot.bytes || 0);
  return 'FNV1A-' + (h >>> 0).toString(16).toUpperCase();
}
function htmlEscape(s){
  return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

app.get('/health', (_req, res) => res.json({ ok:true, version:VERSION, time:nowIso() }));

app.post('/edu/master/heartbeat', express.json({ limit:'1mb' }), (req, res) => {
  const body = req.body || {};
  const master_uid = normalizeUid(body.master_uid || '');
  const masters = readJson('masters.json', []);
  const rec = {
    master_uid,
    ip: safeText(body.ip || req.ip || ''),
    mac: safeText(body.mac || ''),
    source: safeText(body.source || 'ESP32'),
    lesson: safeText(body.lesson || 'FACE_RECOGNITION_V9D1'),
    last_heartbeat: nowIso(),
    status: 'ONLINE',
    uid_rule: 'MAC_REVERSE_PAIRS'
  };
  const next = Array.isArray(masters) ? masters.filter(m => m.master_uid !== master_uid) : [];
  next.unshift(rec);
  writeJson('masters.json', next);
  if (master_uid) uidToCommunity(master_uid);
  res.json({ ok:true, version:VERSION, master:rec });
});

app.get('/edu/master/command', (req, res) => {
  res.json({ ok:true, version:VERSION, command:'NONE' });
});

app.post('/edu/face/snapshot', express.raw({ type:'*/*', limit:'5mb' }), (req, res) => {
  const master_uid = normalizeUid(req.query.master_uid || req.headers['x-master-uid'] || '');
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!master_uid) return res.status(400).json({ ok:false, version:VERSION, error:'missing master_uid' });
  if (!buf.length || buf.length < 1000) return res.status(400).json({ ok:false, version:VERSION, error:'jpeg too small', bytes:buf.length });

  const face_gate = String(req.query.face_gate || '').toUpperCase();
  const face_count = Number(req.query.face_count || 0);
  if (face_gate && face_gate !== 'PASS') return res.status(409).json({ ok:false, version:VERSION, error:'FACE_GATE_NOT_PASS', face_gate });
  if (face_gate === 'PASS' && face_count <= 0) return res.status(409).json({ ok:false, version:VERSION, error:'FACE_GATE_PASS_BUT_FACE_COUNT_ZERO', face_count });

  const community = uidToCommunity(master_uid);
  fs.writeFileSync(p('edu_face_latest.jpg'), buf);
  const rec = {
    snapshot_id: 'SNAP-' + Date.now().toString(36).toUpperCase(),
    type: 'FACE_SNAPSHOT',
    master_uid,
    community_id: community.community_id || '',
    community_name: community.community_name || community.name || 'A社區',
    source: safeText(req.query.source || 'ESP32'),
    face_gate: face_gate || 'PASS',
    face_found: String(req.query.face_found || 'true') === 'true',
    face_count: face_count || 1,
    face_quality: safeText(req.query.face_quality || 'CANDIDATE', 80),
    face_reason: safeText(req.query.face_reason || '', 240),
    bytes: buf.length,
    image_url: '/edu/face/latest.jpg',
    created_at: nowIso(),
    lesson: VERSION
  };
  const shots = readJson('face_snapshots.json', []);
  const next = Array.isArray(shots) ? shots : [];
  next.unshift(rec);
  writeJson('face_snapshots.json', next.slice(0, 30));
  res.json({ ok:true, version:VERSION, snapshot:rec, count:next.length });
});

app.get('/edu/face/latest.jpg', (_req, res) => {
  const f = p('edu_face_latest.jpg');
  if (!fs.existsSync(f)) return res.status(404).send('no latest image');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(f);
});

app.get('/edu/face-gate/state', (_req, res) => {
  const shots = readJson('face_snapshots.json', []);
  res.json({
    ok:true,
    version:VERSION,
    lesson:'V8A2_REAL_HUMAN_FACE_GATE_SKIP_UPLOAD',
    rule:'ESP32 runs real human_face_detect / FACE_GATE; FACE_GATE_SKIP does not upload; Railway rejects PASS with face_count=0.',
    latest: latestSnapshot(),
    snapshot_count: Array.isArray(shots) ? shots.length : 0
  });
});

app.get('/edu/face/latest-meta', (_req, res) => {
  const shots = readJson('face_snapshots.json', []);
  res.json({ ok:true, version:VERSION, latest:latestSnapshot(), snapshots:Array.isArray(shots) ? shots.slice(0,5) : [] });
});

app.get('/edu/face/db', (_req, res) => res.json({ ok:true, version:VERSION, faces:faceDb() }));
app.post('/edu/face/db/clear', (_req, res) => { writeFaceDb([]); res.json({ ok:true, version:VERSION, count:0 }); });

app.post('/edu/face/register', express.json({ limit:'1mb' }), (req, res) => {
  const body = req.body || {};
  const person_name = safeText(body.person_name || body.name || '', 60).trim();
  const master_uid = normalizeUid(body.master_uid || '');
  if (!person_name) return res.status(400).json({ ok:false, version:VERSION, error:'missing person_name' });
  if (!master_uid) return res.status(400).json({ ok:false, version:VERSION, error:'missing master_uid' });
  const latest = latestSnapshot();
  if (!latest) return res.status(409).json({ ok:false, version:VERSION, error:'NO_LATEST_CANDIDATE_SNAPSHOT' });
  if (latest.master_uid && latest.master_uid !== master_uid) return res.status(409).json({ ok:false, version:VERSION, error:'SNAPSHOT_UID_MISMATCH', latest_uid:latest.master_uid, master_uid });
  if (String(latest.face_gate || '').toUpperCase() !== 'PASS' || Number(latest.face_count || 0) <= 0) return res.status(409).json({ ok:false, version:VERSION, error:'LATEST_NOT_FACE_GATE_PASS', latest });
  const db = faceDb();
  const existed = db.find(f => String(f.person_name || '') === person_name && String(f.master_uid || '') === master_uid);
  const rec = {
    face_id: 'FACE-' + Date.now().toString(36).toUpperCase(),
    person_name,
    community_id: latest.community_id || '',
    community_name: latest.community_name || '',
    master_uid,
    snapshot_id: latest.snapshot_id,
    image_url: latest.image_url || '/edu/face/latest.jpg',
    bytes: latest.bytes || 0,
    face_gate: latest.face_gate,
    face_count: latest.face_count,
    face_reason: latest.face_reason || '',
    fingerprint: fingerprint(latest),
    created_at: nowIso(),
    lesson: VERSION
  };
  db.unshift(rec);
  writeFaceDb(db);
  res.json({ ok:true, version:VERSION, face:rec, count:db.length, existed:!!existed, existed_face_id: existed ? existed.face_id : '' });
});

app.get('/edu/face-snapshot', (_req, res) => {
  const latest = latestSnapshot();
  const shots = readJson('face_snapshots.json', []);
  const latestHtml = latest ? '<div class="meta">最新 Snapshot：' + htmlEscape(latest.snapshot_id) + '｜來源：' + htmlEscape(latest.source) + '｜bytes：' + htmlEscape(latest.bytes) + '｜時間：' + htmlEscape(latest.created_at) + '</div><img src="/edu/face/latest.jpg?_=' + Date.now() + '">' : '<p>尚未收到 Snapshot。</p>';
  const rows = (Array.isArray(shots) ? shots : []).map(s => '<tr><td>'+htmlEscape(s.snapshot_id)+'</td><td>'+htmlEscape(s.community_name)+'</td><td>'+htmlEscape(s.master_uid)+'</td><td>'+htmlEscape(s.source)+'</td><td>'+htmlEscape(s.bytes)+'</td><td>'+htmlEscape(s.created_at)+'</td></tr>').join('') || '<tr><td colspan="6">尚無資料</td></tr>';
  res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+VERSION+'</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}img{max-width:100%;border-radius:12px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:9px;text-align:left}.meta{color:#617085;margin:8px 0}</style></head><body><div class="wrap"><h1>RT7 EDU FACE SNAPSHOT V9D1</h1><p><a href="/edu/face-recognition">第九堂註冊頁</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a></p><div class="card"><h2>最新照片</h2>'+latestHtml+'</div><div class="card"><h2>Snapshot Records</h2><table><thead><tr><th>Snapshot ID</th><th>Community</th><th>Master UID</th><th>Source</th><th>Bytes</th><th>Time</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></body></html>');
});

app.get('/edu/face-recognition', (_req, res) => {
  const html = [
'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>' + VERSION + '</title>',
'<style>',
'body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:920px;margin:auto;padding:18px}',
'.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}',
'button.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:220px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}',
'table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:9px;text-align:left}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto}',
'</style></head><body><div class="wrap">',
'<h1>RT7 EDU FACE RECOGNITION V9D1</h1>',
'<div class="meta">第九堂：Real Face Register / Railway Syntax Fix</div>',
'<p><a href="/edu/face-snapshot">第八堂 Snapshot</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a> ｜ <a href="/edu/face/latest-meta">latest-meta</a></p>',
'<div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2><div id="latestBox">讀取中...</div></div>',
'<div class="card"><h2>2. 註冊人臉</h2><p>先用 ESP32 輸入 <b>s</b> 上傳 FACE_GATE_PASS 照片，再在這裡輸入姓名註冊。</p><select id="master_uid"></select><input id="person_name" placeholder="姓名，例如：小艾"><button onclick="registerFace()">註冊目前 Candidate</button><button class="red" onclick="clearDb()">清除 Face DB</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div>',
'<div class="card"><h2>3. Face DB</h2><table><thead><tr><th>Face ID</th><th>Name</th><th>Community</th><th>UID</th><th>Snapshot</th><th>Bytes</th><th>Time</th></tr></thead><tbody id="faceRows"><tr><td colspan="7">讀取中...</td></tr></tbody></table></div>',
'<div class="card"><h2>4. 第九堂觀察重點</h2><pre>FACE_GATE_PASS Snapshot\\n↓\\n手機輸入姓名\\n↓\\nPOST /edu/face/register\\n↓\\nRailway 寫入 edu_face_db.json\\n↓\\nFace DB 顯示註冊資料\\n\\n本堂不做 Face Match，不開門。</pre></div>',
'</div><script>',
'let latestSnapshot=null;',
'function setStatus(cls,msg){statusBox.className="status "+cls;statusBox.textContent=msg;}',
'function esc(s){return String(s||"").replace(/[&<>"\\\']/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\\\'":"&#39;"}[m];});}',
'async function loadLatest(){const r=await fetch("/edu/face-gate/state?_="+Date.now());const j=await r.json();latestSnapshot=j.latest||null;result.textContent=JSON.stringify(j,null,2);if(latestSnapshot&&latestSnapshot.face_gate==="PASS"&&Number(latestSnapshot.face_count||0)>0){latestBox.innerHTML="<div class=\\"meta\\">最新 Candidate："+esc(latestSnapshot.snapshot_id)+"｜"+esc(latestSnapshot.community_name)+"｜face_gate="+esc(latestSnapshot.face_gate)+"｜face_count="+esc(latestSnapshot.face_count)+"｜bytes="+esc(latestSnapshot.bytes)+"｜"+esc(latestSnapshot.created_at)+"</div><img src=\\"/edu/face/latest.jpg?_="+Date.now()+"\\">";master_uid.innerHTML="<option value=\\""+esc(latestSnapshot.master_uid)+"\\">"+esc(latestSnapshot.community_name||"最新 Snapshot")+" ("+esc(latestSnapshot.master_uid)+")</option>";setStatus("ok","✅ 已讀到 FACE_GATE_PASS Candidate，可輸入姓名註冊");}else{latestBox.innerHTML="<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>";master_uid.innerHTML="";setStatus("warn","⚠️ 尚未收到 Candidate，請先在 ESP32 串口輸入 s");}}',
'async function loadDb(){const r=await fetch("/edu/face/db?_="+Date.now());const j=await r.json();const faces=j.faces||[];faceRows.innerHTML=faces.length?faces.map(function(f){return "<tr><td>"+esc(f.face_id)+"</td><td><b>"+esc(f.person_name)+"</b></td><td>"+esc(f.community_name)+"</td><td>"+esc(f.master_uid)+"</td><td>"+esc(f.snapshot_id)+"</td><td>"+esc(f.bytes)+"</td><td>"+esc(f.created_at)+"</td></tr>";}).join(""):"<tr><td colspan=\\"7\\">尚未註冊</td></tr>";}',
'async function registerFace(){const name=person_name.value.trim();if(!name){setStatus("err","❌ 請先輸入姓名");person_name.focus();return;}if(!master_uid.value){setStatus("err","❌ 尚未讀到 Candidate Snapshot");return;}setStatus("warn","⏳ 註冊中...");try{const r=await fetch("/edu/face/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({master_uid:master_uid.value,person_name:name})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok){setStatus(j.existed?"warn":"ok",(j.existed?"⚠️ 同名資料已存在，已新增：":"✅ 人臉註冊成功：")+j.face.person_name+" / "+j.face.face_id);await loadDb();}else setStatus("err","❌ 註冊失敗："+(j.error||"UNKNOWN"));}catch(e){result.textContent=String(e);setStatus("err","❌ 註冊失敗：網路或伺服器錯誤");}}',
'async function clearDb(){if(!confirm("清除 Face DB?"))return;const r=await fetch("/edu/face/db/clear",{method:"POST"});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus("ok","✅ Face DB 已清除");await loadDb();}',
'loadLatest().then(loadDb);',
'</script></body></html>'
  ].join('');
  res.type('html').send(html);
});


// ===== V9D2: restore Lesson 2 community register routes =====
function rt7V9D2Communities_() {
  const arr = readJson('communities.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V9D2WriteCommunities_(arr) {
  writeJson('communities.json', Array.isArray(arr) ? arr.slice(0, 50) : []);
}

app.post('/edu/community/register', express.json({limit:'1mb'}), (req, res) => {
  const body = req.body || {};
  const community_name = safeText(body.community_name || body.name || 'A社區', 60).trim() || 'A社區';
  const master_uid = normalizeUid(body.master_uid || 'RT7-MASTER-68F2299FC114');
  const community_id = 'COMM-' + community_name + '-' + Date.now().toString(36).toUpperCase();
  const rec = {
    community_id,
    community_name,
    master_uid,
    created_at: nowIso(),
    lesson: VERSION
  };
  const list = rt7V9D2Communities_().filter(c => c.master_uid !== master_uid);
  list.unshift(rec);
  rt7V9D2WriteCommunities_(list);
  res.json({ ok:true, version:VERSION, community:rec, count:list.length });
});

app.get('/edu/community/register', (_req, res) => {
  const communities = rt7V9D2Communities_();
  const rows = communities.map(c => '<tr><td>'+htmlEscape(c.community_id)+'</td><td><b>'+htmlEscape(c.community_name)+'</b></td><td>'+htmlEscape(c.master_uid)+'</td><td>'+htmlEscape(c.created_at)+'</td></tr>').join('') || '<tr><td colspan="4">尚未註冊</td></tr>';
  const html = [
'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>'+VERSION+'</title>',
'<style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}input{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:260px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:9px;text-align:left}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto}.ok{background:#e8fff2;color:#08783e;font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.err{background:#ffecec;color:#a11212;font-weight:800;border-radius:10px;padding:12px;margin-top:10px}</style>',
'</head><body><div class="wrap">',
'<h1>RT7 EDU COMMUNITY REGISTER</h1>',
'<div>第二堂：社區註冊 / V9D2 restored route</div>',
'<p><a href="/edu/face-recognition">第九堂人臉註冊</a> ｜ <a href="/edu/face-snapshot">Snapshot</a> ｜ <a href="/health">health</a></p>',
'<div class="card"><h2>1. 註冊社區</h2>',
'<input id="community_name" value="A社區" placeholder="社區名稱，例如：A社區">',
'<input id="master_uid" value="RT7-MASTER-68F2299FC114" placeholder="Master UID">',
'<button onclick="registerCommunity()">註冊 / 綁定</button>',
'<div id="status" class="ok">READY</div><pre id="result">READY</pre></div>',
'<div class="card"><h2>2. Communities</h2><table><thead><tr><th>Community ID</th><th>Name</th><th>Master UID</th><th>Time</th></tr></thead><tbody>'+rows+'</tbody></table></div>',
'</div><script>',
'async function registerCommunity(){status.className="ok";status.textContent="⏳ 註冊中...";const r=await fetch("/edu/community/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({community_name:community_name.value,master_uid:master_uid.value})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok){status.textContent="✅ 社區註冊成功："+j.community.community_name;setTimeout(()=>location.reload(),800)}else{status.className="err";status.textContent="❌ 註冊失敗："+(j.error||"UNKNOWN")}}',
'</script></body></html>'
  ].join('');
  res.type('html').send(html);
});

app.get('/edu/register', (_req, res) => res.redirect('/edu/community/register'));

app.listen(PORT, () => console.log(VERSION + ' listening on ' + PORT));
