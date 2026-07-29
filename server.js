'use strict';

const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { URLSearchParams } = require('url');

const VERSION = 'RT7_PHASE10_DVR_CLOUD_CAPABILITY_SCANNER_V1';
const PORT = Number(process.env.PORT || 3000);
const TCP_TIMEOUT_MS = clampInt(process.env.RT7_TCP_TIMEOUT_MS, 500, 10000, 1800);
const PROBE_TIMEOUT_MS = clampInt(process.env.RT7_PROBE_TIMEOUT_MS, 1500, 20000, 6000);
const MAX_BODY_BYTES = 32 * 1024;

const DEFAULT_PORTS = [80, 443, 554, 8000, 8554, 8899, 34567];
const COMMON_RTSP_PATHS = [
  '/main_0', '/main_1', '/main_2', '/main_3',
  '/Streaming/Channels/101', '/Streaming/Channels/102',
  '/cam/realmonitor?channel=1&subtype=0',
  '/cam/realmonitor?channel=1&subtype=1',
  '/live/ch00_0', '/live/ch00_1',
  '/h264Preview_01_main', '/h264Preview_01_sub',
  '/ch1/main', '/ch1/sub', '/live', '/stream1'
];

let lastReport = null;
let scanRunning = false;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isPrivateIpv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254);
}

function validateHost(raw) {
  const host = String(raw || '').trim();
  if (!host || host.length > 253) throw new Error('Host 不可為空或過長');
  if (/[:/\\?#@\s]/.test(host)) throw new Error('Host 只能填 IP 或網域名稱，不可包含協定、路徑或空白');
  if (net.isIP(host)) return host;
  if (!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(host)) {
    throw new Error('Host 格式不正確');
  }
  return host;
}

function validatePath(raw) {
  let path = String(raw || '').trim();
  if (!path) return '';
  if (/\r|\n/.test(path)) throw new Error('RTSP 路徑格式不正確');
  if (!path.startsWith('/')) path = '/' + path;
  return path.slice(0, 300);
}

function parsePorts(raw) {
  const source = String(raw || '').trim();
  const values = source ? source.split(',') : DEFAULT_PORTS;
  const result = [];
  for (const item of values) {
    const port = Number(String(item).trim());
    if (Number.isInteger(port) && port >= 1 && port <= 65535 && !result.includes(port)) result.push(port);
  }
  if (!result.length) return DEFAULT_PORTS;
  return result.slice(0, 16);
}

function makeRtspUrl({ host, port, user, password, path }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(password || '')}@` : '';
  return `rtsp://${auth}${host}:${port}${path}`;
}

function maskRtspUrl(url) {
  return url.replace(/(rtsp:\/\/[^:@/]+:)([^@/]*)(@)/i, '$1******$3');
}

function tcpProbe(host, port, timeoutMs = TCP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (status, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, status, detail, elapsed_ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('OPEN', 'TCP connect success'));
    socket.once('timeout', () => done('TIMEOUT', `timeout after ${timeoutMs} ms`));
    socket.once('error', (err) => done('CLOSED', err.code || err.message));
  });
}

function runProcess(command, args, timeoutMs, maxOutputBytes = 256 * 1024) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let spawnError = null;
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const append = (current, chunk) => {
      if (current.length >= maxOutputBytes) return current;
      return Buffer.concat([current, chunk.slice(0, maxOutputBytes - current.length)]);
    };
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (err) => { spawnError = err; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        code,
        signal,
        timed_out: timedOut,
        spawn_error: spawnError ? spawnError.message : null,
        elapsed_ms: Date.now() - started,
        stdout,
        stderr
      });
    });
  });
}

async function ffmpegVersion() {
  const r = await runProcess('ffmpeg', ['-hide_banner', '-version'], 5000, 64 * 1024);
  const text = Buffer.concat([r.stdout, r.stderr]).toString('utf8');
  return {
    ok: !r.spawn_error && r.code === 0,
    elapsed_ms: r.elapsed_ms,
    first_line: text.split(/\r?\n/)[0] || '',
    log: text.slice(0, 12000),
    error: r.spawn_error
  };
}

async function ffprobeRtsp(url, transport) {
  const args = [
    '-v', 'error',
    '-rtsp_transport', transport,
    '-rw_timeout', String(PROBE_TIMEOUT_MS * 1000),
    '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate',
    '-of', 'json',
    url
  ];
  const r = await runProcess('ffprobe', args, PROBE_TIMEOUT_MS + 1500, 256 * 1024);
  const stdoutText = r.stdout.toString('utf8');
  const stderrText = r.stderr.toString('utf8');
  let parsed = null;
  try { parsed = stdoutText ? JSON.parse(stdoutText) : null; } catch (_) {}
  const video = parsed?.streams?.find((s) => s.codec_type === 'video') || null;
  return {
    ok: r.code === 0 && !!video,
    elapsed_ms: r.elapsed_ms,
    timed_out: r.timed_out,
    exit_code: r.code,
    video,
    raw: parsed,
    log: stderrText.slice(0, 12000)
  };
}

async function captureFirstFrame(url, transport) {
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', transport,
    '-rw_timeout', String(PROBE_TIMEOUT_MS * 1000),
    '-i', url,
    '-an', '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
  ];
  const r = await runProcess('ffmpeg', args, PROBE_TIMEOUT_MS + 2500, 4 * 1024 * 1024);
  const jpeg = r.stdout;
  const validJpeg = jpeg.length >= 4 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9;
  return {
    ok: r.code === 0 && validJpeg,
    elapsed_ms: r.elapsed_ms,
    timed_out: r.timed_out,
    exit_code: r.code,
    jpeg_bytes: jpeg.length,
    log: r.stderr.toString('utf8').slice(0, 12000)
  };
}

function classifyFailure(report) {
  if (!report.ffmpeg.ok) return {
    code: 'RAILWAY_FFMPEG_UNAVAILABLE',
    title: 'Railway 容器內無法啟動 FFmpeg',
    detail: '請確認 Railway 使用 Dockerfile 建置，且映像已安裝 ffmpeg。'
  };
  if (report.rtsp.success) return {
    code: 'RTSP_AND_FFMPEG_SUCCESS',
    title: 'RTSP 與 FFmpeg 測試成功',
    detail: '已找到可用 RTSP 路徑，並成功擷取第一張 JPEG 影格。'
  };
  const rtspPort = report.network.find((x) => x.port === report.input.rtsp_port);
  if (report.host_type === 'PRIVATE_LAN' && (!rtspPort || rtspPort.status !== 'OPEN')) return {
    code: 'PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY',
    title: 'DVR 私有內網位址無法由 Railway 直接到達',
    detail: 'Railway 沒有到該 192.168.x.x、10.x.x.x 或 172.16–31.x.x 網段的路由。'
  };
  if (rtspPort?.status !== 'OPEN') return {
    code: 'RTSP_TCP_PORT_UNREACHABLE',
    title: 'RTSP TCP Port 無法連線',
    detail: '可能是防火牆、Port Forward、CGNAT、錯誤 Port，或 DVR 未啟用 RTSP。'
  };
  const logs = report.rtsp.attempts.map((a) => a.log || '').join('\n').toLowerCase();
  if (logs.includes('401 unauthorized') || logs.includes('authentication') || logs.includes('unauthorized')) return {
    code: 'RTSP_AUTHENTICATION_FAILED',
    title: 'RTSP 帳號或密碼驗證失敗',
    detail: '網路與 RTSP Port 可達，但 DVR 拒絕驗證。'
  };
  return {
    code: 'RTSP_PORT_OPEN_BUT_STREAM_NOT_FOUND',
    title: 'RTSP Port 可達，但未找到可用串流',
    detail: '請確認 RTSP 路徑、通道編號、主副碼流格式及 DVR 權限。'
  };
}

async function runScan(input) {
  const started = Date.now();
  const host = validateHost(input.host);
  const rtspPort = clampInt(input.rtsp_port, 1, 65535, 554);
  const user = String(input.user || '').slice(0, 100);
  const password = String(input.password || '').slice(0, 200);
  const transport = input.transport === 'udp' ? 'udp' : 'tcp';
  const customPath = validatePath(input.path);
  const ports = parsePorts(input.ports);
  if (!ports.includes(rtspPort)) ports.unshift(rtspPort);

  const report = {
    version: VERSION,
    generated_at: new Date().toISOString(),
    elapsed_ms: 0,
    input: { host, rtsp_port: rtspPort, user, password_set: !!password, transport, custom_path: customPath, ports },
    host_type: isPrivateIpv4(host) ? 'PRIVATE_LAN' : (net.isIP(host) ? 'PUBLIC_IP_OR_OTHER' : 'HOSTNAME'),
    ffmpeg: null,
    network: [],
    rtsp: { success: false, selected_path: null, selected_url_masked: null, attempts: [], frame: null },
    conclusion: null
  };

  report.ffmpeg = await ffmpegVersion();
  report.network = await Promise.all(ports.map((p) => tcpProbe(host, p)));

  const rtspPortResult = report.network.find((x) => x.port === rtspPort);
  if (report.ffmpeg.ok && rtspPortResult?.status === 'OPEN') {
    const paths = [...new Set([customPath, ...COMMON_RTSP_PATHS].filter(Boolean))].slice(0, 18);
    for (const path of paths) {
      const url = makeRtspUrl({ host, port: rtspPort, user, password, path });
      const probe = await ffprobeRtsp(url, transport);
      report.rtsp.attempts.push({ path, url_masked: maskRtspUrl(url), ...probe });
      if (probe.ok) {
        report.rtsp.success = true;
        report.rtsp.selected_path = path;
        report.rtsp.selected_url_masked = maskRtspUrl(url);
        report.rtsp.frame = await captureFirstFrame(url, transport);
        break;
      }
    }
  }

  report.conclusion = classifyFailure(report);
  report.elapsed_ms = Date.now() - started;
  return report;
}

function page(title, body) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#071116;color:#eef6fa;font-family:Arial,"Noto Sans TC",sans-serif}.wrap{max-width:1100px;margin:0 auto;padding:28px 18px 60px}h1{font-size:28px;margin:0 0 18px}.card{background:#101d23;border:1px solid #31454f;border-radius:13px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.full{grid-column:1/-1}label{display:block;color:#bcd0db;font-size:14px;margin-bottom:5px}input,select,button{width:100%;padding:12px;border-radius:8px;border:1px solid #47606c;background:#071116;color:#fff;font-size:16px}button{background:#1977b6;border:0;font-weight:700;cursor:pointer}.muted{color:#9fb2bc}.warn{color:#ffc84d}.ok{color:#35d07f}.bad{color:#ff6565}.code{font-family:Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#03090c;padding:12px;border-radius:8px;max-height:420px;overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #2c4049;vertical-align:top}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#253840}.result{font-size:21px;font-weight:700}.small{font-size:13px}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}table{font-size:13px}}
  </style></head><body><main class="wrap">${body}</main></body></html>`;
}

function homePage(message = '') {
  const host = process.env.RT7_DVR_HOST || '192.168.0.123';
  const user = process.env.RT7_DVR_USER || 'admin';
  const path = process.env.RT7_DVR_PATH || '/main_0';
  const rtspPort = process.env.RT7_DVR_RTSP_PORT || '554';
  return page(VERSION, `
    <h1>RT7 DVR Cloud Capability Scanner V1</h1>
    <div class="card warn">Network + RTSP + FFmpeg Scanner。請只掃描您有權管理的 DVR／NVR。</div>
    ${message ? `<div class="card bad">${esc(message)}</div>` : ''}
    <form method="post" action="/run" class="card grid">
      <div><label>DVR Host（IP 或網域）</label><input name="host" value="${esc(host)}" required></div>
      <div><label>RTSP Port</label><input name="rtsp_port" type="number" min="1" max="65535" value="${esc(rtspPort)}" required></div>
      <div><label>User</label><input name="user" value="${esc(user)}"></div>
      <div><label>Password</label><input name="password" type="password" placeholder="可由 Railway Variable RT7_DVR_PASSWORD 提供"></div>
      <div><label>優先測試 RTSP Path</label><input name="path" value="${esc(path)}"></div>
      <div><label>Transport</label><select name="transport"><option value="tcp">TCP</option><option value="udp">UDP</option></select></div>
      <div class="full"><label>TCP Ports（逗號分隔，最多 16 個）</label><input name="ports" value="80,443,554,8000,8554,8899,34567"></div>
      <div class="full"><button type="submit">開始 Network + RTSP + FFmpeg 掃描</button></div>
    </form>
    <div class="card small muted">流程：FFmpeg 可用性 → TCP Ports → 常見 RTSP 路徑 → ffprobe 解析 → FFmpeg 擷取第一張 JPEG。掃描可能需要 10–120 秒。</div>
  `);
}

function statusClass(status) {
  return status === 'OPEN' || status === true ? 'ok' : 'bad';
}

function resultPage(r) {
  const networkRows = r.network.map((n) => `<tr><td>${n.port}</td><td class="${n.status === 'OPEN' ? 'ok' : 'bad'}">${esc(n.status)}</td><td>${esc(n.elapsed_ms)} ms</td><td>${esc(n.detail)}</td></tr>`).join('');
  const rtspRows = r.rtsp.attempts.length ? r.rtsp.attempts.map((a) => {
    const v = a.video || {};
    const detail = a.ok ? `${v.codec_name || ''} ${v.width || ''}x${v.height || ''} FPS=${v.avg_frame_rate || v.r_frame_rate || ''}` : (a.timed_out ? 'TIMEOUT' : `exit=${a.exit_code}`);
    return `<tr><td>${esc(a.path)}</td><td class="${a.ok ? 'ok' : 'bad'}">${a.ok ? 'PASS' : 'FAIL'}</td><td>${esc(a.elapsed_ms)} ms</td><td>${esc(detail)}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="muted">RTSP Port 未開啟，因此未執行路徑測試。</td></tr>';
  const logs = r.rtsp.attempts.map((a) => `PATH ${a.path}\n${a.log || '(no stderr)'}`).join('\n\n');
  const frame = r.rtsp.frame;
  return page(VERSION, `
    <h1>RT7 DVR Cloud Capability Scanner V1</h1>
    <div class="card">
      <div class="result ${r.conclusion.code.includes('SUCCESS') ? 'ok' : 'bad'}">${esc(r.conclusion.code)}</div>
      <h2>${esc(r.conclusion.title)}</h2><p>${esc(r.conclusion.detail)}</p>
    </div>
    <div class="card"><table>
      <tr><th>Host</th><td>${esc(r.input.host)}</td></tr>
      <tr><th>Host 類型</th><td>${esc(r.host_type)}</td></tr>
      <tr><th>FFmpeg</th><td class="${r.ffmpeg.ok ? 'ok' : 'bad'}">${r.ffmpeg.ok ? 'PASS' : 'FAIL'} — ${esc(r.ffmpeg.first_line || r.ffmpeg.error || '')}</td></tr>
      <tr><th>RTSP 選定路徑</th><td>${esc(r.rtsp.selected_path || '未找到')}</td></tr>
      <tr><th>第一張影格</th><td class="${frame?.ok ? 'ok' : 'bad'}">${frame ? `${frame.ok ? 'PASS' : 'FAIL'}，${frame.jpeg_bytes} bytes，${frame.elapsed_ms} ms` : '未執行'}</td></tr>
      <tr><th>總耗時</th><td>${esc(r.elapsed_ms)} ms</td></tr>
    </table></div>
    <div class="card"><h2>Network Scanner</h2><table><thead><tr><th>Port</th><th>狀態</th><th>耗時</th><th>說明</th></tr></thead><tbody>${networkRows}</tbody></table></div>
    <div class="card"><h2>RTSP Scanner</h2><table><thead><tr><th>Path</th><th>結果</th><th>耗時</th><th>影像資訊</th></tr></thead><tbody>${rtspRows}</tbody></table></div>
    <div class="card"><h2>FFmpeg / ffprobe 記錄</h2><div class="code">${esc((r.ffmpeg.log || '') + '\n\n' + (logs || '尚無 RTSP 記錄') + (frame?.log ? '\n\nFRAME CAPTURE\n' + frame.log : ''))}</div></div>
    <div class="grid"><form method="get" action="/"><button>返回重新掃描</button></form><form method="get" action="/api/last-report"><button>開啟 JSON 報告</button></form></div>
  `);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && requestUrl.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(homePage());
    }
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, version: VERSION, node: process.version, platform: process.platform, scan_running: scanRunning }, null, 2));
    }
    if (req.method === 'GET' && requestUrl.pathname === '/api/last-report') {
      res.writeHead(lastReport ? 200 : 404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(lastReport || { ok: false, error: '尚無掃描報告' }, null, 2));
    }
    if (req.method === 'POST' && requestUrl.pathname === '/run') {
      if (scanRunning) {
        res.writeHead(409, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(homePage('已有掃描正在執行，請稍後再試。'));
      }
      scanRunning = true;
      try {
        const body = await readBody(req);
        const form = new URLSearchParams(body);
        const input = Object.fromEntries(form.entries());
        if (!input.password) input.password = process.env.RT7_DVR_PASSWORD || '';
        lastReport = await runScan(input);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(resultPage(lastReport));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(homePage(err.message));
      } finally {
        scanRunning = false;
      }
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[RT7] ${VERSION} listening on 0.0.0.0:${PORT}`);
});
