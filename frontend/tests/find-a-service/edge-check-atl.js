// Independent check of the Find a Service page in Microsoft Edge, unlike fas-test.js (Chrome): no request interception,
// no injected scripts, real OpenStreetMap / Nominatim / cdnjs traffic, real mouse clicks and typing. Throwaway profile.
// Usage: node edge-check.js  -> PASS/FAIL lines, screenshots in ./shots-edge-atl
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const URL_ = 'http://localhost/wordpress/find-a-service/';
const SHOTS = path.join(__dirname, 'shots-edge-atl'); fs.mkdirSync(SHOTS, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 100); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvfas-edge-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (n, ok, d) => { results.push([n, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
(async () => {
	let t; for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = []; const writes = []; const hosts = {};
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; }
		if (x.method === 'Network.requestWillBeSent') { const u = new URL(x.params.request.url); if (u.host !== 'localhost') hosts[u.host] = (hosts[u.host] || 0) + 1; if (x.params.request.method !== 'GET' || /admin-ajax|wp-json|xmlrpc/.test(u.href)) writes.push(x.params.request.method + ' ' + u.href.slice(0, 100)); }
		evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(150); } return false; };
	const errs = () => evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || '').slice(0, 160));
	// real pointer click / tap at the element's centre (scrolled into view first)
	// The site scrolls smoothly and the SureCookie banner is fixed at the bottom: scroll instantly, put the target near the top,
	// measure after it settles, and refuse to press anything that is covered (never touch the banner).
	const tap = async (sel) => { await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});var y=e.getBoundingClientRect().top+window.scrollY-140;window.scrollTo({top:Math.max(0,y),behavior:'instant'})})()`); await sleep(400);
		const p = JSON.parse(await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});var r=e.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;var hit=document.elementFromPoint(x,y);return JSON.stringify({x:x,y:y,ok:!!hit&&(e===hit||e.contains(hit)),hit:hit?hit.tagName+'.'+String(hit.className).slice(0,50):'none'})})()`));
		if (!p.ok) { console.log(`  (not pressed: ${sel} is covered by ${p.hit})`); return false; }
		for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(250); return true; };
	const typeInto = async (sel, text) => { await tap(sel); await ev(`document.querySelector(${JSON.stringify(sel)}).select()`); await send('Input.insertText', { text }); await sleep(250); };
	const shot = async (name) => { await ev('window.scrollTo(0,0)'); await sleep(300); const { w, h } = JSON.parse(await ev('JSON.stringify({w:document.documentElement.clientWidth,h:document.documentElement.scrollHeight})'));
		const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 9000), scale: 1 } }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const summary = `document.getElementById('rv-fas-summary').textContent`;
	const cards = `document.querySelectorAll('#rv-fas-list .rv-fas-card').length`;
	const dists = `[].map.call(document.querySelectorAll('#rv-fas-list .rv-fas-dist'),function(d){var s=d.textContent.replace('Distance: ','');return s.indexOf(' m')>0?parseFloat(s)/1000:parseFloat(s)})`;
	await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
	console.log('browser: ' + (await send('Browser.getVersion')).result.product);

	const views = [['desktop', 1280, 900], ['tablet', 820, 1180], ['mobile', 390, 844]];
	for (const [label, w, h] of views) {
		await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
		await send('Emulation.setTouchEmulationEnabled', { enabled: w < 800, maxTouchPoints: w < 800 ? 5 : 1 });
		evs.length = 0; await send('Page.navigate', { url: URL_ }); await waitFor(`document.readyState==='complete'`, 20000);
		const tiles = await waitFor(`!!document.querySelector('#rv-fas-map .leaflet-tile-loaded') && document.querySelectorAll('#rv-fas-map .rv-fas-pin').length===5`, 20000); await sleep(500);
		check(`${label} ${w}px: page, map tiles and 5 ATL demo markers load`, tiles && await ev(`document.querySelector('.rv-fas-title h1').textContent==='Find a Service Near You'`));
		check(`${label} ${w}px: demo-data notice visible`, await ev(`document.querySelector('.rv-fas-notice').getBoundingClientRect().height>0`));
		check(`${label} ${w}px: no horizontal scrolling`, await ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`), await ev(`[document.documentElement.scrollWidth,document.documentElement.clientWidth]`));
		check(`${label} ${w}px: fonts from the plugin, no Google Fonts`, await ev(`document.fonts.ready.then(function(){return document.fonts.check('700 20px "Bricolage Grotesque"')&&document.fonts.check('16px Mulish')&&!document.querySelector('link[href*="fonts.googleapis"]')})`));
		await shot(`${label}-${w}-1-initial`);

		// typed place + Search -> real Nominatim lookup
		await typeInto('#rv-fas-place', 'Vijayawada'); await tap('#rv-fas-go');
		const found = await waitFor(`/nearest first/.test(${summary}) && document.querySelectorAll('#rv-fas-list .rv-fas-dist').length>0`, 20000);
		const fail = found ? '' : await ev(`document.getElementById('rv-fas-loc-text').textContent+' | '+document.getElementById('rv-fas-alert').textContent`);
		check(`${label} ${w}px: typed "Vijayawada" + Search finds it through the real Nominatim service`, found, found ? await ev(summary) : fail);
		if (found) { const d = await ev(dists); check(`${label} ${w}px: results nearest first, all within 25 km`, d.length>0 && d.every((x, i) => x <= 25 && (i === 0 || d[i - 1] <= x)), d); }
		// category chip + radius 50 km (keyboard on the slider)
		await tap('#rv-fas-cats button[data-cat="atl"]');
		await tap('#rv-fas-radius'); await ev(`(function(){var r=document.getElementById('rv-fas-radius');r.value=50;r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(600);
		check(`${label} ${w}px: ATL Labs + 50 km updates list and map`, await ev(`document.getElementById('rv-fas-radius-out').textContent.indexOf('50')>=0 && ${cards}>0 && [].every.call(document.querySelectorAll('#rv-fas-list .rv-fas-card'),function(c){return /ATL Labs/.test(c.textContent)})`), await ev(summary));
		// select first card -> highlighted marker + popup
		await tap('#rv-fas-list .rv-fas-card [data-act="map"]'); await sleep(900);
		check(`${label} ${w}px: "View on map" highlights the facility and opens its popup`, await ev(`!!document.querySelector('.leaflet-popup-content') && !!document.querySelector('#rv-fas-list .rv-fas-card.is-selected')`), await ev(`(document.querySelector('.leaflet-popup-content')||{}).textContent`));
		await sleep(600); // let the pan animation finish
		const fit = await ev(`(function(){var p=document.querySelector('#rv-fas-map .leaflet-popup');var m=document.getElementById('rv-fas-map').getBoundingClientRect();if(!p)return null;var r=p.getBoundingClientRect();return {top:Math.round(r.top-m.top),bottom:Math.round(m.bottom-r.bottom),left:Math.round(r.left-m.left),right:Math.round(m.right-r.right),mapH:Math.round(m.height),popH:Math.round(r.height)}})()`);
		check(`${label} ${w}px: popup fully visible inside the map`, fit && fit.top >= 0 && fit.bottom >= 0 && fit.left >= 0 && fit.right >= 0, fit);
		await shot(`${label}-${w}-2-search-results`);
		check(`${label} ${w}px: no JavaScript errors`, errs().length === 0, errs());
	}
	check('no writes to WordPress (no POST, admin-ajax, REST or XML-RPC requests)', writes.length === 0, writes);
	console.log('external hosts contacted: ' + JSON.stringify(hosts));
	console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
	ws.close(); edge.kill(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
	process.exit(0);
})().catch((e) => { console.log('ERROR ' + e.stack); edge.kill(); process.exit(1); });
