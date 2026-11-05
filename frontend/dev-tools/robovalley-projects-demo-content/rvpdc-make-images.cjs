// RoboValley Projects demo content: draws the 20 placeholder thumbnails (Node 22+, Edge headless over CDP; no downloads).
// Usage:  node rvpdc-make-images.cjs <path to the demo plugin folder>
// Reads key / title / tech from includes/dataset.php, writes <plugin>/assets/images/<key>.png (960 x 600, the 16:10 card crop).
// Colours: cream #f5f4ef, mint #e3ede7, dark green #123f33, green #17694f. Font: the Bricolage Grotesque already self-hosted by the
// RoboValley Landing plugin (SIL OFL 1.1), embedded only while drawing; the PNGs contain no font files.
const fs = require('fs'); const path = require('path'); const os = require('os'); const { spawn } = require('child_process');
const plugin = path.resolve(process.argv[2] || '.');
const ds = fs.readFileSync(path.join(plugin, 'includes/dataset.php'), 'utf8');
const items = []; const re = /'key'\s*=>\s*'([^']+)',\s*'title'\s*=>\s*'((?:[^'\\]|\\.)*)',\s*'tech'\s*=>\s*'([^']+)'/g; let m;
while ((m = re.exec(ds))) items.push({ key: m[1], title: m[2].replace(/\\'/g, "'"), tech: m[3] });
if (items.length !== 20) { console.error('expected 20 projects, found', items.length); process.exit(1); }
const fontFile = path.resolve(plugin, '../robovalley-landing/assets/fonts/bricolage-grotesque-latin.woff2');
if (!fs.existsSync(fontFile)) { console.error('font not found', fontFile); process.exit(1); }
const fontUrl = 'file:///' + fontFile.replace(/\\/g, '/');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const C = { cream: '#f5f4ef', mint: '#e3ede7', dark: '#123f33', green: '#17694f' };
const LABEL = { robotics: 'Robotics', 'embedded-systems': 'Embedded Systems', stem: 'STEM', 'artificial-intelligence': 'Artificial Intelligence', iot: 'Internet of Things', '3d-printing': '3D Printing', automation: 'Automation', electronics: 'Electronics', 'drone-technology': 'Drone Technology', 'other-technologies': 'Other Technologies' };

// Simple geometric icons in a 200 x 200 box.
const S = `fill="none" stroke="${C.dark}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"`;
const icons = {
  robotics: `<rect x="40" y="58" width="120" height="92" rx="18" ${S}/><line x1="100" y1="58" x2="100" y2="34" ${S}/><circle cx="100" cy="26" r="9" fill="${C.green}"/><circle cx="72" cy="100" r="11" fill="${C.green}"/><circle cx="128" cy="100" r="11" fill="${C.green}"/><line x1="76" y1="130" x2="124" y2="130" ${S}/><rect x="22" y="88" width="12" height="32" rx="5" fill="${C.dark}"/><rect x="166" y="88" width="12" height="32" rx="5" fill="${C.dark}"/>`,
  'embedded-systems': `<rect x="55" y="55" width="90" height="90" rx="10" ${S}/><rect x="80" y="80" width="40" height="40" rx="5" fill="${C.green}"/>` + [75, 100, 125].map((p) => `<line x1="${p}" y1="55" x2="${p}" y2="30" ${S}/><line x1="${p}" y1="145" x2="${p}" y2="170" ${S}/><line x1="55" y1="${p}" x2="30" y2="${p}" ${S}/><line x1="145" y1="${p}" x2="170" y2="${p}" ${S}/>`).join(''),
  stem: [0, 60, 120].map((a) => `<ellipse cx="100" cy="100" rx="78" ry="30" transform="rotate(${a} 100 100)" ${S}/>`).join('') + `<circle cx="100" cy="100" r="14" fill="${C.green}"/>`,
  'artificial-intelligence': (() => { const L = [[40, 55], [40, 100], [40, 145]], M = [[100, 40], [100, 100], [100, 160]], R = [[160, 100]]; let o = ''; for (const a of L) for (const b of M) o += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.green}" stroke-width="3.5"/>`; for (const a of M) for (const b of R) o += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.green}" stroke-width="3.5"/>`; for (const n of L.concat(M, R)) o += `<circle cx="${n[0]}" cy="${n[1]}" r="12" fill="${C.cream}" stroke="${C.dark}" stroke-width="6"/>`; return o; })(),
  iot: [30, 60, 90].map((r) => { const a = (d) => [100 + r * Math.cos(d * Math.PI / 180), 150 + r * Math.sin(d * Math.PI / 180)]; const p = a(-135), q = a(-45); return `<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} A${r} ${r} 0 0 1 ${q[0].toFixed(1)} ${q[1].toFixed(1)}" ${S}/>`; }).join('') + `<circle cx="100" cy="150" r="10" fill="${C.green}"/>`,
  '3d-printing': `<polygon points="100,35 160,70 160,130 100,165 40,130 40,70" ${S}/><polygon points="100,35 160,70 100,100 40,70" fill="${C.green}" stroke="${C.dark}" stroke-width="7" stroke-linejoin="round"/><line x1="100" y1="100" x2="100" y2="165" ${S}/>`,
  automation: (() => { let t = ''; for (let i = 0; i < 8; i++) t += `<rect x="90" y="30" width="20" height="26" rx="4" fill="${C.dark}" transform="rotate(${i * 45} 100 100)"/>`; return t + `<circle cx="100" cy="100" r="50" ${S}/><circle cx="100" cy="100" r="18" fill="${C.green}"/>`; })(),
  electronics: `<path d="M20 100 H55 l10 -34 l20 68 l20 -68 l20 68 l10 -34 H180" ${S}/><circle cx="20" cy="100" r="8" fill="${C.green}"/><circle cx="180" cy="100" r="8" fill="${C.green}"/>`,
  'drone-technology': `<rect x="78" y="78" width="44" height="44" rx="9" fill="${C.green}"/>` + [[45, 45], [155, 45], [45, 155], [155, 155]].map((p) => `<line x1="100" y1="100" x2="${p[0]}" y2="${p[1]}" ${S}/><circle cx="${p[0]}" cy="${p[1]}" r="24" fill="${C.cream}" stroke="${C.dark}" stroke-width="7"/><circle cx="${p[0]}" cy="${p[1]}" r="5" fill="${C.dark}"/>`).join(''),
  'other-technologies': `<polygon points="100,28 163,64 163,136 100,172 37,136 37,64" ${S}/><line x1="100" y1="72" x2="100" y2="128" stroke="${C.green}" stroke-width="10" stroke-linecap="round"/><line x1="72" y1="100" x2="128" y2="100" stroke="${C.green}" stroke-width="10" stroke-linecap="round"/>`,
};

function wrap(title, max) { const words = title.split(' '); const lines = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) lines.push(cur); return lines; }
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(it, i) {
  const lines = wrap(it.title, 17); const size = lines.length > 3 ? 46 : 54; const lh = size * 1.12; const y0 = 600 - 70 - (lines.length - 1) * lh;
  // small decorative shapes that differ per project, so two projects of the same technology do not look identical
  const dx = (i * 53) % 90, dy = (i * 37) % 60;
  const deco = `<circle cx="${70 + dx}" cy="${70 + dy}" r="${14 + (i % 3) * 4}" fill="${C.mint}"/><rect x="${430 + dx}" y="${40 + dy}" width="34" height="34" rx="8" fill="${C.mint}" transform="rotate(${(i * 17) % 45} ${447 + dx} ${57 + dy})"/><circle cx="880" cy="${520 - dy}" r="${10 + (i % 4) * 3}" fill="${C.green}" opacity=".18"/>`;
  const pill = LABEL[it.tech] || '';
  const pw = pill.length * 12.2 + 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="${C.cream}"/>${deco}
<circle cx="740" cy="300" r="190" fill="${C.mint}"/><circle cx="740" cy="300" r="150" fill="none" stroke="${C.green}" stroke-opacity=".18" stroke-width="3"/>
<g transform="translate(600 160) scale(1.4)">${icons[it.tech] || icons['other-technologies']}</g>
<rect x="64" y="${y0 - size - 62}" width="${pw}" height="40" rx="20" fill="${C.dark}"/><text x="${64 + 18}" y="${y0 - size - 62 + 27}" font-family="Bricolage, sans-serif" font-weight="600" font-size="20" fill="${C.cream}">${esc(pill)}</text>
<text font-family="Bricolage, sans-serif" font-weight="700" font-size="${size}" fill="${C.dark}">${lines.map((l, k) => `<tspan x="64" y="${(y0 + k * lh).toFixed(1)}">${esc(l)}</tspan>`).join('')}</text></svg>`;
}

const outDir = path.join(plugin, 'assets/images'); fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rvpdc-')); const port = 9700 + Math.floor(Math.random() * 90);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${tmp}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let t; for (let i = 0; i < 80 && !t; i++) { await sleep(250); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(); ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]; const f = path.join(tmp, it.key + '.html');
    fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Bricolage;src:url("${fontUrl}") format("woff2");font-weight:200 800}html,body{margin:0;background:${C.cream};overflow:hidden}</style><body>${svg(it, i)}</body>`);
    await send('Page.navigate', { url: 'file:///' + f.split(path.sep).join('/') });
    for (let k = 0; k < 40; k++) { await sleep(150); const r = await send('Runtime.evaluate', { expression: 'document.readyState==="complete"&&document.fonts.status==="loaded"', returnByValue: true }); if (r.result && r.result.result && r.result.result.value === true) break; }
    await sleep(250);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 960, height: 600, scale: 1 } });
    const out = path.join(outDir, it.key + '.png'); fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    const size = fs.statSync(out).size; total += size; console.log((size < 80 * 1024 ? 'ok   ' : 'CHECK'), it.key, (size / 1024).toFixed(1) + ' KB');
  }
  console.log('total', (total / 1024).toFixed(0), 'KB'); ws.close(); edge.kill(); await sleep(500); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* the temp profile is removed by the OS later */ } process.exit(0);
})();
