'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const { URL, URLSearchParams } = require('url');

const VERSION = 'RT7_PHASE10_GATEWAY_DIAGNOSTIC_SCANNER_V2';
const PORT = Number(process.env.PORT || process.env.RT7_SCANNER_PORT || 8090);
const HOST = process.env.RT7_SCANNER_HOST || '0.0.0.0';
let lastReport = null;

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function json(res, code, obj) { const b = Buffer.from(JSON.stringify(obj, null, 2)); res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store'}); res.end(b); }
function html(res, code, body) { const b = Buffer.from(body); res.writeHead(code, {'Content-Type':'text/html; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store'}); res.end(b); }
function normalizeBase(raw) { let s = String(raw || '').trim(); if (!/^https?:\/\//i.test(s)) s = 'http://' + s; const u = new URL(s); u.pathname = u.pathname.replace(/\/+$/, ''); u.search = ''; u.hash = ''; return u.toString().replace(/\/$/, ''); }
function join(base, p) { return new URL(p, base.endsWith('/') ? base : base + '/').toString(); }
function uniq(xs) { return [...new Set(xs.filter(Boolean))]; }
function isPrivateHost(h) { return h === 'localhost' || h === '127.0.0.1' || h === '::1' || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h); }

function requestBuffer(url, timeoutMs = 5000, maxBytes = 1024 * 1024) {
  return new Promise(resolve => {
    const t0 = Date.now(); let done = false; const chunks = []; let total = 0;
    const u = new URL(url); const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {headers:{'User-Agent':VERSION,'Accept':'*/*','Cache-Control':'no-cache'}, rejectUnauthorized:false}, r => {
      r.on('data', c => { if (done) return; const room = maxBytes-total; if (room > 0) { const x = c.length > room ? c.subarray(0, room) : c; chunks.push(x); total += x.length; } if (total >= maxBytes) finish(null, r); });
      r.on('end', () => finish(null, r));
      r.on('error', e => finish(e, r));
      function finish(err, rr) { if (done) return; done = true; clearTimeout(timer); try { req.destroy(); } catch {} resolve({ok:!err && rr && rr.statusCode >= 200 && rr.statusCode < 300,status:rr?.statusCode||0,headers:rr?.headers||{},body:Buffer.concat(chunks),error:err?String(err.message||err):null,elapsed_ms:Date.now()-t0}); }
    });
    req.on('error', e => { if (!done) { done=true; clearTimeout(timer); resolve({ok:false,status:0,headers:{},body:Buffer.alloc(0),error:String(e.message||e),elapsed_ms:Date.now()-t0}); } });
    const timer = setTimeout(() => { if (!done) { done=true; req.destroy(); resolve({ok:false,status:0,headers:{},body:Buffer.concat(chunks),error:`TIMEOUT_${timeoutMs}ms`,elapsed_ms:Date.now()-t0}); } }, timeoutMs);
  });
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise(resolve => { const t0=Date.now(); let done=false; const s=net.createConnection({host,port}); const finish=(status,detail)=>{if(done)return;done=true;s.destroy();resolve({status,detail,elapsed_ms:Date.now()-t0});}; s.setTimeout(timeoutMs); s.once('connect',()=>finish('OPEN','TCP connected')); s.once('timeout',()=>finish('TIMEOUT',`timeout after ${timeoutMs} ms`)); s.once('error',e=>finish('ERROR',e.code||e.message)); });
}

function discoverFromHtml(text) {
  const paths=[];
  const patterns=[/['"`]((?:\/|\.\/)[^'"`\s<>]+)['"`]/g,/(?:fetch|src|href)\s*[=(]\s*['"`]([^'"`]+)['"`]/gi];
  for (const re of patterns) { let m; while ((m=re.exec(text))) { let p=m[1]; if (!p || p.startsWith('//')) continue; p=p.replace(/&amp;/g,'&'); if (p.startsWith('./')) p=p.slice(1); if (p.startsWith('/') && !p.startsWith('/favicon')) paths.push(p); } }
  return uniq(paths.map(p=>p.replace(/\?[^#'"`]*/,'').replace(/[);,]+$/,'')));
}

function parseStatus(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const pick=(...ks)=>{for(const k of ks) if(obj[k]!==undefined&&obj[k]!==null)return obj[k]; return null;};
  return {state:pick('state','status'),current_channel:pick('current_channel','channel','active_channel'),target_channel:pick('target_channel','requested_channel'),fps:pick('output_fps','fps','live_fps'),frame_age_ms:pick('latest_age_ms','frame_age_ms','age_ms'),clients:pick('clients','client_count'),frames:pick('frames','frame_count'),source:pick('source','rtsp_url_masked','input'),ffmpeg_alive:pick('ffmpeg_alive','process_alive'),ffmpeg_exit:pick('ffmpeg_exit','exit_code'),version:pick('version')};
}

async function testMjpeg(url, timeoutMs) {
  return new Promise(resolve => {
    const t0=Date.now(); let finished=false; let data=Buffer.alloc(0); let frames=[]; const hashes=[];
    const u=new URL(url); const lib=u.protocol==='https:'?https:http;
    const req=lib.get(u,{headers:{'User-Agent':VERSION,'Accept':'multipart/x-mixed-replace,image/jpeg,*/*'},rejectUnauthorized:false},r=>{
      const ct=String(r.headers['content-type']||'');
      if (r.statusCode<200||r.statusCode>=300) return finish({ok:false,error:`HTTP_${r.statusCode}`,status:r.statusCode,content_type:ct});
      r.on('data',chunk=>{
        data=Buffer.concat([data,chunk]); if(data.length>3*1024*1024)data=data.subarray(data.length-2*1024*1024);
        while(true){const a=data.indexOf(Buffer.from([0xff,0xd8])); if(a<0)break; const b=data.indexOf(Buffer.from([0xff,0xd9]),a+2); if(b<0)break; const jpg=data.subarray(a,b+2); frames.push(jpg); hashes.push(simpleHash(jpg)); data=data.subarray(b+2); if(frames.length>=2) return finish({ok:true,status:r.statusCode,content_type:ct,frames:frames.length,bytes:frames.map(x=>x.length),distinct:hashes[0]!==hashes[1]}); }
      });
      r.on('end',()=>finish({ok:frames.length>0,error:frames.length?'STREAM_ENDED_AFTER_FRAME':'NO_JPEG_FRAME',status:r.statusCode,content_type:ct,frames:frames.length,bytes:frames.map(x=>x.length),distinct:frames.length>1?hashes[0]!==hashes[1]:null}));
      r.on('error',e=>finish({ok:false,error:String(e.message||e),status:r.statusCode,content_type:ct}));
    });
    req.on('error',e=>finish({ok:false,error:String(e.message||e),status:0,content_type:''}));
    const timer=setTimeout(()=>finish({ok:frames.length>0,error:frames.length?'ONLY_ONE_FRAME_BEFORE_TIMEOUT':`TIMEOUT_${timeoutMs}ms`,status:0,content_type:'',frames:frames.length,bytes:frames.map(x=>x.length),distinct:null}),timeoutMs);
    function finish(o){if(finished)return;finished=true;clearTimeout(timer);try{req.destroy();}catch{} resolve({...o,url,elapsed_ms:Date.now()-t0});}
  });
}
function simpleHash(b){let h=2166136261; const step=Math.max(1,Math.floor(b.length/2048)); for(let i=0;i<b.length;i+=step){h^=b[i];h=Math.imul(h,16777619);} return h>>>0;}

async function runScan(input) {
  const started=Date.now(); const base=normalizeBase(input.gateway_url); const u=new URL(base); const timeout=Math.max(1000,Math.min(20000,Number(input.timeout_ms)||5000)); const frameTimeout=Math.max(2000,Math.min(30000,Number(input.frame_timeout_ms)||10000));
  const report={version:VERSION,generated_at:new Date().toISOString(),input:{gateway_url:base,timeout_ms:timeout,frame_timeout_ms:frameTimeout},environment:{node:process.version,platform:process.platform,hostname:os.hostname(),railway:Boolean(process.env.RAILWAY_ENVIRONMENT||process.env.RAILWAY_PROJECT_ID),loopback:['127.0.0.1','localhost','::1'].includes(u.hostname),target_private:isPrivateHost(u.hostname)},gateway:{},pages:[],discovered_paths:[],api_attempts:[],stream_attempts:[]};
  report.gateway.tcp=await tcpProbe(u.hostname,Number(u.port||(u.protocol==='https:'?443:80)),timeout);
  if(report.gateway.tcp.status!=='OPEN'){report.conclusion={code:'GATEWAY_TCP_UNREACHABLE',title:'無法連線 Gateway TCP Port',detail:report.gateway.tcp.detail};report.elapsed_ms=Date.now()-started;lastReport=report;return report;}

  const pagePaths=['/live.html','/']; let liveHtml='';
  for(const p of pagePaths){const r=await requestBuffer(join(base,p),timeout,1024*1024); const text=r.body.toString('utf8'); report.pages.push({path:p,status:r.status,ok:r.ok,content_type:r.headers['content-type']||'',elapsed_ms:r.elapsed_ms,bytes:r.body.length,title:(text.match(/<title[^>]*>([^<]+)/i)||[])[1]||null}); if(r.ok&&/text\/html/i.test(String(r.headers['content-type']||''))&&!liveHtml)liveHtml=text;}
  const discovered=discoverFromHtml(liveHtml); report.discovered_paths=discovered;

  const apiCandidates=uniq(['/status','/health','/api/channel','/api/status','/api/health','/status.json',...discovered.filter(p=>/status|health|channel|state/i.test(p))]);
  let bestStatus=null;
  for(const p of apiCandidates){const r=await requestBuffer(join(base,p),timeout,512*1024); let obj=null; try{obj=JSON.parse(r.body.toString('utf8'));}catch{} const parsed=parseStatus(obj); const item={path:p,status:r.status,ok:r.ok,json_ok:!!obj,elapsed_ms:r.elapsed_ms,content_type:r.headers['content-type']||'',parsed,preview:obj?null:r.body.toString('utf8').slice(0,200)}; report.api_attempts.push(item); if(obj&&Object.values(parsed).some(v=>v!==null)&&(!bestStatus||p==='/status')) bestStatus={path:p,obj,parsed}; }
  if(bestStatus){report.gateway.status_path=bestStatus.path;Object.assign(report.gateway,bestStatus.parsed);report.gateway.raw_status=bestStatus.obj;}

  const scannerSelf = report.api_attempts.some(x=>x.json_ok&&x.parsed.version===VERSION) || report.pages.some(x=>String(x.title||'').includes('DIAGNOSTIC_SCANNER'));
  report.environment.self_loop_detected=scannerSelf;
  if(scannerSelf){report.conclusion={code:'SCANNER_LOOPBACK_POINTS_TO_ITSELF',title:'127.0.0.1 指向 Scanner 自己，不是 DVR Gateway',detail:report.environment.railway?'Scanner 正在 Railway 容器內執行；Railway 的 127.0.0.1 只代表 Railway 容器。請在 Gateway 同一台 Windows 電腦啟動此 Scanner，或填入該電腦可到達的 Gateway LAN 位址。':'Scanner 與 Gateway 使用了相同位址/Port，或 Gateway URL 指到 Scanner 自己。Scanner 預設 8090，Gateway 應為 8080。'};report.elapsed_ms=Date.now()-started;lastReport=report;return report;}

  const streamCandidates=uniq([...discovered.filter(p=>/mjpg|mjpeg|stream|camera/i.test(p)), '/stream.mjpg','/api/camera/stream','/mjpeg','/video.mjpg']);
  let selected=null;
  for(const p of streamCandidates){const a=await testMjpeg(join(base,p),frameTimeout); report.stream_attempts.push({path:p,...a}); if(a.ok&&a.frames>=1){selected={path:p,...a};break;}}
  report.stream=selected?{ok:true,selected_path:selected.path,frames:selected.frames,bytes:selected.bytes,distinct:selected.distinct,elapsed_ms:selected.elapsed_ms}:{ok:false,selected_path:null,error:report.stream_attempts.map(x=>`${x.path}:${x.error}`).join(' | ')};

  if(selected && selected.frames>=2 && selected.distinct!==false){report.conclusion={code:'GATEWAY_END_TO_END_SUCCESS',title:'Gateway 端到端診斷成功',detail:'已連線 Gateway、讀取狀態並取得至少兩張連續 JPEG 影格。'};}
  else if(selected){report.conclusion={code:'GATEWAY_JPEG_SINGLE_FRAME_ONLY',title:'已取得 JPEG，但尚未確認連續更新',detail:'可能是串流更新較慢、測試秒數不足，或輸出停在單一影格。'};}
  else if(!liveHtml){report.conclusion={code:'GATEWAY_LIVE_PAGE_UNAVAILABLE',title:'Gateway TCP 可連，但 live.html 無法讀取',detail:'請確認 Gateway Base URL 與 Port。'};}
  else {report.conclusion={code:'GATEWAY_STREAM_PATH_NOT_FOUND',title:'已找到 live.html，但未找到可用 MJPEG 路徑',detail:'請查看自動發現路徑與各串流測試結果。'};}
  report.elapsed_ms=Date.now()-started; lastReport=report; return report;
}

function layout(content){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${VERSION}</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#071116;color:#eef6fa;font-family:Arial,"Noto Sans TC",sans-serif}.wrap{max-width:1140px;margin:auto;padding:26px 18px 60px}.card{background:#101d23;border:1px solid #31454f;border-radius:13px;padding:16px;margin:12px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.full{grid-column:1/-1}label{display:block;color:#bcd0db;margin:0 0 5px}input,button{width:100%;padding:12px;border-radius:8px;border:1px solid #47606c;background:#071116;color:#fff;font-size:16px}button{background:#1977b6;border:0;font-weight:700}.ok{color:#35d07f}.bad{color:#ff6565}.warn{color:#ffc84d}.muted{color:#9fb2bc}.result{font-size:22px;font-weight:800}.code{font:13px Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#03090c;padding:12px;border-radius:8px;max-height:430px;overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 7px;border-bottom:1px solid #2c4049;vertical-align:top}@media(max-width:720px){.grid{grid-template-columns:1fr}.full{grid-column:auto}table{font-size:13px}}</style></head><body><main class="wrap">${content}</main></body></html>`;}
function home(){return layout(`<h1>RT7 Gateway Diagnostic Scanner V2</h1><div class="card"><b class="warn">請在 Native RTSP Gateway 同一台 Windows 電腦執行。</b><p>Scanner 預設使用 8090；Gateway 預設使用 8080。V2 會解析 live.html、自動發現 API／串流路徑，並驗證兩張連續 JPEG。</p></div><form class="card grid" method="post" action="/run"><div class="full"><label>Gateway Base URL</label><input name="gateway_url" value="${esc(process.env.RT7_GATEWAY_URL||'http://127.0.0.1:8080')}" required></div><div><label>一般逾時（ms）</label><input name="timeout_ms" type="number" value="5000"></div><div><label>影格逾時（ms）</label><input name="frame_timeout_ms" type="number" value="10000"></div><div class="full"><button>開始 Auto Discovery + MJPEG 診斷</button></div></form><div class="card"><b>快速檢查：</b> Gateway 影像頁應為 <code>http://127.0.0.1:8080/live.html</code>；Scanner 頁應為 <code>http://127.0.0.1:8090</code>。</div>`);}
function resultPage(r){const good=r.conclusion.code==='GATEWAY_END_TO_END_SUCCESS'; const apiRows=r.api_attempts.map(x=>`<tr><td>${esc(x.path)}</td><td class="${x.ok?'ok':'bad'}">${x.ok?'PASS':'FAIL'}</td><td>${x.status}</td><td>${x.elapsed_ms} ms</td><td>${esc(x.parsed?.version||x.content_type||x.preview||'')}</td></tr>`).join(''); const streamRows=r.stream_attempts.map(x=>`<tr><td>${esc(x.path)}</td><td class="${x.ok?'ok':'bad'}">${x.ok?'PASS':'FAIL'}</td><td>${esc(x.error||'')}</td><td>${x.frames||0}</td><td>${esc((x.bytes||[]).join(', '))}</td><td>${x.distinct===true?'YES':x.distinct===false?'NO':'-'}</td></tr>`).join(''); return layout(`<h1>RT7 Gateway Diagnostic Scanner V2</h1><div class="card"><div class="result ${good?'ok':'bad'}">${esc(r.conclusion.code)}</div><h2>${esc(r.conclusion.title)}</h2><p>${esc(r.conclusion.detail)}</p></div><div class="card"><table><tr><th>Gateway</th><td>${esc(r.input.gateway_url)}</td></tr><tr><th>TCP</th><td class="${r.gateway.tcp.status==='OPEN'?'ok':'bad'}">${esc(r.gateway.tcp.status)} — ${esc(r.gateway.tcp.detail)}</td></tr><tr><th>執行環境</th><td>${esc(r.environment.platform)} / Railway=${r.environment.railway} / self-loop=${r.environment.self_loop_detected}</td></tr><tr><th>Status Path</th><td>${esc(r.gateway.status_path||'未找到')}</td></tr><tr><th>State / CH</th><td>${esc(r.gateway.state??'-')} / ${esc(r.gateway.current_channel??'-')} → ${esc(r.gateway.target_channel??'-')}</td></tr><tr><th>FPS / Age / Clients</th><td>${esc(r.gateway.fps??'-')} / ${esc(r.gateway.frame_age_ms??'-')} ms / ${esc(r.gateway.clients??'-')}</td></tr><tr><th>Stream</th><td>${esc(r.stream?.selected_path||'未找到')}</td></tr><tr><th>總耗時</th><td>${r.elapsed_ms} ms</td></tr></table></div><div class="card"><h2>live.html 自動發現路徑</h2><div class="code">${esc((r.discovered_paths||[]).join('\n')||'未發現')}</div></div><div class="card"><h2>API 探測</h2><table><thead><tr><th>Path</th><th>結果</th><th>HTTP</th><th>耗時</th><th>資訊</th></tr></thead><tbody>${apiRows||'<tr><td colspan="5">未執行</td></tr>'}</tbody></table></div><div class="card"><h2>MJPEG 連續影格驗證</h2><table><thead><tr><th>Path</th><th>結果</th><th>錯誤</th><th>Frames</th><th>Bytes</th><th>不同影格</th></tr></thead><tbody>${streamRows||'<tr><td colspan="6">未執行</td></tr>'}</tbody></table></div><div class="grid"><form method="get" action="/"><button>返回重新掃描</button></form><form method="get" action="/api/last-report"><button>開啟 JSON 報告</button></form></div>`);}

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`); if(req.method==='GET'&&u.pathname==='/')return html(res,200,home()); if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,version:VERSION,node:process.version,platform:process.platform,port:PORT,time:new Date().toISOString()}); if(req.method==='GET'&&u.pathname==='/api/last-report')return json(res,lastReport?200:404,lastReport||{ok:false,error:'no_report'}); if(req.method==='POST'&&u.pathname==='/run'){let body='';req.setEncoding('utf8');for await(const c of req){body+=c;if(body.length>65536)throw new Error('request too large');}const p=new URLSearchParams(body);const r=await runScan({gateway_url:p.get('gateway_url'),timeout_ms:p.get('timeout_ms'),frame_timeout_ms:p.get('frame_timeout_ms')});return html(res,200,resultPage(r));} return json(res,404,{ok:false,error:'not_found'});}catch(e){return html(res,500,layout(`<h1 class="bad">Scanner Error</h1><div class="card code">${esc(e.stack||e)}</div>`));}});
server.listen(PORT,HOST,()=>{console.log('='.repeat(72));console.log(VERSION);console.log(`Scanner: http://127.0.0.1:${PORT}`);console.log('Gateway: http://127.0.0.1:8080/live.html');console.log('='.repeat(72));});
