// RoboValley Projects: Stage 3 bridge over real HTTP (Node 22+, no dependencies). LOCAL TEST SITE ONLY.
// Usage:  RVP_BRIDGE_SECRET=<secret> node rvprojects-bridge-http-test.cjs <rvp-markers.json> [normal|disabled] [base url]
//   normal    the constant is set (>= 32 chars): proves the wire-level behaviour, above all that no Access-Control-* header is sent
//   disabled  the constant is missing or too short: every request must be 503
const fs = require('fs'); const crypto = require('crypto');
const [markersFile, mode = 'normal', baseArg] = process.argv.slice(2); const BASE = (baseArg || 'http://localhost:8080').replace(/\/$/, '');
if (!markersFile) { console.error('usage: node rvprojects-bridge-http-test.cjs <rvp-markers.json> [normal|disabled] [base]'); process.exit(2); }
const SECRET = process.env.RVP_BRIDGE_SECRET || crypto.randomBytes(32).toString('hex');
const data = JSON.parse(fs.readFileSync(markersFile, 'utf8')); const hid = data.ids.published.hidden_fields;
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sign = (method, route, query, ts, nonce, secret = SECRET) => {
	const q = Object.keys(query).sort().map((k) => rfc3986(k) + '=' + rfc3986(query[k])).join('&');
	return crypto.createHmac('sha256', secret).update(['RVP1', method, route, ts, nonce, crypto.createHash('sha256').update(q).digest('hex')].join('\n')).digest('hex');
};
let API = '/wp-json';
const call = async (route, query = {}, o = {}) => {
	const ts = o.ts ?? String(Math.floor(Date.now() / 1000)); const nonce = o.nonce ?? crypto.randomBytes(12).toString('hex');
	const headers = { ...(o.origin !== undefined ? { Origin: o.origin } : {}) };
	if (o.signed !== false) { headers['X-RVP-Timestamp'] = ts; headers['X-RVP-Nonce'] = nonce; headers['X-RVP-Signature'] = o.sig ?? sign(o.signMethod || o.method || 'GET', route, query, ts, nonce, o.secret); }
	const qs = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
	const url = API.startsWith('/index.php') ? `${BASE}/index.php?rest_route=${route}${qs ? '&' + qs.slice(1) : ''}` : BASE + API + route + qs;
	const r = await fetch(url, { method: o.method || 'GET', headers, redirect: 'manual' });
	return { status: r.status, headers: r.headers, body: await r.text(), nonce, ts };
};
const cors = (r) => [...r.headers.keys()].filter((k) => /^access-control-/i.test(k));
const P = (id) => `/rvp-bridge/v1/project/${id}`;

(async () => {
	if ((await fetch(BASE + '/wp-json/').catch(() => ({ status: 0 }))).status === 404) API = '/index.php?rest_route=';
	console.log(`  mode: ${mode}, secret length ${SECRET.length}`);

	if (mode === 'disabled') {
		const a = await call(P(hid)); const b = await call('/rvp-bridge/v1/subject-ids', { subjects: 'physics' }); const c = await call(P(hid), {}, { signed: false });
		check('correctly signed project request -> 503 (bridge is off)', a.status === 503, a.status);
		check('correctly signed subject request -> 503', b.status === 503, b.status);
		check('unsigned request -> 503 as well (never falls back to open)', c.status === 503, c.status);
		check('503 body is generic and holds no project data', /Unavailable\./.test(a.body) && !/RVPMARK|overview|skills/.test(a.body + b.body + c.body), a.body);
		check('503 response is not cacheable', a.headers.get('cache-control') === 'no-store, private', a.headers.get('cache-control'));
		check('503 response has no Access-Control-* header (with an Origin)', cors(await call(P(hid), {}, { origin: 'https://evil.example' })).length === 0);
		console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
	}

	const ok = await call(P(hid));
	check('signed GET -> 200', ok.status === 200, ok.status);
	const j = ok.status === 200 ? JSON.parse(ok.body) : {};
	check('restricted fields present for a valid caller', j.overview === data.markers.overview && j.outcome === data.markers.outcome && j.subjects?.[0]?.name === data.markers.subject);
	console.log('  --- bridge response headers:'); for (const [k, v] of ok.headers) { if (!/^(date|server|keep-alive|connection|content-length|transfer-encoding|x-powered-by)$/i.test(k)) console.log('    ' + k + ': ' + v); }
	check('Cache-Control: no-store, private', ok.headers.get('cache-control') === 'no-store, private', ok.headers.get('cache-control'));
	check('Pragma: no-cache, X-Robots-Tag noindex, X-LiteSpeed-Cache-Control: no-cache', ok.headers.get('pragma') === 'no-cache' && /noindex/.test(ok.headers.get('x-robots-tag') || '') && ok.headers.get('x-litespeed-cache-control') === 'no-cache');
	check('no Vary header', ok.headers.get('vary') === null, ok.headers.get('vary'));
	check('no Set-Cookie header', ok.headers.get('set-cookie') === null);
	check('no Access-Control-* header on a normal server call', cors(ok).length === 0, cors(ok));
	check('the secret is not in the body or any header', !ok.body.includes(SECRET) && ![...ok.headers.values()].some((v) => v.includes(SECRET)));

	// browsers: Origin present => refused, and WordPress core must not add its CORS headers either
	for (const origin of ['https://evil.example', BASE, 'null']) {
		const r = await call(P(hid), {}, { origin });
		check(`valid signature + Origin: ${origin} -> 403`, r.status === 403, r.status);
		check(`  ...with NO Access-Control-* header at all (core would have echoed the Origin)`, cors(r).length === 0, cors(r));
		check(`  ...and no restricted data`, !/RVPMARK|zebra/.test(r.body));
	}
	// the same request on a public catalogue route DOES get core's CORS header: proves the check above can fail
	const control = await fetch(`${BASE}${API.startsWith('/index.php') ? '/index.php?rest_route=/rvp/v1/projects&per_page=1' : '/wp-json/rvp/v1/projects?per_page=1'}`, { headers: { Origin: 'https://evil.example' } });
	check('control: core DOES send Access-Control-Allow-Origin on a non-bridge route (so the absence above is meaningful)', control.headers.get('access-control-allow-origin') === 'https://evil.example', control.headers.get('access-control-allow-origin'));
	// preflight
	const pre = await fetch(BASE + API + P(hid), { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-rvp-signature' }, redirect: 'manual' });
	check('OPTIONS preflight from a browser origin gets no Access-Control-* header', cors({ headers: pre.headers }).length === 0, cors({ headers: pre.headers }));

	// failures over the wire
	const fails = {
		'no headers': await call(P(hid), {}, { signed: false }),
		'bad signature': await call(P(hid), {}, { sig: 'a'.repeat(64) }),
		'wrong secret': await call(P(hid), {}, { secret: 'k'.repeat(40) }),
		'expired (-65 s)': await call(P(hid), {}, { ts: String(Math.floor(Date.now() / 1000) - 65) }),
		'future (+65 s)': await call(P(hid), {}, { ts: String(Math.floor(Date.now() / 1000) + 65) }),
		'signed for another id': await call(P(hid), {}, { sig: sign('GET', P(hid + 1), {}, String(Math.floor(Date.now() / 1000)), 'n'.repeat(24)), nonce: 'n'.repeat(24) }),
		'tampered query': await call('/rvp-bridge/v1/subject-ids', { subjects: 'physics' }, { sig: sign('GET', '/rvp-bridge/v1/subject-ids', { subjects: 'chemistry' }, String(Math.floor(Date.now() / 1000)), 'm'.repeat(24)), nonce: 'm'.repeat(24) }),
	};
	for (const [n, r] of Object.entries(fails)) check(`${n} -> 401`, r.status === 401, r.status);
	check('all 401 bodies identical and generic', new Set(Object.values(fails).map((r) => r.body)).size === 1 && /Denied\./.test(fails['no headers'].body), fails['no headers'].body);
	check('401 responses are no-store and carry no CORS header', Object.values(fails).every((r) => r.headers.get('cache-control') === 'no-store, private' && cors(r).length === 0));
	const once = await call(P(hid)); const replay = await call(P(hid), {}, { nonce: once.nonce, ts: once.ts, sig: undefined });
	check('first use of a nonce -> 200, replay -> 401 over HTTP', once.status === 200 && replay.status === 401, [once.status, replay.status]);
	const post = await call(P(hid), {}, { method: 'POST' });
	check('POST is refused (404/405)', post.status === 404 || post.status === 405, post.status);
	const unpub = await Promise.all(Object.values(data.ids.unpublished).map((id) => call(P(id))));
	check('draft / pending / private / future / password-protected -> 404, identical generic body', unpub.every((r) => r.status === 404) && new Set(unpub.map((r) => r.body)).size === 1 && !/RVPT|RVPMARK/.test(unpub[0].body), unpub.map((r) => r.status));
	const sid = await call('/rvp-bridge/v1/subject-ids', { subjects: 'x' }); check('subject-ids with an unknown subject -> 200, empty', sid.status === 200 && JSON.parse(sid.body).ids.length === 0);
	console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
