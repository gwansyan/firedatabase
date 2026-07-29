'use strict';

const express = require('express');
const { spawn } = require('child_process');
const net = require('net');
const os = require('os');

const app = express();
app.use(express.json({ limit: '64kb' }));

const PORT = Number(process.env.PORT || 8080);
const VERSION = 'RT7_PHASE10_NATIVE_RTSP_CLOUD_DIRECT_TEST';
const startedAt = Date.now();

const state = {
  running: false,
  run_id: 0,
  started_at: null,
  finished_at: null,
  stage: 'idle',
  ffmpeg: null,
  tcp: null,
  rtsp: null,
  diagnosis: null,
  last_error: '',
  child: null
};

function nowIso() { return new Date().toISOString(); }
function text(v, fallback = '') { return String(v ?? fallback).trim(); }
function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function isPrivateIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = m.slice(1).map(Number);
  if (a.some(x => x < 0 || x > 255)) return false;
  return a[0] === 10 || a[0] === 127 ||
    (a[0] === 192 && a[1] === 168) ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 169 && a[1] === 254);
}
function maskUrl(url) {
  return String(url).replace(/(rtsp:\/\/[^:/@]+:)[^@]+(@)/i, '$1******$2');
}
function makeConfig(body = {}) {
  const host = text(body.host || process.env.RT7_RTSP_HOST, '192.168.0.123');
  const port = clampInt(body.port || process.env.RT7_RTSP_PORT, 1, 65535, 554);
  const user = text(body.user || process.env.RT7_RTSP_USER, 'admin');
  const pass = text(body.password || process.env.RT7_RTSP_PASSWORD, '');
  const channel = clampInt(body.channel || process.env.RT7_RTSP_CHANNEL, 1, 64, 1);
  let streamPath = text(body.path || process.env.RT7_RTSP_PATH, `/main_${channel - 1}`);
  if (!streamPath.startsWith('/')) streamPath = '/' + streamPath;
  const transport = text(body.transport || process.env.RT7_RTSP_TRANSPORT, 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
  const seconds = clampInt(body.seconds || process.env.RT7_RTSP_TEST_SECONDS, 3, 30, 8);
  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(pass);
  const auth = user ? `${encodedUser}:${encodedPass}@` : '';
  const url = `rtsp://${auth}${host}:${port}${streamPath}`;
  return { host, port, user, pass, channel, path: streamPath, transport, seconds, url, masked_url: maskUrl(url), private_ip: isPrivateIpv4(host) };
}

function publicState() {
  const cfg = makeConfig({});
  return {
    ok: true,
    version: VERSION,
    running: state.running,
    run_id: state.run_id,
    started_at: state.started_at,
    finished_at: state.finished_at,
    stage: state.stage,
    ffmpeg: state.ffmpeg,
    tcp: state.tcp,
    rtsp: state.rtsp,
    diagnosis: state.diagnosis,
    last_error: state.last_error,
    default_target: {
      host: cfg.host,
      port: cfg.port,
      channel: cfg.channel,
      path: cfg.path,
      transport: cfg.transport,
      masked_url: cfg.masked_url,
      private_ip: cfg.private_ip,
      password_configured: !!cfg.pass
    },
    railway: {
      hostname: os.hostname(),
      railway_environment: process.env.RAILWAY_ENVIRONMENT_NAME || '',
      railway_service: process.env.RAILWAY_SERVICE_NAME || '',
      region: process.env.RAILWAY_REPLICA_REGION || process.env.RAILWAY_REGION || '',
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptime_sec: Math.floor((Date.now() - startedAt) / 1000)
    }
  };
}

function runCommand(command, args, timeoutMs) {
  return new Promise(resolve => {
    const began = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return resolve({ ok: false, spawn_error: err.message, elapsed_ms: Date.now() - began, stdout: '', stderr: '' });
    }
    state.child = child;
    child.stdout.on('data', d => { stdout = (stdout + d.toString()).slice(-24000); });
    child.stderr.on('data', d => { stderr = (stderr + d.toString()).slice(-48000); });
    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.child = null;
      resolve({ ok: false, spawn_error: err.message, elapsed_ms: Date.now() - began, stdout, stderr });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.child = null;
      resolve({ ok: code === 0, code, signal, elapsed_ms: Date.now() - began, stdout, stderr, timed_out: signal === 'SIGKILL' });
    });
  });
}

function tcpProbe(host, port, timeoutMs = 6000) {
  return new Promise(resolve => {
    const began = Date.now();
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ...result, elapsed_ms: Date.now() - began });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, remote_address: socket.remoteAddress, remote_port: socket.remotePort }));
    socket.once('timeout', () => finish({ ok: false, code: 'ETIMEDOUT', error: `TCP ${timeoutMs}ms timeout` }));
    socket.once('error', err => finish({ ok: false, code: err.code || '', error: err.message }));
  });
}

function parseRtspResult(result) {
  const log = `${result.stderr || ''}\n${result.stdout || ''}`;
  const frameMatches = [...log.matchAll(/frame=\s*(\d+)/g)];
  const frames = frameMatches.length ? Number(frameMatches[frameMatches.length - 1][1]) : 0;
  let category = 'unknown';
  if (result.ok && frames > 0) category = 'success';
  else if (/401 Unauthorized|method DESCRIBE failed: 401/i.test(log)) category = 'authentication_failed';
  else if (/404 Not Found|method DESCRIBE failed: 404/i.test(log)) category = 'stream_path_not_found';
  else if (/Connection refused/i.test(log)) category = 'connection_refused';
  else if (/Connection timed out|Operation timed out|Network is unreachable|No route to host/i.test(log) || result.timed_out) category = 'network_unreachable_or_timeout';
  else if (/Invalid data found|could not find codec parameters/i.test(log)) category = 'stream_or_codec_error';
  else if (/Input #0, rtsp/i.test(log) && frames === 0) category = 'rtsp_opened_no_decoded_frame';
  return {
    ok: result.ok && frames > 0,
    category,
    exit_code: result.code ?? null,
    signal: result.signal || null,
    timed_out: !!result.timed_out,
    elapsed_ms: result.elapsed_ms,
    decoded_frames: frames,
    log_tail: log.slice(-12000)
  };
}

function diagnose(cfg, ffmpeg, tcp, rtsp) {
  if (!ffmpeg || !ffmpeg.ok) {
    return {
      code: 'RAILWAY_FFMPEG_UNAVAILABLE',
      title: 'Railway 無法啟動 FFmpeg',
      conclusion: '先確認 Railway 使用本專案 Dockerfile 部署，並在部署紀錄中看到 ffmpeg 套件安裝成功。',
      gateway_removable: false
    };
  }
  if (rtsp && rtsp.ok) {
    return {
      code: 'CLOUD_DIRECT_RTSP_SUCCESS',
      title: 'Railway 可直接拉取 DVR RTSP',
      conclusion: '雲端已取得並解碼影格。技術上可移除本機 RTSP Gateway，再進行正式串流與多使用者負載測試。',
      gateway_removable: true
    };
  }
  if (!tcp || !tcp.ok) {
    if (cfg.private_ip) {
      return {
        code: 'PRIVATE_LAN_NOT_REACHABLE_FROM_RAILWAY',
        title: 'DVR 內網位址無法由 Railway 存取',
        conclusion: `${cfg.host} 是私有內網 IP。Railway 不在同一區域網路，沒有路由、VPN 或公開連接埠時不能直接連線。DVR 仍可提供 RTSP 拉流，但雲端看不到它；本機 Gateway 暫時不能移除。`,
        gateway_removable: false
      };
    }
    return {
      code: 'PUBLIC_RTSP_PORT_UNREACHABLE',
      title: 'Railway 無法連到 RTSP TCP 連接埠',
      conclusion: '請檢查公網 IP、路由器 Port Forward、DVR 防火牆、ISP CGNAT，以及 RTSP 連接埠是否正確。',
      gateway_removable: false
    };
  }
  const map = {
    authentication_failed: ['RTSP_AUTHENTICATION_FAILED', 'RTSP 帳號或密碼錯誤', 'Railway 已能連到 DVR，但 DVR 拒絕認證。修正 RT7_RTSP_USER 與 RT7_RTSP_PASSWORD。'],
    stream_path_not_found: ['RTSP_PATH_NOT_FOUND', 'RTSP 串流路徑錯誤', 'Railway 已能連到 DVR，但指定路徑不存在。確認 main_0～main_3 的實際路徑。'],
    connection_refused: ['RTSP_CONNECTION_REFUSED', 'DVR 拒絕 RTSP 連線', '主機可達，但指定連接埠沒有 RTSP 服務或被防火牆拒絕。'],
    rtsp_opened_no_decoded_frame: ['RTSP_OPENED_NO_FRAME', 'RTSP 已開啟但沒有解碼影格', '網路與 RTSP 握手成功，但測試期間沒有影格。檢查攝影機訊號、編碼格式及 DVR Session 限制。'],
    stream_or_codec_error: ['RTSP_STREAM_CODEC_ERROR', 'RTSP 串流或編碼解析失敗', '網路可達，但 FFmpeg 無法正常解析或解碼此串流。']
  };
  const chosen = map[rtsp?.category] || ['RTSP_PULL_FAILED', 'Railway 可連到主機，但 RTSP 拉流失敗', '查看 FFmpeg 記錄尾端，以判斷認證、路徑、編碼或 DVR Session 問題。'];
  return { code: chosen[0], title: chosen[1], conclusion: chosen[2], gateway_removable: false };
}

async function runFullTest(cfg) {
  state.running = true;
  state.run_id += 1;
  state.started_at = nowIso();
  state.finished_at = null;
  state.stage = 'ffmpeg_check';
  state.ffmpeg = null;
  state.tcp = null;
  state.rtsp = null;
  state.diagnosis = null;
  state.last_error = '';

  try {
    const versionResult = await runCommand('ffmpeg', ['-version'], 8000);
    const firstLine = `${versionResult.stdout || versionResult.stderr || ''}`.split(/\r?\n/)[0] || '';
    state.ffmpeg = {
      ok: versionResult.ok,
      version_line: firstLine,
      exit_code: versionResult.code ?? null,
      error: versionResult.spawn_error || '',
      elapsed_ms: versionResult.elapsed_ms
    };
    if (!state.ffmpeg.ok) {
      state.diagnosis = diagnose(cfg, state.ffmpeg, null, null);
      return;
    }

    state.stage = 'tcp_probe';
    state.tcp = await tcpProbe(cfg.host, cfg.port, 6000);

    state.stage = 'rtsp_pull';
    const args = [
      '-hide_banner', '-loglevel', 'info',
      '-rtsp_transport', cfg.transport,
      '-i', cfg.url,
      '-an', '-frames:v', String(Math.max(25, cfg.seconds * 5)),
      '-f', 'null', '-'
    ];
    const raw = await runCommand('ffmpeg', args, (cfg.seconds + 12) * 1000);
    state.rtsp = parseRtspResult(raw);
    state.rtsp.command = ['ffmpeg', '-hide_banner', '-loglevel', 'info', '-rtsp_transport', cfg.transport, '-i', cfg.masked_url, '-an', '-frames:v', String(Math.max(25, cfg.seconds * 5)), '-f', 'null', '-'].join(' ');
    state.rtsp.target = { host: cfg.host, port: cfg.port, path: cfg.path, channel: cfg.channel, private_ip: cfg.private_ip, masked_url: cfg.masked_url };
    state.diagnosis = diagnose(cfg, state.ffmpeg, state.tcp, state.rtsp);
  } catch (err) {
    state.last_error = err && err.stack ? err.stack : String(err);
    state.diagnosis = { code: 'TEST_INTERNAL_ERROR', title: '測試程式發生錯誤', conclusion: String(err.message || err), gateway_removable: false };
  } finally {
    state.running = false;
    state.stage = 'complete';
    state.finished_at = nowIso();
    state.child = null;
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, version: VERSION, uptime_sec: Math.floor((Date.now() - startedAt) / 1000) }));
app.get('/api/rt7/rtsp-cloud/status', (_req, res) => res.json(publicState()));
app.get('/api/rt7/rtsp-cloud/config', (_req, res) => {
  const cfg = makeConfig({});
  res.json({ ok: true, config: { host: cfg.host, port: cfg.port, channel: cfg.channel, path: cfg.path, transport: cfg.transport, seconds: cfg.seconds, masked_url: cfg.masked_url, private_ip: cfg.private_ip, password_configured: !!cfg.pass } });
});
app.post('/api/rt7/rtsp-cloud/run', (req, res) => {
  if (state.running) return res.status(409).json({ ok: false, error: 'TEST_ALREADY_RUNNING', status: publicState() });
  const cfg = makeConfig(req.body || {});
  setImmediate(() => runFullTest(cfg));
  res.status(202).json({ ok: true, accepted: true, run_id: state.run_id + 1, target: { host: cfg.host, port: cfg.port, path: cfg.path, channel: cfg.channel, masked_url: cfg.masked_url, private_ip: cfg.private_ip } });
});
app.post('/api/rt7/rtsp-cloud/stop', (_req, res) => {
  if (state.child) {
    try { state.child.kill('SIGKILL'); } catch (_) {}
    state.last_error = '使用者停止測試';
  }
  res.json({ ok: true });
});

app.get('/', (_req, res) => res.type('html').send(`<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RT7 Native RTSP Cloud Direct Test</title>
<style>
body{font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif;background:#0b1115;color:#eef4f7;margin:0}.wrap{max-width:920px;margin:auto;padding:18px}.card{background:#151e24;border:1px solid #31404a;border-radius:14px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}label{font-size:14px;color:#b7c7d1}input,select,button{box-sizing:border-box;width:100%;padding:12px;border-radius:9px;border:1px solid #45545e;background:#0d151a;color:white;font-size:16px}button{background:#176fa8;font-weight:700;cursor:pointer}.stop{background:#873535}.status{font-size:22px;font-weight:800}.good{color:#45d483}.bad{color:#ff7373}.wait{color:#ffd45d}pre{white-space:pre-wrap;word-break:break-word;background:#091014;border-radius:10px;padding:12px;max-height:330px;overflow:auto}.note{color:#ffd45d}.full{grid-column:1/-1}@media(max-width:650px){.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>RT7 Native RTSP Cloud Direct Test</h1>
<div class="card note">此頁是在 Railway 容器內執行 FFmpeg 與 RTSP 測試，不會使用你電腦上的 RTSP Gateway。</div>
<div class="card"><div class="grid">
<div><label>DVR Host</label><input id="host" value="${makeConfig({}).host}"></div>
<div><label>RTSP Port</label><input id="port" type="number" value="${makeConfig({}).port}"></div>
<div><label>User</label><input id="user" value="${makeConfig({}).user}"></div>
<div><label>Password</label><input id="password" type="password" placeholder="建議使用 Railway 環境變數"></div>
<div><label>Channel</label><select id="channel"><option>1</option><option>2</option><option>3</option><option>4</option></select></div>
<div><label>Path</label><input id="path" value="${makeConfig({}).path}"></div>
<div><label>Transport</label><select id="transport"><option value="tcp">TCP</option><option value="udp">UDP</option></select></div>
<div><label>測試秒數</label><input id="seconds" type="number" min="3" max="30" value="8"></div>
<div><button onclick="runTest()">開始雲端直連測試</button></div><div><button class="stop" onclick="stopTest()">停止</button></div>
</div></div>
<div class="card"><div id="headline" class="status wait">尚未測試</div><div id="conclusion"></div></div>
<div class="card"><b>三階段結果</b><pre id="result">等待測試...</pre></div>
<div class="card"><b>FFmpeg 記錄尾端</b><pre id="log">尚無記錄</pre></div>
</div><script>
let timer=null;
function val(id){return document.getElementById(id).value}
async function runTest(){
 const channel=Number(val('channel')); const p=document.getElementById('path'); if(!p.value||/^\/main_\d+$/.test(p.value))p.value='/main_'+(channel-1);
 const body={host:val('host'),port:Number(val('port')),user:val('user'),password:val('password'),channel,path:val('path'),transport:val('transport'),seconds:Number(val('seconds'))};
 const r=await fetch('/api/rt7/rtsp-cloud/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); const j=await r.json(); if(!r.ok){alert(j.error||'無法開始');return;} poll();
}
async function stopTest(){await fetch('/api/rt7/rtsp-cloud/stop',{method:'POST'});}
async function poll(){
 const j=await fetch('/api/rt7/rtsp-cloud/status?ts='+Date.now()).then(r=>r.json());
 const d=j.diagnosis; const h=document.getElementById('headline');
 if(j.running){h.className='status wait';h.textContent='測試中：'+j.stage;}
 else if(d){h.className='status '+(d.gateway_removable?'good':'bad');h.textContent=d.title;}
 else{h.className='status wait';h.textContent='尚未測試';}
 document.getElementById('conclusion').textContent=d?d.conclusion:'';
 document.getElementById('result').textContent=JSON.stringify({stage:j.stage,ffmpeg:j.ffmpeg,tcp:j.tcp,rtsp:j.rtsp&&{ok:j.rtsp.ok,category:j.rtsp.category,decoded_frames:j.rtsp.decoded_frames,elapsed_ms:j.rtsp.elapsed_ms,target:j.rtsp.target},diagnosis:j.diagnosis,railway:j.railway},null,2);
 document.getElementById('log').textContent=j.rtsp?.log_tail||'尚無記錄';
 clearTimeout(timer); timer=setTimeout(poll,j.running?1000:4000);
}
document.getElementById('channel').addEventListener('change',e=>{document.getElementById('path').value='/main_'+(Number(e.target.value)-1)});poll();
</script></body></html>`));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RT7] ${VERSION}`);
  console.log(`[RT7] listening on 0.0.0.0:${PORT}`);
  console.log(`[RT7] default target ${makeConfig({}).masked_url}`);
});
