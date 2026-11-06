// RoboValley Projects: real-browser test of the Projects page (Edge headless over CDP, Node 22+, no dependencies). LOCAL ONLY.
// Needs: WordPress with the plugin, the Projects page, DEMO and stage2 test data; the app running; a test member.
// Env: WP, APP, E2E_EMAIL, E2E_PASSWORD, MARKERS (rvp-markers.json), SHOTS (output folder), PAGE_PATH (default /projects/)
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const WP = (process.env.WP || 'http://localhost:8080').replace(/\/$/, ''); const APP = (process.env.APP || 'http://localhost:3010').replace(/\/$/, '');
const PAGE = WP + (process.env.PAGE_PATH || '/projects/'); const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'rvprojects-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const data = JSON.parse(fs.readFileSync(process.env.MARKERS, 'utf8')); const M = Object.values(data.markers).concat(['zebra']);
const port = 9600 + Math.floor(Math.random() * 90); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvprojects-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 260) : '')); };
(async () => {
	let t; for (let i = 0; i < 60 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = []; let reqs = []; let paused = null;
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', async (m) => { const x = JSON.parse(m.data);
		if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; }
		if (x.method === 'Network.requestWillBeSent') reqs.push({ m: x.params.request.method, u: x.params.request.url, body: x.params.request.postData });
		if (x.method === 'Fetch.requestPaused') { const rule = paused && paused.find((r) => r.re.test(x.params.request.url) && x.params.request.method !== 'OPTIONS'); const p = x.params;
			if (rule && rule.fail) await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' });
			else if (rule) await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: rule.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: WP }, { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(rule.body || {})).toString('base64') });
			else await send('Fetch.continueRequest', { requestId: p.requestId }); return; }
		evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(120); } return false; };
	const go = async (url) => { await send('Page.navigate', { url }); await sleep(500); await waitFor('document.readyState==="complete"', 20000); await sleep(300); };
	const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const key = async (k, code, vk, mods = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await sleep(150); };
	const jsErrs = () => evs.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')).map((e) => (e.params.exceptionDetails?.exception?.description?.split('\n')[0] || e.params.args?.map((a) => a.value || a.description).join(' ') || '').slice(0, 160)).filter((s) => !/Failed to load resource|ERR_FAILED|net::/i.test(s));
	const viewport = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
	const cards = () => ev('document.querySelectorAll("#rvp-grid .rvp-card").length');
	const titles = () => ev('JSON.stringify([].map.call(document.querySelectorAll("#rvp-grid .rvp-card-title"),function(n){return n.textContent}))').then(JSON.parse);
	const click = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
	const settle = async () => { await sleep(350); await waitFor('!document.getElementById("rvp-grid").hasAttribute("aria-busy")', 8000); await sleep(150); };
	const modalInfo = () => ev(`(function(){var d=document.querySelector('.rvp-modal[role=dialog]');if(!d)return null;var h=document.getElementById(d.getAttribute('aria-labelledby'));var r=d.getBoundingClientRect();return {modal:d.getAttribute('aria-modal'),title:h&&h.textContent,w:Math.round(r.width),h:Math.round(r.height),vw:innerWidth,vh:innerHeight,active:document.activeElement&&document.activeElement.className+'|'+document.activeElement.textContent.slice(0,20),inside:d.contains(document.activeElement),locked:document.body.classList.contains('rvp-scroll-locked'),inert:document.getElementById('rvp-root').inert,text:d.innerText}})()`);
	const settleModal = async () => { await sleep(250); await waitFor("!(document.querySelector('.rvp-modal')&&document.querySelector('.rvp-modal').hasAttribute('aria-busy'))", 40000); await sleep(250); };
	const waitReq = async (fn, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end) { if (reqs.some(fn)) return true; await sleep(150); } return false; };
	await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
	const hasHScroll = () => ev('document.documentElement.scrollWidth>document.documentElement.clientWidth+1');

	// ============ VISITOR, 1280 ============
	await viewport(1280, 900); await send('Network.clearBrowserCookies');
	await go(PAGE);
	check('Projects page loads (HTTP 200, title)', (await ev('document.title')).startsWith('Projects'), await ev('document.title'));
	check('hero: eyebrow, headline and paragraph are the exact copy', (await ev('document.querySelector(".rvp-eyebrow").textContent')) === 'Explore Projects' && (await ev('document.querySelector(".rvp-hero-title").textContent')) === 'Ideas into Innovation.' && (await ev('document.querySelector(".rvp-hero-text").textContent')) === 'Discover innovative projects, explore emerging technologies and find your next idea to build. From foundational STEM concepts to advanced engineering applications, explore possibilities with RoboValley.');
	check('hero has the robotics visual, the search bar and the call to action', (await ev('!!document.querySelector(".rvp-hero-art")&&!!document.querySelector("#rvp-q")&&!!document.querySelector(".rvp-hero-cta a[href=\\"#rvp-discover\\"]")')) === true);
	check('page script marked the page (rvp-js) and the search form is visible', (await ev('document.getElementById("rvp-root").classList.contains("rvp-js")&&document.getElementById("rvp-hero-search").offsetParent!==null')) === true);
	const tiles = await ev('document.querySelectorAll(".rvp-tile").length'); check('Explore by Technology: tiles from the catalogue (hidden when empty)', tiles >= 5 && tiles <= 10, tiles);
	check('technology tile has name, count and an image or placeholder', (await ev('(function(){var t=document.querySelector(".rvp-tile");return !!t.querySelector(".rvp-tile-name").textContent&&/project/.test(t.querySelector(".rvp-tile-count").textContent)&&!!t.querySelector("img,svg")})()')) === true);
	const first = await cards(); check('server-rendered first page of cards is visible without any request', first > 0 && first <= 12, first);
	check('Featured is the default tab (featured projects exist)', (await ev('document.querySelector("#rvp-tab-featured").getAttribute("aria-selected")')) === 'true');
	check('card shows thumbnail area, title, technology, difficulty, education levels and View Project (nothing else)', (await ev(`(function(){var c=document.querySelector('.rvp-card');return !!c.querySelector('.rvp-card-media')&&!!c.querySelector('.rvp-card-title')&&!!c.querySelector('.rvp-chip-tech')&&!!c.querySelector('.rvp-diff')&&!!c.querySelector('.rvp-levels li')&&!!c.querySelector('a[data-rvp-view]')&&!c.querySelector('.rvp-card-skills,.rvp-card-subjects,.rvp-card-components')})()`)) === true);
	check('card: difficulty and levels sit in labelled meta rows', (await ev('(function(){var m=document.querySelector(".rvp-card .rvp-card-meta");return !!m&&m.querySelectorAll(".rvp-meta-label").length>=1&&!!m.querySelector(".rvp-diff")})()')) === true);
	check('hero: "at a glance" strip shows public counts only (projects first)', (await ev('(function(){var s=document.querySelectorAll(".rvp-hero-stats li");return s.length>=1&&/^[0-9]+Projects?$/.test(s[0].textContent)})()')) === true);
	check('filter panel: "Clear all" is hidden with no filter, shown with one, and clears it', (await ev('document.getElementById("rvp-filters-clear").hidden')) === true && (await click('input[name=difficulty] + .rvp-check-box')) && (await sleep(50), await settle(), (await ev('document.getElementById("rvp-filters-clear").hidden')) === false) && (await click('#rvp-filters-clear')) && (await sleep(50), await settle(), (await ev('document.getElementById("rvp-filters-clear").hidden')) === true && (await ev('document.querySelectorAll(".rvp-chips .rvp-chip-x").length')) === 0));
	check('images (if any) are lazy with width and height', (await ev('[].every.call(document.querySelectorAll("img.rvp-card-img,img.rvp-tile-img"),function(i){return i.loading==="lazy"&&i.width>0&&i.height>0})')) === true);
	check('no horizontal scroll at 1280', (await hasHScroll()) === false);
	check('locked Subject filter is shown to a visitor, with its lock', (await ev('!!document.querySelector("#rvp-subject-lock")&&document.querySelector("#rvp-subject-lock").offsetParent!==null&&!document.querySelector("#rvp-subject-options input")')) === true);
	const dom1 = await ev('document.documentElement.outerHTML'); check('DOM of the logged-out page has no restricted marker', !M.some((m) => dom1.includes(m)), M.filter((m) => dom1.includes(m)));
	await shot('01-visitor-1280-top'); await ev('document.getElementById("rvp-discover").scrollIntoView()'); await sleep(400); await shot('02-visitor-1280-discover');

	// ---- tabs
	reqs = []; await click('#rvp-tab-latest'); await settle();
	check('Latest tab: loads from the public catalogue (GET, view=latest) and the tab is selected', reqs.some((r) => r.m === 'GET' && /rvp\/v1\/projects\?/.test(r.u) && /view=latest/.test(r.u)) && (await ev('document.querySelector("#rvp-tab-latest").getAttribute("aria-selected")')) === 'true');
	const latestTitles = await titles(); check('Latest: newest first (a DEMO project, created last, leads)', /^DEMO /.test(latestTitles[0] || ''), latestTitles.slice(0, 3));
	await click('#rvp-tab-all'); await settle();
	check('All tab shows a full first page with "Load more"', (await cards()) === 12 && (await ev('!document.getElementById("rvp-more").hidden')) === true, await cards());
	const tabsOk = await ev('(function(){var t=document.querySelector("#rvp-tab-all");t.focus();return document.activeElement===t})()'); await key('ArrowLeft', 'ArrowLeft', 37); await settle();
	check('keyboard: ArrowLeft on a tab moves to the previous tab and selects it', (await ev('document.querySelector("#rvp-tab-latest").getAttribute("aria-selected")')) === 'true' && tabsOk);
	await click('#rvp-tab-all'); await settle();

	// ---- load more
	reqs = []; await click('#rvp-more'); await settle();
	check('Load more appends the next page (24 cards, page=2 requested)', (await cards()) === 24 && reqs.some((r) => /page=2/.test(r.u)), await cards());
	const status = await ev('document.getElementById("rvp-status").textContent'); check('status line announces the count', /Showing 24 of \d+ projects/.test(status), status);

	// ---- search
	await ev('document.getElementById("rvp-q").value="gear"'); reqs = []; await ev('document.getElementById("rvp-hero-search").requestSubmit()'); await settle();
	const gear = await titles(); check('hero search finds projects by title/description ("gear")', gear.length >= 1 && gear.some((x) => /gear/i.test(x)) && gear.length < 8, gear);
	check('search request is a public GET with search=gear', reqs.some((r) => r.m === 'GET' && /search=gear/.test(r.u)));
	check('active chip "Search: gear" with its own clear button', (await ev('!!document.querySelector(".rvp-chips .rvp-chip-x[aria-label=\\"Remove filter Search: gear\\"]")')) === true);
	await ev('document.getElementById("rvp-q").value="zebra"'); await ev('document.getElementById("rvp-hero-search").requestSubmit()'); await settle();
	check('searching restricted text finds nothing and shows the empty message', (await cards()) === 0 && (await ev('!document.getElementById("rvp-empty").hidden')) === true && /No projects found/.test(await ev('document.getElementById("rvp-empty").textContent')));
	await ev('document.getElementById("rvp-q").value="zebra"'); await click('.rvp-chips .rvp-chip-x'); await settle();
	check('removing the search chip clears the search and brings the list back', (await cards()) > 0 && (await ev('document.getElementById("rvp-q").value')) === '');

	// ---- filters
	await click('input[name=technology][value=robotics]'); await settle();
	const robo = await titles(); check('Technology filter (robotics) -> chip, only robotics results', robo.length > 0 && (await ev('!!document.querySelector(".rvp-chips .rvp-chip")')) === true && (await ev('[].every.call(document.querySelectorAll("#rvp-grid .rvp-card"),function(c){return [].some.call(c.querySelectorAll(".rvp-chip-tech"),function(t){return t.textContent==="Robotics"})})')) === true, robo.length);
	await click('input[name=education][value=class-6-10]'); await click('input[name=education][value=iti]'); await settle();
	check('Education is multi-select and combines with technology (chips for each)', (await ev('document.querySelectorAll(".rvp-chips .rvp-chip-x").length')) === 3);
	await click('input[name=difficulty][value=beginner]'); await settle();
	check('Difficulty filter combines; every card is Beginner', (await cards()) > 0 && (await ev('[].every.call(document.querySelectorAll("#rvp-grid .rvp-diff"),function(d){return d.textContent==="Beginner"})')) === true, await cards());
	reqs = []; await click('.rvp-chips .rvp-chip-x'); await settle();
	check('a single chip clears only its own filter', (await ev('document.querySelectorAll(".rvp-chips .rvp-chip-x").length')) === 3);
	check('"Clear all" removes everything and restores the list', (await click('.rvp-chip-clear')) && (await sleep(50), await settle(), (await ev('document.querySelectorAll(".rvp-chips .rvp-chip").length')) === 0));
	await click('.rvp-tile'); await settle();
	check('clicking a technology tile filters by it (tile pressed, chip shown)', (await ev('document.querySelector(".rvp-tile[aria-pressed=true]")!==null&&document.querySelectorAll(".rvp-chips .rvp-chip-x").length===1')) === true);
	await click('.rvp-chips .rvp-chip-x'); await settle();
	check('no restricted data was requested or received by the public catalogue calls', !reqs.some((r) => /subject|api\/projects/.test(r.u)));

	// ---- unlock modal from the Subject lock (visitor)
	await ev('document.getElementById("rvp-discover").scrollIntoView()'); reqs = [];
	await ev('document.getElementById("rvp-subject-lock").focus()'); await click('#rvp-subject-lock'); await sleep(350);
	let mi = await modalInfo();
	check('Subject lock opens the unlock window: role=dialog, aria-modal, labelled title', mi && mi.modal === 'true' && mi.title === 'Unlock Project Details', mi && mi.title);
	check('  ...exact copy, Register Now and Login buttons to the app /join and /login, each with returnTo = the Projects page', mi && /Join RoboValley to explore project information, required components, skills and expected outcomes\./.test(mi.text) && (await ev('(function(){var a=[].map.call(document.querySelectorAll(".rvp-modal a.rvp-btn"),function(x){return x.textContent+"|"+x.href});return a.length===2&&a[0]===("Register Now|"+' + JSON.stringify(APP + '/join?returnTo=' + encodeURIComponent(PAGE)) + ')&&a[1]===("Login|"+' + JSON.stringify(APP + '/login?returnTo=' + encodeURIComponent(PAGE)) + ')})()')) === true);
	const lockHrefs = JSON.parse(await ev('JSON.stringify([].map.call(document.querySelectorAll(".rvp-modal a.rvp-btn"),function(a){return a.href}))'));
	check('  ...Register and Login from the Subject lock carry returnTo = the Projects page itself (no ?project)', lockHrefs.length === 2 && lockHrefs.every((h) => new URL(h).searchParams.get('returnTo') === PAGE), lockHrefs);
	check('  ...focus moved inside, background inert, page scroll locked', mi && mi.inside && mi.inert && mi.locked, mi);
	await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9);
	check('  ...focus is trapped (Tab x3 stays inside the window)', (await modalInfo()).inside === true);
	await key('Tab', 'Tab', 9, 8); await key('Tab', 'Tab', 9, 8); await key('Tab', 'Tab', 9, 8);
	check('  ...and Shift+Tab stays inside too', (await modalInfo()).inside === true);
	await shot('03-visitor-unlock-modal-1280');
	await key('Escape', 'Escape', 27);
	check('Escape closes it, restores focus to the Subject lock, unlocks scroll, removes it from the DOM', (await modalInfo()) === null && (await ev('document.activeElement.id')) === 'rvp-subject-lock' && (await ev('!document.body.classList.contains("rvp-scroll-locked")&&!document.getElementById("rvp-root").inert&&!document.querySelector(".rvp-modal-root")')) === true);
	check('the visitor made no request to the members-only app routes for the lock', !reqs.some((r) => /api\/projects/.test(r.u)), reqs.map((r) => r.u));

	// ---- View Project (visitor) -> unlock modal with returnTo
	await ev('document.querySelector("#rvp-grid .rvp-card a[data-rvp-view]").focus()'); const pid0 = await ev('document.querySelector("#rvp-grid .rvp-card a[data-rvp-view]").getAttribute("data-rvp-view")'); reqs = [];
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal();
	mi = await modalInfo();
	check('View Project as a visitor: the app says 401 and the unlock window opens', mi && mi.title === 'Unlock Project Details' && reqs.some((r) => r.u === `${APP}/api/projects/${pid0}`), mi && mi.title);
	const hrefs = await ev('JSON.stringify([].map.call(document.querySelectorAll(".rvp-modal a.rvp-btn"),function(a){return a.href}))').then(JSON.parse);
	const rt = new URL(hrefs[1]).searchParams.get('returnTo');
	check('Register and Login carry a returnTo = this page + ?project=<that id> (validated by the app)', hrefs[0].startsWith(APP + '/join?returnTo=') && rt === `${PAGE}?project=${pid0}`, [hrefs, rt]);
	check('no project details reached the page for a visitor', !(await ev('document.querySelector(".rvp-modal").innerText')).match(/Overview|Skills required|Expected outcome|RVPMARK/));
	await click('.rvp-modal-close'); await sleep(200);
	check('close button works and returns focus to the View Project link', (await modalInfo()) === null && (await ev('document.activeElement.getAttribute("data-rvp-view")')) === pid0);

	// ---- ?project=<id> without a session shows the unlock window, cleans the address
	await go(`${PAGE}?project=${pid0}`); await settleModal();
	mi = await modalInfo();
	check('?project=<id> while signed out: the unlock window (not an error), and the parameter is removed from the address', mi && mi.title === 'Unlock Project Details' && !(await ev('location.search')).includes('project='), [mi && mi.title, await ev('location.href')]);
	await go(`${PAGE}?project=abc`); await sleep(500);
	check('?project=abc (invalid) is ignored and removed', (await modalInfo()) === null && !(await ev('location.search')).includes('project'));

	// ---- fail-closed behaviour with forced app responses (visitor and member alike)
	await go(PAGE); await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/projects/*' }, { urlPattern: '*/api/auth/me*' }] });
	const pidA = await ev('document.querySelector("#rvp-grid .rvp-card a[data-rvp-view]").getAttribute("data-rvp-view")');
	paused = [{ re: /\/api\/projects\/\d+/, status: 503, body: { success: false, error: 'UNAVAILABLE' } }];
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal(); mi = await modalInfo();
	check('app answers 503 -> "Please try again later", no details', mi && mi.title === 'Please try again later' && !/Overview|RVPMARK/.test(mi.text), mi && mi.title); await key('Escape', 'Escape', 27);
	paused = [{ re: /\/api\/projects\/\d+/, fail: true }];
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal(); mi = await modalInfo();
	check('network / CORS failure -> fails closed with the sign-in prompt', mi && mi.title === 'Unlock Project Details', mi && mi.title); await key('Escape', 'Escape', 27);
	paused = [{ re: /\/api\/projects\/\d+/, status: 200, body: { success: true, project: { title: 'x' } } }];
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal(); mi = await modalInfo();
	check('a malformed 200 body is not shown (try again later)', mi && mi.title === 'Please try again later', mi && mi.title); await key('Escape', 'Escape', 27);
	paused = [{ re: /\/api\/projects\/\d+/, status: 404, body: { success: false, error: 'NOT_FOUND' } }];
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal(); mi = await modalInfo();
	check('app answers 404 -> "Project not available"', mi && mi.title === 'Project not available', mi && mi.title); await key('Escape', 'Escape', 27);
	paused = null; await send('Fetch.disable');

	// ---- no-JS: server-rendered catalogue stays visible and useful
	await send('Emulation.setScriptExecutionDisabled', { value: true }); await go(PAGE);
	const noJs = await ev('JSON.stringify({cards:document.querySelectorAll("#rvp-grid .rvp-card").length,hero:document.querySelector(".rvp-hero-title").textContent,searchHidden:getComputedStyle(document.getElementById("rvp-hero-search")).display,filtersHidden:getComputedStyle(document.getElementById("rvp-filters")).display,more:getComputedStyle(document.getElementById("rvp-more")).display,link:document.querySelector("a[data-rvp-view]").href})');
	await send('Emulation.setScriptExecutionDisabled', { value: false }); const nj = JSON.parse(noJs);
	check('JavaScript off: cards and hero are visible; search/filters/Load more are hidden; View Project is a sign-in link with returnTo', nj.cards > 0 && nj.hero === 'Ideas into Innovation.' && nj.searchHidden === 'none' && nj.filtersHidden === 'none' && nj.more === 'none' && nj.link.startsWith(APP + '/login?returnTo='), nj);

	// ---- reduced motion
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await go(PAGE);
	check('prefers-reduced-motion: the hero animation and card transitions are effectively off', parseFloat(await ev('getComputedStyle(document.querySelector(".rvp-art-robot")).animationDuration')) < 0.01 && parseFloat(await ev('getComputedStyle(document.querySelector(".rvp-card")).transitionDuration')) < 0.01);
	await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); await go(PAGE);
	check('normal motion: the hero animation runs', parseFloat(await ev('getComputedStyle(document.querySelector(".rvp-art-robot")).animationDuration')) > 1);

	// ============ RESPONSIVE: 820 and 390 ============
	await viewport(820, 1000); await go(PAGE); check('820px: no horizontal scroll', (await hasHScroll()) === false); await ev('document.getElementById("rvp-discover").scrollIntoView()'); await sleep(300); await shot('04-visitor-820-discover');
	check('820px: the sidebar is still shown beside the cards (the drawer starts at 760px), no Filters button', (await ev('getComputedStyle(document.getElementById("rvp-filter-open")).display')) === 'none' && (await ev('(function(){var r=document.getElementById("rvp-filters").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&getComputedStyle(document.getElementById("rvp-filters")).visibility==="visible"})()')) === true);
	await viewport(740, 1000); await go(PAGE); check('740px: the Filters button replaces the sidebar, no horizontal scroll', (await ev('getComputedStyle(document.getElementById("rvp-filter-open")).display')) !== 'none' && (await hasHScroll()) === false);
	await viewport(390, 844, true); await go(PAGE);
	check('390px: no horizontal scroll', (await hasHScroll()) === false); await shot('05-visitor-390-top');
	await ev('document.getElementById("rvp-discover").scrollIntoView()'); await sleep(300); await shot('06-visitor-390-discover');
	check('390px: filters are closed by default (off-screen), Filters button is shown', (await ev('document.getElementById("rvp-filters").getBoundingClientRect().right<=0||getComputedStyle(document.getElementById("rvp-filters")).visibility==="hidden"')) === true && (await ev('getComputedStyle(document.getElementById("rvp-filter-open")).display')) !== 'none');
	await click('#rvp-filter-open'); await sleep(500);
	check('390px: the drawer opens (visible, aria-expanded) and the page stays usable', (await ev('document.getElementById("rvp-filter-open").getAttribute("aria-expanded")')) === 'true' && (await ev('var r=document.getElementById("rvp-filters").getBoundingClientRect();r.left>=0&&r.width>200')) === true); await shot('07-visitor-390-filter-drawer');
	await click('input[name=difficulty][value=advanced]'); await settle(); await key('Escape', 'Escape', 27); await sleep(400);
	check('390px: choosing a filter shows the count badge; Escape closes the drawer and returns focus', (await ev('document.getElementById("rvp-filter-count").textContent')) === '1' && (await ev('document.getElementById("rvp-filter-open").getAttribute("aria-expanded")')) === 'false' && (await ev('document.activeElement.id')) === 'rvp-filter-open');
	await click('.rvp-chips .rvp-chip-x'); await settle();
	await ev('document.querySelector("#rvp-grid .rvp-card a[data-rvp-view]").focus()'); await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal();
	await shot('08-visitor-390-unlock'); check('390px: unlock window fits (no horizontal overflow) and works', (await modalInfo()).title === 'Unlock Project Details' && (await hasHScroll()) === false); await key('Escape', 'Escape', 27);
	await viewport(1280, 900);

	// ============ MEMBER ============
	// the real journey: visitor -> View Project -> Login (app) -> back to the page -> the details window reopens by itself
	await go(PAGE); const pidB = await ev('document.querySelector("#rvp-grid .rvp-card a[data-rvp-view]").getAttribute("data-rvp-view")');
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal();
	const loginHref = await ev('[].find.call(document.querySelectorAll(".rvp-modal a.rvp-btn"),function(a){return a.textContent==="Login"}).href');
	await go(loginHref);
	check('the app login page opens with the returnTo', (await ev('location.pathname')) === '/login' && (await ev('location.search')).includes('returnTo='), await ev('location.href'));
	await ev(`(function(){function set(el,v){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}set(document.getElementById('login-email'),${JSON.stringify(process.env.E2E_EMAIL)});set(document.getElementById('login-password'),${JSON.stringify(process.env.E2E_PASSWORD)});document.querySelector('button[type=submit]').click()})()`);
	const back = await waitFor(`location.origin===${JSON.stringify(WP)}&&location.pathname==='/projects/'`, 60000); await waitFor('document.readyState==="complete"', 30000); await waitFor("!!document.querySelector('.rvp-modal')", 30000); await settleModal();
	check('after signing in the visitor lands back on the Projects page (exact returnTo)', back, await ev('location.href'));
	mi = await modalInfo();
	check('...and the details window opened by itself for the same project', mi && mi.title && mi.title !== 'Unlock Project Details' && mi.title !== 'Loading project…', mi && mi.title);
	check('...the ?project parameter was removed from the address (history.replaceState)', !(await ev('location.search')).includes('project='), await ev('location.href'));
	check('details window: three tabs (Overview, Skills & components, Expected outcome), Overview selected, with the overview text and subjects', mi && (await ev('[].map.call(document.querySelectorAll(".rvp-modal [role=tab]"),function(t){return t.textContent+":"+t.getAttribute("aria-selected")}).join("|")')) === 'Overview:true|Skills & components:false|Expected outcome:false' && /Subjects/i.test(mi.text) && (await ev('document.querySelector("#rvp-dpanel-0 .rvp-detail-text").textContent.length')) > 20, mi && mi.text.slice(0, 200));
	await click('#rvp-dtab-1'); await sleep(150);
	check('...Skills & components tab shows skills and components (and the other panels are hidden)', (await ev('(function(){var d=document.querySelector(".rvp-modal");return d.innerText.indexOf("Skills required")>-1&&d.innerText.indexOf("Components required")>-1&&document.getElementById("rvp-dpanel-0").hidden&&document.getElementById("rvp-dpanel-2").hidden})()')) === true);
	await click('#rvp-dtab-2'); await sleep(150);
	check('...Expected outcome tab shows the outcome', (await ev('document.querySelector("#rvp-dpanel-2 .rvp-detail-text").textContent.length')) > 20 && (await ev('document.getElementById("rvp-dpanel-2").hidden')) === false);
	await ev('document.getElementById("rvp-dtab-2").focus()'); await key('ArrowLeft', 'ArrowLeft', 37);
	check('keyboard: ArrowLeft on a details tab moves focus to the previous tab and selects it; only the current tab is in the Tab order', (await ev('document.activeElement.id')) === 'rvp-dtab-1' && (await ev('document.getElementById("rvp-dtab-1").getAttribute("aria-selected")')) === 'true' && (await ev('[].filter.call(document.querySelectorAll(".rvp-modal [role=tab]"),function(t){return t.tabIndex===0}).length')) === 1);
	await click('#rvp-dtab-0'); await sleep(150);
	check('...with image area / title, technology, difficulty and education levels', (await ev('(function(){var d=document.querySelector(".rvp-modal");return !!d.querySelector("h2")&&!!d.querySelector(".rvp-chip-tech")&&!!d.querySelector(".rvp-diff")&&!!d.querySelector(".rvp-levels li")})()')) === true);
	check('...dialog semantics, focus inside, background inert, scroll locked', mi && mi.modal === 'true' && mi.inside && mi.inert && mi.locked, mi);
	await shot('09-member-details-1280');
	const storeBefore = await ev('JSON.stringify({l:Object.keys(localStorage),s:Object.keys(sessionStorage)})');
	check('nothing from the details is stored in localStorage or sessionStorage', !/rvp|project|overview/i.test(storeBefore) && !(await ev('JSON.stringify([localStorage,sessionStorage])')).match(/RVPMARK|overview|outcome/i), storeBefore);
	await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9);
	check('details window traps focus (Tab x4 stays inside)', (await modalInfo()).inside === true);
	await key('Escape', 'Escape', 27);
	check('Escape closes it and the details are gone from the DOM entirely', (await modalInfo()) === null && !(await ev('document.documentElement.outerHTML')).match(/RVPMARK_(OVERVIEW|SKILLS|COMPONENTS|OUTCOME)/) && (await ev('document.getElementById("rvp-root").inert')) === false);

	// member: View Project on a card, deep link, and the Subject filter
	await go(PAGE); await waitFor('document.querySelectorAll("#rvp-subject-options input").length>=8', 40000);
	check('member: the Subject filter is unlocked with options from the app (lock hidden)', (await ev('document.querySelectorAll("#rvp-subject-options input").length')) >= 8 && (await ev('document.getElementById("rvp-subject-lock").hidden')) === true, await ev('document.querySelectorAll("#rvp-subject-options input").length'));
	await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal(); mi = await modalInfo();
	check('member: View Project opens the details directly (no sign-in prompt)', mi && mi.title !== 'Unlock Project Details' && /Overview/i.test(mi.text), mi && mi.title); await click('.rvp-modal-close'); await sleep(200);
	check('member: closing restores focus to the View Project link', (await ev('document.activeElement.hasAttribute("data-rvp-view")')) === true);
	const histBefore = await ev('history.length'); await go(`${PAGE}?project=${pidB}`); await settleModal(); mi = await modalInfo();
	check('deep link ?project=<id> as a member opens the details and cleans the address without adding history', mi && /Overview/i.test(mi.text) && !(await ev('location.search')).includes('project=') && (await ev('history.length')) <= histBefore + 1, mi && mi.title); await key('Escape', 'Escape', 27);

	await go(PAGE); await waitFor('document.querySelectorAll("#rvp-subject-options input").length>=8', 40000); reqs = []; await click('input[name=subject]'); await waitReq((r) => r.m === 'POST' && /projects\/query/.test(r.u)); await settle(); await sleep(300);
	check('subject filter: the app route is asked first (credentials), then the public POST query with include ids', reqs.some((r) => /api\/projects\/subject-filter\?subjects=/.test(r.u)) && reqs.some((r) => r.m === 'POST' && /projects\/query/.test(r.u) && /"include":\[/.test(r.body || '')), reqs.map((r) => r.m + ' ' + r.u.slice(0, 90)));
	check('subject filter: chip "Subject: …" and only public cards rendered', (await ev('!!document.querySelector(".rvp-chips .rvp-chip-x[aria-label^=\\"Remove filter Subject:\\"]")')) === true && (await cards()) > 0 && (await ev('document.querySelector("#rvp-grid").innerText')).match(/Overview|Skills required|Expected outcome/) === null);
	await shot('10-member-subject-filter-1280');
	check('subject filter: the POST response (public) contains no restricted marker', !reqs.some((r) => M.some((m) => (r.body || '').includes(m))));
	await click('.rvp-chips .rvp-chip-x'); await settle();
	// forced answers for the subject flow
	await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/projects/subject-filter*' }] });
	paused = [{ re: /subject-filter/, status: 200, body: { success: true, ids: [1, 2], total: 1500, limit: 1000, truncated: true } }];
	await click('input[name=subject]'); await sleep(900);
	check('subject filter truncated by the app -> "Too many matches, narrow your filters." and no cards', /Too many matches, narrow your filters\./.test(await ev('document.getElementById("rvp-status").textContent')) && (await cards()) === 0);
	await click('.rvp-chips .rvp-chip-x'); await settle();
	paused = [{ re: /subject-filter/, status: 503, body: { success: false, error: 'UNAVAILABLE' } }];
	await click('input[name=subject]'); await sleep(900);
	check('subject filter, app 503 -> "not available right now, please try again later", no cards', /not available right now/.test(await ev('document.getElementById("rvp-status").textContent')) && (await cards()) === 0);
	await click('.rvp-chips .rvp-chip-x'); await settle();
	paused = [{ re: /subject-filter/, status: 401, body: { success: false, error: 'UNAUTHENTICATED' } }];
	await click('input[name=subject]'); await settleModal(); mi = await modalInfo();
	check('subject filter, app 401 (session ended) -> unlock window, the selection is cleared, the lock returns', mi && mi.title === 'Unlock Project Details' && (await ev('document.querySelectorAll(".rvp-chips .rvp-chip").length')) === 0 && (await ev('document.getElementById("rvp-subject-lock").hidden')) === false, mi && mi.title);
	await key('Escape', 'Escape', 27); paused = null; await send('Fetch.disable');

	// member on a phone: details fill the screen
	await viewport(390, 844, true); await go(`${PAGE}?project=${pidB}`); await settleModal(); mi = await modalInfo();
	check('390px member: the details window is full screen', mi && mi.w === mi.vw && mi.h === mi.vh, mi && [mi.w, mi.h, mi.vw, mi.vh]); await shot('11-member-details-390'); await key('Escape', 'Escape', 27);
	await viewport(820, 1000); await go(`${PAGE}?project=${pidB}`); await settleModal(); await shot('12-member-details-820'); mi = await modalInfo(); check('820px member: details window fits the screen', mi && mi.w <= mi.vw && mi.h <= mi.vh); await key('Escape', 'Escape', 27);

	check('no JavaScript errors on the page during the whole run', jsErrs().length === 0, jsErrs());
	console.log(`\n${pass} passed, ${fail} failed`); ws.close(); edge.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); edge.kill(); process.exit(2); });
