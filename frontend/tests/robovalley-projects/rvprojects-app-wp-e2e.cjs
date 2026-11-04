// RoboValley Projects: Stage 3 end to end (Node 22+, no dependencies). LOCAL TEST SITES ONLY.
// A black-box client against the real app (Next.js) and the real WordPress, wired together through the signed bridge.
// Prerequisites: rvprojects-testdata-setup.php data in WordPress, RVP_BRIDGE_SECRET set in wp-config.php and in the app's environment,
// a test member created in the app's database.
// Env: APP (default http://localhost:3000)  WP (default http://localhost:8080)  MARKERS (path to rvp-markers.json)
//      E2E_EMAIL, E2E_PASSWORD (the test member)  EXPECT=up|bridge-off   ALLOWED_ORIGIN (the origin the app allows, default = WP)
const fs = require('fs');
const APP = (process.env.APP || 'http://localhost:3000').replace(/\/$/, ''); const WP = (process.env.WP || 'http://localhost:8080').replace(/\/$/, '');
const EXPECT = process.env.EXPECT || 'up'; const ALLOWED = process.env.ALLOWED_ORIGIN || WP;
const data = JSON.parse(fs.readFileSync(process.env.MARKERS, 'utf8')); const M = data.markers; const ids = data.ids;
const restricted = [M.overview, M.skills, M.components, M.outcome, M.subject, M.content, M.excerpt, 'zebra'];
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 300) : '')); };
const get = async (path, { cookie, origin, ip } = {}) => { const r = await fetch(APP + path, { redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), 'X-Forwarded-For': ip || `192.0.2.${1 + Math.floor(Math.random() * 250)}` } }); return { status: r.status, headers: r.headers, text: await r.text() }; };
const leaks = (t) => restricted.filter((m) => t.includes(m));
const noStore = (r) => r.headers.get('cache-control') === 'no-store';

(async () => {
	const pid = ids.published.hidden_fields;
	// ---- 1. anonymous
	const anon = await get(`/api/projects/${pid}`);
	check('no cookie -> 401', anon.status === 401, anon.status);
	check('  ...generic body {success:false,error:UNAUTHENTICATED}, no-store, no restricted marker', anon.text === '{"success":false,"error":"UNAUTHENTICATED"}' && noStore(anon) && leaks(anon.text).length === 0, anon.text);
	const anonSub = await get('/api/projects/subject-filter?subjects=physics');
	check('subject-filter without a cookie -> 401, no-store', anonSub.status === 401 && noStore(anonSub), anonSub.status);
	for (const bad of ['rv_session=garbage', 'rv_session=' + 'a'.repeat(100) + '.' + 'b'.repeat(43), 'rv_session=']) { const r = await get(`/api/projects/${pid}`, { cookie: bad }); check(`forged cookie "${bad.slice(0, 24)}..." -> 401`, r.status === 401 && leaks(r.text).length === 0, r.status); }

	// ---- 2. log in as a real member
	const login = await fetch(APP + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD }) });
	const setCookie = login.headers.get('set-cookie') || ''; const cookie = (setCookie.match(/rv_session=[^;]+/) || [''])[0];
	const loginBody = await login.json();
	check('real login succeeds and sets the HttpOnly session cookie', login.status === 200 && loginBody.success === true && /HttpOnly/i.test(setCookie) && cookie.length > 20, [login.status, setCookie.slice(0, 40)]);
	check('login without returnTo still answers redirectTo = SITE_URL (unchanged behaviour)', loginBody.redirectTo === 'http://localhost:8080/', loginBody.redirectTo);
	const tampered = cookie.slice(0, -3) + (cookie.endsWith('AAA') ? 'BBB' : 'AAA');
	const t = await get(`/api/projects/${pid}`, { cookie: tampered }); check('the same cookie with its signature altered -> 401', t.status === 401 && leaks(t.text).length === 0, t.status);

	if (EXPECT === 'bridge-off') {
		const r = await get(`/api/projects/${pid}`, { cookie });
		check('member + bridge switched off in WordPress -> 503 UNAVAILABLE, no restricted data, no detail', r.status === 503 && r.text === '{"success":false,"error":"UNAVAILABLE"}' && noStore(r) && leaks(r.text).length === 0, [r.status, r.text]);
		const s = await get('/api/projects/subject-filter?subjects=physics', { cookie });
		check('subject-filter with the bridge off -> 503', s.status === 503 && noStore(s) && leaks(s.text).length === 0, [s.status, s.text]);
		check('503 mentions neither the WordPress address nor the word secret/signature', !/localhost:8080|secret|signature|wp-json|rvp-bridge/i.test(r.text + s.text + JSON.stringify([...r.headers])));
		console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
	}

	// ---- 3. signed-in member
	const ok = await get(`/api/projects/${pid}`, { cookie });
	const j = ok.status === 200 ? JSON.parse(ok.text) : {};
	check('member -> 200', ok.status === 200, [ok.status, ok.text.slice(0, 200)]);
	check('  ...with the restricted fields from WordPress', j.project?.overview === M.overview && j.project?.outcome === M.outcome && j.project?.skills?.[0] === M.skills && j.project?.components?.[0] === M.components && j.project?.subjects?.[0]?.name === M.subject);
	check('  ...and the public fields the modal needs', j.project?.id === pid && j.project?.title === 'RVPT Hidden Fields Project' && j.project?.technology?.[0]?.slug === 'iot' && j.project?.difficulty?.slug === 'advanced' && j.project?.education?.[0]?.slug === 'postgraduate');
	check('  ...Cache-Control: no-store, no Set-Cookie', noStore(ok) && ok.headers.get('set-cookie') === null, ok.headers.get('cache-control'));
	check('  ...never the post_content / excerpt markers', !ok.text.includes(M.content) && !ok.text.includes(M.excerpt));
	console.log('  --- member response headers:'); for (const [k, v] of ok.headers) { if (/^(cache-control|content-type|vary|access-control-.*|set-cookie)$/i.test(k)) console.log('    ' + k + ': ' + v); }
	check('response keys are only success + project', Object.keys(j).sort().join() === 'project,success');

	// ---- 4. other ids
	const cases = { 'unknown id': 999999, draft: ids.unpublished.draft, pending: ids.unpublished.pending, private: ids.unpublished.private, scheduled: ids.unpublished.future, 'password protected': ids.unpublished.password };
	for (const [n, id] of Object.entries(cases)) { const r = await get(`/api/projects/${id}`, { cookie }); check(`${n} -> 404 NOT_FOUND, no data`, r.status === 404 && r.text === '{"success":false,"error":"NOT_FOUND"}' && noStore(r), [r.status, r.text]); }
	for (const bad of ['abc', '0', '-1', '1.5', '01', '99999999999', '12abc', '%20']) { const r = await get(`/api/projects/${bad}`, { cookie }); check(`id "${bad}" -> 400`, r.status === 400 && noStore(r), [r.status]); }

	// ---- 5. CORS
	const own = await get(`/api/projects/${pid}`, { cookie, origin: ALLOWED });
	check(`allowed origin ${ALLOWED} -> 200 with Allow-Origin echoed, credentials, Vary: Origin`, own.status === 200 && own.headers.get('access-control-allow-origin') === ALLOWED && own.headers.get('access-control-allow-credentials') === 'true' && /Origin/.test(own.headers.get('vary') || ''), [own.status, own.headers.get('access-control-allow-origin')]);
	for (const origin of ['https://evil.example', 'http://localhost:9999', 'null']) {
		const r = await get(`/api/projects/${pid}`, { cookie, origin });
		check(`unlisted origin ${origin} -> 403, no CORS headers, no data`, r.status === 403 && [...r.headers.keys()].every((k) => !k.startsWith('access-control-')) && leaks(r.text).length === 0 && noStore(r), [r.status]);
	}
	const pre = await fetch(`${APP}/api/projects/${pid}`, { method: 'OPTIONS', headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'GET' } });
	const preBad = await fetch(`${APP}/api/projects/${pid}`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
	check('preflight from the allowed origin -> 204 with GET, OPTIONS and credentials', pre.status === 204 && pre.headers.get('access-control-allow-methods') === 'GET, OPTIONS' && pre.headers.get('access-control-allow-credentials') === 'true', pre.status);
	check('preflight from another origin -> 403 with no CORS headers', preBad.status === 403 && [...preBad.headers.keys()].every((k) => !k.startsWith('access-control-')));
	for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) { const r = await fetch(`${APP}/api/projects/${pid}`, { method, headers: { Cookie: cookie }, body: method === 'DELETE' ? undefined : '{}' }); check(`${method} -> 405`, r.status === 405, r.status); }

	// ---- 6. subject filter
	const slug = (await (await fetch(`${WP}/wp-json/rvp/v1/projects?per_page=1`)).json()) && M.subject.toLowerCase();
	const sf = await get(`/api/projects/subject-filter?subjects=${encodeURIComponent(slug)}`, { cookie }); const sj = sf.status === 200 ? JSON.parse(sf.text) : {};
	check('subject-filter (member) -> 200 with ids only', sf.status === 200 && Array.isArray(sj.ids) && sj.ids.length >= 30 && sj.total === sj.ids.length && sj.truncated === false && sj.limit === 1000 && noStore(sf), [sf.status, sf.text.slice(0, 200)]);
	check('  ...includes the published marker projects, excludes draft/pending/private/scheduled/password', sj.ids?.includes(pid) && !Object.values(ids.unpublished).some((id) => sj.ids.includes(id)));
	check('  ...response holds no title, no subject name, no restricted marker', leaks(sf.text).length === 0 && !/RVPT/.test(sf.text) && Object.keys(sj).sort().join() === 'ids,limit,success,total,truncated');
	const none = await get('/api/projects/subject-filter?subjects=no-such-subject', { cookie }); check('unknown subject -> 200, empty ids', none.status === 200 && JSON.parse(none.text).ids.length === 0);
	for (const q of ['', '?subjects=', '?subjects=Physics', "?subjects=a'b", '?subjects=../x']) { const r = await get('/api/projects/subject-filter' + q, { cookie }); check(`subject-filter ${q || '(nothing)'} -> 400`, r.status === 400 && noStore(r), r.status); }

	// ---- 7. the catalogue include hook with the member's ids (what the page will do)
	const first = sj.ids?.slice(0, 5) || [];
	const cat = await (await fetch(`${WP}/wp-json/rvp/v1/projects?per_page=24&include=${first.join(',')}`)).json();
	check('public catalogue with include=<ids from the gate> returns exactly those public cards', cat.items?.length === first.length && cat.items.every((i) => first.includes(i.id)) && leaks(JSON.stringify(cat)).length === 0, cat.items?.length);

	// ---- 8. returnTo on the real pages (server-rendered). Only the rendered <a href> attributes are inspected: Next's RSC payload
	// legitimately echoes the requested URL, which is not a use of the value.
	const good = process.env.GOOD_RETURN_TO || 'http://localhost:8080/projects-test/?project=12';
	const anchors = (html) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
	const lp = await get('/login?returnTo=' + encodeURIComponent(good)); check('/login?returnTo=<valid>: the Sign up link carries it', lp.status === 200 && anchors(lp.text).includes('/join?returnTo=' + encodeURIComponent(good)), anchors(lp.text));
	const jp = await get('/join?returnTo=' + encodeURIComponent(good)); check('/join?returnTo=<valid>: the Sign in link carries it', jp.status === 200 && anchors(jp.text).includes('/login?returnTo=' + encodeURIComponent(good)), anchors(jp.text));
	for (const evil of ['//evil.com', 'https://evil.com/projects-test/?project=1', 'http://localhost:8080/other/?project=1', 'http://localhost:8080/projects-test/?project=abc', 'javascript:alert(1)', 'http://localhost:8080.evil.com/projects-test/?project=1']) {
		const a = await get('/login?returnTo=' + encodeURIComponent(evil)); const b = await get('/join?returnTo=' + encodeURIComponent(evil));
		const hrefs = [...anchors(a.text), ...anchors(b.text)];
		check(`hostile returnTo ${evil}: no link carries it, links stay /join and /login`, a.status === 200 && b.status === 200 && !hrefs.some((h) => /returnTo|evil/.test(h)) && hrefs.includes('/join') && hrefs.includes('/login'), hrefs);
	}
	const lpPlain = await get('/login'); const jpPlain = await get('/join');
	check('/login and /join without returnTo: links are exactly /join and /login', anchors(lpPlain.text).includes('/join') && anchors(jpPlain.text).includes('/login') && ![...anchors(lpPlain.text), ...anchors(jpPlain.text)].some((h) => /returnTo/.test(h)));
	const si = await fetch(APP + '/login?returnTo=' + encodeURIComponent(good), { redirect: 'manual', headers: { Cookie: cookie } });
	check('a signed-in member opening /login?returnTo=<valid> is redirected to exactly that address', [302, 303, 307, 308].includes(si.status) && si.headers.get('location') === good, [si.status, si.headers.get('location')]);
	const si2 = await fetch(APP + '/login?returnTo=' + encodeURIComponent('//evil.com'), { redirect: 'manual', headers: { Cookie: cookie } });
	check('...and with a hostile returnTo they go to SITE_URL instead', [302, 303, 307, 308].includes(si2.status) && si2.headers.get('location') === WP + '/', [si2.status, si2.headers.get('location')]);
	const si3 = await fetch(APP + '/login', { redirect: 'manual', headers: { Cookie: cookie } });
	check('...and with none, exactly as before: SITE_URL', [302, 303, 307, 308].includes(si3.status) && si3.headers.get('location') === WP + '/', [si3.status, si3.headers.get('location')]);

	// ---- 9. rate limit through the real server
	const ip = '198.51.100.77'; let blocked = 0, retry = null;
	for (let i = 0; i < 130; i++) { const r = await get(`/api/projects/${pid}`, { ip }); if (r.status === 429) { blocked++; retry = retry ?? r.headers.get('retry-after'); } }
	check('130 anonymous calls from one IP: the surplus gets 429 with Retry-After', blocked >= 8 && Number(retry) > 0, [blocked, retry]);
	console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
