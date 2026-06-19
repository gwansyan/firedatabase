// RT7_EDU_FACE_RECOGNITION_V9
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
const VERSION = 'RT7_EDU_FACE_RECOGNITION_V9';
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
ensureFile('face_db.json', []);
ensureFile('face_match_results.json', []);

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


// 第八堂：ESP32 Camera Snapshot。ESP32 拍照後 POST JPEG 到 Railway，手機頁面顯示最新照片。
function latestSnapshotPath() {
  return path.join(DATA_DIR, 'latest_face_snapshot.jpg');
}
function snapshotPublicUrl() {
  return '/edu/face/latest.jpg?ts=' + Date.now();
}
app.post('/edu/face/snapshot', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '3mb' }), (req, res) => {
  const master_uid = normalizeUid(req.query.master_uid || req.headers['x-master-uid'] || '');
  const source = safeText(req.query.source || req.headers['x-source'] || 'ESP32', 20).toUpperCase();
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#dbeafe"/><circle cx="320" cy="210" r="90" fill="#f8c9a8"/><circle cx="285" cy="190" r="10" fill="#111827"/><circle cx="355" cy="190" r="10" fill="#111827"/><path d="M285 255 Q320 285 355 255" stroke="#111827" stroke-width="8" fill="none" stroke-linecap="round"/><text x="320" y="390" text-anchor="middle" font-size="34" font-family="Arial" fill="#0f172a">RT7 EDU FACE SNAPSHOT V8</text><text x="320" y="430" text-anchor="middle" font-size="20" font-family="Arial" fill="#475569">${nowIso()}</text></svg>`;
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



// ===== Lesson 9: Educational Face Recognition =====
// 教學版：用 JPEG SHA256 fingerprint 模擬 Face DB / Face Match / Liveness 流程。
// 正式版才接 OpenAI Face Match + Liveness。
function latestImageBuffer(){ const f=latestSnapshotPath(); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
function imageFingerprint(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
function fingerprintScore(a,b){
  a=String(a||''); b=String(b||''); if(!a||!b) return 0;
  if(a===b) return 100;
  let same=0, n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++) if(a[i]===b[i]) same++;
  return Math.round((same/n)*100);
}
function getMasterCommunity(master_uid){
  return readJson('communities.json', []).find(c=>c.master_uid===master_uid) || null;
}
app.post('/edu/face/register', (req,res)=>{
  const body=req.body||{};
  const master_uid=normalizeUid(body.master_uid);
  const person_name=safeText(body.person_name||'訪客',60);
  const buf=latestImageBuffer();
  if(!master_uid) return res.status(400).json({ok:false,error:'missing master_uid'});
  if(!buf) return res.status(400).json({ok:false,error:'no latest snapshot. Upload snapshot first.'});
  const community=getMasterCommunity(master_uid);
  const rec={face_id:'FACE-'+Date.now().toString(36).toUpperCase(),person_name,master_uid,community_id:community?community.community_id:'',community_name:community?community.community_name:'',fingerprint:imageFingerprint(buf),bytes:buf.length,registered_at:nowIso(),lesson:VERSION};
  let db=readJson('face_db.json',[]); db.unshift(rec); db=db.slice(0,50); writeJson('face_db.json',db);
  res.json({ok:true,version:VERSION,face:{face_id:rec.face_id,person_name:rec.person_name,community_id:rec.community_id,community_name:rec.community_name,master_uid:rec.master_uid,bytes:rec.bytes,registered_at:rec.registered_at}});
});
app.post('/edu/face/match', async (req,res)=>{
  const body=req.body||{}; const master_uid=normalizeUid(body.master_uid);
  const buf=latestImageBuffer();
  if(!master_uid) return res.status(400).json({ok:false,error:'missing master_uid'});
  if(!buf) return res.status(400).json({ok:false,error:'no latest snapshot'});
  const fp=imageFingerprint(buf);
  const db=readJson('face_db.json',[]).filter(f=>!f.master_uid || f.master_uid===master_uid);
  let best=null; for(const f of db){ const score=fingerprintScore(fp,f.fingerprint); if(!best||score>best.score) best={...f,score}; }
  const match=!!best && best.score>=95;
  const liveness = buf.length>2500 ? 'REAL' : 'UNKNOWN';
  const allow_open = match && liveness==='REAL';
  let command=null;
  if(allow_open){
    const community=getMasterCommunity(master_uid);
    const cmd={command_id:'CMD-'+Date.now().toString(36).toUpperCase(),command:'OPEN_DOOR',status:'PENDING',community_id:community?community.community_id:'',community_name:community?community.community_name:'',master_uid,relay_pin:40,pulse_ms:800,source:'FACE_MATCH',created_at:nowIso(),lesson:VERSION};
    let commands=readJson('commands.json',[]); commands.unshift(cmd); commands=commands.slice(0,30); writeJson('commands.json',commands); command=cmd;
  }
  const result={match_id:'MATCH-'+Date.now().toString(36).toUpperCase(),master_uid,best_name:best?best.person_name:'',best_face_id:best?best.face_id:'',match_score:best?best.score:0,face_match:match,liveness,allow_open,command_id:command?command.command_id:'',created_at:nowIso(),lesson:VERSION};
  let results=readJson('face_match_results.json',[]); results.unshift(result); results=results.slice(0,30); writeJson('face_match_results.json',results);
  res.json({ok:true,version:VERSION,result,command});
});
app.get('/edu/face/db', (_req,res)=>res.json({ok:true,version:VERSION,faces:readJson('face_db.json',[]).map(f=>({face_id:f.face_id,person_name:f.person_name,community_id:f.community_id,community_name:f.community_name,master_uid:f.master_uid,bytes:f.bytes,registered_at:f.registered_at}))}));
app.delete('/edu/face/db', (_req,res)=>{const before=readJson('face_db.json',[]); writeJson('face_db.json',[]); res.json({ok:true,version:VERSION,deleted:before.length});});
app.get('/edu/face/results', (_req,res)=>res.json({ok:true,version:VERSION,results:readJson('face_match_results.json',[])}));

app.get('/edu/face-recognition', (_req,res)=>res.send(renderFaceRecognitionPage()));
function renderFaceRecognitionPage(){return String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU FACE RECOGNITION V9</title><style>body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1040px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,input,select{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:white;border:0}.blue{background:#0b6fa4}.danger{background:#c0392b}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.hint{color:#64748b;line-height:1.6}.ok{color:#079b50;font-weight:bold}.bad{color:#c0392b;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}img.snap{width:100%;max-width:640px;border-radius:12px;border:1px solid #d8e1e7;background:#f8fafc}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.warn{background:#fff8e1;border-left:5px solid #f2c94c}</style></head><body><div class="wrap"><h1>RT7 EDU FACE RECOGNITION V9</h1><p><span class="tag">第九堂課</span> Face Register / Educational Face Match / Liveness / OPEN_DOOR</p><p><button class="blue" onclick="location.href='/edu/face-snapshot'">第八堂 Snapshot</button><button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button></p><div id="app">載入中...</div></div><script>
async function api(p,o){const r=await fetch(p,Object.assign({headers:{'Content-Type':'application/json'}},o||{}));let j={};try{j=await r.json()}catch(e){} if(!r.ok)j.http_status=r.status;return j} async function post(p,d){return api(p,{method:'POST',body:JSON.stringify(d)})} async function del(p){return api(p,{method:'DELETE'})} function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function opts(cs){return (cs||[]).map(c=>'<option value="'+esc(c.master_uid)+'">'+esc(c.community_name)+' | '+esc(c.master_uid)+'</option>').join('')||'<option value="">請先完成第二堂</option>'}
async function load(){const st=await api('/edu/state'), snaps=await api('/edu/face/snapshots'), db=await api('/edu/face/db'), rr=await api('/edu/face/results'); const cs=st.communities||[], latest=(snaps.snapshots||[])[0]; let h='';
h+='<div class="card"><h2>1. 最新 ESP32 Snapshot</h2>'; if(latest){h+='<p class="hint">'+esc(latest.snapshot_id)+'｜'+esc(latest.source)+'｜bytes='+esc(latest.bytes)+'｜'+esc(latest.created_at)+'</p><img class="snap" src="/edu/face/latest.jpg?ts='+Date.now()+'">'} else h+='<p class="bad">尚未收到照片，請先完成第八堂。</p>'; h+='</div>';
h+='<div class="card"><h2>2. 手機註冊人臉</h2><p class="hint">用目前最新 Snapshot 登錄到教育版 Face DB。</p><select id="reg_uid">'+opts(cs)+'</select><input id="person_name" placeholder="姓名，例如：老師"><button onclick="regFace()">註冊目前照片</button><button class="danger" onclick="clearDb()">清除 Face DB</button><pre id="msg">READY</pre></div>';
h+='<div class="card"><h2>3. Face DB</h2><table><tr><th>Face ID</th><th>Name</th><th>Community</th><th>UID</th><th>Time</th></tr>'+((db.faces||[]).map(f=>'<tr><td>'+esc(f.face_id)+'</td><td><b>'+esc(f.person_name)+'</b></td><td>'+esc(f.community_name)+'</td><td>'+esc(f.master_uid)+'</td><td>'+esc(f.registered_at)+'</td></tr>').join('')||'<tr><td colspan="5" class="hint">尚未註冊</td></tr>')+'</table></div>';
h+='<div class="card"><h2>4. 辨識測試</h2><p class="hint">用最新 Snapshot 與 Face DB 比對；MATCH + LIVENESS=REAL 時自動送出 OPEN_DOOR。</p><select id="match_uid">'+opts(cs)+'</select><button onclick="matchFace()">做人臉辨識測試</button></div>';
h+='<div class="card"><h2>5. Match Results</h2><table><tr><th>Match ID</th><th>Name</th><th>Score</th><th>Liveness</th><th>Door</th><th>Command</th><th>Time</th></tr>'+((rr.results||[]).map(r=>'<tr><td>'+esc(r.match_id)+'</td><td>'+esc(r.best_name)+'</td><td>'+esc(r.match_score)+'%</td><td>'+esc(r.liveness)+'</td><td class="'+(r.allow_open?'ok':'bad')+'">'+(r.allow_open?'OPEN':'LOCK')+'</td><td>'+esc(r.command_id)+'</td><td>'+esc(r.created_at)+'</td></tr>').join('')||'<tr><td colspan="7" class="hint">尚無辨識結果</td></tr>')+'</table></div>';
h+='<div class="card warn"><h2>6. 教學說明</h2><pre>ESP32 Camera\n↓\nSnapshot POST Railway\n↓\n手機註冊人臉 Face DB\n↓\n最新 Snapshot 做 Face Match\n↓\nLiveness = REAL\n↓\nOPEN_DOOR Command Queue\n↓\nESP32 GPIO40 Relay</pre><p class="hint">本 V9 是教育版 fingerprint 模擬；正式版再接 OpenAI Face Match + Liveness。</p></div>'; document.getElementById('app').innerHTML=h;}
async function regFace(){const r=await post('/edu/face/register',{master_uid:reg_uid.value,person_name:person_name.value}); msg.textContent=JSON.stringify(r,null,2); await load()} async function matchFace(){const r=await post('/edu/face/match',{master_uid:match_uid.value}); alert(JSON.stringify(r.result||r,null,2)); await load()} async function clearDb(){if(confirm('清除 Face DB?')){await del('/edu/face/db');load()}} load(); setInterval(load,10000);
</script></body></html>`}

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
<p><button class="blue" onclick="location.href='/edu/community/register'">第二堂社區註冊</button> <button class="blue" onclick="location.href='/edu/login'">第三堂登入驗證</button> <button class="blue" onclick="location.href='/edu/doorbell'">第四堂門鈴事件</button> <button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button> <button class="blue" onclick="location.href='/edu/node-red'">第六堂 Node-RED Flow</button> <button class="blue" onclick="location.href='/edu/push'">第七堂手機推播</button> <button class="blue" onclick="location.href='/edu/face-snapshot'">第八堂 Snapshot</button> <button class="blue" onclick="location.href='/edu/face-recognition'">第九堂人臉辨識</button></p>
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
return String.raw`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RT7 EDU Node-RED Flow V6</title><style>body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:980px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}code,pre{background:#f5f7f8;padding:10px;border-radius:8px;display:block;overflow:auto}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.blue{background:#0b6fa4;color:#fff;border:0;border-radius:8px;padding:10px;margin:4px;cursor:pointer}.ok{color:#079b50;font-weight:bold}</style></head><body><div class="wrap"><h1>RT7 EDU NODE-RED FLOW V6</h1><p><span class="tag">第六堂課</span> Node-RED Flow / Railway Observer</p><p><button class="blue" onclick="location.href='/edu/open-door'">回第五堂開門控制</button></p><div class="card"><h2>1. 匯入 Flow</h2><p>Node-RED 選單 → Import → Clipboard，貼上專案內：</p><pre>node-red/RT7_EDU_FACE_RECOGNITION_V9_OBSERVER_FLOW.json</pre></div><div class="card"><h2>2. Flow 觀察目標</h2><pre>Heartbeat → Master Registry
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
<title>RT7 EDU FACE SNAPSHOT V8</title>
<style>
body{font-family:Arial,'Noto Sans TC',sans-serif;background:#eef4f6;margin:0;color:#10232e}.wrap{max-width:1040px;margin:20px auto;padding:16px}.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 2px 8px #0001}button,select{font-size:16px;padding:10px;border-radius:8px;border:1px solid #ccd6dc;margin:4px}button{background:#0b9b5a;color:white;border:0}.blue{background:#0b6fa4}.danger{background:#c0392b}.tag{display:inline-block;background:#e9f7ef;color:#087848;border-radius:999px;padding:4px 10px;font-size:13px}.hint{color:#64748b;line-height:1.6}.ok{color:#079b50;font-weight:bold}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5edf1;text-align:left;word-break:break-all}img.snap{width:100%;max-width:640px;border-radius:12px;border:1px solid #d8e1e7;background:#f8fafc}pre{background:#f5f7f8;padding:10px;border-radius:8px;overflow:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.warn{background:#fff8e1;border-left:5px solid #f2c94c}</style>
</head>
<body><div class="wrap">
<h1>RT7 EDU FACE SNAPSHOT V8</h1>
<p><span class="tag">第八堂課</span> ESP32 Camera / Snapshot / Railway / 手機顯示照片</p>
<p><button class="blue" onclick="location.href='/edu/open-door'">第五堂開門控制</button><button class="blue" onclick="location.href='/edu/push'">第七堂手機推播</button><button class="blue" onclick="location.href='/edu/face-snapshot'">第八堂 Snapshot</button> <button class="blue" onclick="location.href='/edu/face-recognition'">第九堂人臉辨識</button></p>
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
 h+='<div class="card warn"><h2>4. 第八堂觀察重點</h2><pre>ESP32 Camera\n↓\nSnapshot JPEG\n↓\nPOST /edu/face/snapshot\n↓\nRailway latest_face_snapshot.jpg\n↓\n手機網頁顯示照片\n\n下一堂才加入：Face Register / Face Match / Liveness</pre></div>';
 document.getElementById('app').innerHTML=h; }
async function simSnap(){ const uid=document.getElementById('master_uid').value; const r=await post('/edu/face/snapshot/sim',{master_uid:uid}); document.getElementById('msg').textContent=r.ok?'模擬 Snapshot 成功':'失敗：'+(r.error||r.http_status); await load(); }
async function clearSnaps(){ if(!confirm('清除 snapshot records?'))return; await del('/edu/face/snapshots'); await load(); }
load(); setInterval(load,5000);
</script>
</body></html>`;
}

app.listen(PORT, () => console.log('[' + VERSION + '] http://localhost:' + PORT + '/edu/push'));
