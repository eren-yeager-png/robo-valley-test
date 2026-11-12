// Small Edge-over-CDP driver shared by the local browser audits (same approach as frontend/tests/find-a-service/*.js).
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
exports.start = async function (opts = {}) {
  const port = 9600 + Math.floor(Math.random() * 300); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-e2e-'));
  const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let t; for (let i = 0; i < 60 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); const d = { evs: [], reqs: [], hooks: [] };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; }
    if (x.method === 'Network.requestWillBeSent') d.reqs.push(x.params.request.method + ' ' + x.params.request.url);
    for (const h of d.hooks) if (h(x)) return; d.evs.push(x); });
  d.send = send; d.sleep = sleep;
  d.ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
  d.waitFor = async (e, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await d.ev(e) === true) return true; await sleep(120); } return false; };
  d.go = async (url, ready) => { await send('Page.navigate', { url }); await sleep(400); await d.waitFor('document.readyState==="complete"', 40000); if (ready) await d.waitFor(ready, 15000); await sleep(300); };
  d.errs = () => d.evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || 'error').slice(0, 160));
  d.viewport = (w, h = 900) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  d.type = async (sel, text) => { await d.ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`); if (text) await send('Input.insertText', { text }); await sleep(150); };
  d.key = async (k, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
  d.click = (sel) => d.ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'missing';e.scrollIntoView({block:'center'});e.click();return 'ok'})()`);
  d.shot = async (dir, name) => { fs.mkdirSync(dir, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  d.close = () => { try { ws.close(); } catch {} edge.kill(); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  return d;
};
exports.checker = () => { let pass = 0, fail = 0; const c = (n, ok, det) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && det !== undefined ? '  -> ' + JSON.stringify(det).slice(0, 400) : '')); }; c.done = () => { console.log(`\n${pass} passed, ${fail} failed`); return fail; }; return c; };
