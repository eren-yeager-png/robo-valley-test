// RoboValley Projects: wp-admin click-through (Edge headless over CDP, Node 22+, no dependencies). LOCAL TEST SITE ONLY.
// It publishes a project "RVP CLICK TEST" and a technology "RVP CLICK TECH"; remove them with cleanup-click-data.php (wp eval-file).
// Needs one image in the Media Library. Env: RVP_ADMIN_PW (required), RVP_ADMIN_USER, RVP_BASE, RVP_SHOTS.
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const BASE = process.env.RVP_BASE || 'http://localhost:8080'; const SHOTS = process.env.RVP_SHOTS || path.join(os.tmpdir(), 'rvp-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const PW = process.env.RVP_ADMIN_PW; if (!PW) { console.error('Set RVP_ADMIN_PW to the password of a local administrator.'); process.exit(2); }
const USER = process.env.RVP_ADMIN_USER || 'rvp_tmp_admin';
const port = 9800 + Math.floor(Math.random() * 90); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvp-click-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
(async () => {
	let t; for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = [];
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; } evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(200); } return false; };
	const go = async (url) => { await send('Page.navigate', { url }); await sleep(600); await waitFor('document.readyState==="complete"', 15000); await sleep(400); };
	const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const jsErrors = () => evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || '').slice(0, 200));
	await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

	// ---- login
	await go(BASE + '/wp-login.php');
	await ev(`document.getElementById('user_login').value=${JSON.stringify(USER)};document.getElementById('user_pass').value=${JSON.stringify(PW)};document.getElementById('wp-submit').click()`);
	check('login to wp-admin', await waitFor('location.pathname.indexOf("wp-admin")>-1', 15000));

	// ---- menu
	await go(BASE + '/wp-admin/edit.php?post_type=rv_project');
	const menu = await ev(`JSON.stringify([].map.call(document.querySelectorAll('#menu-posts-rv_project .wp-submenu li a'),function(a){return a.textContent.trim()}))`);
	console.log('  submenu:', menu);
	check('menu has All Projects, Add New, 3 taxonomies', ['All Projects', 'Add New', 'Technology Categories', 'Education Levels', 'Subjects'].every((x) => menu.includes(x)), menu);
	await shot('01-project-list');

	// ---- project editor
	await go(BASE + '/wp-admin/post-new.php?post_type=rv_project');
	const boxes = await ev(`JSON.stringify([].map.call(document.querySelectorAll('#poststuff .postbox h2.hndle, #poststuff .postbox .postbox-header h2'),function(h){return h.textContent.trim()}))`);
	console.log('  boxes:', boxes);
	check('editor has summary + members-only + featured image + 3 taxonomy boxes', ['Project summary', 'Project details', 'Project image', 'Technology Categories', 'Education Levels', 'Subjects'].every((x) => boxes.includes(x)), boxes);
	check('slug box removed', !boxes.includes('Slug'));
	check('no block editor / content editor shown', (await ev('!document.querySelector(".block-editor, #postdivrich")')) === true);
	await shot('02-project-editor-top');
	await ev('window.scrollTo(0,500)'); await sleep(300); await shot('03-project-editor-scrolled');
	// fill + publish through the UI
	await ev(`(function(){function s(i,v){var e=document.getElementById(i);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))}
		s('title','RVP CLICK TEST');s('rvp_short_desc','Click-test short description');document.getElementById('rvp_difficulty').value='intermediate';document.getElementById('rvp_featured').checked=true;s('rvp_order','3');
		s('rvp_overview','CLICKOVERVIEW');s('rvp_skills','Skill A\\nSkill B');s('rvp_components','Part A');s('rvp_outcome','CLICKOUTCOME');
		var tech=document.querySelector('#rv_technologychecklist input[type=checkbox]');tech.checked=true;
		var edu=document.querySelector('#rv_educationchecklist input[type=checkbox]');edu.checked=true;
		document.getElementById('publish').click()})()`);
	const saved = await waitFor('!!document.querySelector("#message.updated, .notice-success")', 20000);
	check('project published through the UI', saved);
	const persisted = await ev(`JSON.stringify({d:document.getElementById('rvp_difficulty').value,f:document.getElementById('rvp_featured').checked,o:document.getElementById('rvp_order').value,ov:document.getElementById('rvp_overview').value,sk:document.getElementById('rvp_skills').value,t:document.querySelector('#rv_technologychecklist input:checked')?1:0,e:document.querySelector('#rv_educationchecklist input:checked')?1:0})`);
	console.log('  reloaded values:', persisted);
	const p = JSON.parse(persisted);
	check('fields persisted after save', p.d === 'intermediate' && p.f === true && p.o === '3' && p.ov === 'CLICKOVERVIEW' && p.sk === 'Skill A\nSkill B' && p.t === 1 && p.e === 1);
	await shot('04-project-after-save');
	await go(BASE + '/wp-admin/edit.php?post_type=rv_project');
	const cols = await ev(`JSON.stringify([].map.call(document.querySelectorAll('thead th'),function(h){return h.textContent.trim()}))`);
	console.log('  list columns:', cols);
	check('list shows Difficulty / Featured / Order / taxonomy columns', ['Difficulty', 'Featured', 'Order', 'Technology Categories', 'Education Levels'].every((x) => cols.includes(x)), cols);
	check('list row shows Intermediate + Yes', (await ev(`/Intermediate/.test(document.querySelector('#the-list').textContent)&&/Yes/.test(document.querySelector('#the-list').textContent)`)) === true);
	await shot('05-project-list-with-row');

	// ---- technology terms: layout, Media Library picker, AJAX add + reset
	await go(BASE + '/wp-admin/edit-tags.php?taxonomy=rv_technology&post_type=rv_project');
	check('term screen: parent field hidden', (await ev(`getComputedStyle(document.querySelector('.term-parent-wrap')).display`)) === 'none');
	check('term screen: Order column present with seeded value', (await ev(`/Robotics/.test(document.querySelector('#the-list').textContent)&&!!document.querySelector('th.column-rvp_order')`)) === true);
	check('term screen: picker + order + show-empty fields present', (await ev(`!!document.querySelector('#addtag .rvp-image-picker')&&!!document.getElementById('rvp_order')&&!!document.getElementById('rvp_show_empty')`)) === true);
	await shot('06-technology-terms');
	await ev(`document.querySelector('#addtag .rvp-image-choose').click()`);
	check('Media Library modal opens', await waitFor('!!document.querySelector(".media-modal") && !!document.querySelector(".media-modal .attachment")', 15000));
	await sleep(500); await shot('07-media-modal');
	const picked = await ev(`(function(){var a=document.querySelector('.media-modal .attachment[aria-label*="RVP TEST IMAGE"], .media-modal .attachment');a.click();return !!a})()`);
	await sleep(400);
	await ev(`document.querySelector('.media-modal .media-button-select').click()`);
	await sleep(600);
	const afterPick = await ev(`JSON.stringify({id:document.querySelector('#addtag .rvp-image-id').value,img:!!document.querySelector('#addtag .rvp-image-preview img'),rm:!document.querySelector('#addtag .rvp-image-remove').hidden,modalGone:!document.querySelector('.media-modal:not([style*="display: none"])')})`);
	console.log('  after pick:', afterPick);
	const ap = JSON.parse(afterPick);
	check('picking an image fills id, preview and Remove button', picked && ap.id !== '' && ap.img && ap.rm);
	await ev(`(function(){function s(i,v){var e=document.getElementById(i);e.value=v}
		s('tag-name','RVP CLICK TECH');s('tag-description','Click test description');s('rvp_order','55');document.getElementById('rvp_show_empty').checked=true;
		document.getElementById('submit').click()})()`);
	check('term added via AJAX (appears in list)', await waitFor(`/RVP CLICK TECH/.test(document.querySelector('#the-list').textContent)`, 15000));
	await sleep(500);
	const afterAdd = await ev(`JSON.stringify({id:document.querySelector('#addtag .rvp-image-id').value,img:!!document.querySelector('#addtag .rvp-image-preview img'),rmHidden:document.querySelector('#addtag .rvp-image-remove').hidden,order:document.getElementById('rvp_order').value,empty:document.getElementById('rvp_show_empty').checked})`);
	console.log('  after AJAX add:', afterAdd);
	const aa = JSON.parse(afterAdd);
	check('AJAX reset clears picker (id, preview, Remove)', aa.id === '' && !aa.img && aa.rmHidden);
	check('AJAX reset clears order and checkbox', aa.order === '0' && aa.empty === false, aa);
	await shot('08-after-ajax-add');
	// open the new term's edit screen and check saved values
	const href = await ev(`(function(){var a=[].find.call(document.querySelectorAll('#the-list a.row-title'),function(x){return x.textContent==='RVP CLICK TECH'});return a?a.href:''})()`);
	await go(href);
	const edit = await ev(`JSON.stringify({id:document.querySelector('.rvp-image-id').value,img:!!document.querySelector('.rvp-image-preview img'),order:document.getElementById('rvp_order').value,empty:document.getElementById('rvp_show_empty').checked,desc:document.getElementById('description').value})`);
	console.log('  term edit screen:', edit);
	const ed = JSON.parse(edit);
	check('edit screen loads saved image, order, show-empty, description', ed.id !== '' && ed.img && ed.order === '55' && ed.empty === true && ed.desc === 'Click test description');
	await shot('09-term-edit');
	await ev(`document.querySelector('.rvp-image-remove').click()`); await sleep(200);
	await ev(`document.querySelector('.edit-tag-actions input[type=submit], #submit').click()`);
	await sleep(2500);
	const edit2 = await ev(`JSON.stringify({id:document.querySelector('.rvp-image-id').value,img:!!document.querySelector('.rvp-image-preview img')})`);
	check('Remove + Update clears the saved image', JSON.parse(edit2).id === '' && !JSON.parse(edit2).img, edit2);

	// ---- the other taxonomies must not show the picker
	await go(BASE + '/wp-admin/edit-tags.php?taxonomy=rv_subject&post_type=rv_project');
	check('Subjects screen: order field yes, image picker no', (await ev(`!!document.getElementById('rvp_order')&&!document.querySelector('.rvp-image-picker')`)) === true);
	await shot('10-subjects');

	const errs = jsErrors().filter((e) => !/favicon|Failed to load resource/i.test(e));
	check('no JavaScript errors on the plugin screens', errs.length === 0, errs);
	console.log(`\n${pass} passed, ${fail} failed`);
	ws.close(); edge.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); edge.kill(); process.exit(2); });
