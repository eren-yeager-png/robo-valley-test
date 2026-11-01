// Browser tests for the local Find a Service page (http://localhost/wordpress/find-a-service/). Read-only for WordPress:
// every non-GET request and admin-ajax / wp-json / wp-cron / xmlrpc is blocked. Nominatim answers are canned (deterministic)
// except one real lookup at the end. Location is simulated with Chrome's permission + geolocation overrides.
// Usage: node fas-test.js   -> PASS/FAIL lines, screenshots in ./shots
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const URL_ = 'http://localhost/wordpress/find-a-service/';
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvfas-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (n, ok, d) => { results.push([n, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
const CANNED = {
	guntur: [{ lat: '16.3067', lon: '80.4365', display_name: 'Guntur, Guntur district, Andhra Pradesh, 522001, India' }, { lat: '16.2430', lon: '80.6400', display_name: 'Tenali, Guntur district, Andhra Pradesh, 522201, India' }],
	'520010': [{ lat: '16.4996', lon: '80.6565', display_name: 'Benz Circle, Vijayawada, NTR, Andhra Pradesh, 520010, India' }],
	zzqx: [],
};
(async () => {
	let t; for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = []; const blocked = new Set(); const hosts = {}; const geoReqs = []; let realGeocoder = false;
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; }
		if (x.method === 'Fetch.requestPaused') { const { requestId, request } = x.params; const u = request.url; const h = new URL(u).host;
			if (request.method !== 'GET' && request.method !== 'OPTIONS' || /admin-ajax|wp-json|wp-cron|xmlrpc/.test(u)) { blocked.add(request.method + ' ' + u.replace(/\?.*$/, '').slice(0, 90)); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
			if (h === 'nominatim.openstreetmap.org') { geoReqs.push(u);
				if (!realGeocoder) { const q = new URL(u).searchParams.get('q').toLowerCase(); const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }];
					if (q === 'failtest') { send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: cors, body: Buffer.from('{}').toString('base64') }); return; }
					send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: cors, body: Buffer.from(JSON.stringify(CANNED[q] || [])).toString('base64') }); return; } }
			send('Fetch.continueRequest', { requestId }); return; }
		evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(100); } return false; };
	const errs = () => evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || '').slice(0, 160));
	const key = async (k, code, vk, text) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
	const enter = () => key('Enter', 'Enter', 13, '\r');
	const type = async (sel, text) => { await ev(`(function(){var e=document.querySelector('${sel}');e.focus();e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await send('Input.insertText', { text }); await sleep(150); };
	const click = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'missing';e.scrollIntoView({block:'center'});e.click();return 'ok'})()`);
	const shot = async (name, full) => { const m = await ev('JSON.stringify({w:document.documentElement.clientWidth,h:document.documentElement.scrollHeight})'); const { w, h } = JSON.parse(m);
		const r = await send('Page.captureScreenshot', full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 7000), scale: 1 } } : { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const S = {
		summary: `document.getElementById('rv-fas-summary').textContent`,
		loc: `document.getElementById('rv-fas-loc-text').textContent`,
		cards: `[].map.call(document.querySelectorAll('#rv-fas-list .rv-fas-card'),function(c){var d=c.querySelector('.rv-fas-dist');return {id:c.dataset.id,name:c.querySelector('h3').textContent,d:d?d.textContent.replace('Distance: ',''):null}})`,
		pins: `document.querySelectorAll('#rv-fas-map .rv-fas-pin').length`,
	};
	const kmOf = (s) => (s.endsWith(' m') ? parseFloat(s) / 1000 : parseFloat(s));
	const load = async (w, h, opts = {}) => {
		await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 800 });
		await send('Emulation.setTouchEmulationEnabled', { enabled: w < 800, maxTouchPoints: w < 800 ? 5 : 1 });
		evs.length = 0; await send('Page.navigate', { url: URL_ }); await waitFor(`document.readyState==='complete'`, 15000);
		await waitFor(`!!document.querySelector('#rv-fas-map .leaflet-tile-loaded') && document.querySelectorAll('#rv-fas-map .rv-fas-pin').length>0`, 15000); await sleep(400);
	};
	// Only localhost (WordPress writes blocked) and Nominatim (canned answers) are intercepted; OSM tiles and cdnjs load normally.
	const LOCAL = { urlPattern: 'http://localhost/*' }, NOMI = { urlPattern: 'https://nominatim.openstreetmap.org/*' };
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.method === 'Network.requestWillBeSent') { const h = new URL(x.params.request.url).host; if (!/localhost/.test(h)) hosts[h] = (hosts[h] || 0) + 1; } });
	await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Fetch.enable', { patterns: [LOCAL, NOMI] });
	// test-only probe (this browser only): counts geolocation requests; TIMEOUT_TEST makes the browser report a timeout
	await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var g=navigator.geolocation;if(!g)return;window.__geoCalls=0;var orig=g.getCurrentPosition.bind(g);g.getCurrentPosition=function(ok,err,o){window.__geoCalls++;if(window.name==='TIMEOUT_TEST'){setTimeout(function(){err({code:3,message:'Timeout'})},300);return}return orig(ok,err,o)};})();` });
	const origin = 'http://localhost';
	const VIJ = { latitude: 16.5062, longitude: 80.6480, accuracy: 30 };

	// ---------- 1. Page loads; nothing asks for location by itself ----------
	await send('Browser.resetPermissions');
	await load(1280, 900);
	check('page: H1 "Find a Service Near You" and the intro text are shown', await ev(`document.querySelector('.rv-fas-title h1').textContent==='Find a Service Near You' && /Discover nearby laboratories/.test(document.querySelector('.rv-fas-intro-text').textContent)`));
	check('page: demo-data notice is visible', await ev(`(function(){var n=document.querySelector('.rv-fas-notice');var r=n.getBoundingClientRect();return r.height>0&&getComputedStyle(n).visibility!=='hidden'&&/Demonstration data/.test(n.textContent)})()`));
	check('page: every card and popup is labelled demo (names start "Demo")', await ev(`[].every.call(document.querySelectorAll('.rv-fas-card'),function(c){return /^Demo /.test(c.querySelector('h3').textContent)&&/Demo data/.test(c.textContent)})`));
	check('page: before a location, all 14 demo facilities listed with a prompt to choose a location', await ev(`document.querySelectorAll('.rv-fas-card').length===14 && /Choose a location/.test(${S.summary})`), await ev(S.summary));
	check('map: Leaflet map with OpenStreetMap tiles and 14 markers', await ev(`!!document.querySelector('#rv-fas-map.leaflet-container') && document.querySelectorAll('#rv-fas-map .leaflet-tile-loaded').length>0 && ${S.pins}===14`), await ev(S.pins));
	check('map: OpenStreetMap attribution shown', await ev(`/OpenStreetMap/.test(document.querySelector('.leaflet-control-attribution').textContent)`));
	check('map: zoom in / out controls present', await ev(`!!document.querySelector('.leaflet-control-zoom-in')&&!!document.querySelector('.leaflet-control-zoom-out')`));
	check('fonts: RoboValley fonts (Bricolage Grotesque, Mulish) loaded from the plugin, no Google Fonts', await ev(`document.fonts.ready.then(function(){return document.fonts.check('700 20px "Bricolage Grotesque"')&&document.fonts.check('16px Mulish')&&!document.querySelector('link[href*="fonts.googleapis"]')})`));
	check('location: page load does NOT ask for location', await ev('window.__geoCalls===0'), await ev('window.__geoCalls'));
	check('location: default message "Allow location access to discover services near you."', (await ev(S.loc)) === 'Allow location access to discover services near you.');
	check('page: no JavaScript errors on load', errs().length === 0, errs());
	await shot('01-desktop-1280-initial', true);

	// ---------- 2. Scenario 1: user allows location ----------
	await send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
	await send('Emulation.setGeolocationOverride', VIJ);
	await click('#rv-fas-geo');
	await waitFor(`/Using your current location/.test(${S.loc})`);
	check('S1 allow: detected location shown in the interface', /Using your current location \(16\.5062, 80\.6480, accurate to about 30 m\)/.test(await ev(S.loc)), await ev(S.loc));
	let cards = await ev(S.cards);
	check('S1 allow: 4 demo facilities within 25 km of the location (default radius)', cards.length === 4 && /within 25 km of your location, nearest first/.test(await ev(S.summary)), [await ev(S.summary), cards.map((c) => c.name + ' ' + c.d)]);
	check('S8 sorted nearest first', cards.every((c, i) => i === 0 || kmOf(c.d) >= kmOf(cards[i - 1].d)), cards.map((c) => c.d));
	check('S1 allow: distances match a haversine check (Vijayawada 1.2 km, Mangalagiri 12 km, Amaravati 21 km)', cards.map((c) => c.d).join('|') === '1.2 km|2.3 km|12 km|21 km', cards.map((c) => c.d));
	check('map: 4 markers + search circle + starting point after location', await ev(`${S.pins}===4 && !!document.querySelector('#rv-fas-map path.leaflet-interactive, #rv-fas-map svg path') && !!document.querySelector('.rv-fas-origin')`));
	check('S1 allow: only one location request (user-initiated)', await ev('window.__geoCalls===1'));

	// ---------- 3. Scenario 7: radius slider ----------
	const setR = (v) => ev(`(function(){var r=document.getElementById('rv-fas-radius');r.value=${v};r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));return document.getElementById('rv-fas-radius-out').textContent})()`);
	check('S7 radius: label shows "Search radius: 50 km" and 9 results', (await setR(50)) === '50 km' && (await ev(S.cards)).length === 9, await ev(S.summary));
	check('S7 radius: 100 km -> 11 results; Ongole (128 km) and others excluded', (await setR(100)) === '100 km' && (await ev(S.cards)).length === 11 && !(await ev(S.cards)).some((c) => /Ongole|Hyderabad|Visakhapatnam/.test(c.name)));
	check('S7 radius: 1 km -> 0 results, nearest suggested', (await setR(1)) === '1 km' && (await ev(`!document.getElementById('rv-fas-state').hidden && /Nothing within 1 km/.test(document.getElementById('rv-fas-state').textContent)`)), await ev(`document.getElementById('rv-fas-state').textContent`));
	check('S7 radius: every result is within the radius at 25/50/100 km', await (async () => { for (const v of [25, 50, 100]) { await setR(v); if (!(await ev(S.cards)).every((c) => kmOf(c.d) <= v)) return false; } return true; })());
	await ev(`document.getElementById('rv-fas-radius').focus()`); await setR(25); await key('ArrowRight', 'ArrowRight', 39); await sleep(150);
	check('S7 radius: keyboard arrow changes it (25 -> 26 km) and updates the label', (await ev(`document.getElementById('rv-fas-radius-out').textContent`)) === '26 km');
	check('S7 radius: slider has min 1, max 100, default 25 in markup', await ev(`(function(){var r=document.getElementById('rv-fas-radius');return r.min==='1'&&r.max==='100'&&r.defaultValue==='25'})()`));
	await setR(25);

	// ---------- 4. Scenario 5: ATL Labs via suggestions ----------
	await type('#rv-fas-service', 'atl');
	check('S5 ATL: typing "atl" shows the "ATL Labs" suggestion', await ev(`!document.getElementById('rv-fas-service-list').hidden && /ATL Labs/.test(document.getElementById('rv-fas-service-list').textContent)`), await ev(`document.getElementById('rv-fas-service-list').textContent`));
	await key('ArrowDown', 'ArrowDown', 40); await enter(); await sleep(200);
	cards = await ev(S.cards);
	check('S5 ATL: keyboard-selected chip "ATL Labs"; 2 ATL facilities within 25 km, nearest first', (await ev(`document.getElementById('rv-fas-chips').textContent`)).includes('ATL Labs') && cards.length === 2 && cards[0].id === 'demo-01' && cards[1].id === 'demo-03', cards);
	check('S5 ATL: summary names the service', /for ATL Labs within 25 km/.test(await ev(S.summary)), await ev(S.summary));
	check('S5 ATL: the "ATL Labs" category button shows as pressed', await ev(`document.querySelector('[data-cat="atl"]').getAttribute('aria-pressed')==='true'`));
	await shot('02-desktop-1280-atl-25km', true);

	// ---------- 5. Scenario 6: another category, multiple categories ----------
	await click('[data-remove="atl"]'); await click('[data-cat="print3d"]'); await sleep(150);
	cards = await ev(S.cards);
	check('S6 other: "3D Printing Facilities" -> 2 within 25 km (Robotics Lab Vijayawada, Innovation Centre Mangalagiri)', cards.map((c) => c.id).join() === 'demo-02,demo-04', cards);
	await click('[data-cat="atl"]'); await sleep(150);
	check('S6 multiple: 3D Printing + ATL Labs together -> 4 within 25 km', (await ev(S.cards)).length === 4 && /3D Printing Facilities or ATL Labs/.test(await ev(S.summary)), await ev(S.summary));
	await type('#rv-fas-service', 'training'); await enter(); await sleep(200);
	check('S6 typed + Search: "training" + Search adds "Robotics Training Centres"', (await ev(`document.getElementById('rv-fas-chips').textContent`)).includes('Robotics Training Centres'));
	await type('#rv-fas-service', 'cad'); await sleep(100);
	check('S6 free text: "cad" suggests a search across services', /Search for “cad”/.test(await ev(`document.getElementById('rv-fas-service-list').textContent`)));
	await ev(`document.getElementById('rv-fas-service').value=''`);
	await ev(`(function(){document.querySelectorAll('[data-remove]').forEach(function(){});})()`);
	while (await ev(`!!document.querySelector('[data-remove]')`)) { await click('[data-remove]'); await sleep(50); }

	// ---------- 6. Scenario 9: no matching providers ----------
	await type('#rv-fas-service', 'quantum');
	check('S9 no match: suggestion list explains "No service matches “quantum”"', /No service matches “quantum”/.test(await ev(`document.getElementById('rv-fas-service-list').textContent`)));
	await enter(); await sleep(200);
	check('S9 no match: empty state "No matching services" with category shortcuts', await ev(`!document.getElementById('rv-fas-state').hidden && /No matching services/.test(document.getElementById('rv-fas-state').textContent) && document.querySelectorAll('#rv-fas-state [data-only]').length===6`));
	check('S9 no match: map has no facility markers', (await ev(S.pins)) === 0);
	await shot('03-desktop-1280-no-match', false);
	await click('[data-clear]'); await sleep(100);
	await click('[data-cat="innovation"]'); await setR(5); await sleep(100);
	check('S9 none in radius: "Nothing within 5 km" names the nearest (Mangalagiri, 12 km) and offers 12 km', await ev(`/Nothing within 5 km/.test(document.getElementById('rv-fas-state').textContent) && /Mangalagiri, 12 km away/.test(document.getElementById('rv-fas-state').textContent) && !!document.querySelector('[data-radius="12"]')`), await ev(`document.getElementById('rv-fas-state').textContent`));
	await shot('04-desktop-1280-none-in-radius', false);
	await click('[data-radius="12"]'); await sleep(200);
	check('S9 none in radius: "Search within 12 km" button widens the radius and finds it', (await ev(`document.getElementById('rv-fas-radius-out').textContent`)) === '12 km' && (await ev(S.cards)).length === 1);
	await click('[data-remove="innovation"]'); await setR(50); await sleep(200);

	// ---------- 7. Scenarios 10 + 11: card <-> marker ----------
	await click('#rv-fas-list .rv-fas-card:nth-child(3) [data-act="map"]'); await sleep(700);
	const third = (await ev(S.cards))[2];
	check('S10 select: card 3 highlighted', await ev(`document.querySelector('#rv-fas-list .rv-fas-card:nth-child(3)').classList.contains('is-selected') && document.querySelectorAll('.rv-fas-card.is-selected').length===1`));
	check('S10 select: exactly one marker highlighted (amber)', await ev(`document.querySelectorAll('.rv-fas-pin.is-active').length===1 && document.querySelector('.rv-fas-pin.is-active').textContent==='3'`));
	check('S10 select: popup opens with that facility', await ev(`!!document.querySelector('.leaflet-popup') && document.querySelector('.leaflet-popup h4').textContent===${JSON.stringify(third.name)}`), await ev(`document.querySelector('.leaflet-popup h4')&&document.querySelector('.leaflet-popup h4').textContent`));
	await shot('05-desktop-1280-selected', false);
	await ev(`(function(){var p=[].filter.call(document.querySelectorAll('.rv-fas-pin'),function(x){return x.textContent==='5'})[0];p.parentElement.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`); await sleep(600);
	const fifth = (await ev(S.cards))[4];
	check('S10 marker -> card: clicking marker 5 highlights card 5 and opens its popup', await ev(`document.querySelector('#rv-fas-list .rv-fas-card:nth-child(5)').classList.contains('is-selected') && document.querySelector('.leaflet-popup h4').textContent===${JSON.stringify(fifth.name)}`));
	const data = JSON.parse(await ev(`document.getElementById('rv-fas-data').textContent`));
	const popupOk = await (async () => { const bad = []; const n = await ev(S.pins); for (let i = 1; i <= n; i++) {
		await ev(`(function(){var p=[].filter.call(document.querySelectorAll('.rv-fas-pin'),function(x){return x.textContent==='${i}'})[0];p.parentElement.dispatchEvent(new MouseEvent('click',{bubbles:true}));})()`); await sleep(250);
		const pop = await ev(`(function(){var p=document.querySelector('.leaflet-popup');return p?{name:p.querySelector('h4').textContent,text:p.textContent,dir:p.querySelector('a').href}:null})()`); const c = (await ev(S.cards))[i - 1]; const f = data.facilities.find((x) => x.id === c.id);
		if (!pop || pop.name !== f.name || !pop.text.includes(f.address) || !pop.text.includes(c.d) || !pop.dir.includes(`destination=${f.lat},${f.lng}`)) bad.push(i); } return bad; })();
	check('S11 popups: every marker popup shows the right name, address, distance and directions coordinates', popupOk.length === 0, popupOk);
	const cardInfo = await ev(`(function(){var c=document.querySelector('#rv-fas-list .rv-fas-card');return {addr:c.querySelector('dd').textContent,phone:c.textContent.indexOf('+91 XXXXX XXXXX (demo)')>-1,tel:!!c.querySelector('a[href^="tel:"]'),dir:c.querySelector('.rv-fas-actions a').href,dirTarget:c.querySelector('.rv-fas-actions a').target,site:(c.querySelector('a[href*="example.org"]')||{}).href||'none'}})()`);
	check('cards: address, services, demo phone (no call link), Google Maps directions in new tab, example.org website', cardInfo.phone && !cardInfo.tel && /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=16\.4996,80\.6565&origin=16\.50620,80\.64800$/.test(cardInfo.dir) && cardInfo.dirTarget === '_blank', cardInfo);
	check('cards: facilities without a website say "No website listed"', await ev(`[].some.call(document.querySelectorAll('.rv-fas-card'),function(c){return /No website listed/.test(c.textContent)})`));

	// ---------- 8. Scenario 4: manual location (canned Nominatim answers) ----------
	await load(1280, 900);
	const before = geoReqs.length;
	await type('#rv-fas-place', 'Guntur');
	check('S4 manual: typing does not call the geocoder (only Search does)', geoReqs.length === before);
	await click('#rv-fas-go'); await waitFor(`/Showing services near Guntur/.test(${S.loc})`);
	check('S4 manual: Search calls Nominatim once, restricted to India', geoReqs.length === before + 1 && /countrycodes=in/.test(geoReqs[geoReqs.length - 1]) && /q=Guntur/.test(geoReqs[geoReqs.length - 1]), geoReqs.slice(before));
	cards = await ev(S.cards);
	check('S4 manual: results now measured from Guntur, nearest first (Guntur facilities first)', /Guntur/.test(cards[0].name) && cards.every((c, i) => i === 0 || kmOf(c.d) >= kmOf(cards[i - 1].d)) && /of Guntur, Guntur district, Andhra Pradesh/.test(await ev(S.summary)), cards.map((c) => c.name + ' ' + c.d));
	check('S4 manual: other matches offered to choose from', await ev(`!document.getElementById('rv-fas-places').hidden && /Tenali/.test(document.getElementById('rv-fas-places').textContent)`));
	check('S4 manual: no location permission was requested', await ev('window.__geoCalls===0'));
	await shot('06-desktop-1280-manual-guntur', true);
	await click('[data-place="0"]'); await sleep(300);
	check('S4 manual: choosing "Tenali" moves the starting point (3D Printing Tenali nearest)', /Tenali/.test((await ev(S.cards))[0].name) && /near Tenali/.test(await ev(S.loc)));
	await type('#rv-fas-place', '520010'); await enter(); await waitFor(`/near Benz Circle/.test(${S.loc})`);
	check('S4 manual: a PIN code works (520010 -> Benz Circle, ATL Lab Vijayawada at 0 m)', (await ev(S.cards))[0].d === '0 m', (await ev(S.cards))[0]);
	await type('#rv-fas-place', 'zzqx'); await enter(); await sleep(1500);
	check('S4 manual: unknown place explains what to try', /couldn’t find “zzqx”/.test(await ev(S.loc)), await ev(S.loc));
	await type('#rv-fas-place', 'failtest'); await enter(); await sleep(1500);
	check('error state: geocoder failure shows an alert; results stay usable', await ev(`!document.getElementById('rv-fas-alert').hidden && /couldn’t look up “failtest”/.test(document.getElementById('rv-fas-alert').textContent) && document.querySelectorAll('.rv-fas-card').length>0`), await ev(`document.getElementById('rv-fas-alert').textContent`));
	await shot('07-desktop-1280-geocoder-error', false);
	const t0 = geoReqs.length; await type('#rv-fas-place', 'Guntur'); await enter(); await sleep(300);
	check('geocoder: repeated place is answered from memory (no new request)', geoReqs.length === t0);

	// ---------- 9. Loading state ----------
	await type('#rv-fas-place', 'slowplace');
	await ev(`(function(){var f=window.fetch;window.fetch=function(u,o){return new Promise(function(r){setTimeout(function(){r(f(u,o))},1500)})}})()`);
	await enter(); await sleep(400);
	check('loading state: skeleton cards + "Looking up…" while the lookup runs', await ev(`document.getElementById('rv-fas-state').classList.contains('rv-fas-state--loading') && document.querySelectorAll('.rv-fas-skel').length===3 && document.getElementById('rv-fas-list').getAttribute('aria-busy')==='true'`));
	await shot('08-desktop-1280-loading', false);
	await sleep(2500);

	// ---------- 10. Scenario 2: user denies location ----------
	await send('Browser.setPermission', { origin, permission: { name: 'geolocation' }, setting: 'denied' });
	await load(1280, 900);
	check('S2 deny: blocked permission is explained on load without prompting', /Location access is currently unavailable\. Please enable location permission or enter your location manually\./.test(await ev(S.loc)) && (await ev('window.__geoCalls')) === 0, await ev(S.loc));
	await click('#rv-fas-geo'); await sleep(800);
	check('S2 deny: after clicking, message + "Permission was denied." + Try again button', /currently unavailable.*Permission was denied\./.test(await ev(S.loc)) && await ev(`!document.getElementById('rv-fas-geo-retry').hidden`), await ev(S.loc));
	check('S2 deny: results still listed (manual entry possible)', (await ev(`document.querySelectorAll('.rv-fas-card').length`)) === 14);
	await click('#rv-fas-go'); await sleep(300);
	check('S2 deny: pressing Search does not ask again', (await ev('window.__geoCalls')) === 1);
	await shot('09-desktop-1280-denied', false);
	await type('#rv-fas-place', 'Guntur'); await enter(); await waitFor(`/near Guntur/.test(${S.loc})`);
	check('S2 deny: manual location works after a denial', /Guntur/.test((await ev(S.cards))[0].name));

	// ---------- 11. Scenario 3: location unavailable; timeout; retry ----------
	await send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
	await send('Emulation.setGeolocationOverride', {}); // position unavailable
	await load(1280, 900);
	await click('#rv-fas-geo'); await waitFor(`/currently unavailable/.test(${S.loc})`);
	check('S3 unavailable: "Location access is currently unavailable…" + device reason + Try again', /currently unavailable.*could not find its position/.test(await ev(S.loc)) && await ev(`!document.getElementById('rv-fas-geo-retry').hidden`), await ev(S.loc));
	await send('Emulation.setGeolocationOverride', VIJ);
	await click('#rv-fas-geo-retry'); await waitFor(`/Using your current location/.test(${S.loc})`);
	check('S3 retry: Try again succeeds once location is available', /Using your current location/.test(await ev(S.loc)) && (await ev(S.cards)).length === 4);
	await ev(`window.name='TIMEOUT_TEST'`); await load(1280, 900);
	await click('#rv-fas-geo'); await sleep(800);
	check('S3 timeout: "The request timed out." explained with Try again', /currently unavailable.*timed out/.test(await ev(S.loc)) && await ev(`!document.getElementById('rv-fas-geo-retry').hidden`), await ev(S.loc));
	await ev(`window.name=''`);
	await send('Browser.resetPermissions'); await send('Emulation.setGeolocationOverride', VIJ);
	await load(1280, 900);
	await click('#rv-fas-go'); await sleep(800);
	check('location: Search with no location requests location once (user action)', (await ev('window.__geoCalls')) === 1);

	// ---------- 12. Scenario 12 + layout at every width ----------
	await send('Browser.grantPermissions', { origin, permissions: ['geolocation'] });
	for (const [w, h, label] of [[360, 740, 'phone-360'], [390, 844, 'phone-390'], [430, 932, 'phone-430'], [768, 1024, 'tablet-768'], [820, 1180, 'tablet-820'], [1024, 768, 'tablet-1024'], [1280, 900, 'desktop-1280'], [1440, 900, 'desktop-1440'], [1920, 1080, 'desktop-1920']]) {
		await load(w, h); await click('#rv-fas-geo'); await waitFor(`document.querySelectorAll('.rv-fas-card').length===4`); await sleep(500);
		const L = await ev(`(function(){var vw=document.documentElement.clientWidth,R=function(s){var r=document.querySelector(s).getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top+scrollY),r:Math.round(r.right),b:Math.round(r.bottom+scrollY),w:Math.round(r.width),h:Math.round(r.height)}};
			var small=[].filter.call(document.querySelectorAll('.rv-fas button:not([hidden]), .rv-fas a.rv-fas-btn, .rv-fas input'),function(e){var r=e.getBoundingClientRect();return r.width>0&&(r.height<24||r.width<24)}).map(function(e){return e.id||e.className});
			var out=[].filter.call(document.querySelectorAll('.rv-fas *'),function(e){var r=e.getBoundingClientRect();return r.width>0&&(r.right>vw+1||r.left<-1)&&!e.closest('.leaflet-container')}).slice(0,4).map(function(e){return e.className||e.tagName});
			return {vw:vw,hscroll:document.documentElement.scrollWidth-vw,map:R('#rv-fas-map'),list:R('#rv-fas-list'),panel:R('#rv-fas-form'),go:R('#rv-fas-go'),small:small,out:out}})()`);
		const sideBySide = L.map.l >= L.list.r - 1 && Math.abs(L.map.t - L.list.t) < 60;
		const stacked = L.map.b <= L.list.t + 1;
		check(`${label}: no horizontal scroll, nothing off-screen`, L.hscroll <= 0 && L.out.length === 0, { hscroll: L.hscroll, out: L.out });
		check(`${label}: ${w > 1024 ? 'results left, map right (two columns)' : 'map above results (stacked)'}`, w > 1024 ? sideBySide : stacked, { map: L.map, list: L.list });
		check(`${label}: controls are touch-sized (>=24px) and the map is usable (>=300px tall)`, L.small.length === 0 && L.map.h >= 300, { small: L.small, mapH: L.map.h });
		if (w <= 640) check(`${label}: Search button full width on phones`, L.go.w >= L.panel.w - 40, { go: L.go.w, panel: L.panel.w });
		if (['phone-390', 'tablet-820', 'desktop-1280'].includes(label)) await shot(`10-${label}-results`, true);
	}
	// phone: View on map brings the map into view; touch drag on the slider
	await load(390, 844); await click('#rv-fas-geo'); await waitFor(`document.querySelectorAll('.rv-fas-card').length===4`); await sleep(400);
	await click('#rv-fas-list .rv-fas-card:nth-child(4) [data-act="map"]'); await sleep(1200);
	check('S12 phone: "View on map" scrolls the map into view and highlights marker 4', await ev(`(function(){var r=document.getElementById('rv-fas-map').getBoundingClientRect();return r.top>=-5&&r.bottom<=innerHeight+5&&document.querySelector('.rv-fas-pin.is-active').textContent==='4'})()`));
	await shot('11-phone-390-view-on-map', false);
	await ev(`document.getElementById('rv-fas-radius').scrollIntoView({block:'center'})`); await sleep(300);
	const rr = JSON.parse(await ev(`JSON.stringify(document.getElementById('rv-fas-radius').getBoundingClientRect())`));
	const y = rr.top + rr.height / 2, x0 = rr.left + 14 + (rr.width - 28) * (24 / 99), x1 = rr.left + 14 + (rr.width - 28) * (59 / 99);
	await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
	for (let i = 1; i <= 8; i++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y }] });
	await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
	const after = await ev(`document.getElementById('rv-fas-radius-out').textContent`);
	check('S12 phone: dragging the radius slider by touch changes it (~60 km) and updates results', parseInt(after, 10) >= 50 && parseInt(after, 10) <= 70 && (await ev(S.cards)).length === 11 - ((parseInt(after, 10) < 63.2) ? 1 : 0) - ((parseInt(after, 10) < 52.8) ? 1 : 0), [after, (await ev(S.cards)).length]);
	await ev(`scrollTo(0,0)`); await sleep(200); await shot('12-phone-390-top', false);

	// ---------- 13. One real Nominatim lookup ----------
	realGeocoder = true; await send('Fetch.enable', { patterns: [LOCAL] }); await load(1280, 900);
	await type('#rv-fas-place', 'Vijayawada'); await enter(); await waitFor(`/Showing services near|couldn’t/.test(${S.loc})`, 15000);
	check('real Nominatim: "Vijayawada" resolves and results are measured from it', /Showing services near Vijayawada/.test(await ev(S.loc)) && (await ev(S.cards)).length >= 3, [await ev(S.loc), await ev(S.summary)]);

	check('no JavaScript errors in the last run', errs().length === 0, errs());
	console.log('\nExternal hosts contacted:', JSON.stringify(hosts));
	console.log('Blocked (never reached WordPress):', [...blocked].length ? [...blocked].join(' | ') : 'none');
	const f = results.filter((r) => !r[1]); console.log(`\nRESULT: ${results.length - f.length}/${results.length} passed` + (f.length ? '\nFAILED: ' + f.map((r) => r[0]).join(' | ') : ''));
	ws.close(); chrome.kill(); process.exit(0);
})().catch((e) => { console.log('HARNESS ERROR', e); chrome.kill(); process.exit(1); });
