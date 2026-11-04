// RoboValley Projects: Stage 2 over real HTTP (Node 22+, no dependencies). LOCAL TEST SITE ONLY.
// Fetches the public catalogue and every other public surface as an anonymous visitor and proves that no restricted marker
// (written by stage2-setup.php) appears anywhere. Usage:  node stage2-http.cjs <path to rvp-markers.json> [base url]
const fs = require('fs');
const markersFile = process.argv[2]; const BASE = (process.argv[3] || 'http://localhost:8080').replace(/\/$/, '');
if (!markersFile) { console.error('usage: node stage2-http.cjs <rvp-markers.json> [base]'); process.exit(2); }
const data = JSON.parse(fs.readFileSync(markersFile, 'utf8'));
const markers = Object.values(data.markers).concat(['zebra']);
const hiddenTitles = ['RVPT Hidden Draft', 'RVPT Hidden Pending', 'RVPT Hidden Private', 'RVPT Hidden Future', 'RVPT Hidden Password'];
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d) : '')); };
const get = async (path, headers = {}) => { const r = await fetch(BASE + path, { redirect: 'manual', headers }); return { status: r.status, headers: r.headers, body: await r.text() }; };
// A marker that is part of the requested URL itself (e.g. /?s=zebra) may be echoed back by WordPress's search page: a reflection, not a leak.
const leaks = (body, url = '') => { let u = url; try { u = decodeURIComponent(url).replace(/\+/g, ' '); } catch {} return markers.filter((m) => body.includes(m) && !u.includes(m)); };

(async () => {
	// pretty permalinks or ?rest_route=
	let API = '/wp-json/rvp/v1/projects'; let r = await get(API + '?per_page=3');
	if (r.status === 404) { API = '/index.php?rest_route=/rvp/v1/projects'; r = await get(API + '&per_page=3'); }
	const q = (extra) => API + (API.includes('?') ? '&' : '?') + extra;
	console.log('  endpoint:', API);
	check('catalogue answers 200 as an anonymous visitor', r.status === 200, r.status);
	const h = (x, k) => x.headers.get(k);
	check('Content-Type is JSON', /application\/json/.test(h(r, 'content-type') || ''), h(r, 'content-type'));
	check('Cache-Control: public, max-age=60, s-maxage=120', h(r, 'cache-control') === 'public, max-age=60, s-maxage=120', h(r, 'cache-control'));
	check('Vary does not include Cookie or Authorization', !/cookie|authorization/i.test(h(r, 'vary') || ''), h(r, 'vary'));
	check('no Set-Cookie on the public response', h(r, 'set-cookie') === null, h(r, 'set-cookie'));
	check('X-Robots-Tag: noindex', h(r, 'x-robots-tag') === 'noindex');
	check('X-WP-Total / X-WP-TotalPages present', /^\d+$/.test(h(r, 'x-wp-total') || '') && /^\d+$/.test(h(r, 'x-wp-totalpages') || ''));
	console.log('  --- response headers:'); for (const k of ['cache-control', 'vary', 'content-type', 'x-robots-tag', 'x-wp-total', 'x-wp-totalpages', 'access-control-allow-origin', 'link', 'content-encoding']) { if (h(r, k) !== null) console.log('    ' + k + ': ' + h(r, k)); }
	const body = JSON.parse(r.body);
	check('JSON shape: items / pagination / technologies', Array.isArray(body.items) && body.pagination && Array.isArray(body.technologies));
	check('3 items for per_page=3', body.items.length === 3);

	// every catalogue variant, grepped for markers
	const variants = ['per_page=24', 'per_page=24&page=2', 'search=zebra', 'search=RVPMARK', 'search=RVPT', 'view=featured', 'view=latest', 'technology=robotics', 'education=iti', 'difficulty=advanced',
		'subject=' + encodeURIComponent(data.markers.subject), 'subject[]=physics', 'include=' + data.ids.unpublished.draft, 'search=Hidden'];
	let bodies = r.body;
	for (const v of variants) { const x = await get(q(v)); bodies += x.body; check(`catalogue ?${v.slice(0, 50)} -> 200 and free of markers`, x.status === 200 && leaks(x.body, q(v)).length === 0, { status: x.status, leaks: leaks(x.body, q(v)) }); }
	check('no unpublished / password-protected title in any catalogue response', hiddenTitles.every((t) => !bodies.includes(t)));
	const subj = await get(q('per_page=24&subject=' + encodeURIComponent(data.markers.subject)));
	const base = await get(q('per_page=24'));
	check('?subject=<marker> is ignored: byte-identical body', subj.body === base.body);
	check('?subject=<marker> is not echoed in body or headers', !subj.body.includes(data.markers.subject) && ![...subj.headers.values()].join('|').includes(data.markers.subject));

	// invalid parameters over HTTP
	for (const [n, v] of [['per_page=0', 'per_page=0'], ['page=0', 'page=0'], ['view=x', 'view=x'], ['difficulty=x', 'difficulty=x']]) { const x = await get(q(v)); check(`invalid ${n} -> 400 JSON error`, x.status === 400 && /rest_invalid_param/.test(x.body), x.status); }
	const big = await get(q('per_page=500')); check('per_page=500 is capped at 24', JSON.parse(big.body).pagination.per_page === 24 && JSON.parse(big.body).items.length === 24);
	const post = await fetch(BASE + API, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: '{"title":"x"}' });
	check('POST to the catalogue is refused', post.status === 404 || post.status === 405, post.status);

	// CORS: only the site's own origin is echoed
	const evil = await get(q('per_page=1'), { Origin: 'http://evil.example' }); const own = await get(q('per_page=1'), { Origin: BASE });
	// WordPress core echoes the request Origin on every REST route (credentials allowed). That is core behaviour, not ours, and is
	// harmless here: the body is public and identical for every caller.
	console.log('  ACAO for a foreign origin (WordPress core behaviour):', evil.headers.get('access-control-allow-origin'), '| own origin:', own.headers.get('access-control-allow-origin'));
	check('response body is identical whatever the Origin (nothing caller-specific)', evil.body === own.body);

	// every other public surface
	const allIds = [...Object.values(data.ids.published), ...Object.values(data.ids.unpublished)];
	const surfaces = ['/', '/?s=RVPT', '/?s=RVPMARK', '/?s=zebra', '/?s=Hidden+Fields', '/feed/', '/?feed=rss2&post_type=rv_project', '/?post_type=rv_project', '/?rv_project=rvpt-hidden-fields-project',
		'/?taxonomy=rv_subject&term=' + encodeURIComponent(data.markers.subject.toLowerCase()), '/?rv_subject=' + encodeURIComponent(data.markers.subject.toLowerCase()), '/wp-sitemap.xml', '/wp-json/', '/wp-json/wp/v2/types', '/wp-json/wp/v2/taxonomies',
		'/wp-json/wp/v2/search?search=RVPT', '/wp-json/wp/v2/search?search=RVPMARK', '/wp-json/wp/v2/search?type=post&subtype=rv_project', '/wp-json/wp/v2/posts?search=RVPT', '/wp-json/wp/v2/pages?search=RVPT', '/wp-json/wp/v2/media?search=RVP',
		'/wp-json/wp/v2/rv_project', '/wp-json/wp/v2/rv_subject', '/wp-json/wp/v2/rv_technology', '/wp-json/wp/v2/rv_education', '/wp-json/wp/v2/users', '/wp-json/wp/v2/comments'];
	for (const id of allIds) { surfaces.push('/?p=' + id); surfaces.push('/?post_type=rv_project&p=' + id); surfaces.push('/wp-json/wp/v2/rv_project/' + id); surfaces.push('/wp-json/oembed/1.0/embed?url=' + encodeURIComponent(BASE + '/?p=' + id)); }
	const sm = await get('/wp-sitemap.xml'); const smUrls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
	for (const u of smUrls) { try { surfaces.push(new URL(u).pathname + new URL(u).search); } catch {} }
	let bad = [], statuses = {}, hits = [];
	for (const s of surfaces) { const x = await get(s); statuses[x.status] = (statuses[x.status] || 0) + 1; const l = leaks(x.body, s); const t = hiddenTitles.filter((t2) => x.body.includes(t2)); if (l.length || t.length) bad.push({ s, l, t }); if (/rv_project|RVPT/.test(x.body)) hits.push(s); }
	console.log(`  scanned ${surfaces.length} public URLs (status counts: ${JSON.stringify(statuses)}) incl. ${smUrls.length} sitemap URLs`);
	check('no marker or unpublished title on any scanned public URL', bad.length === 0, bad.slice(0, 5));
	check('sitemap lists no rv_project / rv_* URL', !smUrls.some((u) => /rv_|project/i.test(u)), smUrls.filter((u) => /rv_|project/i.test(u)));
	const types = JSON.parse((await get('/wp-json/wp/v2/types')).body); check('/wp/v2/types does not list rv_project', !('rv_project' in types));
	const taxes = JSON.parse((await get('/wp-json/wp/v2/taxonomies')).body); check('/wp/v2/taxonomies lists none of the rv_ taxonomies', !Object.keys(taxes).some((k) => k.startsWith('rv_')));
	const idxJson = JSON.parse((await get('/wp-json/')).body); const idxRoutes = Object.keys(idxJson.routes || {});
	check('REST index lists the rvp/v1 namespace with exactly our 2 routes and no rv_ route', idxJson.namespaces.includes('rvp/v1') && idxRoutes.filter((k) => k.startsWith('/rvp/')).length === 2 && !idxRoutes.some((k) => /rv_/.test(k)), idxRoutes.filter((k) => /rv/.test(k)));
	for (const id of Object.values(data.ids.unpublished)) { const x = await get('/?p=' + id); check(`/?p=${id} (unpublished project) is not served as a page`, x.status !== 200 || !/RVPT/.test(x.body), x.status); }
	const pubDirect = await get('/?p=' + data.ids.published.hidden_fields); check('published project has no public URL of its own (not 200 with its content)', !(pubDirect.status === 200 && /Hidden Fields Project/.test(pubDirect.body)), pubDirect.status);
	console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
