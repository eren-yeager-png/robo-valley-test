// RoboValley Projects: Demo Content, the Projects page in a real browser with the 20 demo projects installed (Edge headless over CDP, Node 22+). LOCAL ONLY.
// Env: WP, APP, E2E_EMAIL, E2E_PASSWORD (a test member in the app), DATASET (rvpdc-dataset.json), SHOTS, PAGE_PATH (default /projects/)
const { spawn } = require('child_process'); const os = require('os'); const path = require('path'); const fs = require('fs');
const WP = (process.env.WP || 'http://localhost:8080').replace(/\/$/, ''); const APP = (process.env.APP || 'http://localhost:3010').replace(/\/$/, '');
const PAGE = WP + (process.env.PAGE_PATH || '/projects/'); const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'rvpdc-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const data = JSON.parse(fs.readFileSync(process.env.DATASET, 'utf8')); const DS = data.dataset; const L = data.labels;
const TECH = L.rv_technology, EDU = L.rv_education, SUBJ = L.rv_subject;
const port = 9800 + Math.floor(Math.random() * 90); const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rvpdc-b-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 300) : '')); };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
(async () => {
	let t; for (let i = 0; i < 60 && !t; i++) { await sleep(200); try { t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page'); } catch {} }
	const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
	let id = 0; const pend = new Map(); const evs = [];
	const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
	ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); return; } evs.push(x); });
	const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXCEPTION ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result.result.value; };
	const waitFor = async (e, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e) === true) return true; await sleep(120); } return false; };
	const go = async (url) => { await send('Page.navigate', { url }); await sleep(500); await waitFor('document.readyState==="complete"', 20000); await sleep(300); };
	const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); };
	const viewport = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
	const click = (sel) => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
	const settle = async () => { await sleep(350); await waitFor('!document.getElementById("rvp-grid").hasAttribute("aria-busy")', 12000); await sleep(150); };
	const titles = () => ev('JSON.stringify([].map.call(document.querySelectorAll("#rvp-grid .rvp-card-title"),function(n){return n.textContent}))').then(JSON.parse);
	const cards = () => ev('document.querySelectorAll("#rvp-grid .rvp-card").length');
	const loadAll = async () => { for (let i = 0; i < 5; i++) { if ((await ev('document.getElementById("rvp-more").hidden')) === true) break; await click('#rvp-more'); await settle(); } return titles(); };
	const openAll = async () => { await go(PAGE); await click('#rvp-tab-all'); await settle(); };
	const setBoxes = async (group, slugs) => { for (const s of slugs) await ev(`(function(){var i=document.querySelector('input[name="${group}"][value="${s}"]');if(i&&!i.checked)i.click()})()`); await settle(); };
	const modalText = () => ev('(function(){var d=document.querySelector(".rvp-modal[role=dialog]");return d?d.innerText:null})()');
	const settleModal = async () => { await sleep(250); await waitFor("!(document.querySelector('.rvp-modal')&&document.querySelector('.rvp-modal').hasAttribute('aria-busy'))", 40000); await sleep(250); };
	const hasHScroll = () => ev('document.documentElement.scrollWidth>document.documentElement.clientWidth+1');
	const byTitle = (n) => DS.find((d) => d.title === n);
	const names = (d) => ({ tech: TECH[d.tech], edu: d.edu.map((s) => EDU[s]), subj: d.subjects.map((s) => SUBJ[s]) });
	await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

	// ================= VISITOR, 1280 =================
	await viewport(1280, 900); await send('Network.clearBrowserCookies');
	await go(PAGE);
	const techSlugs = Object.keys(TECH);
	check('Explore by Technology shows a tile for each of the 10 technologies, with a count of 2', (await ev('document.querySelectorAll(".rvp-tile").length')) === 10 && (await ev('[].every.call(document.querySelectorAll(".rvp-tile-count"),function(c){return /^2 projects?$/.test(c.textContent.trim())})')) === true, await ev('[].map.call(document.querySelectorAll(".rvp-tile"),function(t){return t.textContent.replace(/\\s+/g," ").trim()}).join(" | ")'));
	check('...every tile name is the technology name', sameSet(JSON.parse(await ev('JSON.stringify([].map.call(document.querySelectorAll(".rvp-tile-name"),function(n){return n.textContent.trim()}))')), Object.values(TECH)));
	check('the Technology filter has a heading and all 10 checkboxes', (await ev('document.querySelectorAll("input[name=technology]").length')) === 10 && /Technology/.test(await ev('document.querySelector("[data-group=technology] legend").textContent')));
	check('Education level filter has all 7 levels, Difficulty has 3', (await ev('document.querySelectorAll("input[name=education]").length')) === 7 && (await ev('document.querySelectorAll("input[name=difficulty]").length')) === 3);
	// tabs
	const feat = DS.filter((d) => d.featured).sort((a, b) => a.order - b.order).map((d) => d.title);
	check('Featured is the default tab and shows the 6 featured projects in the display order 1..6', (await ev('document.querySelector("#rvp-tab-featured").getAttribute("aria-selected")')) === 'true' && JSON.stringify(await titles()) === JSON.stringify(feat), await titles());
	await shot('d01-visitor-1280-featured');
	const latestOrder = [...DS].sort((a, b) => a.days_ago - b.days_ago).map((d) => d.title);
	await click('#rvp-tab-latest'); await settle(); const lt = await titles();
	check('Latest tab: newest first, matching the staggered dates (first 12 in order)', JSON.stringify(lt) === JSON.stringify(latestOrder.slice(0, 12)), lt);
	await click('#rvp-tab-all'); await settle();
	check('All tab: 12 cards and Load more is visible', (await cards()) === 12 && (await ev('document.getElementById("rvp-more").hidden')) === false);
	await click('#rvp-more'); await settle();
	check('Load more adds the rest: 20 cards, Load more hidden, status "Showing 20 of 20 projects"', (await cards()) === 20 && (await ev('document.getElementById("rvp-more").hidden')) === true && /Showing 20 of 20 projects/.test(await ev('document.getElementById("rvp-status").textContent')), await ev('document.getElementById("rvp-status").textContent'));
	check('all 20 titles are the clean titles from the table (no DEMO prefix anywhere)', sameSet(await titles(), DS.map((d) => d.title)) && !(await ev('document.getElementById("rvp-grid").innerText')).match(/demo/i));
	// images
	await ev('[].forEach.call(document.querySelectorAll("#rvp-grid img"),function(i){i.loading="eager"})'); await sleep(1500);
	const imgs = JSON.parse(await ev('JSON.stringify([].map.call(document.querySelectorAll("#rvp-grid .rvp-card"),function(c){var i=c.querySelector("img.rvp-card-img");var m=c.querySelector(".rvp-card-media").getBoundingClientRect();return i?{ok:i.complete&&i.naturalWidth>0,ratio:i.naturalWidth/i.naturalHeight,box:m.width/m.height,alt:i.alt}:null}))'));
	check('every card shows a loaded generated image whose shape is 16:10, the same as the card crop (not stretched), with alt text', imgs.length === 20 && imgs.every((i) => i && i.ok && Math.abs(i.ratio - 1.6) < 0.02 && Math.abs(i.box - 1.6) < 0.05 && i.alt), imgs.filter((i) => !i || !i.ok || Math.abs(i.ratio - 1.6) > 0.02).slice(0, 2));
	await ev('document.getElementById("rvp-discover").scrollIntoView()'); await sleep(500); await shot('d02-visitor-1280-all');

	// technology filter, one by one: exactly the 2 expected projects
	for (const s of techSlugs) {
		await openAll(); await setBoxes('technology', [s]); const got = await loadAll(); const want = DS.filter((d) => d.tech === s).map((d) => d.title);
		check(`technology filter "${TECH[s]}": exactly its ${want.length} projects`, got.length > 0 && sameSet(got, want), [got, want]);
	}
	// tiles: each tile filters too
	await openAll(); await click('.rvp-tile[data-tech="drone-technology"]'); await settle();
	check('clicking the "Drone Technology" tile filters to its 2 projects and shows the chip', sameSet(await titles(), DS.filter((d) => d.tech === 'drone-technology').map((d) => d.title)) && (await ev('document.querySelectorAll(".rvp-chips .rvp-chip").length')) >= 1);
	// education levels
	for (const s of Object.keys(EDU)) {
		await openAll(); await setBoxes('education', [s]); const got = await loadAll(); const want = DS.filter((d) => d.edu.includes(s)).map((d) => d.title);
		check(`education filter "${EDU[s]}": ${want.length} projects`, got.length > 0 && sameSet(got, want), [got.length, want.length]);
	}
	// difficulty
	for (const s of ['beginner', 'intermediate', 'advanced']) {
		await openAll(); await setBoxes('difficulty', [s]); const got = await loadAll(); const want = DS.filter((d) => d.difficulty === s).map((d) => d.title);
		check(`difficulty filter "${s}": ${want.length} projects`, got.length > 0 && sameSet(got, want), [got.length, want.length]);
	}
	// combined
	const combos = [{ tech: ['iot'], edu: [], dif: ['beginner'] }, { tech: ['robotics', 'automation'], edu: ['polytechnic'], dif: [] }, { tech: [], edu: ['b-tech', 'postgraduate'], dif: ['advanced'] }, { tech: ['electronics', 'stem'], edu: ['class-6-10'], dif: ['beginner'] }];
	for (const c of combos) {
		await openAll(); await setBoxes('technology', c.tech); await setBoxes('education', c.edu); await setBoxes('difficulty', c.dif); const got = await loadAll();
		const want = DS.filter((d) => (!c.tech.length || c.tech.includes(d.tech)) && (!c.edu.length || d.edu.some((e) => c.edu.includes(e))) && (!c.dif.length || c.dif.includes(d.difficulty))).map((d) => d.title);
		check(`combined filters tech[${c.tech}] + level[${c.edu}] + difficulty[${c.dif}]: ${want.length} projects`, want.length > 0 && sameSet(got, want), [got, want]);
	}
	// search
	for (const q of ['robot', 'solar', 'drone']) {
		await openAll(); await ev(`document.getElementById("rvp-q").value=${JSON.stringify(q)}`); await ev('document.getElementById("rvp-hero-search").requestSubmit()'); await settle(); const got = await loadAll();
		const want = DS.filter((d) => (d.title + ' ' + d.desc + ' ' + TECH[d.tech] + ' ' + d.edu.map((e) => EDU[e]).join(' ')).toLowerCase().includes(q)).map((d) => d.title);
		check(`search "${q}": ${want.length} projects (title, description, technology, level only)`, want.length > 0 && sameSet(got, want), [got, want]);
	}
	await openAll(); await ev('document.getElementById("rvp-q").value="Soldering"'); await ev('document.getElementById("rvp-hero-search").requestSubmit()'); await settle();
	check('search for a restricted skill ("Soldering") finds nothing', (await cards()) === 0 && /No projects found/.test(await ev('document.getElementById("rvp-empty").textContent')));
	// subject lock (visitor)
	await go(PAGE); await ev('document.getElementById("rvp-discover").scrollIntoView()'); await click('#rvp-subject-lock'); await sleep(400);
	check('visitor: the locked Subject filter opens the "Unlock Project Details" prompt', (await modalText() || '').includes('Unlock Project Details'));
	await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await sleep(300);
	const domV = await ev('document.documentElement.outerHTML'); const restricted = DS.flatMap((d) => [d.overview, d.outcome, ...d.skills, ...d.components]);
	check('visitor DOM after all that has none of the restricted text of the 20 projects', !restricted.some((m) => domV.includes(m)), restricted.filter((m) => domV.includes(m)).slice(0, 2));
	// View Project as a visitor
	await go(PAGE); await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal();
	check('visitor: View Project opens the unlock prompt (no details)', /Unlock Project Details/.test(await modalText() || ''));
	const vm = (await modalText()) || ''; check('...and the window holds none of the restricted text', !restricted.some((m) => vm.includes(m)));

	// ================= MOBILE 390 (visitor) =================
	await viewport(390, 844, true); await go(PAGE);
	check('390px: no horizontal scroll, tiles and cards render', (await hasHScroll()) === false && (await cards()) === 6 && (await ev('document.querySelectorAll(".rvp-tile").length')) === 10, [await hasHScroll(), await cards()]);
	await shot('d03-visitor-390-top'); await ev('document.getElementById("rvp-discover").scrollIntoView()'); await sleep(400); await shot('d04-visitor-390-cards');
	await click('#rvp-filter-open'); await sleep(500); await setBoxes('technology', ['iot']); await sleep(300); await shot('d05-visitor-390-drawer');
	await click('#rvp-drawer-done'); await sleep(400);
	check('390px: "Show results" closed the drawer', (await ev('document.getElementById("rvp-filter-open").getAttribute("aria-expanded")')) === 'false');
	const mt = await titles(); check('390px: the filtered list holds only IoT projects (at least one)', mt.length >= 1 && mt.every((n) => byTitle(n) && byTitle(n).tech === 'iot'), mt);
	check('390px: still no horizontal scroll after filtering', (await hasHScroll()) === false);
	const jsErrors = evs.filter((e) => e.method === 'Runtime.exceptionThrown').length; check('no JavaScript errors on the page during the visitor run', jsErrors === 0, jsErrors);

	// ================= MEMBER =================
	await viewport(1280, 900); await send('Network.clearBrowserCookies');
	await go(APP + '/login'); await waitFor('!!document.getElementById("login-email")', 30000);
	await ev(`(function(){function set(el,v){var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}set(document.getElementById('login-email'),${JSON.stringify(process.env.E2E_EMAIL)});set(document.getElementById('login-password'),${JSON.stringify(process.env.E2E_PASSWORD)});document.querySelector('button[type=submit]').click()})()`);
	await waitFor(`location.origin!==${JSON.stringify(APP)}||location.pathname!=='/login'`, 60000); await sleep(800);
	await go(PAGE); await waitFor('document.querySelectorAll("#rvp-subject-options input").length>=8', 40000);
	check('member: the Subject filter is unlocked with all 8 subjects', (await ev('document.querySelectorAll("#rvp-subject-options input").length')) === 8 && (await ev('document.getElementById("rvp-subject-lock").hidden')) === true, await ev('document.querySelectorAll("#rvp-subject-options input").length'));
	// View Project for at least one project per technology
	for (const s of techSlugs) {
		await openAll(); await setBoxes('technology', [s]); const wantT = JSON.stringify(DS.filter((d) => d.tech === s).map((d) => d.title)); await waitFor(`(function(){var t=[].map.call(document.querySelectorAll('#rvp-grid .rvp-card-title'),function(n){return n.textContent});return t.length>0&&t.every(function(x){return ${wantT}.indexOf(x)!==-1})})()`, 15000); await click('#rvp-grid .rvp-card a[data-rvp-view]'); await settleModal();
		const txt = (await modalText()) || ''; const title = (await ev('(function(){var h=document.querySelector(".rvp-modal h2");return h&&h.textContent})()')) || ''; const d = byTitle(title.trim()); const n = d && names(d);
		const miss = d ? [d.overview, d.outcome, ...d.skills, ...d.components, ...n.subj, n.tech, ...n.edu].filter((x) => !txt.includes(x)) : ['no project for title ' + title];
		check(`member: View Project (${TECH[s]}: ${title.trim()}) shows overview, subjects, skills, components and expected outcome from the table`, !!d && d.tech === s && miss.length === 0 && /Overview/i.test(txt) && /Subjects/i.test(txt) && /Skills required/i.test(txt) && /Components required/i.test(txt) && /Expected outcome/i.test(txt), miss.slice(0, 3));
		if (s === 'robotics') await shot('d06-member-details-1280');
		await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await sleep(250);
	}
	check('closing the details removes them from the DOM', !(await ev('document.documentElement.outerHTML')).includes(DS[0].overview));
	// Subject filter for members
	for (const s of ['chemistry', 'other', 'mechanical-engineering']) {
		await openAll(); await waitFor('document.querySelectorAll("#rvp-subject-options input").length>=8', 40000); await setBoxes('subject', [s]); await sleep(600); await settle(); const got = await loadAll(); const want = DS.filter((d) => d.subjects.includes(s)).map((d) => d.title);
		check(`member: Subject filter "${SUBJ[s]}": ${want.length} projects, public cards only`, got.length > 0 && sameSet(got, want) && !/Overview|Skills required|Expected outcome/.test(await ev('document.getElementById("rvp-grid").innerText')), [got, want]);
	}
	await shot('d07-member-subject-filter');
	const jsErr2 = evs.filter((e) => e.method === 'Runtime.exceptionThrown').length; check('no JavaScript errors during the member run', jsErr2 === 0, jsErr2);
	console.log(`\n${pass} passed, ${fail} failed`); edge.kill(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); edge.kill(); process.exit(2); });
