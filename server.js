'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const { URL, URLSearchParams } = require('url');

const VERSION = 'RT7_PHASE10_GATEWAY_DIAGNOSTIC_SCANNER_V1';
const PORT = Number(process.env.PORT || 8090);
const DEFAULT_GATEWAY = process.env.RT7_GATEWAY_URL || 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT = Math.max(1000, Number(process.env.RT7_GATEWAY_TIMEOUT_MS || 5000));
const DEFAULT_FRAME_TIMEOUT = Math.max(2000, Number(process.env.RT7_FRAME_TIMEOUT_MS || 8000));
let lastReport = null;

function esc(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function nowIso() { return new Date().toISOString(); }
function msSince(t) { return Date.now() - t; }
function normalizeBase(input) {
  let s = String(input || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  const u = new URL(s);
  u.pathname = u.pathname.replace(/\/+$/, '');
  u.search = ''; u.hash = '';
  return u.toString().replace(/\/$/, '');
}
function isPrivateHost(host) {
  if (/^(localhost|127\.|0\.0\.0\.0$|::1$)/i.test(host)) return true;
  const p = host.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 127;
}
function requestBuffer(urlText, timeoutMs, maxBytes = 1024 * 1024, headers = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    let u;
    try { u = new URL(urlText); } catch (e) { return resolve({ok:false,status:0,error:'INVALID_URL: '+e.message,elapsed_ms:0,headers:{},body:Buffer.alloc(0)}); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers: {'User-Agent':'RT7-Gateway-Diagnostic/1.0','Cache-Control':'no-cache',...headers}, rejectUnauthorized:false }, res => {
      const chunks=[]; let size=0; let ended=false;
      res.on('data', chunk => {
        if (ended) return;
        size += chunk.length;
        if (size <= maxBytes) chunks.push(chunk);
        if (size >= maxBytes) { ended=true; req.destroy(); resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,error:null,elapsed_ms:msSince(started),headers:res.headers,body:Buffer.concat(chunks)}); }
      });
      res.on('end', () => { if (!ended) resolve({ok:res.statusCode>=200&&res.statusCode<400,status:res.statusCode,error:null,elapsed_ms:msSince(started),headers:res.headers,body:Buffer.concat(chunks)}); });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout after '+timeoutMs+' ms')));
    req.on('error', e => resolve({ok:false,status:0,error:e.message,elapsed_ms:msSince(started),headers:{},body:Buffer.alloc(0)}));
  });
}
function tcpTest(host, port, timeoutMs) {
  return new Promise(resolve => {
    const started=Date.now(); const s=net.createConnection({host,port}); let done=false;
    const finish=(status,detail)=>{if(done)return;done=true;s.destroy();resolve({status,detail,elapsed_ms:msSince(started)});};
    s.setTimeout(timeoutMs); s.on('connect',()=>finish('OPEN','TCP connected')); s.on('timeout',()=>finish('TIMEOUT','timeout after '+timeoutMs+' ms')); s.on('error',e=>finish('ERROR',e.code||e.message));
  });
}
function safeJson(buf) { try { return {ok:true,value:JSON.parse(buf.toString('utf8'))}; } catch(e) { return {ok:false,error:e.message,text:buf.toString('utf8').slice(0,2000)}; } }
function findFirst(obj, keys) {
  const wanted = new Set(keys.map(k=>k.toLowerCase()));
  const seen = new Set();
  function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return undefined; seen.add(v);
    for (const [k,val] of Object.entries(v)) if (wanted.has(k.toLowerCase()) && val !== null && val !== '') return val;
    for (const val of Object.values(v)) { const r=walk(val); if (r!==undefined) return r; }
  }
  return walk(obj);
}
function jpegFrameTest(urlText, timeoutMs) {
  return new Promise(resolve => {
    const started=Date.now(); let u;
    try { u=new URL(urlText); } catch(e) { return resolve({ok:false,error:'INVALID_URL',elapsed_ms:0,bytes:0}); }
    const lib=u.protocol==='https:'?https:http; let data=Buffer.alloc(0); let done=false;
    const finish=(out)=>{if(done)return;done=true;req.destroy();resolve({...out,elapsed_ms:msSince(started)});};
    const req=lib.get(u,{headers:{'User-Agent':'RT7-Gateway-Diagnostic/1.0','Cache-Control':'no-cache'},rejectUnauthorized:false},res=>{
      if (!(res.statusCode>=200&&res.statusCode<400)) return finish({ok:false,error:'HTTP_'+res.statusCode,bytes:0,content_type:res.headers['content-type']||''});
      res.on('data',chunk=>{
        data=Buffer.concat([data,chunk]); if(data.length>3*1024*1024)data=data.subarray(data.length-2*1024*1024);
        const soi=data.indexOf(Buffer.from([0xff,0xd8]));
        if(soi>=0){const eoi=data.indexOf(Buffer.from([0xff,0xd9]),soi+2);if(eoi>soi){const frame=data.subarray(soi,eoi+2);return finish({ok:true,error:null,bytes:frame.length,content_type:res.headers['content-type']||'',jpeg_soi:true,jpeg_eoi:true});}}
      });
      res.on('end',()=>finish({ok:false,error:'STREAM_ENDED_BEFORE_JPEG',bytes:data.length,content_type:res.headers['content-type']||''}));
    });
    req.setTimeout(timeoutMs,()=>finish({ok:false,error:'TIMEOUT_AFTER_'+timeoutMs+'_MS',bytes:data.length,content_type:''}));
    req.on('error',e=>finish({ok:false,error:e.message,bytes:data.length,content_type:''}));
  });
}

async function scan(baseInput, timeoutMs, frameTimeoutMs) {
  const started=Date.now(); const base=normalizeBase(baseInput); const u=new URL(base);
  const report={version:VERSION,generated_at:nowIso(),input:{gateway_url:base,timeout_ms:timeoutMs,frame_timeout_ms:frameTimeoutMs},environment:{node:process.version,platform:process.platform,scanner_host_private:isPrivateHost(u.hostname)},gateway:{},endpoints:{},conclusion:{}};
  report.gateway.tcp=await tcpTest(u.hostname,Number(u.port||(u.protocol==='https:'?443:80)),timeoutMs);
  const candidates=[['status','/status'],['health','/health'],['channel','/api/channel']];
  for(const [name,path] of candidates){const r=await requestBuffer(base+path,timeoutMs,512*1024);const j=safeJson(r.body);report.endpoints[name]={url:base+path,ok:r.ok,status:r.status,elapsed_ms:r.elapsed_ms,error:r.error,content_type:r.headers['content-type']||'',json_ok:j.ok,json:j.ok?j.value:null,preview:j.ok?null:(j.text||'').slice(0,500)};}
  const statusObj=report.endpoints.status.json || report.endpoints.health.json || {};
  report.gateway.state=findFirst(statusObj,['state','stream_state','status']);
  report.gateway.current_channel=Number(findFirst(statusObj,['current_channel','channel','active_channel']))||null;
  report.gateway.target_channel=Number(findFirst(statusObj,['target_channel','requested_channel']))||null;
  report.gateway.fps=Number(findFirst(statusObj,['fps','output_fps','live_fps']))||null;
  report.gateway.frame_age_ms=Number(findFirst(statusObj,['frame_age_ms','age_ms','latest_frame_age_ms','age']))||null;
  report.gateway.clients=Number(findFirst(statusObj,['clients','client_count','stream_clients']))||0;
  report.gateway.frames=Number(findFirst(statusObj,['frames','frame_count','frames_out']))||null;
  report.gateway.ffmpeg_alive=findFirst(statusObj,['ffmpeg_alive','process_alive','alive']);
  report.gateway.ffmpeg_exit_code=findFirst(statusObj,['ffmpeg_exit_code','exit_code']);
  report.gateway.ffmpeg_last_line=findFirst(statusObj,['ffmpeg_last_line','last_error','error']);
  const streamPaths=['/stream.mjpg','/api/camera/stream'];
  report.stream_attempts=[];
  for(const path of streamPaths){const r=await jpegFrameTest(base+path,frameTimeoutMs);report.stream_attempts.push({path,url:base+path,...r});if(r.ok){report.stream={selected_path:path,...r};break;}}
  if(!report.stream)report.stream={selected_path:null,ok:false,error:report.stream_attempts.map(x=>x.path+': '+x.error).join(' | ')};
  const tcpOpen=report.gateway.tcp.status==='OPEN'; const apiOk=report.endpoints.status.ok||report.endpoints.health.ok; const frameOk=report.stream.ok;
  if(tcpOpen&&apiOk&&frameOk){report.conclusion={code:'GATEWAY_END_TO_END_SUCCESS',title:'Gateway 端到端診斷成功',detail:'Scanner 可連線 Gateway、讀取狀態，並從 MJPEG 串流取得完整 JPEG 影格。'};}
  else if(!tcpOpen&&isPrivateHost(u.hostname)){report.conclusion={code:'GATEWAY_PRIVATE_ADDRESS_NOT_REACHABLE_FROM_SCANNER',title:'Scanner 無法到達 Gateway 私有位址',detail:'若 Scanner 部署在 Railway，而 Gateway 位於 127.0.0.1 或 192.168.x.x，這是正常結果。請在 Gateway 同一台電腦執行本工具，或提供公網/反向通道。'};}
  else if(!tcpOpen){report.conclusion={code:'GATEWAY_TCP_UNREACHABLE',title:'Gateway TCP 連線失敗',detail:'請確認 Gateway 已啟動、IP/Port 正確，以及防火牆允許連線。'};}
  else if(!apiOk){report.conclusion={code:'GATEWAY_API_UNAVAILABLE',title:'Gateway 可連線，但狀態 API 不可用',detail:'TCP 已連通，但 /status 與 /health 未取得有效回應。'};}
  else {report.conclusion={code:'GATEWAY_STREAM_NO_JPEG_FRAME',title:'Gateway API 正常，但未取得 MJPEG 影格',detail:'請檢查 FFmpeg 狀態、目前通道、DVR RTSP、以及 /stream.mjpg 輸出。'};}
  report.elapsed_ms=msSince(started); lastReport=report; return report;
}

const css=`:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#071116;color:#eef6fa;font-family:Arial,"Noto Sans TC",sans-serif}.wrap{max-width:1120px;margin:auto;padding:28px 18px 60px}.card{background:#101d23;border:1px solid #31454f;border-radius:13px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.full{grid-column:1/-1}input,button{width:100%;padding:12px;border-radius:8px;border:1px solid #47606c;background:#071116;color:#fff;font-size:16px}button{background:#1977b6;border:0;font-weight:700}.ok{color:#35d07f}.bad{color:#ff6565}.warn{color:#ffc84d}.muted{color:#9fb2bc}.code{font-family:Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#03090c;padding:12px;border-radius:8px;max-height:440px;overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #2c4049;vertical-align:top}.result{font-size:22px;font-weight:800}@media(max-width:700px){.grid{grid-template-columns:1fr}.full{grid-column:auto}}`;
function page(title,body){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body><main class="wrap">${body}</main></body></html>`;}
function home(msg='') { return page(VERSION,`<h1>RT7 Gateway Diagnostic Scanner</h1><div class="card"><p class="warn">此工具應優先在 RTSP Gateway 同一台電腦執行。若部署到 Railway，Railway 無法直接存取 127.0.0.1 或 192.168.x.x 的本機 Gateway。</p>${msg?`<p class="bad">${esc(msg)}</p>`:''}</div><form class="card" method="post" action="/run"><div class="grid"><div class="full"><label>Gateway Base URL</label><input name="gateway_url" value="${esc(DEFAULT_GATEWAY)}" required></div><div><label>HTTP/TCP timeout (ms)</label><input name="timeout_ms" type="number" min="1000" max="30000" value="${DEFAULT_TIMEOUT}"></div><div><label>MJPEG frame timeout (ms)</label><input name="frame_timeout_ms" type="number" min="2000" max="60000" value="${DEFAULT_FRAME_TIMEOUT}"></div><div class="full"><button type="submit">開始 Gateway 端到端診斷</button></div></div></form><div class="card"><h2>診斷內容</h2><p>① Gateway TCP　② /status、/health、/api/channel　③ FFmpeg/通道/FPS/影格年齡　④ /stream.mjpg 第一張 JPEG　⑤ 最終結論。</p></div>`); }
function resultPage(r){const cls=r.conclusion.code==='GATEWAY_END_TO_END_SUCCESS'?'ok':'bad';const ep=Object.entries(r.endpoints).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="${v.ok?'ok':'bad'}">${v.ok?'PASS':'FAIL'}</td><td>${v.status||'-'}</td><td>${v.elapsed_ms} ms</td><td>${esc(v.error||v.content_type||'')}</td></tr>`).join('');const st=r.stream_attempts.map(v=>`<tr><td>${esc(v.path)}</td><td class="${v.ok?'ok':'bad'}">${v.ok?'JPEG PASS':'FAIL'}</td><td>${v.elapsed_ms} ms</td><td>${v.bytes||0}</td><td>${esc(v.error||v.content_type||'')}</td></tr>`).join('');return page(VERSION,`<h1>RT7 Gateway Diagnostic Scanner</h1><div class="card"><div class="result ${cls}">${esc(r.conclusion.code)}</div><h2>${esc(r.conclusion.title)}</h2><p>${esc(r.conclusion.detail)}</p></div><div class="card"><table><tr><th>Gateway</th><td>${esc(r.input.gateway_url)}</td></tr><tr><th>TCP</th><td class="${r.gateway.tcp.status==='OPEN'?'ok':'bad'}">${esc(r.gateway.tcp.status)} — ${esc(r.gateway.tcp.detail)}</td></tr><tr><th>State</th><td>${esc(r.gateway.state??'未提供')}</td></tr><tr><th>Current / Target CH</th><td>${esc(r.gateway.current_channel??'-')} / ${esc(r.gateway.target_channel??'-')}</td></tr><tr><th>FPS</th><td>${esc(r.gateway.fps??'未提供')}</td></tr><tr><th>Frame age</th><td>${esc(r.gateway.frame_age_ms??'未提供')} ms</td></tr><tr><th>Clients / Frames</th><td>${esc(r.gateway.clients)} / ${esc(r.gateway.frames??'未提供')}</td></tr><tr><th>FFmpeg alive / exit</th><td>${esc(r.gateway.ffmpeg_alive??'未提供')} / ${esc(r.gateway.ffmpeg_exit_code??'未提供')}</td></tr><tr><th>FFmpeg last line</th><td>${esc(r.gateway.ffmpeg_last_line??'')}</td></tr><tr><th>總耗時</th><td>${r.elapsed_ms} ms</td></tr></table></div><div class="card"><h2>Gateway API</h2><table><thead><tr><th>Endpoint</th><th>結果</th><th>HTTP</th><th>耗時</th><th>說明</th></tr></thead><tbody>${ep}</tbody></table></div><div class="card"><h2>MJPEG 第一張影格</h2><table><thead><tr><th>Path</th><th>結果</th><th>耗時</th><th>JPEG bytes</th><th>說明</th></tr></thead><tbody>${st}</tbody></table></div><div class="card"><h2>Status JSON</h2><div class="code">${esc(JSON.stringify(r.endpoints.status.json||r.endpoints.health.json||{},null,2))}</div></div><div class="grid"><form method="get" action="/"><button>返回重新掃描</button></form><form method="get" action="/api/last-report"><button>開啟 JSON 報告</button></form></div>`);}
function parseBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000)req.destroy();});req.on('end',()=>resolve(new URLSearchParams(s)));req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(home());}if(req.method==='GET'&&u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,version:VERSION,node:process.version,platform:process.platform,time:nowIso()},null,2));}if(req.method==='GET'&&u.pathname==='/api/last-report'){res.writeHead(lastReport?200:404,{'Content-Type':'application/json'});return res.end(JSON.stringify(lastReport||{ok:false,error:'NO_REPORT_YET'},null,2));}if(req.method==='POST'&&u.pathname==='/run'){const p=await parseBody(req);const base=p.get('gateway_url')||DEFAULT_GATEWAY;const t=Math.max(1000,Math.min(30000,Number(p.get('timeout_ms')||DEFAULT_TIMEOUT)));const ft=Math.max(2000,Math.min(60000,Number(p.get('frame_timeout_ms')||DEFAULT_FRAME_TIMEOUT)));const r=await scan(base,t,ft);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(resultPage(r));}res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not Found');}catch(e){res.writeHead(500,{'Content-Type':'text/html; charset=utf-8'});res.end(home(e.stack||e.message));}});
server.listen(PORT,'0.0.0.0',()=>console.log(`[${VERSION}] http://127.0.0.1:${PORT}`));
