// RoboValley Projects: leak scan of the real Projects page as a logged-out visitor (Node 22+, no dependencies). LOCAL ONLY.
// Usage:  RVP_BRIDGE_SECRET=<secret> node rvprojects-page-leak-scan.cjs <rvp-markers.json> <path to the plugin folder> [base url] [page path]
const fs = require('fs'); const path = require('path');
const [markersFile, pluginDir, baseArg, pagePath] = process.argv.slice(2);
if (!markersFile || !pluginDir) { console.error('usage: node rvprojects-page-leak-scan.cjs <markers.json> <plugin dir> [base] [page path]'); process.exit(2); }
const BASE = (baseArg || 'http://localhost:8080').replace(/\/$/, ''); const PAGE = pagePath || '/projects/';
const data = JSON.parse(fs.readFileSync(markersFile, 'utf8')); const markers = Object.values(data.markers).concat(['zebra']);
const secret = process.env.RVP_BRIDGE_SECRET || '';
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 200) : '')); };
const get = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); return { status: r.status, headers: r.headers, body: await r.text() }; };
const leaks = (t) => markers.filter((m) => t.includes(m)); const unpub = ['RVPT Hidden Draft', 'RVPT Hidden Pending', 'RVPT Hidden Private', 'RVPT Hidden Future', 'RVPT Hidden Password'];
(async () => {
	const ids = [...Object.values(data.ids.published), ...Object.values(data.ids.unpublished)];
	const pages = { 'page': PAGE, 'page ?project=<published id>': `${PAGE}?project=${data.ids.published.hidden_fields}`, 'page ?project=<draft id>': `${PAGE}?project=${data.ids.unpublished.draft}`, 'page ?s=zebra': `${PAGE}?s=zebra`, 'page ?rvp_q=zebra': `${PAGE}?rvp_q=zebra` };
	for (const [n, p] of Object.entries(pages)) {
		const r = await get(p);
		check(`${n}: ${p.includes('?s=') ? '200 or 404 (WordPress treats ?s= as a search)' : '200'}`, p.includes('?s=') ? [200, 404].includes(r.status) : r.status === 200, r.status);
		check(`${n}: source has no restricted marker, no unpublished title`, leaks(r.body).length === 0 && !unpub.some((u) => r.body.includes(u)), leaks(r.body));
		check(`${n}: source has no secret and no bridge route name`, !(secret && r.body.includes(secret)) && !/rvp-bridge|RVP_BRIDGE_SECRET|X-RVP-/.test(r.body));
	}
	const page = await get(PAGE);
	check('page source has none of the subject names (they are members-only)', !/Mechanical Engineering|Electrical Engineering|Computer Science|Chemistry|Mathematics/.test(page.body));
	check('page source contains no subject checkboxes (only the locked button)', !/name="subject"/.test(page.body) && /id="rvp-subject-lock"/.test(page.body));
	check('page source has no <script> that carries project data (only the small RVP_PAGE config)', (page.body.match(/<script[^>]*>[\s\S]*?<\/script>/g) || []).filter((s) => /window\.RVP_PAGE=/.test(s)).every((s) => !/overview|skills|components|outcome/i.test(s)));
	const cfg = (page.body.match(/window\.RVP_PAGE=(\{[^<]*?\});/) || [])[1]; const parsed = cfg ? JSON.parse(cfg) : null;
	check('RVP_PAGE config holds only public addresses and numbers', parsed && Object.keys(parsed).sort().join() === 'app,catalogue,imgBase,pageUrl,perPage,query', parsed && Object.keys(parsed));
	check('RVP_PAGE imgBase is only the public folder of the illustration files of the plugin (a plain address, nothing secret)', parsed && /^https?:\/\/[^\s"<>?#]+\/robovalley-projects\/assets\/img\/$/.test(parsed.imgBase || '') && !/secret|token|key|bridge/i.test(parsed.imgBase), parsed && parsed.imgBase);
	check('page assets are versioned (?ver=...) and only rvp-projects-page.css/.js (+ optional fonts) are added', /rvp-projects-page\.css\?ver=[\d.]+/.test(page.body) && /rvp-projects-page\.js\?ver=[\d.]+/.test(page.body));
	check('page response is not marked private/no-store by the plugin (public, cacheable page)', !/no-store|private/.test(page.headers.get('cache-control') || ''), page.headers.get('cache-control'));
	check('no Set-Cookie on the public page', page.headers.get('set-cookie') === null, page.headers.get('set-cookie'));
	// other pages must not load the page assets
	const home = await get('/'); const fas = await get('/find-a-service/');
	check('assets do NOT load on the home page or Find a Service', !/rvp-projects-page\.(css|js)/.test(home.body) && !/rvp-projects-page\.(css|js)/.test(fas.body));
	// the shipped files
	const js = fs.readFileSync(path.join(pluginDir, 'assets/rvp-projects-page.js'), 'utf8'); const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	check('script: no innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / new Function', !/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code), code.match(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/g));
	check('script: no localStorage / sessionStorage / IndexedDB / cookies written', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code));
	check('script: exactly 4 credentialed calls, all to the app API routes, and no secret anywhere', !/RVP_BRIDGE|bridge-secret|X-RVP-/i.test(code) && (code.match(/credentials: 'include'/g) || []).length === 4 && (code.match(/fetch\( APP \+ '\/api\//g) || []).length === 4);
	for (const f of ['assets/rvp-projects-page.js', 'assets/rvp-projects-page.css', 'includes/page.php']) { const t = fs.readFileSync(path.join(pluginDir, f), 'utf8'); check(`${f}: no restricted marker and no secret`, leaks(t).length === 0 && !(secret && t.includes(secret))); }
	const php = fs.readFileSync(path.join(pluginDir, 'includes/page.php'), 'utf8');
	check('page.php never reads the restricted meta keys', !/_rvp_(overview|skills|components|outcome)|RVP_TAX_SUBJECT/.test(php));
	console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
