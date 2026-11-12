// The admin "School data" upload screen, in a real browser, with real .xlsx / .csv files, as the admin. Nothing mocked.
const { start, checker } = require('./lib.cjs'); const fs = require('fs'); const path = require('path');
const S = process.env.E2E_DIR; const APP = 'http://localhost:3012'; const SHOTS = path.join(S, 'shots'); const FILES = path.join(S, 'files'); fs.mkdirSync(FILES, { recursive: true });
const ExcelJS = require(path.join(process.cwd(), 'node_modules', 'exceljs')); // run from the repository root
const pw = (n) => fs.readFileSync(path.join(S, 'pw-' + n + '.txt'), 'utf8').trim(); const check = checker();
(async () => {
  const mk = async (name, rows) => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Schools'); rows.forEach((r) => ws.addRow(r)); const p = path.join(FILES, name); await wb.xlsx.writeFile(p); return p; };
  const good = await mk('stem.xlsx', [['School Name', 'State', 'District', 'Pincode', 'UDISE Code'], ['STEM High School One', 'Andhra Pradesh', 'NTR', 520010, 5001], ['STEM High School One', 'Andhra Pradesh', 'NTR', 520010, 5001], ['STEM Girls School', 'Andhra Pradesh', 'Guntur', 522001, 5002], ['Bad Pin School', 'Andhra Pradesh', 'Guntur', '12AB45', 5003], ['', 'Andhra Pradesh', 'Guntur', 522001, 5004]]);
  const wrong = await mk('wrong.xlsx', [['Name', 'Town'], ['A', 'B']]);
  const empty = path.join(FILES, 'empty.csv'); fs.writeFileSync(empty, '');
  const big = path.join(FILES, 'big.csv'); fs.writeFileSync(big, 'School Name,District,Pincode\n' + 'A School,Guntur,522001\n'.repeat(250000)); // ~5.5 MB
  const d = await start(); await d.viewport(1280); const dialogs = []; d.hooks.push((x) => { if (x.method === 'Page.javascriptDialogOpening') { dialogs.push(x.params.message); d.send('Page.handleJavaScriptDialog', { accept: true }); return true; } return false; });
  const J = (e) => d.ev(`JSON.stringify(${e})`).then((x) => { try { return JSON.parse(x); } catch { return x; } });
  await d.go(APP + '/login', `document.readyState==='complete'`);
  check('admin signs in', (await d.ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'audit-admin@example.com',password:${JSON.stringify(pw('admin'))},remember:false})}).then(r=>r.status)`)) === 200);
  const choose = async (file) => { const doc = await d.send('DOM.getDocument'); const q = await d.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' }); await d.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] }); await d.sleep(500); };
  const shown = () => d.ev(`document.querySelector('main, body').innerText`);
  const page = async (w) => { await d.viewport(w); d.evs.length = 0; await d.go(APP + '/admin/upload', `!!document.querySelector('input[type=file]')`); await d.waitFor(`Object.keys(document.querySelector('form')).some(k=>k.startsWith('__reactProps'))`, 20000); await d.sleep(500); };

  await page(1280);
  const m = await J(`({h1:(document.querySelector('h1')||{}).textContent,over:document.documentElement.scrollWidth>innerWidth+1})`); check('1280px /admin/upload: heading and no sideways scroll', !!m.h1 && !m.over, m);
  check('type picker is a list of the six categories', (await d.ev(`document.querySelectorAll('select option').length`)) >= 6, await d.ev(`document.querySelector('select').innerText`));
  // wrong columns
  await d.ev(`(function(){var s=document.querySelector('select');var o=[].find.call(s.options,x=>/STEM/.test(x.text));var set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await choose(wrong); await d.click('form button[type=submit]'); await d.waitFor(`/Cannot upload|missing|School name/i.test(document.body.innerText)`, 15000);
  let t = await shown(); check('wrong columns (xlsx): a clear "missing" message and no preview', /missing|school name/i.test(t) && !/Preview:/.test(t), t.slice(0, 300));
  await choose(empty); t = await shown(); check('empty file: refused in the page before sending ("The file is empty")', /The file is empty/.test(t), t.slice(0, 300));
  await choose(big); t = await shown(); check('file over 4 MB: refused in the page before sending, with the limit stated', /more than the 4(\.0)? ?MB limit|4 MB/i.test(t), t.slice(0, 300));
  check('the upload button is disabled while the problem stands', (await d.ev(`document.querySelector('form button[type=submit]').disabled`)) === true);
  // the good one
  await choose(good); await d.click('form button[type=submit]'); await d.waitFor(`/Preview:/.test(document.body.innerText)`, 30000); t = await shown();
  check('valid .xlsx: preview shows 2 unique schools for STEM Labs and "2 rows rejected" (duplicate merged)', /2 unique schools/.test(t) && /STEM Labs/.test(t) && /2 rows rejected/.test(t), t.slice(0, 500));
  check('rejected rows are named with their row number and reason', /Row \d+: Pincode must be 6 digits/.test(t) && /Row \d+:.*school name/i.test(t), t.slice(0, 700));
  check('nothing is public yet (staged until confirmed): STEM Labs search is empty', (await (await fetch(APP + '/api/services/search?category=stem-labs')).json()).total === 0);
  await d.shot(SHOTS, 'admin-upload-1280-preview');
  const btn = await J(`(function(){var b=[].find.call(document.querySelectorAll('button'),x=>/Make live|Activate|Publish|Go live|Confirm/i.test(x.textContent));return b?b.textContent:null})()`); check('a confirm button is offered', !!btn, btn);
  await d.ev(`[].find.call(document.querySelectorAll('button'),x=>/Make live|Activate|Publish|Go live|Confirm/i.test(x.textContent)).click()`); await d.sleep(800);
  check('making it live asks the admin to confirm first (replaces the current live file)', dialogs.length === 1 && /replaced/.test(dialogs[0]), dialogs);
  await d.waitFor(`/Now live/.test(document.body.innerText)`, 20000); check('confirming makes it live ("Now live")', /Now live/.test(await shown()), (await shown()).slice(-300));
  const st = await (await fetch(APP + '/api/services/search?category=stem-labs&pageSize=50')).json(); check('the STEM Labs search now returns exactly the 2 valid unique schools', st.total === 2, st.total);
  check('ATL Labs data was not touched (still 8 schools)', (await (await fetch(APP + '/api/services/search?category=atl-labs&pageSize=50')).json()).total === 8);
  check('no console errors', d.errs().length === 0, d.errs());
  await page(390); const m2 = await J(`({h1:(document.querySelector('h1')||{}).textContent,over:document.documentElement.scrollWidth>innerWidth+1})`); check('390px /admin/upload: heading and no sideways scroll', !!m2.h1 && !m2.over, m2); await d.shot(SHOTS, 'admin-upload-390');
  for (const p of ['/admin/datasets', '/admin/upload-history', '/admin/reports']) { for (const w of [1280, 390]) { await d.viewport(w); d.evs.length = 0; await d.go(APP + p, `document.readyState==='complete'`); await d.sleep(800); const x = await J(`({h1:(document.querySelector('h1')||{}).textContent,over:document.documentElement.scrollWidth>innerWidth+1})`); check(`${w}px ${p}: heading, no sideways scroll, no console errors`, !!x.h1 && !x.over && d.errs().length === 0, { x, e: d.errs() }); } }
  const hist = await (async () => { await d.go(APP + '/admin/upload-history', `document.readyState==='complete'`); return shown(); })(); check('upload history lists this session’s uploads (success and rejected)', /stem\.xlsx/.test(hist) && /wrong\.xlsx/.test(hist), hist.slice(0, 300));
  d.close(); process.exit(check.done() ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
