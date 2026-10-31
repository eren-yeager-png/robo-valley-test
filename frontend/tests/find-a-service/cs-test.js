// Coming Soon change on the Find a Service page, tested in Microsoft Edge: no request interception, real OSM / Nominatim,
// real mouse hover, keyboard (Tab / Enter / Escape) and touch taps. Location is simulated with Edge's geolocation override.
// Usage: node cs-test.js  -> PASS/FAIL lines, screenshots in ./shots-cs
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const URL_ = 'http://localhost/wordpress/find-a-service/';
const SHOTS = path.join(__dirname, 'shots-cs'); fs.mkdirSync(SHOTS, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 90); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvfas-cs-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (n, ok, d) => { results.push([n, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
const SOON = { robotics: 'Robotics Labs', stem: 'STEM Labs', print3d: '3D Printing Facilities', training: 'Robotics Training Centres', innovation: 'Innovation Centres' };
(async () => {
	let t; for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = []; const writes = [];
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; }
		if (x.method === 'Network.requestWillBeSent') { const u = new URL(x.params.request.url); if (x.params.request.method !== 'GET' || /admin-ajax|wp-json|xmlrpc/.test(u.href)) writes.push(x.params.request.method + ' ' + u.href.slice(0, 100)); }
		evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(150); } return false; };
	const errs = () => evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || '').slice(0, 160));
	// scroll the target near the top (clear of the fixed cookie banner), measure, and never press anything that is covered
	const point = async (sel) => { await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});var y=e.getBoundingClientRect().top+window.scrollY-160;window.scrollTo({top:Math.max(0,y),behavior:'instant'})})()`); await sleep(350);
		return JSON.parse(await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});var r=e.getBoundingClientRect();var x=r.left+r.width/2,y=r.top+r.height/2;var hit=document.elementFromPoint(x,y);return JSON.stringify({x:x,y:y,ok:!!hit&&(e===hit||e.contains(hit)),hit:hit?hit.tagName+'.'+String(hit.className).slice(0,50):'none'})})()`)); };
	const click = async (sel) => { const p = await point(sel); if (!p.ok) { console.log(`  (not pressed: ${sel} covered by ${p.hit})`); return false; }
		for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(300); return true; };
	const tapTouch = async (sel) => { const p = await point(sel); if (!p.ok) { console.log(`  (not tapped: ${sel} covered by ${p.hit})`); return false; }
		await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(350); return true; };
	const hover = async (sel) => { const p = await point(sel); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(300); return p; };
	const unhover = async () => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 }); await sleep(300); };
	const key = async (k, code, vk, mods = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await sleep(300); };
	const tip = (cat) => `(function(){var t=document.getElementById('rv-fas-tip-${cat}');if(!t)return null;var s=getComputedStyle(t),r=t.getBoundingClientRect();return {text:t.textContent,shown:s.visibility==='visible'&&+s.opacity>0.95,inView:r.left>=0&&r.right<=document.documentElement.clientWidth&&r.top>=0,bg:s.backgroundColor,color:s.color}})()`;
	const shot = async (name, full) => { if (full) await ev('window.scrollTo({top:0,behavior:"instant"})'); await sleep(300); const { w, h } = JSON.parse(await ev('JSON.stringify({w:document.documentElement.clientWidth,h:document.documentElement.scrollHeight})'));
		const r = await send('Page.captureScreenshot', full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 9000), scale: 1 } } : { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const summary = `document.getElementById('rv-fas-summary').textContent`;
	const cards = `[].map.call(document.querySelectorAll('#rv-fas-list .rv-fas-card'),function(c){return c.querySelector('h3').textContent})`;
	const pins = `document.querySelectorAll('#rv-fas-map .rv-fas-pin').length`;
	// remove every selected service (chips re-render after each removal), then close the suggestion list that focus opens
	const clear = async () => { await ev(`(function(){var b,n=0;while((b=document.querySelector('#rv-fas-chips [data-remove]'))&&n++<10)b.click();var i=document.getElementById('rv-fas-service');i.value='';i.blur()})()`); await sleep(400); };
	await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
	console.log('browser: ' + (await send('Browser.getVersion')).result.product);
	await send('Browser.grantPermissions', { origin: 'http://localhost', permissions: ['geolocation'] });
	await send('Emulation.setGeolocationOverride', { latitude: 16.5062, longitude: 80.6480, accuracy: 30 });

	for (const [label, w, h] of [['desktop', 1280, 900], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
		const touch = w < 1024;
		await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
		await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
		evs.length = 0; await send('Page.navigate', { url: URL_ }); await waitFor(`document.readyState==='complete'`, 20000);
		await waitFor(`!!document.querySelector('#rv-fas-map .leaflet-tile-loaded') && ${pins}>0`, 20000); await sleep(500);
		const L = `${label} ${w}px:`;
		// data: only the five ATL facilities remain, with no Coming Soon category tags on their cards
		check(`${L} 5 demo facilities (ATL only) listed and 5 markers on the map`, (await ev(cards)).length === 5 && await ev(pins) === 5, await ev(cards));
		check(`${L} no card or popup shows a Coming Soon category tag`, await ev(`[].every.call(document.querySelectorAll('.rv-fas-tag'),function(t){return ['Robotics Labs','STEM Labs','3D Printing Facilities','Robotics Training Centres','Innovation Centres'].indexOf(t.textContent)<0})`));
		check(`${L} demo-data notice still visible`, await ev(`document.querySelector('.rv-fas-notice').getBoundingClientRect().height>0`));
		check(`${L} all six Popular chips still shown in the same order`, await ev(`[].map.call(document.querySelectorAll('#rv-fas-cats [data-cat]'),function(b){return b.textContent}).join('|')`) === 'ATL Labs|Robotics Labs|STEM Labs|3D Printing Facilities|Robotics Training Centres|Innovation Centres');
		check(`${L} ATL Labs chip has no tooltip`, await ev(`!document.querySelector('[data-cat="atl"]').hasAttribute('aria-describedby')&&!document.querySelector('[data-cat="atl"]').closest('.rv-fas-cat-wrap')`));
		check(`${L} tooltips hidden until used`, (await Promise.all(Object.keys(SOON).map(async (c) => (await ev(tip(c))).shown))).every((s) => !s));

		for (const [cat, name] of Object.entries(SOON)) {
			check(`${L} ${name}: tooltip text "Coming Soon!", linked for screen readers`, await ev(`(function(){var b=document.querySelector('[data-cat="${cat}"]');var t=document.getElementById(b.getAttribute('aria-describedby'));return !!t&&t.getAttribute('role')==='tooltip'&&t.textContent==='Coming Soon!'})()`));
			if (!touch) {
				await hover(`[data-cat="${cat}"]`); const tv = await ev(tip(cat));
				check(`${L} ${name}: hover shows the tooltip, fully on screen`, tv.shown && tv.inView, tv);
				if (cat === 'robotics') await shot(`${label}-${w}-tooltip-hover`);
				await unhover(); check(`${L} ${name}: tooltip hides when the pointer leaves`, !(await ev(tip(cat))).shown);
			}
			// keyboard: focus the chip before it, then Tab onto this chip
			await ev(`(function(){var all=[].slice.call(document.querySelectorAll('#rv-fas-cats [data-cat]'));var b=document.querySelector('[data-cat="${cat}"]');all[all.indexOf(b)-1].focus({preventScroll:true})})()`); await point(`[data-cat="${cat}"]`);
			await key('Tab', 'Tab', 9);
			const kf = await ev(`document.activeElement===document.querySelector('[data-cat="${cat}"]')`); const tk = await ev(tip(cat));
			check(`${L} ${name}: keyboard Tab focus shows the tooltip`, kf && tk.shown && tk.inView, tk);
			await key('Escape', 'Escape', 27); check(`${L} ${name}: Escape hides the tooltip`, !(await ev(tip(cat))).shown);
			await ev('document.activeElement.blur()'); await unhover();
			// select: click (desktop) or touch tap (tablet / phone)
			const pressed = touch ? await tapTouch(`[data-cat="${cat}"]`) : await click(`[data-cat="${cat}"]`);
			const st = await ev(`(function(){var s=document.getElementById('rv-fas-state');return {pressed:document.querySelector('[data-cat="${cat}"]').getAttribute('aria-pressed'),soon:!s.hidden&&s.classList.contains('rv-fas-state--soon'),text:s.textContent.slice(0,120),cards:document.querySelectorAll('#rv-fas-list .rv-fas-card').length,listHidden:document.getElementById('rv-fas-list').hidden}})()`);
			check(`${L} ${name}: ${touch ? 'tap' : 'click'} selects it and shows "Coming Soon!" with no demo results or markers`, pressed && st.pressed === 'true' && st.soon && /Coming Soon!/.test(st.text) && st.listHidden && await ev(pins) === 0 && /^Coming Soon!/.test(await ev(summary)), { st, summary: await ev(summary), pins: await ev(pins) });
			if (touch) { const tt = await ev(tip(cat)); check(`${L} ${name}: tap shows the tooltip`, tt.shown && tt.inView, tt); if (cat === 'robotics') await shot(`${label}-${w}-tooltip-tap`); }
			if (cat === 'stem') await shot(`${label}-${w}-coming-soon-results`, true);
			await clear();
		}

		if (touch) { // a tooltip still showing after a tap must not block the next tap on a nearby chip
			await tapTouch('[data-cat="innovation"]'); const ok = await tapTouch('[data-cat="robotics"]');
			check(`${L} a visible tooltip never blocks tapping another chip`, ok && await ev(`document.querySelector('[data-cat="robotics"]').getAttribute('aria-pressed')==='true'`));
			await clear();
		}
		// ATL still works: chip, real location search, map
		await click('[data-cat="atl"]'); await sleep(300);
		check(`${L} ATL Labs chip still filters: 5 ATL facilities, no tooltip`, (await ev(cards)).length === 5 && /for ATL Labs/.test(await ev(summary)) && await ev(`!document.querySelector('[data-cat="atl"]').closest('.rv-fas-cat-wrap')`), await ev(summary));
		await click('#rv-fas-geo');
		await waitFor(`/within 25 km of your location/.test(${summary})`, 15000);
		check(`${L} ATL Labs + "Use my location": nearest first within 25 km`, /ATL Labs within 25 km of your location, nearest first/.test(await ev(summary)) && (await ev(cards)).length >= 1, [await ev(summary), await ev(cards)]);
		// mixed: ATL + Robotics -> ATL results plus a Coming Soon note
		touch ? await tapTouch('[data-cat="robotics"]') : await click('[data-cat="robotics"]');
		check(`${L} ATL Labs + Robotics Labs: ATL results kept, summary notes Robotics Labs Coming Soon`, (await ev(cards)).length >= 1 && /for ATL Labs within .* Robotics Labs: Coming Soon!/.test(await ev(summary)), await ev(summary));
		await clear();
		// manual location still works (real Nominatim)
		await click('#rv-fas-place'); await ev(`document.getElementById('rv-fas-place').select()`); await send('Input.insertText', { text: 'Guntur' }); await click('#rv-fas-go');
		const g = await waitFor(`/of Guntur/.test(${summary})`, 20000);
		check(`${L} manual location "Guntur" (real Nominatim) still works`, g, await ev(summary));
		await shot(`${label}-${w}-atl-results`, true);
		// service search box: the five are listed as Coming Soon and cannot be chosen
		await click('#rv-fas-service'); await send('Input.insertText', { text: 'lab' }); await sleep(400);
		const opts = await ev(`[].map.call(document.querySelectorAll('#rv-fas-service-list .rv-fas-option'),function(o){return o.textContent+(o.hasAttribute('data-i')?' [choosable]':' [disabled]')})`);
		check(`${L} search box: "lab" lists ATL Labs choosable and the Coming Soon labs disabled`, opts.some((o) => /^ATL Labs.*\[choosable\]/.test(o)) && opts.some((o) => /^Robotics Labs.*Coming Soon!.*\[disabled\]/.test(o)) && opts.some((o) => /^STEM Labs.*Coming Soon!.*\[disabled\]/.test(o)), opts);
		if (label === 'desktop') await shot(`${label}-${w}-search-suggestions`);
		await key('ArrowDown', 'ArrowDown', 40); await key('ArrowDown', 'ArrowDown', 40);
		check(`${L} search box: arrow keys skip the disabled Coming Soon options`, /^ATL Labs/.test(await ev(`(document.querySelector('#rv-fas-service-list .is-active')||{}).textContent||''`)));
		await ev(`(function(){var i=document.getElementById('rv-fas-service');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
		await send('Input.insertText', { text: '3d printing' }); await sleep(300); await key('Enter', 'Enter', 13); await sleep(300); await ev('document.getElementById("rv-fas-service").blur()');
		await click('#rv-fas-go'); await sleep(1500);
		check(`${L} typing "3d printing" + Search shows Coming Soon, no demo results`, /^Coming Soon! 3D Printing Facilities/.test(await ev(summary)) && (await ev(cards)).length === 0, await ev(summary));
		await clear();
		check(`${L} no horizontal scrolling`, await ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`));
		check(`${L} no JavaScript errors`, errs().length === 0, errs());
	}
	check('no writes to WordPress (no POST, admin-ajax, REST or XML-RPC requests)', writes.length === 0, writes);
	console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
	ws.close(); edge.kill(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
	process.exit(0);
})().catch((e) => { console.log('ERROR ' + e.stack); edge.kill(); process.exit(1); });
