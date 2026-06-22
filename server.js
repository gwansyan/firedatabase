// RT7_EDU_PRODUCTION_FACE_MATCH_OPENAI_LIVENESS_V12B_TWO_STEP_CHALLENGE
// 第五堂課：開門控制 / Command Queue
// 保留第一堂 Heartbeat、第二堂 Community Register、第三堂 Login Auth
// 新增 API: POST /edu/command/open-door, GET /edu/master/command, POST /edu/master/command/ack

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const webPush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const VERSION = 'RT7_EDU_PRODUCTION_FACE_MATCH_OPENAI_LIVENESS_V12B_TWO_STEP_CHALLENGE';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:teacher@example.com';
let VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
let VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  const keys = webPush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = keys.publicKey;
  VAPID_PRIVATE_KEY = keys.privateKey;
  console.log('[EDU][V7][PUSH] generated temporary VAPID keys. Subscriptions reset after redeploy.');
}
webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
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
ensureFile('push_subscriptions.json', []);
ensureFile('face_snapshots.json', []);

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



function getPushSubscriptions() {
  return readJson('push_subscriptions.json', []);
}
function savePushSubscriptions(list) {
  writeJson('push_subscriptions.json', list);
}
function subscriptionKey(sub) {
  return sub && sub.endpoint ? String(sub.endpoint) : '';
}
async function sendDoorbellPush(event) {
  let subs = getPushSubscriptions();
  if (!subs.length) {
    console.log('[EDU][V7][PUSH] no subscriptions');
    return { sent: 0, failed: 0 };
  }
  const payload = JSON.stringify({
    title: 'RT7 EDU 門鈴通知',
    body: (event.community_name ? event.community_name + '：' : '') + '有人按門鈴',
    tag: event.event_id,
    url: '/edu/push',
    event_id: event.event_id,
    community_name: event.community_name,
    master_uid: event.master_uid,
    created_at: event.created_at
  });
  let sent = 0, failed = 0;
  const alive = [];
  for (const sub of subs) {
    try {
      await webPush.sendNotification(sub.subscription, payload);
      sent++;
      alive.push(sub);
    } catch (e) {
      failed++;
      const code = e && (e.statusCode || e.status);
      console.log('[EDU][V7][PUSH_FAIL]', code || '', e && e.message ? e.message : e);
      if (code !== 404 && code !== 410) alive.push(sub);
    }
  }
  if (alive.length !== subs.length) savePushSubscriptions(alive);
  console.log('[EDU][V7][PUSH_SENT]', 'sent=' + sent, 'failed=' + failed);
  return { sent, failed };
}

// 第四堂：門鈴事件。ESP32 按 GPIO38 後 POST 到這裡。
app.post('/edu/event/doorbell', async (req, res) => {
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
  const push = await sendDoorbellPush(event);
  res.json({ ok: true, version: VERSION, event, count: events.length, push });
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


app.get('/edu/push/vapid-public-key', (_req, res) => {
  res.json({ ok: true, version: VERSION, publicKey: VAPID_PUBLIC_KEY });
});

app.post('/edu/push/subscribe', (req, res) => {
  const body = req.body || {};
  const sub = body.subscription || body;
  const endpoint = subscriptionKey(sub);
  if (!endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ ok: false, error: 'invalid subscription' });
  let list = getPushSubscriptions();
  list = list.filter(x => subscriptionKey(x.subscription) !== endpoint);
  const item = {
    subscription: sub,
    community_id: safeText(body.community_id || '', 120),
    user_agent: safeText(req.headers['user-agent'] || '', 180),
    created_at: nowIso(),
    last_seen: nowIso(),
    lesson: VERSION
  };
  list.unshift(item);
  list = list.slice(0, 50);
  savePushSubscriptions(list);
  console.log('[EDU][V7][PUSH_SUBSCRIBE]', endpoint.slice(0, 60));
  res.json({ ok: true, version: VERSION, count: list.length });
});

app.get('/edu/push/subscriptions', (_req, res) => {
  const list = getPushSubscriptions().map((x, i) => ({
    index: i + 1,
    endpoint: subscriptionKey(x.subscription).slice(0, 80) + '...',
    community_id: x.community_id || '',
    created_at: x.created_at,
    last_seen: x.last_seen || ''
  }));
  res.json({ ok: true, version: VERSION, count: list.length, subscriptions: list });
});

app.delete('/edu/push/subscriptions', (_req, res) => {
  const before = getPushSubscriptions();
  savePushSubscriptions([]);
  res.json({ ok: true, version: VERSION, deleted: before.length });
});

app.post('/edu/push/test', async (_req, res) => {
  const event = {
    event_id: 'PUSH-TEST-' + Date.now().toString(36).toUpperCase(),
    community_name: 'RT7 EDU',
    master_uid: 'TEST',
    created_at: nowIso()
  };
  const push = await sendDoorbellPush(event);
  res.json({ ok: true, version: VERSION, push });
});

app.get('/edu/push/sw.js', (_req, res) => {
  res.type('application/javascript').send(`
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'RT7 EDU', body: event.data ? event.data.text() : '通知' }; }
  const title = data.title || 'RT7 EDU 門鈴通知';
  const options = {
    body: data.body || '有人按門鈴',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || data.event_id || 'rt7-edu-doorbell',
    data: { url: data.url || '/edu/push' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/edu/push';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) { if ('focus' in client) return client.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
`);
});


// 第九堂：ESP32 Camera Snapshot。ESP32 拍照後 POST JPEG 到 Railway，手機頁面顯示最新照片。
function latestSnapshotPath() {
  return path.join(DATA_DIR, 'latest_face_snapshot.jpg');
}
function snapshotPublicUrl() {
  return '/edu/face/latest.jpg?ts=' + Date.now();
}
app.post('/edu/face/snapshot', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '3mb' }), (req, res) => {
  const master_uid = normalizeUid(req.query.master_uid || req.headers['x-master-uid'] || '');
  const source = safeText(req.query.source || req.headers['x-source'] || 'ESP32', 20).toUpperCase();
  const faceGateParam = String(req.query.face_gate || req.headers['x-face-gate'] || '').toUpperCase();
  if (faceGateParam && faceGateParam !== 'PASS') {
    return res.status(409).json({ ok:false, version: VERSION, error:'FACE_GATE_NOT_PASS', face_gate: faceGateParam, note:'V8A1 only accepts candidate snapshots after ESP32 FACE_GATE_PASS.' });
  }
  const faceCountParam = Number(req.query.face_count || req.headers['x-face-count'] || 0);
  if ((faceGateParam || 'PASS') === 'PASS' && faceCountParam <= 0) {
    return res.status(409).json({ ok:false, version: VERSION, error:'FACE_GATE_PASS_BUT_FACE_COUNT_ZERO', face_gate: faceGateParam || 'PASS', face_count: faceCountParam, note:'V8A2 rejects contradictory PASS with zero face count.' });
  }
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid query or X-Master-UID header' });
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!buf.length) return res.status(400).json({ ok: false, error: 'empty jpeg body' });
  if (buf.length < 1000) return res.status(400).json({ ok: false, error: 'jpeg too small', bytes: buf.length });
  fs.writeFileSync(latestSnapshotPath(), buf);
  const communities = readJson('communities.json', []);
  const community = communities.find(c => c.master_uid === master_uid) || null;
  let shots = readJson('face_snapshots.json', []);
  const shot = {
    snapshot_id: 'SNAP-' + Date.now().toString(36).toUpperCase(),
    type: 'FACE_SNAPSHOT',
    master_uid,
    community_id: community ? community.community_id : '',
    community_name: community ? community.community_name : '',
    source,
    face_gate: faceGateParam || 'PASS',
    face_found: faceCountParam > 0,
    face_count: faceCountParam,
    face_quality: safeText(req.query.face_quality || req.headers['x-face-quality'] || '', 40),
    face_reason: safeText(req.query.face_reason || req.headers['x-face-reason'] || 'ESP32_HUMAN_FACE_GATE_PASS', 80),
    bytes: buf.length,
    image_url: '/edu/face/latest.jpg',
    created_at: nowIso(),
    lesson: VERSION
  };
  shots.unshift(shot);
  shots = shots.slice(0, 30);
  writeJson('face_snapshots.json', shots);
  console.log('[EDU][V8][FACE_SNAPSHOT]', shot.snapshot_id, 'bytes=' + buf.length, master_uid);
  res.json({ ok: true, version: VERSION, snapshot: shot, count: shots.length });
});

// 教學用：瀏覽器模擬 snapshot，方便沒有接 ESP32 Camera 時先測 UI。
app.post('/edu/face/snapshot/sim', (req, res) => {
  const body = req.body || {};
  let master_uid = normalizeUid(body.master_uid || '');
  if (!master_uid) {
    const communities = readJson('communities.json', []);
    if (communities[0]) master_uid = normalizeUid(communities[0].master_uid);
  }
  if (!master_uid) return res.status(400).json({ ok: false, error: 'missing master_uid. Please run heartbeat and register community first.' });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#dbeafe"/><circle cx="320" cy="210" r="90" fill="#f8c9a8"/><circle cx="285" cy="190" r="10" fill="#111827"/><circle cx="355" cy="190" r="10" fill="#111827"/><path d="M285 255 Q320 285 355 255" stroke="#111827" stroke-width="8" fill="none" stroke-linecap="round"/><text x="320" y="390" text-anchor="middle" font-size="34" font-family="Arial" fill="#0f172a">RT7 EDU FACE SNAPSHOT V8B REAL FACE DETECT GATE</text><text x="320" y="430" text-anchor="middle" font-size="20" font-family="Arial" fill="#475569">${nowIso()}</text></svg>`;
  fs.writeFileSync(latestSnapshotPath(), Buffer.from(svg));
  const communities = readJson('communities.json', []);
  const community = communities.find(c => c.master_uid === master_uid) || null;
  let shots = readJson('face_snapshots.json', []);
  const shot = { snapshot_id: 'SNAP-' + Date.now().toString(36).toUpperCase(), type:'FACE_SNAPSHOT_SIM', master_uid, community_id: community?community.community_id:'', community_name: community?community.community_name:'', source:'SIM', bytes: Buffer.byteLength(svg), image_url:'/edu/face/latest.jpg', created_at: nowIso(), lesson: VERSION };
  shots.unshift(shot); shots = shots.slice(0,30); writeJson('face_snapshots.json', shots);
  res.json({ ok:true, version: VERSION, snapshot: shot, count: shots.length });
});

app.get('/edu/face/latest.jpg', (_req, res) => {
  const f = latestSnapshotPath();
  if (!fs.existsSync(f)) return res.status(404).send('No snapshot yet');
  const b = fs.readFileSync(f);
  const isSvg = b.slice(0, 20).toString().includes('<svg');
  res.type(isSvg ? 'image/svg+xml' : 'image/jpeg').send(b);
});


app.get('/edu/face-gate/state', (_req, res) => {
  const shots = readJson('face_snapshots.json', []);
  const latest = shots[0] || null;
  res.json({
    ok: true,
    version: VERSION,
    lesson: 'V8A2_REAL_HUMAN_FACE_GATE_SKIP_UPLOAD',
    rule: 'ESP32 runs real human_face_detect / FACE_GATE; FACE_GATE_SKIP does not upload; Railway rejects PASS with face_count=0.',
    latest,
    snapshot_count: shots.length
  });
});

app.get('/edu/face/snapshots', (_req, res) => {
  res.json({ ok: true, version: VERSION, snapshots: readJson('face_snapshots.json', []) });
});

app.delete('/edu/face/snapshots', (_req, res) => {
  const before = readJson('face_snapshots.json', []);
  writeJson('face_snapshots.json', []);
  const f = latestSnapshotPath();
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true, version: VERSION, deleted: before.length });
});

app.get('/edu/face-snapshot', (_req, res) => res.send(renderFaceSnapshotPage()));

function renderEduPage() {
return String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU Node-RED Flow V6</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1120px;margin:20px auto;padding:16px}.card{background:white;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}input,select,button{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px;box-sizing:border-box}button{background:#0b9b5a;color:#fff;border:0;cursor:pointer}.danger{background:#c0392b}.blue{background:#0b6fa4}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;font-size:14px;line-height:1.55}.uidbox{background:#f8fafc;font-family:ui-monospace,Consolas,monospace}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}.step{font-weight:bold;color:#0b5f8a}.loginok{background:#effaf4;border-left:5px solid #0b9b5a}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU NODE-RED FLOW V6</h1>
<p><span class="tag">第六堂課</span> Node-RED Flow / Railway Observer / IoT Dashboard</p>
<p><button class="blue" onclick="location.href='/edu/community/register'">第二堂社區註冊</button> <button class="blue" onclick="location.href='/edu/login'">第三堂登入驗證</button> <button class="blue" onclick="location.href='/edu/doorbell'">第四堂門鈴事件</button> <button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button> <button class="blue" onclick="location.href='/edu/node-red'">第六堂 Node-RED Flow</button> <button class="blue" onclick="location.href='/edu/push'">第七堂手機推播</button> <button class="blue" onclick="location.href='/edu/face-snapshot'">第九堂 REAL FACE_DETECT Snapshot</button></p>
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
async function sendHeartbeat(){syncSimUid(); out(await post('/edu/master/heartbeat',{master_uid:h_uid.value,ip:h_ip.value,mac:h_mac.value,source:'SIM',lesson:'NODE_RED_FLOW_V6'})); await load();}
async function simulateDoorbell(){var masters=Object.values((STATE&&STATE.masters)||{}); var uid=masters[0]?masters[0].master_uid:''; if(!uid){out({ok:false,error:'請先送出 heartbeat'});return;} out(await post('/edu/event/doorbell',{master_uid:uid,source:'SIM'})); await load();}
async function clearDoorbells(){out(await del('/edu/events/doorbell')); await load();}
async function openDoorCmd(){var communities=(STATE&&STATE.communities)||[]; var c=communities[0]; if(!c){out({ok:false,error:'請先完成第二堂社區註冊'});return;} out(await post('/edu/command/open-door',{community_id:c.community_id,source:'WEB'})); await load();}
async function clearCommands(){out(await del('/edu/commands')); await load();}
load(); setInterval(function(){ if(!document.activeElement || document.activeElement.tagName!=='INPUT') load(); },10000);
</script></body></html>`;
}

app.get(['/edu', '/edu/doorbell', '/edu/login', '/edu/open-door'], (_req, res) => { res.type('html').send(renderEduPage()); });
app.get('/edu/node-red', (_req, res) => { res.type('html').send(renderNodeRedPage()); });
app.get('/edu/push', (_req, res) => { res.type('html').send(renderPushPage()); });




function renderPushPage() {
return String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU Push Notify V7</title><style>body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button{font-size:16px;padding:10px;border-radius:8px;border:0;margin:4px;background:#0b9b5a;color:#fff;cursor:pointer}.blue{background:#0b6fa4}.danger{background:#c0392b}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.ok{color:#079b50;font-weight:bold}.bad{color:#d33;font-weight:bold}.hint{color:#64748b;line-height:1.6}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}</style></head><body><div class="wrap"><h1>RT7 EDU PUSH NOTIFY V7</h1><p><span class="tag">第七堂課</span> Web Push / Service Worker / Doorbell Notification</p><p><button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button><button class="blue" onclick="location.href='/edu/node-red'">第六堂 Node-RED</button></p><div class="card"><h2>1. 手機推播啟用</h2><p class="hint">請用手機 Chrome 開啟本頁，按「啟用手機推播」。若瀏覽器詢問通知權限，請按允許。</p><button onclick="enablePush()">啟用手機推播</button><button onclick="testPush()">測試推播</button><button class="danger" onclick="clearSubs()">清除訂閱</button><p id="status" class="hint">READY</p></div><div class="card"><h2>2. 門鈴事件觸發推播</h2><p class="hint">按 ESP32 GPIO38 或按下方模擬按鈕，Railway 寫入 doorbell_events.json，並送出 Web Push。</p><button onclick="simulateDoorbell()">模擬按門鈴</button><button class="blue" onclick="load()">重新整理</button></div><div class="card"><h2>3. Push Subscriptions</h2><div id="subs">載入中...</div></div><div class="card"><h2>4. Doorbell Events</h2><div id="events">載入中...</div></div><div class="card"><h2>5. 課程觀察重點</h2><pre>手機瀏覽器
↓
Service Worker
↓
Push Subscription
↓
Railway 儲存訂閱
↓
ESP32 Doorbell Event
↓
Railway Web Push
↓
手機收到通知</pre></div><div class="card"><h2>回應</h2><pre id="out">READY</pre></div></div><script>
function log(x){document.getElementById('out').textContent=typeof x==='string'?x:JSON.stringify(x,null,2)}
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json()}catch(e){} if(!r.ok)j.http_status=r.status;return j}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data||{})})} async function del(path){return api(path,{method:'DELETE'})}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const rawData=atob(base64);const outputArray=new Uint8Array(rawData.length);for(let i=0;i<rawData.length;++i)outputArray[i]=rawData.charCodeAt(i);return outputArray}
async function enablePush(){try{if(!('serviceWorker' in navigator))throw new Error('此瀏覽器不支援 Service Worker'); if(!('PushManager' in window))throw new Error('此瀏覽器不支援 Push API'); const perm=await Notification.requestPermission(); if(perm!=='granted')throw new Error('通知權限未允許：'+perm); const reg=await navigator.serviceWorker.register('/edu/push/sw.js'); await navigator.serviceWorker.ready; const key=(await api('/edu/push/vapid-public-key')).publicKey; const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)}); const r=await post('/edu/push/subscribe',{subscription:sub}); document.getElementById('status').innerHTML='<span class="ok">推播已啟用</span>'; log(r); await load();}catch(e){document.getElementById('status').innerHTML='<span class="bad">'+esc(e.message||e)+'</span>'; log(String(e.stack||e));}}
async function testPush(){log(await post('/edu/push/test',{})); setTimeout(load,800)}
async function clearSubs(){log(await del('/edu/push/subscriptions')); await load()}
async function simulateDoorbell(){const s=await api('/edu/state'); const m=Object.values(s.masters||{})[0]; if(!m){log({ok:false,error:'請先讓 ESP32 heartbeat 上線'});return} log(await post('/edu/event/doorbell',{master_uid:m.master_uid,source:'SIM'})); setTimeout(load,800)}
async function load(){const subs=await api('/edu/push/subscriptions'); document.getElementById('subs').innerHTML='<p>訂閱數：<b>'+esc(subs.count||0)+'</b></p><pre>'+esc(JSON.stringify(subs.subscriptions||[],null,2))+'</pre>'; const ev=await api('/edu/events/doorbell'); const rows=(ev.events||[]).slice(0,8).map(e=>'<tr><td>'+esc(e.event_id)+'</td><td>'+esc(e.message)+'</td><td>'+esc(e.community_name)+'</td><td>'+esc(e.source)+'</td><td>'+esc(e.created_at)+'</td></tr>').join(''); document.getElementById('events').innerHTML='<table><tr><th>Event ID</th><th>訊息</th><th>Community</th><th>來源</th><th>時間</th></tr>'+rows+'</table>'}
load(); setInterval(load,10000);
</script></body></html>`;
}

function renderNodeRedPage() {
return String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU Node-RED Flow V6</title><style>body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}code,pre{background:#f5f7f8;padding:10px;border-radius:8px;display:block;overflow:auto}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.blue{background:#0b6fa4;color:#fff;border:0;border-radius:8px;padding:10px;margin:4px;cursor:pointer}.ok{color:#079b50;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 EDU NODE-RED FLOW V6</h1><p><span class="tag">第六堂課</span> Node-RED Flow / Railway Observer</p><p><button class="blue" onclick="location.href='/edu/open-door'">回第五堂開門控制</button></p><div class="card"><h2>1. 匯入 Flow</h2><p>Node-RED 選單 → Import → Clipboard，貼上專案內：</p><pre>node-red/RT7_EDU_PRODUCTION_FACE_MATCH_OPENAI_LIVENESS_V12B_TWO_STEP_CHALLENGE_OBSERVER_FLOW.json</pre></div><div class="card"><h2>2. Flow 觀察目標</h2><pre>Heartbeat → Master Registry
Doorbell → doorbell_events.json
Open Door → commands.json
ACK → DONE
/edu/state → Dashboard Observer</pre></div><div class="card"><h2>3. Railway API</h2><pre>GET  /health
GET  /edu/state
POST /edu/master/heartbeat
POST /edu/event/doorbell
POST /edu/command/open-door
GET  /edu/commands
GET  /edu/events/doorbell</pre></div><div class="card"><h2>4. 課程定位</h2><pre>第一堂 Heartbeat
第二堂 Community Register
第三堂 Login Auth
第四堂 Doorbell Event
第五堂 Open Door Command Queue
第六堂 Node-RED Flow</pre><p class="ok">V6 不改 ESP32 控制邏輯，只新增 Node-RED 教學觀察 Flow。</p></div></div></body></html>`;
}

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


function renderFaceSnapshotPage() {
return String.raw`<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 EDU FACE SNAPSHOT V8B REAL FACE DETECT GATE</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1040px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,select{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:white;border:0}.blue{background:#0b6fa4}.danger{background:#c0392b}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.hint{color:#64748b;line-height:1.6}.ok{color:#079b50;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}img.snap{width:100%;max-width:640px;border-radius:12px;border:1px solid #d8e1e7;background:#f8fafc}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU FACE SNAPSHOT V8B REAL FACE DETECT GATE</h1>
<p><span class="tag">第九堂課</span> ESP32 Camera / human_face_detect / FACE_GATE / Candidate Snapshot / Railway</p>
<p><button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button><button class="blue" onclick="location.href='/edu/push'">第七堂手機推播</button><button class="blue" onclick="location.href='/edu/face-snapshot'">第九堂 REAL FACE_DETECT Snapshot</button></p>
<div id="app">載入中...</div>
</div>
<script>
async function api(path,opt){const r=await fetch(path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));let j={};try{j=await r.json();}catch(e){j={text:await r.text()}} if(!r.ok)j.http_status=r.status;return j;}
async function post(path,data){return api(path,{method:'POST',body:JSON.stringify(data)});} async function del(path){return api(path,{method:'DELETE'});} function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let STATE={}; function options(list){ if(!list.length)return '<option value="">請先完成第二堂：社區註冊</option>'; return list.map(c=>'<option value="'+esc(c.master_uid)+'">'+esc(c.community_name)+' ('+esc(c.master_uid)+')</option>').join(''); }
async function load(){ const s=await api('/edu/state'); const f=await api('/edu/face/snapshots'); STATE=s; const communities=s.communities||[]; const shots=f.snapshots||[]; const latest=shots[0]; let h='';
 h+='<div class="card"><h2>1. Snapshot 測試</h2><p class="hint">ESP32 Camera 拍照後，POST JPEG 到 <b>/edu/face/snapshot</b>，Railway 儲存最新照片，手機頁面讀取 <b>/edu/face/latest.jpg</b>。</p><select id="master_uid">'+options(communities)+'</select><button onclick="simSnap()">模擬 Snapshot</button><button class="danger" onclick="clearSnaps()">清除照片</button><p id="msg" class="ok"></p></div>';
 h+='<div class="card"><h2>2. 手機顯示最新照片</h2>';
 if(latest){ h+='<p class="hint">最新 Snapshot：'+esc(latest.snapshot_id)+'｜來源：'+esc(latest.source)+'｜bytes：'+esc(latest.bytes)+'｜時間：'+esc(latest.created_at)+'</p><img class="snap" src="/edu/face/latest.jpg?ts='+Date.now()+'">'; } else { h+='<p class="hint">尚未收到 Snapshot。可先按「模擬 Snapshot」，或燒錄 V8 ESP32 Camera 程式。</p>'; }
 h+='</div>';
 h+='<div class="card"><h2>3. Snapshot Records</h2><table><tr><th>Snapshot ID</th><th>Community</th><th>Master UID</th><th>Source</th><th>Bytes</th><th>Time</th></tr>';
 if(!shots.length) h+='<tr><td colspan="6" class="hint">尚無資料</td></tr>'; else shots.slice(0,10).forEach(x=>{h+='<tr><td>'+esc(x.snapshot_id)+'</td><td>'+esc(x.community_name)+'<br><span class="hint">'+esc(x.community_id)+'</span></td><td>'+esc(x.master_uid)+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.bytes)+'</td><td>'+esc(x.created_at)+'</td></tr>';});
 h+='</table></div>';
 h+='<div class="card warn"><h2>4. 第九堂觀察重點</h2><pre>ESP32 Camera\n↓\nSnapshot JPEG\n↓\nPOST /edu/face/snapshot\n↓\nRailway latest_face_snapshot.jpg\n↓\n手機網頁顯示照片\n\n下一堂才加入：Face Register / Face Match / Liveness</pre></div>';
 document.getElementById('app').innerHTML=h; }
async function simSnap(){ const uid=document.getElementById('master_uid').value; const r=await post('/edu/face/snapshot/sim',{master_uid:uid}); document.getElementById('msg').textContent=r.ok?'模擬 Snapshot 成功':'失敗：'+(r.error||r.http_status); await load(); }
async function clearSnaps(){ if(!confirm('清除 snapshot records?'))return; await del('/edu/face/snapshots'); await load(); }
load(); setInterval(load,5000);
</script>
</body></html>`;
}


// =====================================================
// Lesson 14: AI Voice Assistant (Phone MIC/SPEAKER + ESP32 Snapshot Vision)
// Non-destructive addon: keeps Lesson 1~13 / V12B routes unchanged.
// Page: /edu/ai-voice-assistant
// API : POST /api/v14/voice/camera-qa  { question }
// =====================================================

function rt7V14EscapeHtml_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
}
function rt7V14FindLatestSnapshotFile_() {
  const candidates = [
    path.join(DATA_DIR, 'latest_face_snapshot.jpg'),
    path.join(DATA_DIR, 'latest_snapshot.jpg'),
    path.join(DATA_DIR, 'rt7_latest_snapshot.jpg')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p) && fs.statSync(p).size > 1000) return p; } catch (_) {}
  }
  return '';
}
function rt7V14ReadLatestSnapshotMeta_() {
  try {
    const arr = readJson ? readJson('face_snapshots.json', []) : [];
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  } catch (_) {
    try {
      const f = path.join(DATA_DIR, 'face_snapshots.json');
      const arr = JSON.parse(fs.readFileSync(f, 'utf8') || '[]');
      return Array.isArray(arr) && arr.length ? arr[0] : null;
    } catch (__) { return null; }
  }
}
async function rt7V14OpenAIVision_(question, imageBase64) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.RT7_OPENAI_API_KEY || '';
  const model = process.env.RT7_V14_VISION_MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    return {
      ok: true,
      demo: true,
      model: 'DEMO_NO_OPENAI_KEY',
      answer: '這是示範回覆：我看到 ESP32 鏡頭前有人物影像。若要正式辨識畫面內容，請在 Railway Variables 設定 OPENAI_API_KEY。'
    };
  }
  const prompt = String(question || '現在看到什麼？').trim() || '現在看到什麼？';
  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: '你是 RT7 門禁的 AI 語音助理。請用繁體中文、短句回答手機使用者。只描述畫面中可見內容，不要猜測看不到的個人身分。'
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } }
        ]
      }
    ],
    max_tokens: 220
  };
  const started = Date.now();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  let j = {};
  try { j = JSON.parse(text); } catch (_) {}
  const answer = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || '').trim() : '';
  return {
    ok: r.ok && !!answer,
    http_status: r.status,
    model,
    ms: Date.now() - started,
    answer: answer || '',
    error: r.ok ? '' : String((j.error && j.error.message) || text || 'OpenAI request failed').slice(0, 800),
    usage: j.usage || null
  };
}

app.get('/edu/ai-voice-assistant', (_req, res) => {
  res.type('html').send(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><title>RT7 EDU AI Voice Assistant V14D</title><style>
body{margin:0;background:#eef5f7;color:#102330;font-family:system-ui,-apple-system,'Noto Sans TC',sans-serif}.wrap{max-width:980px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}.top{display:flex;gap:8px;flex-wrap:wrap}.top a{background:#1677a8;color:#fff;text-decoration:none;font-weight:900;border-radius:10px;padding:10px 12px}button{border:0;border-radius:14px;background:#079b50;color:white;font-weight:900;padding:14px 18px;margin:6px;font-size:18px}.red{background:#c9342d}.blue{background:#1677a8}.mic{font-size:28px;border-radius:999px;width:96px;height:96px}input,textarea{box-sizing:border-box;width:100%;font-size:18px;padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px 0}img{max-width:100%;border-radius:12px;border:1px solid #ddd;background:#f8fafc}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}.ok{color:#08783e;font-weight:900}.bad{color:#b11111;font-weight:900}.hint{color:#64748b;line-height:1.6}.answer{font-size:22px;font-weight:900;line-height:1.55;background:#f0fff5;border-left:6px solid #079b50;border-radius:14px;padding:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:760px){.grid{grid-template-columns:1fr}.mic{width:86px;height:86px}}
</style></head><body><div class="wrap"><h1>第14堂 AI語音助理 V14D</h1><p class="hint">維持原始 RT7：手機 MIC → Chrome webkitSpeechRecognition → 文字 → Railway Snapshot → OpenAI Vision → 手機 Speaker。</p><div class="top"><a href="/edu/community/register">社區註冊</a><a href="/edu/two-step-liveness">V12B 二步活體</a><a href="/edu/face-snapshot">Snapshot</a><a href="/edu/state">EDU State</a></div><div class="grid"><div class="card"><h2>1. 手機 MIC</h2><p class="hint">請用手機 Chrome 開啟本頁。按「文字詢問」應立即有反應；按麥克風會啟動單次聆聽。</p><button id="btnMic" class="mic" type="button">🎙️</button><button id="btnText" class="blue" type="button">文字詢問</button><button id="btnStop" class="red" type="button">停止播放</button><textarea id="question" rows="3">現在看到什麼？</textarea><div id="micStatus" class="hint">JS 載入中...</div></div><div class="card"><h2>2. 最新 ESP32 Snapshot</h2><img id="snap" src="/edu/face/latest.jpg?_=" onerror="this.style.display='none';document.getElementById('noSnap').style.display='block'"><p id="noSnap" class="bad" style="display:none">尚未收到 snapshot，請先讓 ESP32 上傳 FACE_GATE_PASS Candidate。</p><button id="btnSnap" type="button">重新載入 Snapshot</button></div></div><div class="card"><h2>3. AI 回答</h2><div id="answer" class="answer">尚未詢問</div><pre id="debug">BOOTING</pre></div><div class="card"><h2>4. 測試流程</h2><pre>1. 開頁後狀態應顯示 JS_READY\n2. 先按「文字詢問」確認 API 正常\n3. 再按 🎙️，手機應跳出/使用麥克風權限\n4. 說：現在看到什麼？\n5. Speaker 播放回答</pre></div></div><script>
(function(){
  'use strict';
  var RT7_SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recog = null;
  var listening = false;
  var speechStarted = false;
  var gotSpeechText = false;
  var busy = false;
  var hearTimer = null;
  function el(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[<>&]/g,function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c]; }); }
  function setDebug(x){ var d=el('debug'); if(d) d.textContent = (typeof x === 'string') ? x : JSON.stringify(x,null,2); }
  function appendDebug(x){ var d=el('debug'); if(d) d.textContent = String(d.textContent || '') + '\n' + x; }
  function setStatus(html){ el('micStatus').innerHTML = html; appendDebug('[STATUS] ' + String(html).replace(/<[^>]+>/g,'')); }
  window.addEventListener('error', function(e){ setStatus('<span class="bad">JS 錯誤：'+esc(e.message || e.error || e)+'</span>'); appendDebug('[JS_ERROR] '+(e.message||e)); });
  window.addEventListener('unhandledrejection', function(e){ setStatus('<span class="bad">Promise 錯誤：'+esc((e.reason && e.reason.message) || e.reason || e)+'</span>'); appendDebug('[PROMISE_ERROR] '+((e.reason && e.reason.stack) || e.reason || e)); });
  function reloadSnap(){ var img=el('snap'); el('noSnap').style.display='none'; img.style.display='block'; img.src='/edu/face/latest.jpg?_='+Date.now(); }
  function clearHearTimer(){ if(hearTimer){ clearTimeout(hearTimer); hearTimer=null; } }
  function stopRecognition(){ try{ if(recog) recog.stop(); }catch(e){} listening=false; clearHearTimer(); }
  function stopSpeak(){ try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){} }
  function speak(text){
    try{
      if(!('speechSynthesis' in window)) { appendDebug('[SPEAKER] speechSynthesis not supported'); return; }
      stopRecognition(); window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text || ''));
      u.lang='zh-TW'; u.rate=1.0; u.pitch=1.0;
      u.onstart=function(){ stopRecognition(); };
      window.speechSynthesis.speak(u);
    }catch(e){ appendDebug('[SPEAKER_ERROR] '+(e.stack||e)); }
  }
  async function ask(q){
    q = String(q || (el('question') && el('question').value) || '').trim() || '現在看到什麼？';
    el('question').value = q;
    if(busy){ setStatus('<span class="bad">AI 正在處理，請稍候。</span>'); return; }
    busy = true; stopSpeak(); stopRecognition();
    el('answer').textContent = 'AI 分析中...';
    setStatus('送出問題：<b>'+esc(q)+'</b>');
    try{
      var r = await fetch('/api/v14/voice/camera-qa?_=' + Date.now(), { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question:q}), cache:'no-store' });
      var txt = await r.text();
      var j = {}; try{ j = JSON.parse(txt); }catch(e){ j = { ok:false, error:'NON_JSON', raw:txt, status:r.status }; }
      setDebug(j);
      var ans = j.answer || j.error || '沒有回答';
      el('answer').textContent = ans;
      if(j.ok) speak(ans); else setStatus('<span class="bad">AI 失敗：'+esc(ans)+'</span>');
    }catch(e){ el('answer').textContent = '連線失敗：' + e; setDebug(String(e.stack || e)); }
    finally{ busy = false; }
  }
  function scheduleHearWatchdog(){
    clearHearTimer();
    hearTimer = setTimeout(function(){
      if(listening && !speechStarted && !gotSpeechText){
        stopRecognition();
        setStatus('<span class="bad">沒有聽到聲音。請確認手機 Chrome 麥克風權限，靠近手機再按一次。</span>');
      }
    }, 7000);
  }
  async function checkMicPermission(){
    try{
      if(navigator.permissions && navigator.permissions.query){
        var p = await navigator.permissions.query({name:'microphone'});
        appendDebug('[PERMISSION] microphone=' + (p && p.state));
        if(p && p.state === 'denied') return {ok:false, message:'Chrome 麥克風權限被拒絕，請到網址列鎖頭/設定允許麥克風。'};
      }
    }catch(e){ appendDebug('[PERMISSION] query skipped: '+e); }
    return {ok:true};
  }
  function isVisionQuestion(t){
    t = String(t || '').trim();
    if(!t) return false;
    return /鏡頭|攝影機|畫面|看到|看見|看得到|門口|有人|有沒有人|人物|人臉|燈具|天花板|現在.*什麼|那裡.*什麼|前面.*什麼/.test(t);
  }
  async function startMic(){
    appendDebug('[CLICK] mic');
    if(busy){ setStatus('<span class="bad">AI 正在回答，請稍候。</span>'); return; }
    if(!RT7_SR){ setStatus('<span class="bad">此手機瀏覽器不支援 Web Speech API，請改用手機 Chrome 或文字詢問。</span>'); return; }
    stopSpeak(); stopRecognition();
    var perm = await checkMicPermission();
    if(!perm.ok){ setStatus('<span class="bad">'+esc(perm.message)+'</span>'); return; }
    try{
      recog = new RT7_SR();
      recog.lang = 'zh-TW';
      recog.interimResults = true;
      recog.continuous = false;
      recog.maxAlternatives = 1;
      recog.onstart = function(){ listening=true; speechStarted=false; gotSpeechText=false; scheduleHearWatchdog(); setStatus('<span class="ok">語音單次聆聽中，請現在說：鏡頭現在看到什麼？</span>'); };
      recog.onaudiostart = function(){ setStatus('<span class="ok">麥克風已開啟，請說：鏡頭現在看到什麼？</span>'); };
      recog.onspeechstart = function(){ speechStarted=true; setStatus('<span class="ok">已偵測到語音，正在辨識...</span>'); };
      recog.onspeechend = function(){ try{ recog.stop(); }catch(e){} };
      recog.onnomatch = function(){ listening=false; clearHearTimer(); setStatus('<span class="bad">沒有辨識到文字，請再按一次麥克風。</span>'); };
      recog.onresult = function(ev){
        clearHearTimer();
        var finalText=''; var interimText='';
        for(var i=ev.resultIndex || 0; i<ev.results.length; i++){
          var txt=''; try{ txt = ev.results[i][0].transcript || ''; }catch(e){}
          if(ev.results[i].isFinal) finalText += txt; else interimText += txt;
        }
        if(finalText){ gotSpeechText=true; listening=false; setStatus('辨識完成：<b>'+esc(finalText)+'</b>'); ask(finalText); }
        else if(interimText && isVisionQuestion(interimText)){ gotSpeechText=true; setStatus('正在聽：<b>'+esc(interimText)+'</b>'); }
        else if(interimText){ setStatus('正在聽：'+esc(interimText)); scheduleHearWatchdog(); }
      };
      recog.onerror = function(e){
        clearHearTimer(); listening=false;
        var er = (e && e.error) || 'unknown';
        var msg = 'MIC 錯誤：' + er;
        if(er === 'not-allowed' || er === 'service-not-allowed') msg='瀏覽器擋住麥克風。請允許麥克風後再按一次。';
        if(er === 'no-speech') msg='沒有聽到聲音，請靠近手機再按一次。';
        if(er === 'audio-capture') msg='找不到麥克風或麥克風被其他程式占用。';
        setStatus('<span class="bad">'+esc(msg)+'</span>');
      };
      recog.onend = function(){ listening=false; clearHearTimer(); appendDebug('[MIC] end'); };
      setStatus('MIC 啟動中...');
      recog.start();
    }catch(e){ setStatus('<span class="bad">語音啟動失敗：'+esc(e.message || e)+'</span>'); }
  }
  function bind(){
    el('btnMic').addEventListener('click', startMic);
    el('btnText').addEventListener('click', function(){ appendDebug('[CLICK] text'); ask(el('question').value); });
    el('btnStop').addEventListener('click', function(){ stopSpeak(); stopRecognition(); setStatus('已停止播放/聆聽'); });
    el('btnSnap').addEventListener('click', reloadSnap);
    reloadSnap();
    setDebug('JS_READY V14D\nSpeechRecognition=' + (!!RT7_SR) + '\nprotocol=' + location.protocol + '\nhost=' + location.host);
    setStatus('<span class="ok">JS_READY，請先按「文字詢問」測試。</span>');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
</script></body></html>`);
});

app.post('/api/v14/voice/camera-qa', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const question = String((req.body || {}).question || '現在看到什麼？').trim() || '現在看到什麼？';
    const file = rt7V14FindLatestSnapshotFile_();
    const meta = rt7V14ReadLatestSnapshotMeta_();
    if (!file) return res.status(409).json({ ok:false, version: VERSION, error:'NO_SNAPSHOT', answer:'我還沒有收到 ESP32 的最新照片，請先讓 ESP32 上傳 Snapshot。' });
    const buf = fs.readFileSync(file);
    const result = await rt7V14OpenAIVision_(question, buf.toString('base64'));
    const out = Object.assign({ ok: !!result.ok, version: VERSION, lesson:'RT7_EDU_AI_VOICE_ASSISTANT_V14C_ORIGINAL_SPEECH_RECOGNITION_FIX', question, snapshot_bytes: buf.length, snapshot_meta: meta }, result);
    res.status(out.ok ? 200 : 502).json(out);
  } catch (e) {
    res.status(500).json({ ok:false, version: VERSION, error:String(e && e.message || e), answer:'AI 語音助理發生錯誤。' });
  }
});

app.listen(PORT, () => console.log('[' + VERSION + '] http://localhost:' + PORT + '/edu/push'));


// ===== Lesson 9: Real Face Register =====
// V9 只做註冊：使用 V8B FACE_GATE_PASS 後的 latest snapshot 存入 Face DB。
// 本堂不做 Face Match、不開門。
function rt7EduReadFaceDb_() {
  return readJson('edu_face_db.json', []);
}
function rt7EduWriteFaceDb_(db) {
  writeJson('edu_face_db.json', Array.isArray(db) ? db.slice(0, 80) : []);
}
function rt7EduLatestSnapshot_() {
  const shots = readJson('face_snapshots.json', []);
  return shots && shots.length ? shots[0] : null;
}
function rt7EduFaceFingerprintFromLatest_(snapshot) {
  // V9 註冊階段只保存可追蹤 fingerprint；第十堂才做比對。
  const img = safeReadFile('edu_face_latest.jpg');
  const buf = img && img.length ? img : Buffer.from(String(snapshot && snapshot.snapshot_id || '') + String(snapshot && snapshot.bytes || ''));
  let h = 2166136261;
  for (let i = 0; i < buf.length; i += Math.max(1, Math.floor(buf.length / 512))) {
    h ^= buf[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= (snapshot && snapshot.bytes ? Number(snapshot.bytes) : 0);
  return 'FNV1A-' + (h >>> 0).toString(16).toUpperCase();
}
function safeReadFile(name) {
  try {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch (_) {}
  return null;
}





function getCommunityByMasterUid_(master_uid) {
  const arr = readJson('communities.json', []);
  return arr.find(c => c.master_uid === master_uid) || null;
}


// ===== V9A latest snapshot binding fix =====
// 修正：/edu/face-gate/state 看得到 latest，但 /edu/face-recognition 顯示尚未收到。
// 原因通常是讀取檔名/排序/相容欄位不同。V9A 統一使用同一個 latest resolver。
function rt7EduReadSnapshotsV9A_() {
  const arr = readJson('face_snapshots.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7EduLatestSnapshotV9A_() {
  const arr = rt7EduReadSnapshotsV9A_();
  if (!arr.length) return null;
  arr.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return arr.find(s => String(s.face_gate || '').toUpperCase() === 'PASS' && Number(s.face_count || 0) > 0) || arr[0] || null;
}
function rt7EduReadFaceDbV9A_() {
  return readJson('edu_face_db.json', []);
}
function rt7EduWriteFaceDbV9A_(db) {
  writeJson('edu_face_db.json', Array.isArray(db) ? db.slice(0, 80) : []);
}
function rt7EduFaceFingerprintFromLatestV9A_(snapshot) {
  const img = safeReadFileV9A_('edu_face_latest.jpg');
  const seed = img && img.length ? img : Buffer.from(JSON.stringify(snapshot || {}));
  let h = 2166136261;
  const step = Math.max(1, Math.floor(seed.length / 512));
  for (let i = 0; i < seed.length; i += step) {
    h ^= seed[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= Number(snapshot && snapshot.bytes || 0);
  return 'FNV1A-' + (h >>> 0).toString(16).toUpperCase();
}
function safeReadFileV9A_(name) {
  try {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch (_) {}
  try {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return fs.readFileSync(p);
  } catch (_) {}
  return null;
}
function getCommunityByMasterUidV9A_(master_uid) {
  const arr = readJson('communities.json', []);
  return Array.isArray(arr) ? (arr.find(c => c.master_uid === master_uid) || null) : null;
}

app.get('/edu/face/latest-meta', (_req, res) => {
  res.json({ ok:true, version:VERSION, latest:rt7EduLatestSnapshotV9A_(), snapshots:rt7EduReadSnapshotsV9A_().slice(0,5) });
});

app.post('/edu/face/register', express.json({ limit: '1mb' }), (req, res) => {
  const body = req.body || {};
  const person_name = safeText(body.person_name || body.name || '', 60).trim();
  const master_uid = normalizeUid(body.master_uid || '');
  if (!person_name) return res.status(400).json({ ok:false, version:VERSION, error:'missing person_name' });
  if (!master_uid) return res.status(400).json({ ok:false, version:VERSION, error:'missing master_uid' });

  const latest = rt7EduLatestSnapshotV9A_();
  if (!latest) return res.status(409).json({ ok:false, version:VERSION, error:'NO_LATEST_CANDIDATE_SNAPSHOT', note:'請先用 ESP32 FACE_GATE_PASS 上傳 candidate snapshot。' });
  if (latest.master_uid && latest.master_uid !== master_uid) return res.status(409).json({ ok:false, version:VERSION, error:'SNAPSHOT_UID_MISMATCH', latest_uid:latest.master_uid, master_uid });
  if (String(latest.face_gate || '').toUpperCase() !== 'PASS' || Number(latest.face_count || 0) <= 0) {
    return res.status(409).json({ ok:false, version:VERSION, error:'LATEST_SNAPSHOT_NOT_FACE_GATE_PASS', latest });
  }

  const community = getCommunityByMasterUidV9A_(master_uid) || {};
  const rec = {
    face_id: 'FACE-' + Date.now().toString(36).toUpperCase(),
    person_name,
    community_id: latest.community_id || community.community_id || '',
    community_name: latest.community_name || community.community_name || '',
    master_uid,
    snapshot_id: latest.snapshot_id,
    image_url: latest.image_url || '/edu/face/latest.jpg',
    bytes: latest.bytes || 0,
    face_gate: latest.face_gate,
    face_count: latest.face_count || 1,
    face_reason: latest.face_reason || '',
    fingerprint: rt7EduFaceFingerprintFromLatestV9A_(latest),
    created_at: nowIso(),
    lesson: VERSION
  };
  const db = rt7EduReadFaceDbV9A_();
  db.unshift(rec);
  rt7EduWriteFaceDbV9A_(db);
  res.json({ ok:true, version:VERSION, face:rec, count:db.length });
});

app.get('/edu/face/db', (_req, res) => {
  res.json({ ok:true, version:VERSION, faces:rt7EduReadFaceDbV9A_() });
});

app.post('/edu/face/db/clear', (_req, res) => {
  rt7EduWriteFaceDbV9A_([]);
  res.json({ ok:true, version:VERSION, count:0 });
});


// [V9B] removed duplicate /edu/face-recognition route




// ===== V9B Route Order + Latest Snapshot Fix =====
function rt7V9BReadSnapshots_() {
  const arr = readJson('face_snapshots.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V9BLatest_() {
  const arr = rt7V9BReadSnapshots_();
  arr.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return arr.find(s => String(s.face_gate || '').toUpperCase() === 'PASS' && Number(s.face_count || 0) > 0) || null;
}
function rt7V9BFaceDb_() {
  const arr = readJson('edu_face_db.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V9BWriteFaceDb_(db) {
  writeJson('edu_face_db.json', Array.isArray(db) ? db.slice(0,80) : []);
}
function rt7V9BCommunityByUid_(uid) {
  const arr = readJson('communities.json', []);
  return Array.isArray(arr) ? (arr.find(c => c.master_uid === uid) || null) : null;
}
function rt7V9BFingerprint_(snapshot) {
  const seed = Buffer.from(JSON.stringify(snapshot || {}));
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed[i]; h = Math.imul(h, 16777619) >>> 0; }
  h ^= Number(snapshot && snapshot.bytes || 0);
  return 'FNV1A-' + (h >>> 0).toString(16).toUpperCase();
}

app.get('/edu/face/latest-meta', (_req, res) => {
  res.json({ ok:true, version:VERSION, latest:rt7V9BLatest_(), snapshots:rt7V9BReadSnapshots_().slice(0,5) });
});

app.post('/edu/face/register', express.json({limit:'1mb'}), (req, res) => {
  const body = req.body || {};
  const person_name = safeText(body.person_name || body.name || '', 60).trim();
  const master_uid = normalizeUid(body.master_uid || '');
  if (!person_name) return res.status(400).json({ ok:false, version:VERSION, error:'missing person_name' });
  if (!master_uid) return res.status(400).json({ ok:false, version:VERSION, error:'missing master_uid' });
  const latest = rt7V9BLatest_();
  if (!latest) return res.status(409).json({ ok:false, version:VERSION, error:'NO_LATEST_CANDIDATE_SNAPSHOT' });
  if (latest.master_uid !== master_uid) return res.status(409).json({ ok:false, version:VERSION, error:'SNAPSHOT_UID_MISMATCH', latest_uid:latest.master_uid, master_uid });
  const c = rt7V9BCommunityByUid_(master_uid) || {};
  const rec = {
    face_id: 'FACE-' + Date.now().toString(36).toUpperCase(),
    person_name,
    community_id: latest.community_id || c.community_id || '',
    community_name: latest.community_name || c.community_name || c.name || '',
    master_uid,
    snapshot_id: latest.snapshot_id,
    image_url: latest.image_url || '/edu/face/latest.jpg',
    bytes: latest.bytes || 0,
    face_gate: latest.face_gate,
    face_count: latest.face_count,
    face_reason: latest.face_reason || '',
    fingerprint: rt7V9BFingerprint_(latest),
    created_at: nowIso(),
    lesson: VERSION
  };
  const db = rt7V9BFaceDb_();
  db.unshift(rec);
  rt7V9BWriteFaceDb_(db);
  res.json({ ok:true, version:VERSION, face:rec, count:db.length });
});

app.get('/edu/face/db', (_req, res) => res.json({ ok:true, version:VERSION, faces:rt7V9BFaceDb_() }));
app.post('/edu/face/db/clear', (_req, res) => { rt7V9BWriteFaceDb_([]); res.json({ ok:true, version:VERSION, count:0 }); });

app.get('/edu/face-recognition', (_req, res) => {
  const latest = rt7V9BLatest_();
  const faces = rt7V9BFaceDb_();
  const masters = readJson('masters.json', []);
  const communities = readJson('communities.json', []);
  let options = [];
  if (latest && latest.master_uid) options.push({uid: latest.master_uid, name: latest.community_name || '最新 Snapshot'});
  if (Array.isArray(communities)) communities.forEach(c => { if(c.master_uid && !options.find(o=>o.uid===c.master_uid)) options.push({uid:c.master_uid,name:c.community_name||c.name||'社區'}); });
  if (Array.isArray(masters)) masters.forEach(m => { if(m.master_uid && !options.find(o=>o.uid===m.master_uid)) options.push({uid:m.master_uid,name:'Master'}); });
  const opts = options.map(o => `<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml = latest ? `<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">` : '<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';
  const rows = faces.map(f => `<tr><td>${f.face_id}</td><td><b>${f.person_name}</b></td><td>${f.community_name||''}</td><td>${f.master_uid}</td><td>${f.snapshot_id||''}</td><td>${f.bytes||''}</td><td>${f.created_at||''}</td></tr>`).join('') || '<tr><td colspan="7">尚未註冊</td></tr>';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title>
<style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}button.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:220px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:9px;text-align:left}.meta{color:#617085;margin:8px 0}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto}</style>
</head><body><div class="wrap">
<h1>RT7 EDU FACE RECOGNITION V9B</h1>
<div class="meta">第九堂：Real Face Register / Route Order Latest Fix</div>
<p><a href="/edu/face-snapshot">第八堂 Snapshot</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a> ｜ <a href="/edu/face/latest-meta">latest-meta</a></p>
<div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div>
<div class="card"><h2>2. 註冊人臉</h2><p>先用 ESP32 輸入 <b>s</b> 上傳 FACE_GATE_PASS 照片，再在這裡輸入姓名註冊。</p>
<select id="master_uid">${opts}</select><input id="person_name" placeholder="姓名，例如：小艾"><button onclick="registerFace()">註冊目前 Candidate</button><button class="red" onclick="clearDb()">清除 Face DB</button><pre id="result">READY</pre></div>
<div class="card"><h2>3. Face DB</h2><table><thead><tr><th>Face ID</th><th>Name</th><th>Community</th><th>UID</th><th>Snapshot</th><th>Bytes</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="card"><h2>4. 第九堂觀察重點</h2><pre>FACE_GATE_PASS Snapshot
↓
手機輸入姓名
↓
POST /edu/face/register
↓
Railway 寫入 edu_face_db.json
↓
Face DB 顯示註冊資料

本堂不做 Face Match，不開門。</pre></div>
</div><script>
async function registerFace(){const r=await fetch('/edu/face/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,person_name:person_name.value})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok)setTimeout(()=>location.reload(),800);}
async function clearDb(){if(!confirm('清除 Face DB?'))return;const r=await fetch('/edu/face/db/clear',{method:'POST'});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setTimeout(()=>location.reload(),600);}
</script></body></html>`);
});



// ===== Lesson 10: Production Face Doorbell =====
// V10 uses the V9 registered Face DB and the newest FACE_GATE_PASS snapshot.
// It performs an educational metadata-based face similarity, then queues OPEN_DOOR when MATCH + LIVENESS=REAL.
// Original RT7 production idea: ESP32 does FACE_GATE candidate snapshot; Railway does register/match/door command.

function rt7V10ReadSnapshots_() {
  const arr = readJson('face_snapshots.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V10Latest_() {
  const arr = rt7V10ReadSnapshots_();
  arr.sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return arr.find(s => String(s.face_gate || '').toUpperCase() === 'PASS' && Number(s.face_count || 0) > 0) || null;
}
function rt7V10FaceDb_() {
  const arr = readJson('edu_face_db.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V10Matches_() {
  const arr = readJson('edu_face_matches.json', []);
  return Array.isArray(arr) ? arr : [];
}
function rt7V10WriteMatches_(arr) {
  writeJson('edu_face_matches.json', Array.isArray(arr) ? arr.slice(0, 80) : []);
}
function rt7V10Metric_(txt, name) {
  const m = String(txt || '').match(new RegExp(name + '=([0-9.]+)'));
  return m ? Number(m[1]) : 0;
}
function rt7V10Parse_(obj) {
  const reason = String(obj && obj.face_reason || '');
  const box = reason.match(/box=([0-9]+)x([0-9]+)/);
  const center = reason.match(/center=([0-9]+),([0-9]+)/);
  return {
    skin: rt7V10Metric_(reason, 'skin'),
    skin_pct: rt7V10Metric_(reason, 'skin_pct'),
    ratio: rt7V10Metric_(reason, 'ratio'),
    box_w: box ? Number(box[1]) : 0,
    box_h: box ? Number(box[2]) : 0,
    cx: center ? Number(center[1]) : 0,
    cy: center ? Number(center[2]) : 0,
    bytes: Number(obj && obj.bytes || 0)
  };
}
function rt7V10Similarity_(latest, face) {
  const a = rt7V10Parse_(latest);
  const b = rt7V10Parse_(face);
  if (!a.skin_pct || !b.skin_pct || !a.box_w || !b.box_w) return 0;

  let score = 100;
  score -= Math.min(28, Math.abs(a.skin_pct - b.skin_pct) * 2.0);
  score -= Math.min(22, Math.abs(a.ratio - b.ratio) * 30.0);
  score -= Math.min(18, Math.abs(a.box_w - b.box_w) * 0.55);
  score -= Math.min(18, Math.abs(a.box_h - b.box_h) * 0.55);
  score -= Math.min(14, (Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy)) * 0.7);
  score -= Math.min(10, Math.abs(a.bytes - b.bytes) / 400.0);
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return Math.round(score);
}
function rt7V10QueueOpenDoor_(community_id, community_name, master_uid, source, note) {
  let commands = readJson('commands.json', []);
  const cmd = {
    command_id: 'CMD-' + Date.now().toString(36).toUpperCase(),
    command: 'OPEN_DOOR',
    status: 'PENDING',
    community_id: community_id || '',
    community_name: community_name || '',
    master_uid,
    relay_pin: 40,
    pulse_ms: 800,
    source: source || 'FACE_MATCH',
    created_at: nowIso(),
    delivered_at: '',
    ack_at: '',
    ack_note: note || '',
    lesson: VERSION
  };
  commands.unshift(cmd);
  writeJson('commands.json', commands.slice(0,50));
  return cmd;
}
function rt7V10BestMatch_(master_uid) {
  const latest = rt7V10Latest_();
  const db = rt7V10FaceDb_().filter(f => !master_uid || f.master_uid === master_uid);
  let best = null;
  let best_score = 0;
  for (const f of db) {
    const s = rt7V10Similarity_(latest, f);
    if (s > best_score) { best_score = s; best = f; }
  }
  return { latest, db, best, best_score };
}

app.post('/edu/face/match', express.json({limit:'1mb'}), (req, res) => {
  const body = req.body || {};
  const master_uid = normalizeUid(body.master_uid || '');
  const threshold = Number(body.threshold || 70);
  const liveness = 'REAL'; // Lesson 10 keeps liveness as REAL placeholder; OpenAI liveness is later production enhancement.
  if (!master_uid) return res.status(400).json({ ok:false, version:VERSION, error:'missing master_uid' });

  const { latest, db, best, best_score } = rt7V10BestMatch_(master_uid);
  if (!latest) return res.status(409).json({ ok:false, version:VERSION, error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT' });
  if (!db.length) return res.status(409).json({ ok:false, version:VERSION, error:'FACE_DB_EMPTY', note:'請先完成第九堂 Face Register。' });

  const face_match = !!(best && best_score >= threshold);
  const allow_open = face_match && liveness === 'REAL';
  let cmd = null;
  if (allow_open) {
    cmd = rt7V10QueueOpenDoor_(latest.community_id || best.community_id, latest.community_name || best.community_name, master_uid, 'FACE_MATCH', 'V10 MATCH + LIVENESS REAL');
  }
  const rec = {
    match_id: 'MATCH-' + Date.now().toString(36).toUpperCase(),
    master_uid,
    latest_snapshot_id: latest.snapshot_id,
    best_face_id: best ? best.face_id : '',
    best_name: best ? best.person_name : '',
    match_score: best_score,
    threshold,
    face_match,
    liveness,
    allow_open,
    command_id: cmd ? cmd.command_id : '',
    block_reason: allow_open ? '' : (face_match ? 'LIVENESS_NOT_REAL' : 'MATCH_SCORE_BELOW_THRESHOLD'),
    created_at: nowIso(),
    lesson: VERSION
  };
  const matches = rt7V10Matches_();
  matches.unshift(rec);
  rt7V10WriteMatches_(matches);
  res.json({ ok:true, version:VERSION, result:rec, command:cmd, latest, best_face:best });
});

app.get('/edu/face/matches', (_req, res) => {
  res.json({ ok:true, version:VERSION, matches:rt7V10Matches_() });
});

app.get('/edu/production-face-doorbell', (_req, res) => {
  const latest = rt7V10Latest_();
  const faces = rt7V10FaceDb_();
  const matches = rt7V10Matches_();
  const masters = readJson('master_registry.json', {});
  let masterOptions = [];
  if (latest && latest.master_uid) masterOptions.push({uid:latest.master_uid, name:latest.community_name || '最新 Snapshot'});
  if (!masterOptions.length && faces.length) masterOptions = faces.map(f => ({uid:f.master_uid, name:f.community_name || f.person_name || 'Face DB'}));
  const seen = {};
  masterOptions = masterOptions.filter(o => o.uid && !seen[o.uid] && (seen[o.uid]=true));
  const opts = masterOptions.map(o => `<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml = latest ? `<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">` : '<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';
  const faceRows = faces.map(f => `<tr><td>${f.face_id}</td><td><b>${f.person_name}</b></td><td>${f.community_name||''}</td><td>${f.master_uid}</td><td>${f.snapshot_id||''}</td><td>${f.bytes||''}</td><td>${f.created_at||''}</td></tr>`).join('') || '<tr><td colspan="7">尚未註冊</td></tr>';
  const matchRows = matches.map(m => `<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('') || '<tr><td colspan="8">尚無辨識結果</td></tr>';

  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${VERSION}</title>
<style>
body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:980px;margin:auto;padding:18px}
.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}
button.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:220px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}
table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:9px;text-align:left}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto}
</style></head><body><div class="wrap">
<h1>RT7 EDU PRODUCTION FACE DOORBELL V10</h1>
<div class="meta">第十堂：FACE_GATE Candidate → Face DB Match → OPEN_DOOR Command</div>
<p><a href="/edu/face-recognition">第九堂 Face Register</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a> ｜ <a href="/edu/commands">Commands</a></p>

<div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div>

<div class="card"><h2>2. 生產版辨識測試</h2>
<p>先讓 ESP32 串口輸入 <b>s</b> 上傳最新候選照片，再按辨識。MATCH + LIVENESS=REAL 時會寫入 OPEN_DOOR command。</p>
<select id="master_uid">${opts}</select>
<input id="threshold" type="number" value="70" min="1" max="100" style="width:120px;min-width:120px"> %
<button onclick="doMatch()">做人臉辨識測試</button>
<div id="statusBox" class="status">READY</div>
<pre id="result">READY</pre>
</div>

<div class="card"><h2>3. Match Results</h2><table><thead><tr><th>Match ID</th><th>Name</th><th>Score</th><th>Liveness</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${matchRows}</tbody></table></div>

<div class="card"><h2>4. Face DB</h2><table><thead><tr><th>Face ID</th><th>Name</th><th>Community</th><th>UID</th><th>Snapshot</th><th>Bytes</th><th>Time</th></tr></thead><tbody>${faceRows}</tbody></table></div>

<div class="card"><h2>5. 第十堂觀察重點</h2><pre>ESP32 Camera
↓
human_face_detect / FACE_GATE_PASS
↓
Railway Candidate Snapshot
↓
Face DB Match
↓
MATCH + LIVENESS=REAL
↓
OPEN_DOOR command
↓
ESP32 GPIO40 relay</pre></div>
</div>
<script>
function setStatus(cls,msg){statusBox.className='status '+cls;statusBox.textContent=msg;}
async function doMatch(){
  if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}
  setStatus('warn','⏳ 辨識中...');
  const r = await fetch('/edu/face/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70)})});
  const j = await r.json();
  result.textContent = JSON.stringify(j,null,2);
  if(j.ok && j.result && j.result.allow_open){setStatus('ok','✅ MATCH '+j.result.match_score+'%：已送出開門命令 '+j.result.command_id);}
  else if(j.ok && j.result){setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'%，未達門檻');}
  else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));
  setTimeout(()=>location.reload(),1500);
}
</script></body></html>`);
});



// ===== Lesson 11: OpenAI Liveness + Face Match =====
function rt7V11Snapshots(){ const a=readJson('face_snapshots.json',[]); return Array.isArray(a)?a:[]; }
function rt7V11Latest(){
  const a=rt7V11Snapshots();
  a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));
  return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS' && Number(s.face_count||0)>0) || null;
}
function rt7V11FaceDb(){ const a=readJson('edu_face_db.json',[]); return Array.isArray(a)?a:[]; }
function rt7V11Matches(){ const a=readJson('edu_face_matches.json',[]); return Array.isArray(a)?a:[]; }
function rt7V11WriteMatches(a){ writeJson('edu_face_matches.json', Array.isArray(a)?a.slice(0,100):[]); }
function rt7V11Metric(txt,name){ const m=String(txt||'').match(new RegExp(name+'=([0-9.]+)')); return m?Number(m[1]):0; }
function rt7V11Parse(o){
  const r=String(o&&o.face_reason||'');
  const b=r.match(/box=([0-9]+)x([0-9]+)/);
  const c=r.match(/center=([0-9]+),([0-9]+)/);
  return {skin_pct:rt7V11Metric(r,'skin_pct'),ratio:rt7V11Metric(r,'ratio'),box_w:b?Number(b[1]):0,box_h:b?Number(b[2]):0,cx:c?Number(c[1]):0,cy:c?Number(c[2]):0,bytes:Number(o&&o.bytes||0)};
}
function rt7V11Similarity(latest,face){
  const a=rt7V11Parse(latest), b=rt7V11Parse(face);
  if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w) return 0;
  let s=100;
  s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2.0);
  s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30.0);
  s-=Math.min(18,Math.abs(a.box_w-b.box_w)*0.55);
  s-=Math.min(18,Math.abs(a.box_h-b.box_h)*0.55);
  s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*0.7);
  s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400.0);
  return Math.max(0,Math.min(100,Math.round(s)));
}
function rt7V11Best(master_uid){
  const latest=rt7V11Latest();
  const db=rt7V11FaceDb().filter(f=>!master_uid||f.master_uid===master_uid);
  let best=null, best_score=0;
  for(const f of db){ const s=rt7V11Similarity(latest,f); if(s>best_score){best=f;best_score=s;} }
  return {latest,db,best,best_score};
}
function rt7V11QueueOpen(community_id,community_name,master_uid,note){
  let commands=readJson('commands.json',[]);
  const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:community_id||'',community_name:community_name||'',master_uid,relay_pin:40,pulse_ms:800,source:'OPENAI_LIVENESS_FACE_MATCH',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};
  commands.unshift(cmd); writeJson('commands.json',commands.slice(0,50)); return cmd;
}
async function rt7V11OpenAILiveness(){
  const key=process.env.OPENAI_API_KEY||'';
  const imgPath=path.join(DATA_DIR,'edu_face_latest.jpg');
  if(!key) return {mode:'DEMO_NO_OPENAI_KEY',liveness:'REAL',confidence:0.51,reason:'OPENAI_API_KEY not configured; demo mode returns REAL for lesson testing.'};
  if(!fs.existsSync(imgPath)) return {mode:'OPENAI',liveness:'UNKNOWN',confidence:0,reason:'latest image not found'};
  try{
    const b64=fs.readFileSync(imgPath).toString('base64');
    const body={model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',messages:[{role:'user',content:[{type:'text',text:'Door access liveness check. Decide whether image shows a real live person in front of camera, or a printed photo/screen/replay. Return strict JSON only: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","confidence":0-1,"reason":"short reason"}'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],temperature:0,max_tokens:120,response_format:{type:'json_object'}};
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok) return {mode:'OPENAI_ERROR',liveness:'UNKNOWN',confidence:0,reason:d.error?d.error.message:('HTTP '+r.status)};
    const txt=d.choices&&d.choices[0]&&d.choices[0].message?d.choices[0].message.content:'{}';
    const p=JSON.parse(txt);
    return {mode:'OPENAI',liveness:String(p.liveness||'UNKNOWN').toUpperCase(),confidence:Number(p.confidence||0),reason:String(p.reason||'')};
  }catch(e){ return {mode:'OPENAI_EXCEPTION',liveness:'UNKNOWN',confidence:0,reason:String(e&&e.message||e)}; }
}
app.post('/edu/face/openai-liveness-match', express.json({limit:'1mb'}), async (req,res)=>{
  const body=req.body||{};
  const master_uid=normalizeUid(body.master_uid||'');
  const threshold=Number(body.threshold||70);
  const liveThreshold=Number(body.liveness_confidence||0.5);
  if(!master_uid) return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});
  const {latest,db,best,best_score}=rt7V11Best(master_uid);
  if(!latest) return res.status(409).json({ok:false,version:VERSION,error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT'});
  if(!db.length) return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY',note:'請先完成第九堂 Face Register。'});
  const live=await rt7V11OpenAILiveness();
  const face_match=!!(best&&best_score>=threshold);
  const live_ok=live.liveness==='REAL' && Number(live.confidence||0)>=liveThreshold;
  const allow_open=face_match&&live_ok;
  const cmd=allow_open?rt7V11QueueOpen(latest.community_id||best.community_id,latest.community_name||best.community_name,master_uid,'V11 MATCH + OPENAI LIVENESS REAL'):null;
  const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid,latest_snapshot_id:latest.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:live.liveness,liveness_mode:live.mode,liveness_confidence:live.confidence,liveness_reason:live.reason,allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_NOT_REAL'),created_at:nowIso(),lesson:VERSION};
  const m=rt7V11Matches(); m.unshift(rec); rt7V11WriteMatches(m);
  res.json({ok:true,version:VERSION,result:rec,command:cmd,latest,best_face:best,liveness:live});
});
app.get('/edu/openai-liveness-face-doorbell', (_req,res)=>{
  const latest=rt7V11Latest(), faces=rt7V11FaceDb(), matches=rt7V11Matches().filter(m=>String(m.lesson||'').includes('V11')||m.liveness_mode);
  let options=[]; if(latest&&latest.master_uid) options.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'}); if(!options.length&&faces.length) options=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));
  const seen={}; options=options.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true));
  const opts=options.map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml=latest?`<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';
  const faceRows=faces.map(f=>`<tr><td>${f.face_id}</td><td><b>${f.person_name}</b></td><td>${f.community_name||''}</td><td>${f.master_uid}</td><td>${f.snapshot_id||''}</td><td>${f.created_at||''}</td></tr>`).join('')||'<tr><td colspan="6">尚未註冊</td></tr>';
  const matchRows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${m.liveness_mode||''}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="10">尚無 V11 辨識結果</td></tr>';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1040px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:180px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto}</style></head><body><div class="wrap"><h1>RT7 EDU V11 OPENAI LIVENESS FACE DOORBELL</h1><div class="meta">第十一堂：Face Match + OpenAI Liveness + OPEN_DOOR</div><p><a href="/edu/production-face-doorbell">第十堂 V10</a> ｜ <a href="/edu/face-recognition">第九堂 Face Register</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a></p><div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>2. OpenAI Liveness + Face Match</h2><p>先讓 ESP32 串口輸入 <b>s</b> 上傳最新候選照片，再按辨識。MATCH + LIVENESS=REAL 時送出 OPEN_DOOR command。</p><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" min="1" max="100" style="width:90px;min-width:90px"> %<input id="live_conf" type="number" value="0.5" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness<button onclick="doMatch()">OpenAI 活體 + 人臉辨識</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div><div class="card"><h2>3. V11 Match Results</h2><table><thead><tr><th>Match ID</th><th>Name</th><th>Score</th><th>Liveness</th><th>Mode</th><th>Conf</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${matchRows}</tbody></table></div><div class="card"><h2>4. Face DB</h2><table><thead><tr><th>Face ID</th><th>Name</th><th>Community</th><th>UID</th><th>Snapshot</th><th>Time</th></tr></thead><tbody>${faceRows}</tbody></table></div><div class="card"><h2>5. 第十一堂觀察重點</h2><pre>ESP32 FACE_GATE_PASS Candidate
↓
Railway Face DB Match
↓
OpenAI Vision Liveness
↓
MATCH + LIVENESS=REAL
↓
OPEN_DOOR command
↓
ESP32 GPIO40 relay

若 Railway 未設定 OPENAI_API_KEY，系統會進入 DEMO_NO_OPENAI_KEY 模式，仍可完成課堂流程。</pre></div></div><script>function setStatus(cls,msg){statusBox.className='status '+cls;statusBox.textContent=msg;}async function doMatch(){if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}setStatus('warn','⏳ OpenAI 活體辨識中...');const r=await fetch('/edu/face/openai-liveness-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open){setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / LIVENESS '+j.result.liveness+' / '+j.result.command_id);}else if(j.ok&&j.result){setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / LIVENESS '+j.result.liveness+' / '+j.result.block_reason);}else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),1800);}</script></body></html>`);
});



// ===== V11A RESPONSE DEBUG =====
function v11aShots(){const a=readJson('face_snapshots.json',[]);return Array.isArray(a)?a:[]}
function v11aLatest(){const a=v11aShots();a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function v11aDb(){const a=readJson('edu_face_db.json',[]);return Array.isArray(a)?a:[]}
function v11aMatches(){const a=readJson('edu_face_matches.json',[]);return Array.isArray(a)?a:[]}
function v11aWriteMatches(a){writeJson('edu_face_matches.json',Array.isArray(a)?a.slice(0,120):[])}
function v11aLogs(){const a=readJson('openai_liveness_debug_log.json',[]);return Array.isArray(a)?a:[]}
function v11aWriteLogs(a){writeJson('openai_liveness_debug_log.json',Array.isArray(a)?a.slice(0,80):[])}
function v11aMetric(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function v11aMeta(o){const r=String(o&&o.face_reason||''),b=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin_pct:v11aMetric(r,'skin_pct'),ratio:v11aMetric(r,'ratio'),box_w:b?Number(b[1]):0,box_h:b?Number(b[2]):0,cx:c?Number(c[1]):0,cy:c?Number(c[2]):0,bytes:Number(o&&o.bytes||0)}}
function v11aScore(latest,face){const a=v11aMeta(latest),b=v11aMeta(face);if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.box_w-b.box_w)*.55);s-=Math.min(18,Math.abs(a.box_h-b.box_h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function v11aBest(uid){const latest=v11aLatest(),db=v11aDb().filter(f=>!uid||f.master_uid===uid);let best=null,score=0;for(const f of db){const s=v11aScore(latest,f);if(s>score){best=f;score=s}}return{latest,db,best,best_score:score}}
function v11aQueueOpen(cid,cname,uid,note){let commands=readJson('commands.json',[]);const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'OPENAI_LIVENESS_RESPONSE_DEBUG',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};commands.unshift(cmd);writeJson('commands.json',commands.slice(0,50));return cmd}
function v11aExtract(raw){const txt=String(raw||'').trim();if(!txt)return{ok:false,parsed:null,method:'EMPTY',error:'empty response'};try{return{ok:true,parsed:JSON.parse(txt),method:'DIRECT_JSON',error:''}}catch(e){}const fence=txt.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence&&fence[1]){try{return{ok:true,parsed:JSON.parse(fence[1].trim()),method:'MARKDOWN_JSON_FENCE',error:''}}catch(e){return{ok:false,parsed:null,method:'MARKDOWN_JSON_PARSE_FAIL',error:String(e.message||e)}}}const first=txt.indexOf('{'),last=txt.lastIndexOf('}');if(first>=0&&last>first){try{return{ok:true,parsed:JSON.parse(txt.slice(first,last+1)),method:'JSON_SUBSTRING',error:''}}catch(e){}}const up=txt.toUpperCase();if(up.includes('REAL')||up.includes('LIVE'))return{ok:true,parsed:{liveness:'REAL',confidence:.65,reason:'plain text REAL/LIVE'},method:'PLAIN_TEXT_KEYWORD',error:''};if(up.includes('PHOTO')||up.includes('PRINT'))return{ok:true,parsed:{liveness:'PHOTO',confidence:.65,reason:'plain text PHOTO/PRINT'},method:'PLAIN_TEXT_KEYWORD',error:''};if(up.includes('SCREEN')||up.includes('REPLAY')||up.includes('DISPLAY'))return{ok:true,parsed:{liveness:'SCREEN',confidence:.65,reason:'plain text SCREEN/REPLAY/DISPLAY'},method:'PLAIN_TEXT_KEYWORD',error:''};return{ok:false,parsed:null,method:'UNPARSEABLE_TEXT',error:'No JSON or keyword found'}}
function v11aNorm(p){p=p||{};let live=String(p.liveness||p.live||p.result||p.status||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')live=p.real?'REAL':'PHOTO';if(typeof p.is_live==='boolean')live=p.is_live?'REAL':'PHOTO';if(live.includes('REAL')||live.includes('LIVE'))live='REAL';else if(live.includes('PHOTO')||live.includes('PRINT'))live='PHOTO';else if(live.includes('SCREEN')||live.includes('REPLAY')||live.includes('DISPLAY'))live='SCREEN';else live='UNKNOWN';let conf=Number(p.confidence??p.score??p.probability??0);if(conf>1)conf=conf/100;if(!Number.isFinite(conf))conf=0;return{liveness:live,confidence:conf,reason:String(p.reason||p.explanation||p.note||'')}}
async function v11aOpenAI(){const key=process.env.OPENAI_API_KEY||'',img=path.join(DATA_DIR,'edu_face_latest.jpg');const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),at:nowIso(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',image_exists:fs.existsSync(img),image_bytes:fs.existsSync(img)?fs.statSync(img).size:0,http_status:0,openai_ok:false,raw_content:'',usage:null,parse_ok:false,parse_method:'',parse_error:'',normalized:null};if(!key){d.raw_content='DEMO_NO_OPENAI_KEY';d.parse_ok=true;d.parse_method='DEMO_NO_OPENAI_KEY';d.normalized={liveness:'REAL',confidence:.51,reason:'OPENAI_API_KEY not configured'};return d}if(!d.image_exists){d.parse_error='latest image not found';d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}try{const b64=fs.readFileSync(img).toString('base64');const body={model:d.model,messages:[{role:'user',content:[{type:'text',text:'Door access liveness check. Return ONLY compact JSON: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","confidence":0-1,"reason":"short reason"}'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],temperature:0,max_tokens:160};const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});d.http_status=r.status;const j=await r.json();d.usage=j.usage||null;d.openai_ok=!!r.ok;if(!r.ok){d.raw_content=j.error?JSON.stringify(j.error):JSON.stringify(j).slice(0,1000);d.parse_error=j.error?(j.error.message||'OpenAI error'):('HTTP '+r.status);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}d.raw_content=j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||''):'';const ex=v11aExtract(d.raw_content);d.parse_ok=ex.ok;d.parse_method=ex.method;d.parse_error=ex.error||'';d.normalized=ex.ok?v11aNorm(ex.parsed):{liveness:'UNKNOWN',confidence:0,reason:ex.error||'parse failed'};return d}catch(e){d.parse_error=String(e&&e.message||e);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}}
app.post('/edu/face/openai-liveness-debug-match',express.json({limit:'1mb'}),async(req,res)=>{const body=req.body||{},uid=normalizeUid(body.master_uid||''),threshold=Number(body.threshold||70),liveThreshold=Number(body.liveness_confidence||.5);if(!uid)return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});const {latest,db,best,best_score}=v11aBest(uid);if(!latest)return res.status(409).json({ok:false,version:VERSION,error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT'});if(!db.length)return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY'});const debug=await v11aOpenAI(),norm=debug.normalized||{liveness:'UNKNOWN',confidence:0,reason:'no normalized'};const face_match=!!(best&&best_score>=threshold),live_ok=norm.liveness==='REAL'&&Number(norm.confidence||0)>=liveThreshold,allow_open=face_match&&live_ok;const cmd=allow_open?v11aQueueOpen(latest.community_id||best.community_id,latest.community_name||best.community_name,uid,'V11A MATCH + OpenAI debug liveness REAL'):null;const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,latest_snapshot_id:latest.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:norm.liveness,liveness_mode:debug.has_openai_key?'OPENAI_DEBUG':'DEMO_NO_OPENAI_KEY',liveness_confidence:norm.confidence,liveness_reason:norm.reason,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_parse_error:debug.parse_error,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_NOT_REAL'),created_at:nowIso(),lesson:VERSION};const m=v11aMatches();m.unshift(rec);v11aWriteMatches(m);const logs=v11aLogs();logs.unshift({debug_id:debug.debug_id,result:rec,debug});v11aWriteLogs(logs);res.json({ok:true,version:VERSION,result:rec,command:cmd,latest,best_face:best,openai_debug:debug})});
app.get('/edu/openai-liveness/debug-log',(_req,res)=>res.json({ok:true,version:VERSION,logs:v11aLogs().slice(0,10)}));
app.get('/edu/openai-liveness-debug',(_req,res)=>{const latest=v11aLatest(),faces=v11aDb(),logs=v11aLogs(),matches=v11aMatches().filter(m=>String(m.lesson||'').includes('V11A')||m.openai_parse_method);let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'});if(!opts.length&&faces.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');const latestHtml=latest?`<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${m.liveness_mode||''}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.openai_http_status||''}</td><td>${m.openai_parse_method||''}</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="12">尚無 V11A Debug 結果</td></tr>';const last=logs[0]&&logs[0].debug?logs[0].debug:null;const dbg=last?JSON.stringify({debug_id:last.debug_id,has_openai_key:last.has_openai_key,model:last.model,image_bytes:last.image_bytes,http_status:last.http_status,openai_ok:last.openai_ok,usage:last.usage,parse_ok:last.parse_ok,parse_method:last.parse_method,parse_error:last.parse_error,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 OpenAI debug log';res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1120px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:14px}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V11A OPENAI LIVENESS RESPONSE DEBUG</h1><p><a href="/edu/openai-liveness-face-doorbell">第十一堂 V11</a> ｜ <a href="/edu/production-face-doorbell">第十堂 V10</a> ｜ <a href="/edu/openai-liveness/debug-log">Debug JSON</a></p><div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>2. OpenAI Debug + Face Match</h2><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" min="1" max="100" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="0.5" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness <button onclick="doMatch()">OpenAI Debug 活體 + 人臉辨識</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div><div class="card"><h2>3. V11A Match Results</h2><table><thead><tr><th>Match ID</th><th>Name</th><th>Score</th><th>Liveness</th><th>Mode</th><th>Conf</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><h2>4. Last OpenAI Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function setStatus(c,m){statusBox.className='status '+c;statusBox.textContent=m;}async function doMatch(){if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}setStatus('warn','⏳ OpenAI Debug 辨識中...');const r=await fetch('/edu/face/openai-liveness-debug-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / parse='+j.result.openai_parse_method+' / '+j.result.command_id);else if(j.ok&&j.result)setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / parse='+j.result.openai_parse_method+' / '+j.result.block_reason);else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),2200);}</script></body></html>`)});



// ===== V11B IMAGE SOURCE FIX =====
// V11B fixes V11A "latest image not found" by resolving the actual image source.
// It supports local files and self-fetching /edu/face/latest.jpg before calling OpenAI.

function v11bShots(){const a=readJson('face_snapshots.json',[]);return Array.isArray(a)?a:[]}
function v11bLatest(){const a=v11bShots();a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function v11bDb(){const a=readJson('edu_face_db.json',[]);return Array.isArray(a)?a:[]}
function v11bMatches(){const a=readJson('edu_face_matches.json',[]);return Array.isArray(a)?a:[]}
function v11bWriteMatches(a){writeJson('edu_face_matches.json',Array.isArray(a)?a.slice(0,140):[])}
function v11bLogs(){const a=readJson('openai_liveness_debug_log.json',[]);return Array.isArray(a)?a:[]}
function v11bWriteLogs(a){writeJson('openai_liveness_debug_log.json',Array.isArray(a)?a.slice(0,100):[])}
function v11bMetric(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function v11bMeta(o){const r=String(o&&o.face_reason||''),b=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin_pct:v11bMetric(r,'skin_pct'),ratio:v11bMetric(r,'ratio'),box_w:b?Number(b[1]):0,box_h:b?Number(b[2]):0,cx:c?Number(c[1]):0,cy:c?Number(c[2]):0,bytes:Number(o&&o.bytes||0)}}
function v11bScore(latest,face){const a=v11bMeta(latest),b=v11bMeta(face);if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.box_w-b.box_w)*.55);s-=Math.min(18,Math.abs(a.box_h-b.box_h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function v11bBest(uid){const latest=v11bLatest(),db=v11bDb().filter(f=>!uid||f.master_uid===uid);let best=null,score=0;for(const f of db){const s=v11bScore(latest,f);if(s>score){best=f;score=s}}return{latest,db,best,best_score:score}}
function v11bQueueOpen(cid,cname,uid,note){let commands=readJson('commands.json',[]);const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'OPENAI_LIVENESS_IMAGE_SOURCE_FIX',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};commands.unshift(cmd);writeJson('commands.json',commands.slice(0,50));return cmd}

function v11bExtract(raw){const txt=String(raw||'').trim();if(!txt)return{ok:false,parsed:null,method:'EMPTY',error:'empty response'};try{return{ok:true,parsed:JSON.parse(txt),method:'DIRECT_JSON',error:''}}catch(e){}const fence=txt.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence&&fence[1]){try{return{ok:true,parsed:JSON.parse(fence[1].trim()),method:'MARKDOWN_JSON_FENCE',error:''}}catch(e){return{ok:false,parsed:null,method:'MARKDOWN_JSON_PARSE_FAIL',error:String(e.message||e)}}}const first=txt.indexOf('{'),last=txt.lastIndexOf('}');if(first>=0&&last>first){try{return{ok:true,parsed:JSON.parse(txt.slice(first,last+1)),method:'JSON_SUBSTRING',error:''}}catch(e){}}const up=txt.toUpperCase();if(up.includes('REAL')||up.includes('LIVE'))return{ok:true,parsed:{liveness:'REAL',confidence:.65,reason:'plain text REAL/LIVE'},method:'PLAIN_TEXT_KEYWORD',error:''};if(up.includes('PHOTO')||up.includes('PRINT'))return{ok:true,parsed:{liveness:'PHOTO',confidence:.65,reason:'plain text PHOTO/PRINT'},method:'PLAIN_TEXT_KEYWORD',error:''};if(up.includes('SCREEN')||up.includes('REPLAY')||up.includes('DISPLAY'))return{ok:true,parsed:{liveness:'SCREEN',confidence:.65,reason:'plain text SCREEN/REPLAY/DISPLAY'},method:'PLAIN_TEXT_KEYWORD',error:''};return{ok:false,parsed:null,method:'UNPARSEABLE_TEXT',error:'No JSON or keyword found'}}
function v11bNorm(p){p=p||{};let live=String(p.liveness||p.live||p.result||p.status||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')live=p.real?'REAL':'PHOTO';if(typeof p.is_live==='boolean')live=p.is_live?'REAL':'PHOTO';if(typeof p.is_real==='boolean')live=p.is_real?'REAL':'PHOTO';if(live.includes('REAL')||live.includes('LIVE'))live='REAL';else if(live.includes('PHOTO')||live.includes('PRINT'))live='PHOTO';else if(live.includes('SCREEN')||live.includes('REPLAY')||live.includes('DISPLAY'))live='SCREEN';else live='UNKNOWN';let conf=Number(p.confidence??p.score??p.probability??p.liveness_confidence??0);if(conf>1)conf=conf/100;if(!Number.isFinite(conf))conf=0;return{liveness:live,confidence:conf,reason:String(p.reason||p.explanation||p.note||p.rationale||'')}}

function v11bBaseUrl(req){
  if(process.env.RAILWAY_PUBLIC_DOMAIN) return 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN;
  if(process.env.RAILWAY_STATIC_URL) return process.env.RAILWAY_STATIC_URL;
  if(req && req.headers && req.headers.host) return (req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host;
  return '';
}
async function v11bResolveImage(latest, req){
  const checked=[];
  const names=['edu_face_latest.jpg','latest.jpg','face_latest.jpg'];
  const dirs=[DATA_DIR,__dirname,path.join(DATA_DIR,'data'),path.join(__dirname,'data'),path.join(process.cwd(),'data'),process.cwd()];
  for(const d of dirs){
    for(const n of names){
      const pth=path.join(d,n);
      checked.push(pth);
      try{
        if(fs.existsSync(pth)){
          const buf=fs.readFileSync(pth);
          if(buf && buf.length>1000) return {ok:true,buffer:buf,source:'LOCAL_FILE',path:pth,bytes:buf.length,checked};
        }
      }catch(e){}
    }
  }
  if(latest && latest.image_url){
    const rel=String(latest.image_url).replace(/^\//,'');
    const candidates=[path.join(DATA_DIR,rel),path.join(__dirname,rel),path.join(process.cwd(),rel)];
    for(const pth of candidates){
      checked.push(pth);
      try{
        if(fs.existsSync(pth)){
          const buf=fs.readFileSync(pth);
          if(buf && buf.length>1000) return {ok:true,buffer:buf,source:'LOCAL_IMAGE_URL_PATH',path:pth,bytes:buf.length,checked};
        }
      }catch(e){}
    }
    const base=v11bBaseUrl(req);
    if(base){
      const url=base + (String(latest.image_url).startsWith('/') ? latest.image_url : '/' + latest.image_url);
      checked.push(url);
      try{
        const r=await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now(), {headers:{'Cache-Control':'no-cache'}});
        const ab=await r.arrayBuffer();
        const buf=Buffer.from(ab);
        if(r.ok && buf.length>1000) return {ok:true,buffer:buf,source:'SELF_FETCH_IMAGE_URL',path:url,bytes:buf.length,http_status:r.status,checked};
        return {ok:false,buffer:null,source:'SELF_FETCH_FAILED',path:url,bytes:buf.length,http_status:r.status,checked,error:'self fetch image failed'};
      }catch(e){
        return {ok:false,buffer:null,source:'SELF_FETCH_EXCEPTION',path:url,bytes:0,checked,error:String(e.message||e)};
      }
    }
  }
  return {ok:false,buffer:null,source:'NOT_FOUND',path:'',bytes:0,checked,error:'image source not found'};
}

async function v11bOpenAI(latest,req){
  const key=process.env.OPENAI_API_KEY||'';
  const img=await v11bResolveImage(latest,req);
  const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),at:nowIso(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',image_source:img.source,image_path:img.path,image_exists:img.ok,image_bytes:img.bytes||0,image_checked:(img.checked||[]).slice(-12),image_error:img.error||'',http_status:0,openai_ok:false,raw_content:'',usage:null,parse_ok:false,parse_method:'',parse_error:'',normalized:null};
  if(!key){d.raw_content='DEMO_NO_OPENAI_KEY';d.parse_ok=true;d.parse_method='DEMO_NO_OPENAI_KEY';d.normalized={liveness:'REAL',confidence:.51,reason:'OPENAI_API_KEY not configured'};return d}
  if(!img.ok || !img.buffer){d.parse_error=img.error||'latest image not found';d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}
  try{
    const b64=img.buffer.toString('base64');
    const body={model:d.model,messages:[{role:'user',content:[{type:'text',text:'Door access liveness check. Return ONLY compact JSON: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","confidence":0-1,"reason":"short reason"}'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],temperature:0,max_tokens:160};
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    d.http_status=r.status;
    const j=await r.json();
    d.usage=j.usage||null;
    d.openai_ok=!!r.ok;
    if(!r.ok){d.raw_content=j.error?JSON.stringify(j.error):JSON.stringify(j).slice(0,1000);d.parse_error=j.error?(j.error.message||'OpenAI error'):('HTTP '+r.status);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}
    d.raw_content=j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||''):'';
    const ex=v11bExtract(d.raw_content);
    d.parse_ok=ex.ok; d.parse_method=ex.method; d.parse_error=ex.error||'';
    d.normalized=ex.ok?v11bNorm(ex.parsed):{liveness:'UNKNOWN',confidence:0,reason:ex.error||'parse failed'};
    return d;
  }catch(e){d.parse_error=String(e&&e.message||e);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}
}

app.post('/edu/face/openai-liveness-image-source-match',express.json({limit:'1mb'}),async(req,res)=>{
  const body=req.body||{},uid=normalizeUid(body.master_uid||''),threshold=Number(body.threshold||70),liveThreshold=Number(body.liveness_confidence||.5);
  if(!uid)return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});
  const {latest,db,best,best_score}=v11bBest(uid);
  if(!latest)return res.status(409).json({ok:false,version:VERSION,error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT'});
  if(!db.length)return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY'});
  const debug=await v11bOpenAI(latest,req),norm=debug.normalized||{liveness:'UNKNOWN',confidence:0,reason:'no normalized'};
  const face_match=!!(best&&best_score>=threshold),live_ok=norm.liveness==='REAL'&&Number(norm.confidence||0)>=liveThreshold,allow_open=face_match&&live_ok;
  const cmd=allow_open?v11bQueueOpen(latest.community_id||best.community_id,latest.community_name||best.community_name,uid,'V11B MATCH + OpenAI image source fix liveness REAL'):null;
  const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,latest_snapshot_id:latest.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:norm.liveness,liveness_mode:debug.has_openai_key?'OPENAI_IMAGE_SOURCE_FIX':'DEMO_NO_OPENAI_KEY',liveness_confidence:norm.confidence,liveness_reason:norm.reason,image_source:debug.image_source,image_bytes:debug.image_bytes,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_parse_error:debug.parse_error,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_NOT_REAL'),created_at:nowIso(),lesson:VERSION};
  const m=v11bMatches();m.unshift(rec);v11bWriteMatches(m);
  const logs=v11bLogs();logs.unshift({debug_id:debug.debug_id,result:rec,debug});v11bWriteLogs(logs);
  res.json({ok:true,version:VERSION,result:rec,command:cmd,latest,best_face:best,openai_debug:debug});
});
app.get('/edu/openai-liveness/image-source-log',(_req,res)=>res.json({ok:true,version:VERSION,logs:v11bLogs().slice(0,10)}));
app.get('/edu/openai-liveness-image-source-fix',(_req,res)=>{
  const latest=v11bLatest(),faces=v11bDb(),logs=v11bLogs(),matches=v11bMatches().filter(m=>String(m.lesson||'').includes('V11B')||m.image_source);
  let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'});if(!opts.length&&faces.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));
  const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml=latest?`<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜image_url=${latest.image_url||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';
  const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${m.liveness_mode||''}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.image_source||''}</td><td>${m.image_bytes||0}</td><td>${m.openai_http_status||''}</td><td>${m.openai_parse_method||''}</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="14">尚無 V11B 結果</td></tr>';
  const last=logs[0]&&logs[0].debug?logs[0].debug:null;
  const dbg=last?JSON.stringify({debug_id:last.debug_id,has_openai_key:last.has_openai_key,model:last.model,image_source:last.image_source,image_path:last.image_path,image_exists:last.image_exists,image_bytes:last.image_bytes,image_checked:last.image_checked,image_error:last.image_error,http_status:last.http_status,openai_ok:last.openai_ok,usage:last.usage,parse_ok:last.parse_ok,parse_method:last.parse_method,parse_error:last.parse_error,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 OpenAI image source debug log';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1180px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:13px}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V11B OPENAI LIVENESS IMAGE SOURCE FIX</h1><p><a href="/edu/openai-liveness-debug">V11A Debug</a> ｜ <a href="/edu/openai-liveness-face-doorbell">V11</a> ｜ <a href="/edu/production-face-doorbell">V10</a> ｜ <a href="/edu/openai-liveness/image-source-log">Image Source Log JSON</a></p><div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>2. OpenAI Image Source Fix + Face Match</h2><p>V11B 不再只讀 DATA_DIR/edu_face_latest.jpg，會 fallback 到 /edu/face/latest.jpg self-fetch。</p><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" min="1" max="100" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="0.5" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness <button onclick="doMatch()">OpenAI Image Fix 活體 + 人臉辨識</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div><div class="card"><h2>3. V11B Results</h2><table><thead><tr><th>Match ID</th><th>Name</th><th>Score</th><th>Live</th><th>Mode</th><th>Conf</th><th>ImgSrc</th><th>ImgBytes</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><h2>4. Last Image Source Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function setStatus(c,m){statusBox.className='status '+c;statusBox.textContent=m;}async function doMatch(){if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}setStatus('warn','⏳ OpenAI Image Source Fix 辨識中...');const r=await fetch('/edu/face/openai-liveness-image-source-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / img='+j.result.image_bytes+' / '+j.result.command_id);else if(j.ok&&j.result)setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / img='+j.result.image_bytes+' / '+j.result.block_reason);else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),2400);}</script></body></html>`);
});



// ===== V11C MULTI FRAME CHALLENGE =====
function v11cR(n,d){const a=readJson(n,d);return Array.isArray(d)?(Array.isArray(a)?a:[]):(a&&typeof a==='object'?a:{})}
function v11cW(n,o){writeJson(n,o)}
function v11cLatest(){const a=v11cR('face_snapshots.json',[]);a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function v11cDb(){return v11cR('edu_face_db.json',[])}
function v11cMatches(){return v11cR('edu_face_matches.json',[])}
function v11cLog(){return v11cR('openai_liveness_debug_log.json',[])}
function v11cChallenge(){return v11cR('v11c_challenge.json',{})}
function v11cMetric(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function v11cMeta(o){const r=String(o&&o.face_reason||''),b=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin_pct:v11cMetric(r,'skin_pct'),ratio:v11cMetric(r,'ratio'),box_w:b?+b[1]:0,box_h:b?+b[2]:0,cx:c?+c[1]:0,cy:c?+c[2]:0,bytes:+(o&&o.bytes||0)}}
function v11cScore(a0,b0){const a=v11cMeta(a0),b=v11cMeta(b0);if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.box_w-b.box_w)*.55);s-=Math.min(18,Math.abs(a.box_h-b.box_h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function v11cBest(uid,latest){const db=v11cDb().filter(f=>!uid||f.master_uid===uid);let best=null,best_score=0;for(const f of db){const s=v11cScore(latest,f);if(s>best_score){best=f;best_score=s}}return{db,best,best_score}}
function v11cFramePath(label){return path.join(DATA_DIR,'v11c_frame_'+label+'.jpg')}
function v11cBase(req){if(process.env.RAILWAY_PUBLIC_DOMAIN)return'https://'+process.env.RAILWAY_PUBLIC_DOMAIN;if(process.env.RAILWAY_STATIC_URL)return process.env.RAILWAY_STATIC_URL;if(req&&req.headers&&req.headers.host)return(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;return''}
async function v11cResolve(latest,req){const base=v11cBase(req);if(latest&&latest.image_url&&base){const url=base+(String(latest.image_url).startsWith('/')?latest.image_url:'/'+latest.image_url);try{const r=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{headers:{'Cache-Control':'no-cache'}});const buf=Buffer.from(await r.arrayBuffer());if(r.ok&&buf.length>1000)return{ok:true,buffer:buf,source:'SELF_FETCH_IMAGE_URL',path:url,bytes:buf.length};return{ok:false,error:'self fetch failed',bytes:buf.length,status:r.status,path:url}}catch(e){return{ok:false,error:String(e.message||e),path:url}}}return{ok:false,error:'no latest image url'}}
function v11cQueue(cid,cname,uid,note){let commands=readJson('commands.json',[]);const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'OPENAI_LIVENESS_MULTI_FRAME_CHALLENGE',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};commands.unshift(cmd);writeJson('commands.json',commands.slice(0,50));return cmd}
function v11cExtract(raw){const txt=String(raw||'').trim();if(!txt)return{ok:false,parsed:null,method:'EMPTY',error:'empty'};try{return{ok:true,parsed:JSON.parse(txt),method:'DIRECT_JSON'}}catch(e){}const f=txt.match(/```(?:json)?\s*([\s\S]*?)```/i);if(f&&f[1]){try{return{ok:true,parsed:JSON.parse(f[1].trim()),method:'MARKDOWN_JSON_FENCE'}}catch(e){return{ok:false,method:'MARKDOWN_JSON_FAIL',error:String(e.message||e)}}}const i=txt.indexOf('{'),j=txt.lastIndexOf('}');if(i>=0&&j>i){try{return{ok:true,parsed:JSON.parse(txt.slice(i,j+1)),method:'JSON_SUBSTRING'}}catch(e){}}const up=txt.toUpperCase();if(up.includes('REAL')||up.includes('LIVE'))return{ok:true,parsed:{liveness:'REAL',challenge_pass:true,confidence:.65,reason:'plain text'},method:'PLAIN_TEXT'};return{ok:false,parsed:null,method:'UNPARSEABLE',error:'no json'}}
function v11cNorm(p){p=p||{};let l=String(p.liveness||p.live||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')l=p.real?'REAL':'PHOTO';if(typeof p.is_live==='boolean')l=p.is_live?'REAL':'PHOTO';if(l.includes('REAL')||l.includes('LIVE'))l='REAL';else if(l.includes('PHOTO')||l.includes('PRINT'))l='PHOTO';else if(l.includes('SCREEN')||l.includes('REPLAY'))l='SCREEN';else l='UNKNOWN';let c=Number(p.confidence??p.score??0);if(c>1)c=c/100;if(!Number.isFinite(c))c=0;let cp=p.challenge_pass;if(typeof cp!=='boolean')cp=(l==='REAL'&&c>=.5);return{liveness:l,challenge_pass:cp,confidence:c,reason:String(p.reason||p.explanation||'')}}
async function v11cOpenAI(){const key=process.env.OPENAI_API_KEY||'',ap=v11cFramePath('A'),bp=v11cFramePath('B');const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',frame_a_bytes:fs.existsSync(ap)?fs.statSync(ap).size:0,frame_b_bytes:fs.existsSync(bp)?fs.statSync(bp).size:0,http_status:0,openai_ok:false,usage:null,raw_content:'',parse_ok:false,parse_method:'',parse_error:'',normalized:null};if(!key){d.parse_ok=true;d.parse_method='DEMO_NO_OPENAI_KEY';d.normalized={liveness:'REAL',challenge_pass:true,confidence:.51,reason:'demo'};return d}if(d.frame_a_bytes<1000||d.frame_b_bytes<1000){d.parse_error='Frame A/B image missing';d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}try{const a64=fs.readFileSync(ap).toString('base64'),b64=fs.readFileSync(bp).toString('base64');const body={model:d.model,messages:[{role:'user',content:[{type:'text',text:'Door access liveness challenge. Two images: Frame A before challenge, Frame B after user blinked or turned head. Return ONLY JSON: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","challenge_pass":true/false,"confidence":0-1,"reason":"short reason"}. challenge_pass true only if plausible live movement/change exists.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+a64}},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],temperature:0,max_tokens:180};const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});d.http_status=r.status;const j=await r.json();d.usage=j.usage||null;d.openai_ok=!!r.ok;if(!r.ok){d.raw_content=j.error?JSON.stringify(j.error):JSON.stringify(j).slice(0,1000);d.parse_error=j.error?(j.error.message||'OpenAI error'):('HTTP '+r.status);d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}d.raw_content=j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||''):'';const ex=v11cExtract(d.raw_content);d.parse_ok=ex.ok;d.parse_method=ex.method;d.parse_error=ex.error||'';d.normalized=ex.ok?v11cNorm(ex.parsed):{liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:ex.error||'parse failed'};return d}catch(e){d.parse_error=String(e.message||e);d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}}
app.post('/edu/liveness/challenge/reset',express.json({limit:'1mb'}),(_req,res)=>{const ch={challenge_id:'CHAL-'+Date.now().toString(36).toUpperCase(),instruction:'拍 Frame A，眨眼或轉頭，再拍 Frame B。',frame_a:null,frame_b:null,created_at:nowIso(),lesson:VERSION};v11cW('v11c_challenge.json',ch);res.json({ok:true,version:VERSION,challenge:ch})});
app.post('/edu/liveness/challenge/capture',express.json({limit:'1mb'}),async(req,res)=>{const label=String((req.body||{}).label||'A').toUpperCase()==='B'?'B':'A',latest=v11cLatest();if(!latest)return res.status(409).json({ok:false,version:VERSION,error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT'});const img=await v11cResolve(latest,req);if(!img.ok)return res.status(409).json({ok:false,version:VERSION,error:'IMAGE_NOT_FOUND',image:img});fs.writeFileSync(v11cFramePath(label),img.buffer);const ch=v11cChallenge();if(!ch.challenge_id)ch.challenge_id='CHAL-'+Date.now().toString(36).toUpperCase();ch['frame_'+label.toLowerCase()]={label,snapshot_id:latest.snapshot_id,master_uid:latest.master_uid,community_id:latest.community_id,community_name:latest.community_name,bytes:img.bytes,image_source:img.source,image_path:img.path,face_reason:latest.face_reason,created_at:nowIso()};ch.updated_at=nowIso();ch.lesson=VERSION;v11cW('v11c_challenge.json',ch);res.json({ok:true,version:VERSION,challenge:ch,captured:ch['frame_'+label.toLowerCase()]})});
app.post('/edu/face/openai-liveness-multiframe-match',express.json({limit:'1mb'}),async(req,res)=>{const body=req.body||{},uid=normalizeUid(body.master_uid||''),threshold=Number(body.threshold||70),liveThreshold=Number(body.liveness_confidence||.5);if(!uid)return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});const ch=v11cChallenge(),latest=v11cLatest()||{master_uid:uid,face_reason:(ch.frame_b&&ch.frame_b.face_reason)||'',snapshot_id:(ch.frame_b&&ch.frame_b.snapshot_id)||'',bytes:(ch.frame_b&&ch.frame_b.bytes)||0,community_id:(ch.frame_b&&ch.frame_b.community_id)||'',community_name:(ch.frame_b&&ch.frame_b.community_name)||''};const {db,best,best_score}=v11cBest(uid,latest);if(!db.length)return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY'});const debug=await v11cOpenAI(),n=debug.normalized||{liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:'no normalized'};const face_match=!!(best&&best_score>=threshold),live_ok=n.liveness==='REAL'&&n.challenge_pass===true&&Number(n.confidence||0)>=liveThreshold,allow_open=face_match&&live_ok;const cmd=allow_open?v11cQueue(latest.community_id||best.community_id,latest.community_name||best.community_name,uid,'V11C MATCH + multi-frame liveness REAL'):null;const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,challenge_id:ch.challenge_id||'',frame_a_snapshot_id:ch.frame_a?ch.frame_a.snapshot_id:'',frame_b_snapshot_id:ch.frame_b?ch.frame_b.snapshot_id:'',best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:n.liveness,challenge_pass:n.challenge_pass,liveness_mode:debug.has_openai_key?'OPENAI_MULTI_FRAME':'DEMO_NO_OPENAI_KEY',liveness_confidence:n.confidence,liveness_reason:n.reason,frame_a_bytes:debug.frame_a_bytes,frame_b_bytes:debug.frame_b_bytes,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_parse_error:debug.parse_error,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_CHALLENGE_NOT_PASS'),created_at:nowIso(),lesson:VERSION};const m=v11cMatches();m.unshift(rec);v11cW('edu_face_matches.json',m.slice(0,160));const logs=v11cLog();logs.unshift({debug_id:debug.debug_id,result:rec,debug});v11cW('openai_liveness_debug_log.json',logs.slice(0,120));res.json({ok:true,version:VERSION,result:rec,command:cmd,challenge:ch,best_face:best,openai_debug:debug})});
app.get('/edu/liveness/challenge/state',(_req,res)=>res.json({ok:true,version:VERSION,challenge:v11cChallenge(),logs:v11cLog().slice(0,5)}));
app.get('/edu/openai-liveness-multiframe',(_req,res)=>{const latest=v11cLatest(),faces=v11cDb(),ch=v11cChallenge(),logs=v11cLog(),matches=v11cMatches().filter(m=>String(m.lesson||'').includes('V11C')||m.challenge_id);let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'});if(!opts.length&&faces.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');const latestHtml=latest?`<div class="meta">最新 Candidate：${latest.snapshot_id}｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${m.challenge_pass?'PASS':'FAIL'}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.frame_a_bytes||0}/${m.frame_b_bytes||0}</td><td>${m.openai_http_status||''}</td><td>${m.openai_parse_method||''}</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="13">尚無 V11C 結果</td></tr>';const last=logs[0]&&logs[0].debug?logs[0].debug:null;const dbg=last?JSON.stringify({debug_id:last.debug_id,has_openai_key:last.has_openai_key,model:last.model,frame_a_bytes:last.frame_a_bytes,frame_b_bytes:last.frame_b_bytes,http_status:last.http_status,openai_ok:last.openai_ok,usage:last.usage,parse_ok:last.parse_ok,parse_method:last.parse_method,parse_error:last.parse_error,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 OpenAI multi-frame debug log';res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1180px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}.blue{background:#1677a8}.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:13px}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V11C MULTI-FRAME LIVENESS CHALLENGE</h1><p><a href="/edu/openai-liveness-image-source-fix">V11B</a> ｜ <a href="/edu/production-face-doorbell">V10</a> ｜ <a href="/edu/liveness/challenge/state">Challenge JSON</a></p><div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>2. 多幀活體挑戰</h2><p>重設挑戰 → ESP32 串口 s 拍 Frame A → 眨眼/轉頭 → ESP32 串口 s 拍 Frame B → OpenAI 多幀辨識。</p><button class="red" onclick="resetChallenge()">重設挑戰</button><button class="blue" onclick="cap('A')">擷取 Frame A</button><button class="blue" onclick="cap('B')">擷取 Frame B</button><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" min="1" max="100" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="0.5" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness <button onclick="doMatch()">OpenAI 多幀活體 + 人臉辨識</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div><div class="card"><h2>3. Challenge State</h2><pre>${JSON.stringify(ch,null,2).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div><div class="card"><h2>4. V11C Results</h2><table><thead><tr><th>Match</th><th>Name</th><th>Score</th><th>Live</th><th>Chal</th><th>Conf</th><th>A/B</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><h2>5. Last Multi-frame Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function setStatus(c,m){statusBox.className='status '+c;statusBox.textContent=m;}async function resetChallenge(){setStatus('warn','重設中...');const r=await fetch('/edu/liveness/challenge/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus('ok','✅ 已重設挑戰');setTimeout(()=>location.reload(),800)}async function cap(label){setStatus('warn','擷取 Frame '+label+'...');const r=await fetch('/edu/liveness/challenge/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok)setStatus('ok','✅ Frame '+label+' 已擷取 bytes='+(j.captured&&j.captured.bytes));else setStatus('err','❌ Frame '+label+' 失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),1000)}async function doMatch(){if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}setStatus('warn','⏳ OpenAI 多幀辨識中...');const r=await fetch('/edu/face/openai-liveness-multiframe-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / challenge PASS / '+j.result.command_id);else if(j.ok&&j.result)setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / challenge '+(j.result.challenge_pass?'PASS':'FAIL')+' / '+j.result.block_reason);else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),2500)}</script></body></html>`)});



// ===== V11D UNIQUE FRAME CAPTURE =====
// Prevents Frame B from using the same snapshot_id as Frame A.
// Adds:
//   GET  /edu/openai-liveness-unique-frame
//   POST /edu/liveness/challenge/capture-unique
//   GET  /edu/liveness/challenge/unique-state

function v11dR(n,d){const a=readJson(n,d);return Array.isArray(d)?(Array.isArray(a)?a:[]):(a&&typeof a==='object'?a:{})}
function v11dW(n,o){writeJson(n,o)}
function v11dLatest(){const a=v11dR('face_snapshots.json',[]);a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function v11dDb(){return v11dR('edu_face_db.json',[])}
function v11dMatches(){return v11dR('edu_face_matches.json',[])}
function v11dLog(){return v11dR('openai_liveness_debug_log.json',[])}
function v11dChallenge(){return v11dR('v11c_challenge.json',{})}
function v11dMetric(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function v11dMeta(o){const r=String(o&&o.face_reason||''),b=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin_pct:v11dMetric(r,'skin_pct'),ratio:v11dMetric(r,'ratio'),box_w:b?+b[1]:0,box_h:b?+b[2]:0,cx:c?+c[1]:0,cy:c?+c[2]:0,bytes:+(o&&o.bytes||0)}}
function v11dScore(a0,b0){const a=v11dMeta(a0),b=v11dMeta(b0);if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.box_w-b.box_w)*.55);s-=Math.min(18,Math.abs(a.box_h-b.box_h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function v11dBest(uid,latest){const db=v11dDb().filter(f=>!uid||f.master_uid===uid);let best=null,best_score=0;for(const f of db){const s=v11dScore(latest,f);if(s>best_score){best=f;best_score=s}}return{db,best,best_score}}
function v11dFramePath(label){return path.join(DATA_DIR,'v11c_frame_'+label+'.jpg')}
function v11dBase(req){if(process.env.RAILWAY_PUBLIC_DOMAIN)return'https://'+process.env.RAILWAY_PUBLIC_DOMAIN;if(process.env.RAILWAY_STATIC_URL)return process.env.RAILWAY_STATIC_URL;if(req&&req.headers&&req.headers.host)return(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;return''}
async function v11dResolve(latest,req){
  const base=v11dBase(req);
  if(latest&&latest.image_url&&base){
    const url=base+(String(latest.image_url).startsWith('/')?latest.image_url:'/'+latest.image_url);
    try{
      const r=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{headers:{'Cache-Control':'no-cache'}});
      const buf=Buffer.from(await r.arrayBuffer());
      if(r.ok&&buf.length>1000)return{ok:true,buffer:buf,source:'SELF_FETCH_IMAGE_URL',path:url,bytes:buf.length,http_status:r.status};
      return{ok:false,error:'self fetch failed',bytes:buf.length,status:r.status,path:url}
    }catch(e){return{ok:false,error:String(e.message||e),path:url}}
  }
  return{ok:false,error:'no latest image url'}
}
function v11dQueue(cid,cname,uid,note){
  let commands=readJson('commands.json',[]);
  const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'OPENAI_LIVENESS_UNIQUE_FRAME_CAPTURE',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};
  commands.unshift(cmd);writeJson('commands.json',commands.slice(0,50));return cmd
}
function v11dExtract(raw){const txt=String(raw||'').trim();if(!txt)return{ok:false,parsed:null,method:'EMPTY',error:'empty'};try{return{ok:true,parsed:JSON.parse(txt),method:'DIRECT_JSON'}}catch(e){}const f=txt.match(/```(?:json)?\s*([\s\S]*?)```/i);if(f&&f[1]){try{return{ok:true,parsed:JSON.parse(f[1].trim()),method:'MARKDOWN_JSON_FENCE'}}catch(e){return{ok:false,method:'MARKDOWN_JSON_FAIL',error:String(e.message||e)}}}const i=txt.indexOf('{'),j=txt.lastIndexOf('}');if(i>=0&&j>i){try{return{ok:true,parsed:JSON.parse(txt.slice(i,j+1)),method:'JSON_SUBSTRING'}}catch(e){}}const up=txt.toUpperCase();if(up.includes('REAL')||up.includes('LIVE'))return{ok:true,parsed:{liveness:'REAL',challenge_pass:true,confidence:.65,reason:'plain text'},method:'PLAIN_TEXT'};return{ok:false,parsed:null,method:'UNPARSEABLE',error:'no json'}}
function v11dNorm(p){p=p||{};let l=String(p.liveness||p.live||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')l=p.real?'REAL':'PHOTO';if(typeof p.is_live==='boolean')l=p.is_live?'REAL':'PHOTO';if(l.includes('REAL')||l.includes('LIVE'))l='REAL';else if(l.includes('PHOTO')||l.includes('PRINT'))l='PHOTO';else if(l.includes('SCREEN')||l.includes('REPLAY'))l='SCREEN';else l='UNKNOWN';let c=Number(p.confidence??p.score??0);if(c>1)c=c/100;if(!Number.isFinite(c))c=0;let cp=p.challenge_pass;if(typeof cp!=='boolean')cp=(l==='REAL'&&c>=.5);return{liveness:l,challenge_pass:cp,confidence:c,reason:String(p.reason||p.explanation||'')}}
async function v11dOpenAI(){
  const key=process.env.OPENAI_API_KEY||'',ap=v11dFramePath('A'),bp=v11dFramePath('B');
  const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',frame_a_bytes:fs.existsSync(ap)?fs.statSync(ap).size:0,frame_b_bytes:fs.existsSync(bp)?fs.statSync(bp).size:0,http_status:0,openai_ok:false,usage:null,raw_content:'',parse_ok:false,parse_method:'',parse_error:'',normalized:null};
  if(!key){d.parse_ok=true;d.parse_method='DEMO_NO_OPENAI_KEY';d.normalized={liveness:'REAL',challenge_pass:true,confidence:.51,reason:'demo'};return d}
  if(d.frame_a_bytes<1000||d.frame_b_bytes<1000){d.parse_error='Frame A/B image missing';d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}
  try{
    const a64=fs.readFileSync(ap).toString('base64'),b64=fs.readFileSync(bp).toString('base64');
    const body={model:d.model,messages:[{role:'user',content:[
      {type:'text',text:'Door access liveness challenge. Frame A is before challenge. Frame B is after user was asked to blink or turn head. Return ONLY JSON: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","challenge_pass":true/false,"confidence":0-1,"reason":"short reason"}. challenge_pass true only if plausible live movement/change exists. If the frames are same or nearly same, return PHOTO or UNKNOWN and challenge_pass false.'},
      {type:'image_url',image_url:{url:'data:image/jpeg;base64,'+a64}},
      {type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}
    ]}],temperature:0,max_tokens:180};
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    d.http_status=r.status;const j=await r.json();d.usage=j.usage||null;d.openai_ok=!!r.ok;
    if(!r.ok){d.raw_content=j.error?JSON.stringify(j.error):JSON.stringify(j).slice(0,1000);d.parse_error=j.error?(j.error.message||'OpenAI error'):('HTTP '+r.status);d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}
    d.raw_content=j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||''):'';
    const ex=v11dExtract(d.raw_content);d.parse_ok=ex.ok;d.parse_method=ex.method;d.parse_error=ex.error||'';d.normalized=ex.ok?v11dNorm(ex.parsed):{liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:ex.error||'parse failed'};return d
  }catch(e){d.parse_error=String(e.message||e);d.normalized={liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:d.parse_error};return d}
}
app.post('/edu/liveness/challenge/unique-reset',express.json({limit:'1mb'}),(_req,res)=>{
  try{ if(fs.existsSync(v11dFramePath('A'))) fs.unlinkSync(v11dFramePath('A')); if(fs.existsSync(v11dFramePath('B'))) fs.unlinkSync(v11dFramePath('B')); }catch(e){}
  const ch={challenge_id:'CHAL-'+Date.now().toString(36).toUpperCase(),instruction:'拍 Frame A；眨眼或轉頭；再拍新的 Frame B。Frame B 必須是不同 snapshot_id。',frame_a:null,frame_b:null,created_at:nowIso(),lesson:VERSION};
  v11dW('v11c_challenge.json',ch);res.json({ok:true,version:VERSION,challenge:ch})
});
app.post('/edu/liveness/challenge/capture-unique',express.json({limit:'1mb'}),async(req,res)=>{
  const body=req.body||{},label=String(body.label||'A').toUpperCase()==='B'?'B':'A',latest=v11dLatest(),ch=v11dChallenge();
  if(!latest)return res.status(409).json({ok:false,version:VERSION,error:'NO_LATEST_FACE_GATE_PASS_SNAPSHOT'});
  if(label==='B'&&ch.frame_a&&ch.frame_a.snapshot_id&&latest.snapshot_id===ch.frame_a.snapshot_id){
    return res.status(409).json({ok:false,version:VERSION,error:'SAME_SNAPSHOT_DETECTED',note:'Frame B 必須先讓 ESP32 串口重新輸入 s，上傳新的 snapshot_id 後才能擷取。',frame_a_snapshot_id:ch.frame_a.snapshot_id,latest_snapshot_id:latest.snapshot_id,challenge:ch});
  }
  if(label==='A'&&ch.frame_b&&ch.frame_b.snapshot_id&&latest.snapshot_id===ch.frame_b.snapshot_id){
    return res.status(409).json({ok:false,version:VERSION,error:'SAME_AS_EXISTING_FRAME_B',note:'請先按重設挑戰。',latest_snapshot_id:latest.snapshot_id,challenge:ch});
  }
  const img=await v11dResolve(latest,req);
  if(!img.ok)return res.status(409).json({ok:false,version:VERSION,error:'IMAGE_NOT_FOUND',image:img});
  fs.writeFileSync(v11dFramePath(label),img.buffer);
  if(!ch.challenge_id) ch.challenge_id='CHAL-'+Date.now().toString(36).toUpperCase();
  ch['frame_'+label.toLowerCase()]={label,snapshot_id:latest.snapshot_id,master_uid:latest.master_uid,community_id:latest.community_id,community_name:latest.community_name,bytes:img.bytes,image_source:img.source,image_path:img.path,face_reason:latest.face_reason,created_at:nowIso()};
  ch.updated_at=nowIso();ch.lesson=VERSION;v11dW('v11c_challenge.json',ch);
  res.json({ok:true,version:VERSION,challenge:ch,captured:ch['frame_'+label.toLowerCase()],unique_ok:true})
});
app.post('/edu/face/openai-liveness-unique-frame-match',express.json({limit:'1mb'}),async(req,res)=>{
  const body=req.body||{},uid=normalizeUid(body.master_uid||''),threshold=Number(body.threshold||70),liveThreshold=Number(body.liveness_confidence||.5),ch=v11dChallenge();
  if(!uid)return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});
  if(!ch.frame_a||!ch.frame_b)return res.status(409).json({ok:false,version:VERSION,error:'FRAME_A_B_REQUIRED',challenge:ch});
  if(ch.frame_a.snapshot_id===ch.frame_b.snapshot_id)return res.status(409).json({ok:false,version:VERSION,error:'SAME_SNAPSHOT_DETECTED_BEFORE_OPENAI',note:'A/B 是同一張，不送 OpenAI。請重新拍 Frame B。',challenge:ch});
  const latest={master_uid:uid,face_reason:ch.frame_b.face_reason||'',snapshot_id:ch.frame_b.snapshot_id||'',bytes:ch.frame_b.bytes||0,community_id:ch.frame_b.community_id||'',community_name:ch.frame_b.community_name||''};
  const {db,best,best_score}=v11dBest(uid,latest);if(!db.length)return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY'});
  const debug=await v11dOpenAI(),n=debug.normalized||{liveness:'UNKNOWN',challenge_pass:false,confidence:0,reason:'no normalized'};
  const face_match=!!(best&&best_score>=threshold),live_ok=n.liveness==='REAL'&&n.challenge_pass===true&&Number(n.confidence||0)>=liveThreshold,allow_open=face_match&&live_ok;
  const cmd=allow_open?v11dQueue(latest.community_id||best.community_id,latest.community_name||best.community_name,uid,'V11D unique A/B + multi-frame liveness REAL'):null;
  const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,challenge_id:ch.challenge_id||'',frame_a_snapshot_id:ch.frame_a.snapshot_id,frame_b_snapshot_id:ch.frame_b.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:n.liveness,challenge_pass:n.challenge_pass,liveness_mode:debug.has_openai_key?'OPENAI_UNIQUE_FRAME':'DEMO_NO_OPENAI_KEY',liveness_confidence:n.confidence,liveness_reason:n.reason,frame_a_bytes:debug.frame_a_bytes,frame_b_bytes:debug.frame_b_bytes,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_parse_error:debug.parse_error,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_CHALLENGE_NOT_PASS'),created_at:nowIso(),lesson:VERSION};
  const m=v11dMatches();m.unshift(rec);v11dW('edu_face_matches.json',m.slice(0,180));const logs=v11dLog();logs.unshift({debug_id:debug.debug_id,result:rec,debug});v11dW('openai_liveness_debug_log.json',logs.slice(0,140));res.json({ok:true,version:VERSION,result:rec,command:cmd,challenge:ch,best_face:best,openai_debug:debug})
});
app.get('/edu/liveness/challenge/unique-state',(_req,res)=>res.json({ok:true,version:VERSION,challenge:v11dChallenge(),latest:v11dLatest(),logs:v11dLog().slice(0,5)}));
app.get('/edu/openai-liveness-unique-frame',(_req,res)=>{
  const latest=v11dLatest(),faces=v11dDb(),ch=v11dChallenge(),logs=v11dLog(),matches=v11dMatches().filter(m=>String(m.lesson||'').includes('V11D')||m.liveness_mode==='OPENAI_UNIQUE_FRAME');
  let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'});if(!opts.length&&faces.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml=latest?`<div class="meta">最新 Snapshot：<b>${latest.snapshot_id}</b>｜${latest.community_name||''}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p>尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';
  const same=(ch.frame_a&&ch.frame_b&&ch.frame_a.snapshot_id===ch.frame_b.snapshot_id);
  const guard=same?'<div class="status err">❌ SAME_SNAPSHOT_DETECTED：Frame A/B 是同一張，請重新拍 Frame B。</div>':'<div class="status ok">✅ Unique Guard Ready：Frame B 會被要求不同 snapshot_id。</div>';
  const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${m.challenge_pass?'PASS':'FAIL'}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.frame_a_snapshot_id||''}</td><td>${m.frame_b_snapshot_id||''}</td><td>${m.openai_http_status||''}</td><td>${m.openai_parse_method||''}</td><td style="font-weight:800;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="14">尚無 V11D 結果</td></tr>';
  const last=logs[0]&&logs[0].debug?logs[0].debug:null;const dbg=last?JSON.stringify({debug_id:last.debug_id,model:last.model,frame_a_bytes:last.frame_a_bytes,frame_b_bytes:last.frame_b_bytes,http_status:last.http_status,openai_ok:last.openai_ok,usage:last.usage,parse_ok:last.parse_ok,parse_method:last.parse_method,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 V11D debug log';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1220px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:800;padding:12px 16px;margin:6px}.blue{background:#1677a8}.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:13px}.meta{color:#617085;margin:8px 0}.status{font-weight:800;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V11D UNIQUE FRAME CAPTURE</h1><p><a href="/edu/openai-liveness-multiframe">V11C</a> ｜ <a href="/edu/liveness/challenge/unique-state">Unique State JSON</a> ｜ <a href="/edu/production-face-doorbell">V10</a></p><div class="card"><h2>1. 最新 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>2. Unique Frame 活體挑戰</h2>${guard}<p>重設 → ESP32 串口 s → 擷取 A → 眨眼/轉頭 → ESP32 串口再輸入 s → 擷取 B。若 B 的 snapshot_id 與 A 相同，系統會拒絕。</p><button class="red" onclick="resetChallenge()">重設挑戰</button><button class="blue" onclick="cap('A')">擷取 Frame A</button><button class="blue" onclick="cap('B')">擷取 Frame B（必須新 snapshot）</button><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" min="1" max="100" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="0.5" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness <button onclick="doMatch()">OpenAI Unique A/B 活體 + 人臉辨識</button><div id="statusBox" class="status">READY</div><pre id="result">READY</pre></div><div class="card"><h2>3. Challenge State</h2><pre>${JSON.stringify(ch,null,2).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div><div class="card"><h2>4. V11D Results</h2><table><thead><tr><th>Match</th><th>Name</th><th>Score</th><th>Live</th><th>Chal</th><th>Conf</th><th>Frame A</th><th>Frame B</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><h2>5. Last Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function setStatus(c,m){statusBox.className='status '+c;statusBox.textContent=m;}async function resetChallenge(){setStatus('warn','重設中...');const r=await fetch('/edu/liveness/challenge/unique-reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus('ok','✅ 已重設挑戰');setTimeout(()=>location.reload(),800)}async function cap(label){setStatus('warn','擷取 Frame '+label+'...');const r=await fetch('/edu/liveness/challenge/capture-unique',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok)setStatus('ok','✅ Frame '+label+' 已擷取 snapshot='+(j.captured&&j.captured.snapshot_id));else setStatus('err','❌ Frame '+label+' 失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),1200)}async function doMatch(){if(!master_uid.value){setStatus('err','❌ 尚未有 Master UID');return;}setStatus('warn','⏳ OpenAI Unique A/B 辨識中...');const r=await fetch('/edu/face/openai-liveness-unique-frame-match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / challenge PASS / '+j.result.command_id);else if(j.ok&&j.result)setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / challenge '+(j.result.challenge_pass?'PASS':'FAIL')+' / '+j.result.block_reason);else setStatus('err','❌ 辨識失敗：'+(j.error||'UNKNOWN'));setTimeout(()=>location.reload(),2600)}</script></body></html>`)});



// ===== V12A ESP32 AUTO FACE_GATE RECOGNITION =====
// Goal: return to production-like flow.
// 1) ESP32 automatically FACE_GATE_PASS and uploads candidate snapshot.
// 2) Railway automatically processes the latest new candidate.
// 3) Face DB match + OpenAI single-snapshot liveness verification.
// 4) MATCH + LIVENESS=REAL => queue OPEN_DOOR.
// Web page is monitor/control only; it is not Frame A/B manual capture.

function v12aR(n,d){const a=readJson(n,d);return Array.isArray(d)?(Array.isArray(a)?a:[]):(a&&typeof a==='object'?a:{})}
function v12aW(n,o){writeJson(n,o)}
function v12aState(){return v12aR('v12a_auto_face_state.json',{enabled:false,last_processed_snapshot_id:'',last_match_id:'',updated_at:'',lesson:VERSION})}
function v12aSaveState(s){s=s&&typeof s==='object'?s:{};s.lesson=VERSION;s.updated_at=nowIso();v12aW('v12a_auto_face_state.json',s);return s}
function v12aLatest(){const a=v12aR('face_snapshots.json',[]);a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function v12aDb(){return v12aR('edu_face_db.json',[])}
function v12aMatches(){return v12aR('edu_face_matches.json',[])}
function v12aLog(){return v12aR('openai_liveness_debug_log.json',[])}
function v12aMetric(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function v12aMeta(o){const r=String(o&&o.face_reason||''),b=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin_pct:v12aMetric(r,'skin_pct'),ratio:v12aMetric(r,'ratio'),box_w:b?+b[1]:0,box_h:b?+b[2]:0,cx:c?+c[1]:0,cy:c?+c[2]:0,bytes:+(o&&o.bytes||0)}}
function v12aScore(a0,b0){const a=v12aMeta(a0),b=v12aMeta(b0);if(!a.skin_pct||!b.skin_pct||!a.box_w||!b.box_w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin_pct-b.skin_pct)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.box_w-b.box_w)*.55);s-=Math.min(18,Math.abs(a.box_h-b.box_h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function v12aBest(uid,latest){const db=v12aDb().filter(f=>!uid||f.master_uid===uid);let best=null,best_score=0;for(const f of db){const s=v12aScore(latest,f);if(s>best_score){best=f;best_score=s}}return{db,best,best_score}}
function v12aBase(req){if(process.env.RAILWAY_PUBLIC_DOMAIN)return'https://'+process.env.RAILWAY_PUBLIC_DOMAIN;if(process.env.RAILWAY_STATIC_URL)return process.env.RAILWAY_STATIC_URL;if(req&&req.headers&&req.headers.host)return(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;return''}
async function v12aFetchLatestImage(latest,req){
  const base=v12aBase(req);
  if(latest&&latest.image_url&&base){
    const url=base+(String(latest.image_url).startsWith('/')?latest.image_url:'/'+latest.image_url);
    try{
      const r=await fetch(url+(url.includes('?')?'&':'?')+'_='+Date.now(),{headers:{'Cache-Control':'no-cache'}});
      const buf=Buffer.from(await r.arrayBuffer());
      if(r.ok&&buf.length>1000)return{ok:true,buffer:buf,source:'SELF_FETCH_IMAGE_URL',path:url,bytes:buf.length,http_status:r.status};
      return{ok:false,error:'self fetch failed',bytes:buf.length,status:r.status,path:url}
    }catch(e){return{ok:false,error:String(e.message||e),path:url}}
  }
  return{ok:false,error:'no latest image url'}
}
function v12aQueue(cid,cname,uid,note){
  let commands=readJson('commands.json',[]);
  const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'V12A_AUTO_FACE_GATE_RECOGNITION',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:note||'',lesson:VERSION};
  commands.unshift(cmd);writeJson('commands.json',commands.slice(0,60));return cmd
}
function v12aExtract(raw){const txt=String(raw||'').trim();if(!txt)return{ok:false,parsed:null,method:'EMPTY',error:'empty'};try{return{ok:true,parsed:JSON.parse(txt),method:'DIRECT_JSON'}}catch(e){}const f=txt.match(/```(?:json)?\s*([\s\S]*?)```/i);if(f&&f[1]){try{return{ok:true,parsed:JSON.parse(f[1].trim()),method:'MARKDOWN_JSON_FENCE'}}catch(e){return{ok:false,method:'MARKDOWN_JSON_FAIL',error:String(e.message||e)}}}const i=txt.indexOf('{'),j=txt.lastIndexOf('}');if(i>=0&&j>i){try{return{ok:true,parsed:JSON.parse(txt.slice(i,j+1)),method:'JSON_SUBSTRING'}}catch(e){}}const up=txt.toUpperCase();if(up.includes('REAL')||up.includes('LIVE'))return{ok:true,parsed:{liveness:'REAL',confidence:.65,reason:'plain text'},method:'PLAIN_TEXT'};return{ok:false,parsed:null,method:'UNPARSEABLE',error:'no json'}}
function v12aNorm(p){p=p||{};let l=String(p.liveness||p.live||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')l=p.real?'REAL':'PHOTO';if(typeof p.is_live==='boolean')l=p.is_live?'REAL':'PHOTO';if(l.includes('REAL')||l.includes('LIVE'))l='REAL';else if(l.includes('PHOTO')||l.includes('PRINT'))l='PHOTO';else if(l.includes('SCREEN')||l.includes('REPLAY'))l='SCREEN';else l='UNKNOWN';let c=Number(p.confidence??p.score??0);if(c>1)c=c/100;if(!Number.isFinite(c))c=0;return{liveness:l,confidence:c,reason:String(p.reason||p.explanation||'')}}
async function v12aOpenAISingle(latest,req){
  const key=process.env.OPENAI_API_KEY||'',img=await v12aFetchLatestImage(latest,req);
  const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',snapshot_id:latest&&latest.snapshot_id||'',image_ok:img.ok,image_bytes:img.bytes||0,image_path:img.path||'',image_error:img.error||'',http_status:0,openai_ok:false,usage:null,raw_content:'',parse_ok:false,parse_method:'',parse_error:'',normalized:null};
  if(!img.ok){d.normalized={liveness:'UNKNOWN',confidence:0,reason:'image not found'};d.parse_error='image not found';return d}
  if(!key){d.parse_ok=true;d.parse_method='DEMO_NO_OPENAI_KEY';d.normalized={liveness:'REAL',confidence:.51,reason:'demo no openai key'};return d}
  try{
    const b64=img.buffer.toString('base64');
    const body={model:d.model,messages:[{role:'user',content:[
      {type:'text',text:'RT7 door access liveness check. The ESP32 already detected a human face and uploaded this candidate snapshot. Decide if this looks like a real live person in front of a camera rather than a printed photo or screen replay. Return ONLY JSON: {"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","confidence":0-1,"reason":"short reason"}. Be conservative if image quality is poor.'},
      {type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}
    ]}],temperature:0,max_tokens:160};
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});
    d.http_status=r.status;const j=await r.json();d.usage=j.usage||null;d.openai_ok=!!r.ok;
    if(!r.ok){d.raw_content=j.error?JSON.stringify(j.error):JSON.stringify(j).slice(0,1000);d.parse_error=j.error?(j.error.message||'OpenAI error'):('HTTP '+r.status);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}
    d.raw_content=j.choices&&j.choices[0]&&j.choices[0].message?String(j.choices[0].message.content||''):'';
    const ex=v12aExtract(d.raw_content);d.parse_ok=ex.ok;d.parse_method=ex.method;d.parse_error=ex.error||'';d.normalized=ex.ok?v12aNorm(ex.parsed):{liveness:'UNKNOWN',confidence:0,reason:ex.error||'parse failed'};
    return d
  }catch(e){d.parse_error=String(e.message||e);d.normalized={liveness:'UNKNOWN',confidence:0,reason:d.parse_error};return d}
}
async function v12aProcessLatest(req,opts){
  opts=opts||{};
  const state=v12aState(),latest=v12aLatest(),threshold=Number(opts.threshold||state.threshold||70),liveThreshold=Number(opts.liveness_confidence||state.liveness_confidence||.5);
  if(!latest)return{ok:false,version:VERSION,error:'NO_FACE_GATE_PASS_CANDIDATE',state};
  if(opts.skip_processed!==false && state.last_processed_snapshot_id===latest.snapshot_id){
    return{ok:true,version:VERSION,skipped:true,reason:'ALREADY_PROCESSED',latest,state};
  }
  const uid=normalizeUid(latest.master_uid||opts.master_uid||'');
  if(!uid)return{ok:false,version:VERSION,error:'MISSING_MASTER_UID',latest,state};
  const {db,best,best_score}=v12aBest(uid,latest);
  if(!db.length)return{ok:false,version:VERSION,error:'FACE_DB_EMPTY',latest,state};
  const debug=await v12aOpenAISingle(latest,req),n=debug.normalized||{liveness:'UNKNOWN',confidence:0,reason:'no normalized'};
  const face_match=!!(best&&best_score>=threshold);
  const live_ok=n.liveness==='REAL'&&Number(n.confidence||0)>=liveThreshold;
  const allow_open=face_match&&live_ok;
  const cmd=allow_open?v12aQueue(latest.community_id||best.community_id,latest.community_name||best.community_name,uid,'V12A AUTO FACE_GATE MATCH + LIVENESS REAL'):null;
  const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,snapshot_id:latest.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:best_score,threshold,face_match,liveness:n.liveness,liveness_mode:debug.has_openai_key?'OPENAI_SINGLE_AUTO_FACE_GATE':'DEMO_NO_OPENAI_KEY',liveness_confidence:n.confidence,liveness_reason:n.reason,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_parse_error:debug.parse_error,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'LIVENESS_NOT_REAL'),created_at:nowIso(),lesson:VERSION};
  const m=v12aMatches();m.unshift(rec);v12aW('edu_face_matches.json',m.slice(0,200));
  const logs=v12aLog();logs.unshift({debug_id:debug.debug_id,result:rec,debug});v12aW('openai_liveness_debug_log.json',logs.slice(0,160));
  const next=Object.assign({},state,{last_processed_snapshot_id:latest.snapshot_id,last_match_id:rec.match_id,last_result:rec,threshold,liveness_confidence:liveThreshold});
  v12aSaveState(next);
  return{ok:true,version:VERSION,result:rec,command:cmd,latest,best_face:best,openai_debug:debug,state:next}
}
app.post('/api/v12a/auto/enable',express.json({limit:'1mb'}),(req,res)=>{
  const body=req.body||{},s=v12aState();
  s.enabled=body.enabled!==false;
  s.threshold=Number(body.threshold||s.threshold||70);
  s.liveness_confidence=Number(body.liveness_confidence||s.liveness_confidence||.5);
  v12aSaveState(s);
  res.json({ok:true,version:VERSION,state:s})
});
app.post('/api/v12a/auto/reset',express.json({limit:'1mb'}),(_req,res)=>{
  const s=v12aSaveState({enabled:false,last_processed_snapshot_id:'',last_match_id:'',last_result:null,threshold:70,liveness_confidence:.5});
  res.json({ok:true,version:VERSION,state:s})
});
app.post('/api/v12a/auto/process-latest',express.json({limit:'1mb'}),async(req,res)=>{
  try{res.json(await v12aProcessLatest(req,Object.assign({},req.body||{},{skip_processed:false})))}catch(e){res.status(500).json({ok:false,version:VERSION,error:String(e.message||e),stack:String(e.stack||'').slice(0,1500)})}
});
app.get('/api/v12a/auto/state',async(req,res)=>{
  const state=v12aState(),latest=v12aLatest();
  let processed=null;
  if(state.enabled && latest && state.last_processed_snapshot_id!==latest.snapshot_id){
    try{processed=await v12aProcessLatest(req,{skip_processed:true})}catch(e){processed={ok:false,error:String(e.message||e)}}
  }
  res.json({ok:true,version:VERSION,state:v12aState(),latest,snapshot_count:v12aR('face_snapshots.json',[]).length,face_db_count:v12aDb().length,processed})
});
app.get('/edu/auto-face-gate-recognition',(_req,res)=>{
  const latest=v12aLatest(),state=v12aState(),faces=v12aDb(),matches=v12aMatches().filter(m=>String(m.lesson||'').includes('V12A')||m.liveness_mode==='OPENAI_SINGLE_AUTO_FACE_GATE').slice(0,20);
  let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新 Snapshot'});if(!opts.length&&faces.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=true)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');
  const latestHtml=latest?`<div class="meta">最新 Candidate：<b>${latest.snapshot_id}</b>｜${latest.community_name||''}｜face_gate=${latest.face_gate}｜face_count=${latest.face_count}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p class="bad">尚未收到 FACE_GATE_PASS Candidate Snapshot。請讓 ESP32 自動 FACE_GATE_PASS 上傳。</p>';
  const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.snapshot_id||''}</td><td>${m.best_name||''}</td><td>${m.match_score}%</td><td>${m.liveness}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.openai_http_status||''}</td><td>${m.openai_parse_method||''}</td><td style="font-weight:900;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="12">尚無 V12A 結果</td></tr>';
  const last=v12aLog()[0]&&v12aLog()[0].debug?v12aLog()[0].debug:null;
  const dbg=last?JSON.stringify({debug_id:last.debug_id,model:last.model,snapshot_id:last.snapshot_id,image_ok:last.image_ok,image_bytes:last.image_bytes,http_status:last.http_status,openai_ok:last.openai_ok,parse_ok:last.parse_ok,parse_method:last.parse_method,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 V12A debug log';
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1220px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:900;padding:12px 16px;margin:6px}.blue{background:#1677a8}.red{background:#c9342d}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:13px}.meta{color:#617085;margin:8px 0}.status{font-weight:900;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}.bad{color:#b11111;font-weight:900}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V12A AUTO FACE_GATE RECOGNITION</h1><p><a href="/edu/face-recognition">第九堂註冊</a> ｜ <a href="/edu/face-gate/state">FACE_GATE state</a> ｜ <a href="/api/v12a/auto/state">V12A state JSON</a></p><div class="card"><h2>1. 正式流程說明</h2><pre>人在 ESP32 鏡頭前
↓
ESP32 自動 human_face_detect / FACE_GATE
↓
FACE_GATE_PASS 才自動 POST Candidate Snapshot
↓
Railway 自動 Face Match
↓
OpenAI Liveness
↓
MATCH + LIVENESS=REAL 才送 OPEN_DOOR</pre></div><div class="card"><h2>2. 最新 ESP32 FACE_GATE Candidate Snapshot</h2>${latestHtml}</div><div class="card"><h2>3. Auto Recognition 控制</h2><select id="master_uid">${opts}</select><input id="threshold" type="number" value="${state.threshold||70}" min="1" max="100" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="${state.liveness_confidence||0.5}" min="0" max="1" step="0.1" style="width:90px;min-width:90px"> liveness <button onclick="enableAuto()">啟用自動辨識</button><button class="red" onclick="disableAuto()">關閉自動辨識</button><button class="blue" onclick="processNow()">立即處理最新 Candidate</button><button class="red" onclick="resetState()">清除 V12A 狀態</button><div id="statusBox" class="status ${state.enabled?'ok':'warn'}">${state.enabled?'AUTO ENABLED':'AUTO DISABLED'}</div><pre id="result">${JSON.stringify(state,null,2)}</pre></div><div class="card"><h2>4. V12A Match Results</h2><table><thead><tr><th>Match</th><th>Snapshot</th><th>Name</th><th>Score</th><th>Live</th><th>Conf</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><h2>5. Last OpenAI Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function setStatus(c,m){statusBox.className='status '+c;statusBox.textContent=m;}async function enableAuto(){setStatus('warn','啟用中...');const r=await fetch('/api/v12a/auto/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus('ok','✅ AUTO ENABLED');}async function disableAuto(){const r=await fetch('/api/v12a/auto/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:false})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus('warn','AUTO DISABLED');}async function resetState(){const r=await fetch('/api/v12a/auto/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const j=await r.json();result.textContent=JSON.stringify(j,null,2);setStatus('warn','CLEARED');setTimeout(()=>location.reload(),800)}async function processNow(){setStatus('warn','⏳ 處理最新 Candidate...');const r=await fetch('/api/v12a/auto/process-latest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||0.5)})});const j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)setStatus('ok','✅ OPEN：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / '+j.result.command_id);else if(j.ok&&j.result)setStatus('err','🔒 LOCK：MATCH '+j.result.match_score+'% / '+j.result.liveness+' / '+j.result.block_reason);else setStatus('err','❌ '+(j.error||j.reason||'UNKNOWN'));setTimeout(()=>location.reload(),2200)}async function poll(){try{const r=await fetch('/api/v12a/auto/state?_='+Date.now());const j=await r.json();if(j.processed&&j.processed.result){result.textContent=JSON.stringify(j.processed,null,2);if(j.processed.result.allow_open)setStatus('ok','✅ AUTO OPEN '+j.processed.result.command_id);else setStatus('err','AUTO LOCK '+j.processed.result.block_reason);setTimeout(()=>location.reload(),1200)}}catch(e){}}setInterval(poll,3500);</script></body></html>`)});



// ===== V12B TWO STEP CHALLENGE (LEFT/RIGHT) =====
function bR(n,d){const a=readJson(n,d);return Array.isArray(d)?(Array.isArray(a)?a:[]):(a&&typeof a==='object'?a:{})}
function bW(n,o){writeJson(n,o)}
function bLatest(){const a=bR('face_snapshots.json',[]);a.sort((x,y)=>String(y.created_at||'').localeCompare(String(x.created_at||'')));return a.find(s=>String(s.face_gate||'').toUpperCase()==='PASS'&&Number(s.face_count||0)>0)||null}
function bCh(){return bR('v12b_two_step_challenge.json',{})}
function bDb(){return bR('edu_face_db.json',[])}
function bMatches(){return bR('edu_face_matches.json',[])}
function bLogs(){return bR('openai_liveness_debug_log.json',[])}
function bFrame(l){return path.join(DATA_DIR,'v12b_frame_'+l+'.jpg')}
function bBase(req){if(process.env.RAILWAY_PUBLIC_DOMAIN)return'https://'+process.env.RAILWAY_PUBLIC_DOMAIN;if(req&&req.headers&&req.headers.host)return(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host;return''}
async function bImg(latest,req){const base=bBase(req);if(!base||!latest||!latest.image_url)return{ok:false,error:'no image url'};const url=base+(latest.image_url.startsWith('/')?latest.image_url:'/'+latest.image_url);try{const r=await fetch(url+'?_='+Date.now(),{headers:{'Cache-Control':'no-cache'}});const buf=Buffer.from(await r.arrayBuffer());return r.ok&&buf.length>1000?{ok:true,buffer:buf,bytes:buf.length,path:url}:{ok:false,error:'fetch failed',status:r.status,bytes:buf.length,path:url}}catch(e){return{ok:false,error:String(e.message||e),path:url}}}
function bM(t,n){const m=String(t||'').match(new RegExp(n+'=([0-9.]+)'));return m?Number(m[1]):0}
function bMeta(o){const r=String(o&&o.face_reason||''),bb=r.match(/box=([0-9]+)x([0-9]+)/),c=r.match(/center=([0-9]+),([0-9]+)/);return{skin:bM(r,'skin_pct'),ratio:bM(r,'ratio'),w:bb?+bb[1]:0,h:bb?+bb[2]:0,cx:c?+c[1]:0,cy:c?+c[2]:0,bytes:+(o&&o.bytes||0)}}
function bScore(a0,b0){const a=bMeta(a0),b=bMeta(b0);if(!a.skin||!b.skin||!a.w||!b.w)return 0;let s=100;s-=Math.min(28,Math.abs(a.skin-b.skin)*2);s-=Math.min(22,Math.abs(a.ratio-b.ratio)*30);s-=Math.min(18,Math.abs(a.w-b.w)*.55);s-=Math.min(18,Math.abs(a.h-b.h)*.55);s-=Math.min(14,(Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy))*.7);s-=Math.min(10,Math.abs(a.bytes-b.bytes)/400);return Math.max(0,Math.min(100,Math.round(s)))}
function bBest(uid,latest){const db=bDb().filter(f=>!uid||f.master_uid===uid);let best=null,score=0;for(const f of db){const s=bScore(latest,f);if(s>score){best=f;score=s}}return{db,best,score}}
function bQueue(cid,cname,uid){let commands=readJson('commands.json',[]);const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:cid||'',community_name:cname||'',master_uid:uid,relay_pin:40,pulse_ms:800,source:'V12B_TWO_STEP_CHALLENGE',created_at:nowIso(),delivered_at:'',ack_at:'',ack_note:'',lesson:VERSION};commands.unshift(cmd);writeJson('commands.json',commands.slice(0,60));return cmd}
function bExtract(raw){const t=String(raw||'').trim();try{return{ok:true,p:JSON.parse(t),m:'DIRECT_JSON'}}catch(e){}const f=t.match(/```(?:json)?\s*([\s\S]*?)```/i);if(f)try{return{ok:true,p:JSON.parse(f[1].trim()),m:'MARKDOWN_JSON_FENCE'}}catch(e){}const i=t.indexOf('{'),j=t.lastIndexOf('}');if(i>=0&&j>i)try{return{ok:true,p:JSON.parse(t.slice(i,j+1)),m:'JSON_SUBSTRING'}}catch(e){}return{ok:false,p:{},m:'UNPARSEABLE'}}
function bNorm(p){p=p||{};let l=String(p.liveness||p.verdict||'').toUpperCase();if(typeof p.real==='boolean')l=p.real?'REAL':'PHOTO';if(l.includes('REAL')||l.includes('LIVE'))l='REAL';else if(l.includes('PHOTO'))l='PHOTO';else if(l.includes('SCREEN'))l='SCREEN';else l='UNKNOWN';let c=Number(p.confidence??p.score??0);if(c>1)c/=100;if(!Number.isFinite(c))c=0;return{liveness:l,same_person:typeof p.same_person==='boolean'?p.same_person:true,challenge_pass:typeof p.challenge_pass==='boolean'?p.challenge_pass:(l==='REAL'&&c>=.5),confidence:c,reason:String(p.reason||'')}}
async function bOpenAI(){const key=process.env.OPENAI_API_KEY||'',ap=bFrame('A'),bp=bFrame('B');const d={debug_id:'DBG-'+Date.now().toString(36).toUpperCase(),has_openai_key:!!key,model:process.env.OPENAI_VISION_MODEL||'gpt-4o-mini',frame_a_bytes:fs.existsSync(ap)?fs.statSync(ap).size:0,frame_b_bytes:fs.existsSync(bp)?fs.statSync(bp).size:0,http_status:0,openai_ok:false,raw_content:'',parse_ok:false,parse_method:'',normalized:null,usage:null};if(!key){d.parse_ok=true;d.parse_method='DEMO';d.normalized={liveness:'REAL',same_person:true,challenge_pass:true,confidence:.51,reason:'demo'};return d}if(d.frame_a_bytes<1000||d.frame_b_bytes<1000){d.normalized={liveness:'UNKNOWN',same_person:false,challenge_pass:false,confidence:0,reason:'missing frame'};return d}const a64=fs.readFileSync(ap).toString('base64'),b64=fs.readFileSync(bp).toString('base64');try{const body={model:d.model,messages:[{role:'user',content:[{type:'text',text:'RT7 door access liveness. Frame A should show TURN_LEFT. Frame B should show TURN_RIGHT. Return ONLY JSON: {"same_person":true/false,"liveness":"REAL|PHOTO|SCREEN|UNKNOWN","challenge_pass":true/false,"confidence":0-1,"reason":"short reason"}. challenge_pass true only if same live person plausibly turned left then right.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+a64}},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b64}}]}],temperature:0,max_tokens:180};const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify(body)});d.http_status=r.status;const j=await r.json();d.usage=j.usage||null;d.openai_ok=!!r.ok;d.raw_content=r.ok&&j.choices&&j.choices[0]?String(j.choices[0].message.content||''):(j.error?JSON.stringify(j.error):JSON.stringify(j));const ex=bExtract(d.raw_content);d.parse_ok=ex.ok;d.parse_method=ex.m;d.normalized=ex.ok?bNorm(ex.p):{liveness:'UNKNOWN',same_person:false,challenge_pass:false,confidence:0,reason:'parse failed'};return d}catch(e){d.normalized={liveness:'UNKNOWN',same_person:false,challenge_pass:false,confidence:0,reason:String(e.message||e)};return d}}
app.post('/api/v12b/challenge/reset',express.json({limit:'1mb'}),(req,res)=>{try{if(fs.existsSync(bFrame('A')))fs.unlinkSync(bFrame('A'));if(fs.existsSync(bFrame('B')))fs.unlinkSync(bFrame('B'))}catch(e){}const ch={challenge_id:'CHAL-'+Date.now().toString(36).toUpperCase(),step:'TURN_LEFT',instruction:'請向左轉頭，讓 ESP32 上傳 snapshot，然後擷取 Frame A',frame_a:null,frame_b:null,created_at:nowIso(),lesson:VERSION};bW('v12b_two_step_challenge.json',ch);res.json({ok:true,version:VERSION,challenge:ch})});
app.post('/api/v12b/challenge/capture',express.json({limit:'1mb'}),async(req,res)=>{const label=String((req.body||{}).label||'A').toUpperCase()==='B'?'B':'A',latest=bLatest(),ch=bCh();if(!latest)return res.status(409).json({ok:false,version:VERSION,error:'NO_FACE_GATE_PASS_CANDIDATE'});if(label==='B'&&ch.frame_a&&ch.frame_a.snapshot_id===latest.snapshot_id)return res.status(409).json({ok:false,version:VERSION,error:'SAME_SNAPSHOT_DETECTED',note:'請先讓 ESP32 重新上傳新的 snapshot'});const img=await bImg(latest,req);if(!img.ok)return res.status(409).json({ok:false,version:VERSION,error:'IMAGE_NOT_FOUND',image:img});fs.writeFileSync(bFrame(label),img.buffer);const rec={label,snapshot_id:latest.snapshot_id,master_uid:latest.master_uid,community_id:latest.community_id,community_name:latest.community_name,bytes:img.bytes,face_reason:latest.face_reason,created_at:nowIso()};if(!ch.challenge_id)ch.challenge_id='CHAL-'+Date.now().toString(36).toUpperCase();if(label==='A'){ch.frame_a=rec;ch.step='TURN_RIGHT';ch.instruction='請向右轉頭，讓 ESP32 上傳新的 snapshot，然後擷取 Frame B'}else{ch.frame_b=rec;ch.step='VERIFY';ch.instruction='A/B 完成，可按 OpenAI 二步活體 + 人臉辨識'}ch.updated_at=nowIso();ch.lesson=VERSION;bW('v12b_two_step_challenge.json',ch);res.json({ok:true,version:VERSION,challenge:ch,captured:rec})});
app.post('/api/v12b/challenge/verify',express.json({limit:'1mb'}),async(req,res)=>{const body=req.body||{},uid=normalizeUid(body.master_uid||''),threshold=Number(body.threshold||70),liveThreshold=Number(body.liveness_confidence||.5),ch=bCh();if(!uid)return res.status(400).json({ok:false,version:VERSION,error:'missing master_uid'});if(!ch.frame_a||!ch.frame_b)return res.status(409).json({ok:false,version:VERSION,error:'FRAME_A_B_REQUIRED',challenge:ch});if(ch.frame_a.snapshot_id===ch.frame_b.snapshot_id)return res.status(409).json({ok:false,version:VERSION,error:'SAME_SNAPSHOT_DETECTED_BEFORE_OPENAI',challenge:ch});const latest={master_uid:uid,face_reason:ch.frame_b.face_reason||'',snapshot_id:ch.frame_b.snapshot_id,bytes:ch.frame_b.bytes||0,community_id:ch.frame_b.community_id,community_name:ch.frame_b.community_name};const {db,best,score}=bBest(uid,latest);if(!db.length)return res.status(409).json({ok:false,version:VERSION,error:'FACE_DB_EMPTY'});const debug=await bOpenAI(),n=debug.normalized||{};const face_match=!!(best&&score>=threshold),live_ok=n.same_person===true&&n.liveness==='REAL'&&n.challenge_pass===true&&Number(n.confidence||0)>=liveThreshold,allow_open=face_match&&live_ok;const cmd=allow_open?bQueue(latest.community_id||best.community_id,latest.community_name||best.community_name,uid):null;const rec={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid:uid,challenge_id:ch.challenge_id,frame_a_snapshot_id:ch.frame_a.snapshot_id,frame_b_snapshot_id:ch.frame_b.snapshot_id,best_face_id:best?best.face_id:'',best_name:best?best.person_name:'',match_score:score,threshold,face_match,same_person:!!n.same_person,liveness:n.liveness||'UNKNOWN',challenge_pass:!!n.challenge_pass,liveness_mode:debug.has_openai_key?'OPENAI_TWO_STEP_LEFT_RIGHT':'DEMO_NO_OPENAI_KEY',liveness_confidence:Number(n.confidence||0),liveness_reason:n.reason||'',frame_a_bytes:debug.frame_a_bytes,frame_b_bytes:debug.frame_b_bytes,openai_http_status:debug.http_status,openai_parse_ok:debug.parse_ok,openai_parse_method:debug.parse_method,openai_usage:debug.usage,openai_raw_content:String(debug.raw_content||'').slice(0,1200),allow_open,command_id:cmd?cmd.command_id:'',block_reason:allow_open?'':(!face_match?'MATCH_SCORE_BELOW_THRESHOLD':'TWO_STEP_LIVENESS_NOT_PASS'),created_at:nowIso(),lesson:VERSION};const ms=bMatches();ms.unshift(rec);bW('edu_face_matches.json',ms.slice(0,220));const logs=bLogs();logs.unshift({debug_id:debug.debug_id,result:rec,debug});bW('openai_liveness_debug_log.json',logs.slice(0,180));res.json({ok:true,version:VERSION,result:rec,command:cmd,challenge:ch,best_face:best,openai_debug:debug})});
app.get('/api/v12b/challenge/state',(req,res)=>res.json({ok:true,version:VERSION,challenge:bCh(),latest:bLatest(),snapshot_count:bR('face_snapshots.json',[]).length,face_db_count:bDb().length,logs:bLogs().slice(0,5)}));
app.get('/edu/two-step-liveness',(req,res)=>{const latest=bLatest(),ch=bCh(),faces=bDb(),matches=bMatches().filter(m=>String(m.lesson||'').includes('V12B')||m.liveness_mode==='OPENAI_TWO_STEP_LEFT_RIGHT').slice(0,20);let opts=[];if(latest&&latest.master_uid)opts.push({uid:latest.master_uid,name:latest.community_name||'最新'});if(!opts.length)opts=faces.map(f=>({uid:f.master_uid,name:f.community_name||f.person_name||'Face DB'}));const seen={};opts=opts.filter(o=>o.uid&&!seen[o.uid]&&(seen[o.uid]=1)).map(o=>`<option value="${o.uid}">${o.name} (${o.uid})</option>`).join('');const latestHtml=latest?`<div class="meta">最新：<b>${latest.snapshot_id}</b>｜${latest.community_name||''}｜bytes=${latest.bytes}｜${latest.created_at||''}</div><img src="/edu/face/latest.jpg?_=${Date.now()}">`:'<p class="bad">尚未收到 FACE_GATE_PASS Candidate Snapshot。</p>';const rows=matches.map(m=>`<tr><td>${m.match_id}</td><td>${m.best_name}</td><td>${m.match_score}%</td><td>${m.same_person?'YES':'NO'}</td><td>${m.liveness}</td><td>${m.challenge_pass?'PASS':'FAIL'}</td><td>${Math.round(Number(m.liveness_confidence||0)*100)}%</td><td>${m.frame_a_snapshot_id}</td><td>${m.frame_b_snapshot_id}</td><td>${m.openai_http_status}</td><td>${m.openai_parse_method}</td><td style="font-weight:900;color:${m.allow_open?'#08783e':'#b11111'}">${m.allow_open?'OPEN':'LOCK'}</td><td>${m.command_id||''}</td><td>${m.block_reason||''}</td><td>${m.created_at}</td></tr>`).join('')||'<tr><td colspan="15">尚無 V12B 結果</td></tr>';const last=bLogs()[0]&&bLogs()[0].debug?bLogs()[0].debug:null;const dbg=last?JSON.stringify({debug_id:last.debug_id,model:last.model,frame_a_bytes:last.frame_a_bytes,frame_b_bytes:last.frame_b_bytes,http_status:last.http_status,openai_ok:last.openai_ok,parse_ok:last.parse_ok,parse_method:last.parse_method,normalized:last.normalized,raw_content:last.raw_content},null,2):'尚無 debug';res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,"Noto Sans TC",sans-serif;background:#eef5f7;margin:0;color:#102330}.wrap{max-width:1260px;margin:auto;padding:18px}.card{background:white;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 2px 12px #0001}button{border:0;border-radius:10px;background:#079b50;color:white;font-weight:900;padding:12px 16px;margin:6px}.red{background:#c9342d}.blue{background:#1677a8}.orange{background:#d18400}input,select{padding:12px;border:1px solid #cfdbe3;border-radius:10px;margin:6px;min-width:160px}img{max-width:100%;border-radius:12px;border:1px solid #ddd}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #dde;padding:8px;text-align:left;font-size:12px}.status{font-weight:900;border-radius:10px;padding:12px;margin-top:10px}.ok{background:#e8fff2;color:#08783e}.warn{background:#fff7df;color:#946200}.err{background:#ffecec;color:#a11212}.bad{color:#b11111;font-weight:900}pre{background:#f5f7f9;border-radius:10px;padding:12px;overflow:auto;white-space:pre-wrap}</style></head><body><div class="wrap"><h1>RT7 EDU V12B TWO STEP CHALLENGE</h1><p><a href="/edu/auto-face-gate-recognition">V12A</a>｜<a href="/api/v12b/challenge/state">State JSON</a>｜<a href="/edu/face-gate/state">FACE_GATE</a></p><div class="card"><h2>1. 流程</h2><pre>向左轉頭 → ESP32 上傳 snapshot → 擷取 Frame A
向右轉頭 → ESP32 上傳新 snapshot → 擷取 Frame B
OpenAI 比較 A/B + Face Match → OPEN_DOOR</pre></div><div class="card"><h2>2. 最新 ESP32 Candidate</h2>${latestHtml}</div><div class="card"><h2>3. 控制</h2><button class="red" onclick="resetC()">重設挑戰</button><button class="orange" onclick="cap('A')">擷取 TURN_LEFT / Frame A</button><button class="orange" onclick="cap('B')">擷取 TURN_RIGHT / Frame B</button><select id="master_uid">${opts}</select><input id="threshold" type="number" value="70" style="width:90px;min-width:90px"> % <input id="live_conf" type="number" value="0.5" step="0.1" style="width:90px;min-width:90px"> liveness <button class="blue" onclick="verify()">OpenAI 二步活體 + 人臉辨識</button><div id="statusBox" class="status warn">READY</div><pre id="result">READY</pre></div><div class="card"><h2>4. Challenge State</h2><pre>${JSON.stringify(ch,null,2).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div><div class="card"><h2>5. V12B Results</h2><table><tr><th>Match</th><th>Name</th><th>Score</th><th>Same</th><th>Live</th><th>Chal</th><th>Conf</th><th>Frame A</th><th>Frame B</th><th>HTTP</th><th>Parse</th><th>Door</th><th>Command</th><th>Block</th><th>Time</th></tr>${rows}</table></div><div class="card"><h2>6. Last OpenAI Debug</h2><pre>${dbg.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></div></div><script>function st(c,m){statusBox.className='status '+c;statusBox.textContent=m}async function resetC(){st('warn','重設中');let r=await fetch('/api/v12b/challenge/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});let j=await r.json();result.textContent=JSON.stringify(j,null,2);st('ok','請向左轉頭並上傳 snapshot');setTimeout(()=>location.reload(),900)}async function cap(label){st('warn','擷取 '+label);let r=await fetch('/api/v12b/challenge/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label})});let j=await r.json();result.textContent=JSON.stringify(j,null,2);st(j.ok?'ok':'err',j.ok?'已擷取 '+label:'失敗 '+(j.error||''));setTimeout(()=>location.reload(),1200)}async function verify(){st('warn','OpenAI 辨識中');let r=await fetch('/api/v12b/challenge/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({master_uid:master_uid.value,threshold:Number(threshold.value||70),liveness_confidence:Number(live_conf.value||.5)})});let j=await r.json();result.textContent=JSON.stringify(j,null,2);if(j.ok&&j.result&&j.result.allow_open)st('ok','OPEN '+j.result.command_id);else if(j.ok&&j.result)st('err','LOCK '+j.result.block_reason);else st('err','失敗 '+(j.error||''));setTimeout(()=>location.reload(),2500)}</script></body></html>`)});

