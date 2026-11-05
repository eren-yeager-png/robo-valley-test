// RoboValley Projects: Demo Content, leak scan with the demo projects installed (Node 22+, no dependencies). LOCAL TEST SITE ONLY.
// The markers are the restricted texts of the 20 demo projects themselves (overview, skills, components, outcome). None of them may appear
// anywhere a visitor can reach: the page, the catalogue (GET and POST), search, the REST index, sitemaps, feeds, direct URLs.
// Usage:  node rvpdc-leak-scan.cjs <rvpdc-dataset.json> [base url]
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const BASE = (process.argv[3] || 'http://localhost:8080').replace(/\/$/, '');
const ds = data.dataset; const markers = [];
for (const d of ds) markers.push(d.overview, d.outcome, ...d.skills, ...d.components);
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 240) : '')); };
const get = async (p, init) => { const r = await fetch(BASE + p, { redirect: 'manual', ...init }); return { status: r.status, headers: [...r.headers.entries()].map((h) => h.join(': ')).join('\n'), body: await r.text() }; };
const leaks = (r) => markers.filter((m) => (r.body + r.headers).includes(m) || (r.body + r.headers).includes(m.replace(/&/g, '&amp;')) || (r.body + r.headers).includes(JSON.stringify(m).slice(1, -1)));
(async () => {
  check(`${markers.length} restricted markers from 20 projects (overview, outcome, skills, components)`, markers.length > 150);
  const cat = await (await fetch(BASE + '/wp-json/rvp/v1/projects?per_page=24&view=all')).json(); const items = cat.items; const ids = items.map((i) => i.id);
  check('catalogue lists all 20 demo projects', items.length === 20 && cat.pagination.total === 20, [items.length, cat.pagination]);
  const keys = new Set(items.flatMap((i) => Object.keys(i)));
  check('catalogue items carry only public fields (no overview, skills, components, outcome, subject keys)', ![...keys].some((k) => /overview|skill|component|outcome|subject/i.test(k)), [...keys]);
  check('no catalogue item mentions "demo" in title or description', !items.some((i) => /demo/i.test(i.title + ' ' + i.short_description)));
  const urls = ['/projects/', `/projects/?project=${ids[0]}`, `/projects/?project=${ids[7]}`, '/projects/?rvp_q=robot', '/?s=Hold+a+DC+motor', '/?s=Soldering', '/feed/', '/wp-sitemap.xml', '/wp-sitemap-posts-rv_project-1.xml', '/wp-json/', '/wp-json/wp/v2/types', '/wp-json/wp/v2/search?search=Soldering', '/wp-json/wp/v2/search?search=encoder&type=post', '/wp-json/wp/v2/posts?search=PID', '/wp-json/wp/v2/pages', '/', '/find-a-service/', '/wp-json/rvp/v1/projects?view=featured&per_page=24', '/wp-json/rvp/v1/projects?view=latest&per_page=24', '/wp-json/rvp/v1/projects?per_page=24&search=robot', '/wp-json/rvp/v1/projects?per_page=24&subject=physics', '/wp-json/rvp/v1/projects?per_page=24&subject[]=physics&subject[]=chemistry', '/wp-json/rvp/v1/projects?per_page=24&include=' + ids.join(','), '/wp-json/rvp/v1/projects?per_page=24&technology=robotics&education=b-tech&difficulty=advanced'];
  for (const id of ids.slice(0, 5)) urls.push('/?p=' + id, '/?post_type=rv_project&p=' + id, '/?rv_project=' + id, '/wp-json/wp/v2/rv_project/' + id, '/wp-json/wp/v2/rv_project');
  for (const t of ['rv_subject=physics', 'rv_technology=robotics', 'taxonomy=rv_subject&term=physics', 'post_type=rv_project']) urls.push('/?' + t);
  urls.push('/wp-json/wp/v2/rv_subject', '/wp-json/wp/v2/rv_technology', '/wp-json/wp/v2/taxonomies');
  let bad = 0; for (const u of urls) { const r = await get(u); const l = leaks(r); if (l.length) { bad++; check(`${u}: no restricted text`, false, l.slice(0, 2)); } } check(`${urls.length} public URLs (page, deep links, catalogue variants, search, REST, sitemaps, feeds, direct project and term URLs): no restricted text anywhere`, bad === 0, bad);
  const post = await get('/wp-json/rvp/v1/projects/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ include: ids, per_page: 24, view: 'all' }) }); const pj = JSON.parse(post.body);
  check('POST /projects/query with all 20 ids returns the public cards only', post.status === 200 && pj.items.length === 20 && leaks(post).length === 0 && /no-store/.test(post.headers), [post.status, pj.items && pj.items.length]);
  const ovHits = []; for (const d of ds) { const r = await (await fetch(BASE + '/wp-json/rvp/v1/projects?per_page=24&search=' + encodeURIComponent(d.overview.slice(0, 40)))).json(); if (r.items.length) ovHits.push([d.key, r.items.length]); }
  check('search for the first 40 characters of every project overview (20 searches) finds nothing', ovHits.length === 0, ovHits.slice(0, 3));
  // Search is "every word must appear in the title, short description, technology or level name". A generic line such as "Microcontroller board"
  // can therefore match a project through its PUBLIC text. So the proof is: for every skill and component line (263 - 40 searches),
  // the result is exactly the set of projects whose public text contains all the words, so restricted text can never be the reason for a match.
  const pub = (d) => (d.title + ' ' + d.desc + ' ' + data.labels.rv_technology[d.tech] + ' ' + d.edu.map((e) => data.labels.rv_education[e]).join(' ')).toLowerCase();
  const wrong = []; let n = 0; for (const d of ds) { for (const line of [...d.skills, ...d.components]) { const words = line.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); if (!words.length) continue; const want = ds.filter((x) => words.every((w) => pub(x).includes(w))).map((x) => x.title).sort(); const r = await (await fetch(BASE + '/wp-json/rvp/v1/projects?per_page=24&search=' + encodeURIComponent(line))).json(); const got = r.items.map((i) => i.title).sort(); n++; if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push([line, got, want]); } }
  check(`search for every skill and component line (${n} searches) returns exactly the projects whose PUBLIC text matches, never one matched through restricted text`, wrong.length === 0 && n > 200, wrong.slice(0, 2));
  const page = await get('/projects/'); check('Projects page source has no subject names or subject checkboxes (members-only)', !/name="subject"/.test(page.body) && /id="rvp-subject-lock"/.test(page.body));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
