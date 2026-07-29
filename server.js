'use strict';

const express = require('express');
const net = require('net');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VERSION = 'RT7_PHASE10_NATIVE_RTSP_CLOUD_DIRECT_TEST_V2';

app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function intInRange(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function normalizePath(value) {
  const text = String(value || '/main_0').trim();
  return text.startsWith('/') ? text : `/${text}`;
}

function isPrivateHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function rtspUrl({ host, port, user, password, path }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password || '')}@` : '';
  return `rtsp://${auth}${host}:${port}${path}`;
}

function maskedRtspUrl(config) {
  const auth = config.user ? `${encodeURIComponent(config.user)}:******@` : '';
  return `rtsp://${auth}${config.host}:${config.port}${config.path}`;
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ elapsedMs: Date.now() - started, ...result });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, code: 'TCP_CONNECTED' }));
    socket.once('timeout', () => finish({ ok: false, code: 'TCP_TIMEOUT', error: `timeout after ${timeoutMs} ms` }));
    socket.once('error', (err) => finish({ ok: false, code: 'TCP_ERROR', error: err.message, errno: err.code || '' }));
    socket.connect(port, host);
  });
}

function runProcess(command, args, timeoutMs, maxOutput = 24000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let child;

    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, spawnError: err.message, exitCode: null, signal: null, timedOut: false, elapsedMs: Date.now() - started, stdout, stderr });
    }

    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      return next.length > maxOutput ? next.slice(-maxOutput) : next;
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, spawnError: err.message, exitCode: null, signal: null, timedOut, elapsedMs: Date.now() - started, stdout, stderr });
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, spawnError: '', exitCode: code, signal, timedOut, elapsedMs: Date.now() - started, stdout, stderr });
    });
  });
}

function classify(config, ffmpegVersion, tcp, ffmpeg) {
  const log = `${ffmpeg.stderr}\n${ffmpeg.stdout}`.toLowerCase();
  if (!ffmpegVersion.ok) {
    return { code: 'RAILWAY_FFMPEG_UNAVAILABLE', title: 'Railway 無法啟動 FFmpeg', detail: '請確認 Railway 使用 Dockerfile 建置，或 Nixpacks 已安裝 ffmpeg。' };
  }
  if (!tcp.ok) {
    if (isPrivateHost(config.host)) {
      return { code: 'PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY', title: 'DVR 內網位址無法由 Railway 直接到達', detail: `${config.host} 是私有內網位址，Railway 容器通常沒有到你家中或公司 LAN 的路由。這不是 DVR 解碼問題。` };
    }
    return { code: 'PUBLIC_RTSP_PORT_UNREACHABLE', title: '公網 RTSP Port 無法連線', detail: '請檢查路由器 Port Forward、防火牆、ISP CGNAT，以及 DVR 是否監聽該 Port。' };
  }
  if (ffmpeg.ok) {
    return { code: 'CLOUD_DIRECT_RTSP_SUCCESS', title: 'Railway 已直接取得 DVR 影格', detail: 'FFmpeg、TCP 與 RTSP 解碼均成功；可進一步製作雲端長時間串流測試。' };
  }
  if (/401 unauthorized|unauthorized|authentication failed|method describe failed: 401/.test(log)) {
    return { code: 'RTSP_AUTHENTICATION_FAILED', title: 'RTSP 認證失敗', detail: 'DVR 可達，但帳號或密碼不正確，或該帳號沒有 RTSP 權限。' };
  }
  if (/404 not found|method describe failed: 404|server returned 404/.test(log)) {
    return { code: 'RTSP_PATH_NOT_FOUND', title: 'RTSP 路徑不存在', detail: `DVR 可達，但路徑 ${config.path} 不正確。` };
  }
  if (/connection refused/.test(log)) {
    return { code: 'RTSP_CONNECTION_REFUSED', title: 'RTSP 連線遭拒', detail: '主機可解析，但指定 Port 沒有接受 RTSP 連線。' };
  }
  if (/connection timed out|i\/o error|network is unreachable|no route to host/.test(log)) {
    return { code: isPrivateHost(config.host) ? 'PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY' : 'RTSP_NETWORK_TIMEOUT', title: 'RTSP 網路連線逾時', detail: 'Railway 無法建立完整 RTSP 工作階段。' };
  }
  if (ffmpeg.timedOut) {
    return { code: 'RTSP_TEST_TIMEOUT', title: 'FFmpeg 測試逾時', detail: 'TCP 可連，但在限制時間內沒有成功取得並輸出一張影格。' };
  }
  return { code: 'RTSP_OPEN_OR_DECODE_FAILED', title: 'RTSP 開啟或解碼失敗', detail: '請依下方 FFmpeg 記錄判斷編碼、路徑、認證或 DVR 相容性問題。' };
}

function page(body, title = 'RT7 Native RTSP Cloud Direct Test V2') {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#081116;color:#e9f1f5;font-family:Arial,"Noto Sans TC",sans-serif}.wrap{max-width:980px;margin:auto;padding:28px 18px 60px}h1{margin:0 0 18px;font-size:30px}.card{background:#121e24;border:1px solid #334650;border-radius:14px;padding:18px;margin:12px 0}.notice{color:#ffd145}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;color:#b8d0dc;font-size:14px;margin-bottom:5px}input,select{width:100%;padding:12px;border:1px solid #45606d;border-radius:8px;background:#081116;color:#fff;font-size:16px}button,.btn{display:inline-block;border:0;border-radius:8px;padding:13px 18px;background:#1785c1;color:#fff;font-weight:700;font-size:16px;text-decoration:none;cursor:pointer}.btn2{background:#42545e}.result{font-size:22px;font-weight:700}.ok{color:#42d77d}.bad{color:#ff6b6b}.warn{color:#ffd145}.step{display:grid;grid-template-columns:220px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid #2b3d46}.step:last-child{border-bottom:0}pre{white-space:pre-wrap;word-break:break-word;background:#050b0e;border-radius:9px;padding:14px;max-height:420px;overflow:auto;color:#d9e8ef}.small{font-size:13px;color:#9ab0bb}.code{font-family:Consolas,monospace}.full{grid-column:1/-1}@media(max-width:680px){.grid{grid-template-columns:1fr}.step{grid-template-columns:1fr}.full{grid-column:auto}}
  </style></head><body><main class="wrap">${body}</main></body></html>`;
}

function formPage(values = {}) {
  const v = {
    host: values.host || process.env.RT7_RTSP_HOST || '192.168.0.123',
    port: values.port || process.env.RT7_RTSP_PORT || '554',
    user: values.user || process.env.RT7_RTSP_USER || 'admin',
    path: values.path || process.env.RT7_RTSP_PATH || '/main_0',
    transport: values.transport || process.env.RT7_RTSP_TRANSPORT || 'tcp',
    seconds: values.seconds || process.env.RT7_RTSP_TEST_SECONDS || '8'
  };
  return page(`<h1>RT7 Native RTSP Cloud Direct Test V2</h1>
  <section class="card notice">此頁在 Railway 容器內直接執行 FFmpeg 與 RTSP 測試，不使用電腦上的 RTSP Gateway；本版不依賴瀏覽器 JavaScript。</section>
  <form method="post" action="/run" class="card"><div class="grid">
    <div><label>DVR Host</label><input name="host" required value="${esc(v.host)}"></div>
    <div><label>RTSP Port</label><input name="port" inputmode="numeric" required value="${esc(v.port)}"></div>
    <div><label>User</label><input name="user" autocomplete="username" value="${esc(v.user)}"></div>
    <div><label>Password</label><input name="password" type="password" autocomplete="current-password" placeholder="留白則使用 Railway 變數 RT7_RTSP_PASSWORD"></div>
    <div><label>Path</label><input name="path" required value="${esc(v.path)}"></div>
    <div><label>Transport</label><select name="transport"><option value="tcp"${v.transport === 'tcp' ? ' selected' : ''}>TCP</option><option value="udp"${v.transport === 'udp' ? ' selected' : ''}>UDP</option></select></div>
    <div><label>測試秒數</label><input name="seconds" inputmode="numeric" value="${esc(v.seconds)}"></div>
    <div class="full"><button type="submit">開始雲端直連測試</button></div>
  </div></form>
  <section class="card small">版本：${VERSION}<br>健康檢查：<span class="code">/health</span></section>`);
}

app.get('/', (req, res) => res.type('html').send(formPage()));
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION, node: process.version, platform: process.platform }));

app.post('/run', async (req, res) => {
  const config = {
    host: String(req.body.host || process.env.RT7_RTSP_HOST || '').trim(),
    port: intInRange(req.body.port || process.env.RT7_RTSP_PORT, 554, 1, 65535),
    user: String(req.body.user ?? process.env.RT7_RTSP_USER ?? '').trim(),
    password: String(req.body.password || process.env.RT7_RTSP_PASSWORD || ''),
    path: normalizePath(req.body.path || process.env.RT7_RTSP_PATH || '/main_0'),
    transport: String(req.body.transport || process.env.RT7_RTSP_TRANSPORT || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp',
    seconds: intInRange(req.body.seconds || process.env.RT7_RTSP_TEST_SECONDS, 8, 3, 30)
  };

  if (!config.host) return res.status(400).type('html').send(page('<h1>設定錯誤</h1><section class="card bad">DVR Host 不可留白。</section><a class="btn" href="/">返回</a>'));

  const ffmpegVersion = await runProcess('ffmpeg', ['-hide_banner', '-version'], 5000, 6000);
  const tcp = await tcpProbe(config.host, config.port, Math.min(config.seconds * 1000, 10000));
  let ffmpeg = { ok: false, skipped: true, stdout: '', stderr: 'TCP probe failed; FFmpeg RTSP test skipped.', exitCode: null, signal: null, timedOut: false, elapsedMs: 0, spawnError: '' };

  if (ffmpegVersion.ok && tcp.ok) {
    const url = rtspUrl(config);
    const args = [
      '-hide_banner', '-loglevel', 'info',
      '-rtsp_transport', config.transport,
      '-rw_timeout', String(config.seconds * 1000000),
      '-i', url,
      '-map', '0:v:0', '-an', '-frames:v', '1',
      '-f', 'image2', '-c:v', 'mjpeg', '-y', '/tmp/rt7_cloud_direct_test.jpg'
    ];
    ffmpeg = await runProcess('ffmpeg', args, (config.seconds + 5) * 1000, 30000);
  }

  const conclusion = classify(config, ffmpegVersion, tcp, ffmpeg);
  const cls = conclusion.code === 'CLOUD_DIRECT_RTSP_SUCCESS' ? 'ok' : (conclusion.code.includes('TIMEOUT') ? 'warn' : 'bad');
  const ffmpegVersionText = (ffmpegVersion.stdout || ffmpegVersion.stderr || ffmpegVersion.spawnError || 'no output').split('\n').slice(0, 4).join('\n');
  const ffmpegLog = [ffmpeg.spawnError, ffmpeg.stderr, ffmpeg.stdout].filter(Boolean).join('\n').replaceAll(config.password, '******');

  res.type('html').send(page(`<h1>RT7 Native RTSP Cloud Direct Test V2</h1>
    <section class="card"><div class="result ${cls}">${esc(conclusion.code)}</div><h2>${esc(conclusion.title)}</h2><p>${esc(conclusion.detail)}</p></section>
    <section class="card"><div class="step"><strong>測試來源</strong><span class="code">${esc(maskedRtspUrl(config))}</span></div>
      <div class="step"><strong>FFmpeg 啟動</strong><span class="${ffmpegVersion.ok ? 'ok' : 'bad'}">${ffmpegVersion.ok ? '成功' : '失敗'}（${ffmpegVersion.elapsedMs} ms）</span></div>
      <div class="step"><strong>TCP ${config.port}</strong><span class="${tcp.ok ? 'ok' : 'bad'}">${esc(tcp.code)}（${tcp.elapsedMs} ms）${tcp.error ? `：${esc(tcp.error)}` : ''}</span></div>
      <div class="step"><strong>RTSP/影格</strong><span class="${ffmpeg.ok ? 'ok' : 'bad'}">${ffmpeg.ok ? '成功取得第一張影格' : `失敗；exit=${esc(ffmpeg.exitCode)} timeout=${esc(ffmpeg.timedOut)}`}（${ffmpeg.elapsedMs} ms）</span></div>
      <div class="step"><strong>Host 類型</strong><span>${isPrivateHost(config.host) ? '私有內網位址' : '非私有位址／網域'}</span></div>
    </section>
    <section class="card"><h3>FFmpeg 版本</h3><pre>${esc(ffmpegVersionText)}</pre></section>
    <section class="card"><h3>FFmpeg RTSP 記錄</h3><pre>${esc(ffmpegLog || '無記錄')}</pre></section>
    <a class="btn" href="/">重新測試</a> <a class="btn btn2" href="/health">Health</a>
    <section class="card small">安全提醒：頁面與紀錄會遮蔽密碼。建議將密碼設於 Railway Variables 的 <span class="code">RT7_RTSP_PASSWORD</span>。</section>`));
});

app.use((req, res) => res.status(404).type('text').send('404 Not Found'));
app.listen(PORT, '0.0.0.0', () => console.log(`[${VERSION}] listening on 0.0.0.0:${PORT}`));
