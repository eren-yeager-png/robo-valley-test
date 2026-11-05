// RoboValley Projects: Demo Content, the admin page over real HTTP (Node 22+, no dependencies). LOCAL TEST SITE ONLY.
// Proves: only administrators see or use the page; nonce + confirmation step; install, re-install and remove through the real buttons.
// Needs: three throwaway users on the local site and a site with no projects.
// Env: WP (default http://localhost:8080), ADMIN_USER/ADMIN_PW, EDITOR_USER/EDITOR_PW, SUB_USER/SUB_PW
const WP = (process.env.WP || 'http://localhost:8080').replace(/\/$/, '');
const U = { admin: [process.env.ADMIN_USER, process.env.ADMIN_PW], editor: [process.env.EDITOR_USER, process.env.EDITOR_PW], sub: [process.env.SUB_USER, process.env.SUB_PW] };
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok && d !== undefined ? '  -> ' + JSON.stringify(d).slice(0, 240) : '')); };
const jarOf = (res, jar) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); } };
const cookie = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
async function req(jar, path, opt = {}) { const res = await fetch(WP + path, { redirect: 'manual', ...opt, headers: { Cookie: cookie(jar), ...(opt.headers || {}) } }); jarOf(res, jar); return { status: res.status, loc: res.headers.get('location'), text: await res.text() }; }
async function login(who) {
  const jar = { wordpress_test_cookie: 'WP Cookie check' };
  const r = await req(jar, '/wp-login.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ log: U[who][0], pwd: U[who][1], 'wp-submit': 'Log In', redirect_to: WP + '/wp-admin/', testcookie: '1' }) });
  if (r.status !== 302) throw new Error('login failed for ' + who + ' (' + r.status + ')');
  return jar;
}
const PAGE = '/wp-admin/edit.php?post_type=rv_project&page=rvpdc-demo-content';
const form = (html, action) => { const forms = html.split('<form').slice(1); for (const f of forms) { if (new RegExp(`name="rvpdc_do" value="${action}"`).test(f)) { const nonce = (f.match(/name="_wpnonce" value="([^"]+)"/) || [])[1]; const conf = /name="rvpdc_confirm"/.test(f); return { nonce, conf }; } } return null; };
const post = (jar, body) => req(jar, PAGE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const total = async () => (await (await fetch(WP + '/wp-json/rvp/v1/projects?per_page=1&view=all&_=' + Date.now())).json()).pagination.total;

(async () => {
  const visitor = {}; const admin = await login('admin'); const editor = await login('editor'); const sub = await login('sub');
  check('site starts with 0 projects', (await total()) === 0, await total());

  // ---- who can see it
  const v = await req(visitor, PAGE); check('visitor (not logged in) is sent to the login page, sees nothing', v.status === 302 && /wp-login\.php/.test(v.loc || '') && !/Demo content/.test(v.text), [v.status, v.loc]);
  const e = await req(editor, PAGE); check('editor gets "not allowed" (403) and none of the page', e.status === 403 && /not allowed/i.test(e.text) && !/Install demo projects/.test(e.text), e.status);
  const s = await req(sub, PAGE); check('subscriber does not get the page either', s.status !== 200 || !/Install demo projects/.test(s.text), s.status);
  const ep = await req(editor, '/wp-admin/edit.php?post_type=rv_project'); check('editor sees the Projects screen but no "Demo content" menu entry', ep.status === 200 && !/rvpdc-demo-content|Demo content/.test(ep.text), ep.status);
  const ed = await req(editor, '/wp-admin/index.php'); check('editor dashboard has no demo notice', ed.status === 200 && !/Remove it before real launch/.test(ed.text));
  const ePost = await post(editor, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: 'x' }); check('editor POSTing the confirm form directly is refused and creates nothing', ePost.status === 403 && (await total()) === 0, ePost.status);
  const vPost = await post(visitor, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: 'x' }); check('visitor POST is refused and creates nothing', vPost.status !== 200 && (await total()) === 0, vPost.status);

  // ---- admin page
  const a = await req(admin, PAGE); check('administrator sees the page, the two buttons and "0 demo project(s) currently installed"', a.status === 200 && /0 demo project\(s\) currently installed/.test(a.text) && /Install demo projects/.test(a.text) && /Remove demo projects/.test(a.text), a.status);
  const ap = await req(admin, '/wp-admin/edit.php?post_type=rv_project'); check('"Demo content" is in the Projects menu for the administrator', /page=rvpdc-demo-content/.test(ap.text));
  check('Remove is disabled while nothing is installed', /<input[^>]*value="Remove demo projects"[^>]*disabled/.test(a.text) || /<input[^>]*disabled[^>]*value="Remove demo projects"/.test(a.text));
  const ad0 = await req(admin, '/wp-admin/index.php'); check('no demo notice while nothing is installed', !/Remove it before real launch/.test(ad0.text));

  // ---- install: ask (nonce) -> confirmation screen -> confirm (nonce) -> done
  const f1 = form(a.text, 'install'); check('install form has a nonce and is the first step (no confirm flag)', f1 && f1.nonce && !f1.conf);
  const n1 = await post(admin, { rvpdc_do: 'install', _wpnonce: 'bad' }); check('step 1 with a bad nonce is refused (403) and shows no confirmation', n1.status === 403 && !/Yes, install/.test(n1.text), n1.status);
  const c1 = await post(admin, { rvpdc_do: 'install', _wpnonce: f1.nonce }); check('step 1 shows the confirmation screen and changes nothing', c1.status === 200 && /Install the demo projects\?/.test(c1.text) && /Yes, install the demo projects/.test(c1.text) && (await total()) === 0, c1.status);
  const f2 = form(c1.text, 'install'); check('confirmation form carries its own nonce and the confirm flag', f2 && f2.nonce && f2.conf && f2.nonce !== f1.nonce);
  const bad = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: 'bad' }); check('confirm with a bad nonce is refused and creates nothing', bad.status === 403 && (await total()) === 0, bad.status);
  const wrong = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: form((await post(admin, { rvpdc_do: 'remove', _wpnonce: form(a.text, 'remove').nonce })).text, 'remove').nonce }); check('a nonce made for "remove" cannot run "install"', wrong.status === 403 && (await total()) === 0, wrong.status);
  const skip = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: f1.nonce }); check('the step-1 nonce cannot be used to skip the confirmation step', skip.status === 403 && (await total()) === 0, skip.status);
  const run = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: f2.nonce }); check('confirmed install redirects (so a refresh cannot run it twice)', run.status === 302 && /rvpdc_done=1/.test(run.loc || ''), [run.status, run.loc]);
  let report = await req(admin, (run.loc || '').replace(WP, '')); let created = +(report.text.match(/Created (\d+) demo project/) || [0, 0])[1]; let images = +(report.text.match(/imported (\d+) image/) || [0, 0])[1]; let rounds = 1;
  while (/still waiting/.test(report.text) && rounds < 12) { const pg = await req(admin, PAGE); const k1 = await post(admin, { rvpdc_do: 'install', _wpnonce: form(pg.text, 'install').nonce }); const k2 = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: form(k1.text, 'install').nonce }); report = await req(admin, (k2.loc || '').replace(WP, '')); created += +(report.text.match(/Created (\d+) demo project/) || [0, 0])[1]; images += +(report.text.match(/imported (\d+) image/) || [0, 0])[1]; rounds++; }
  const done = await req(admin, PAGE);
  check(`install completes (${rounds} click(s) on a slow server; the report says "click Install again" when time runs out): 20 projects and 20 images created in total`, created === 20 && images === 20 && /20 demo project\(s\) currently installed/.test(done.text), { created, images, rounds });
  check('public catalogue now lists 20 projects', (await total()) === 20, await total());
  const again = await req(admin, (run.loc || '').replace(WP, '')); check('reloading the report address does not show it twice or run anything', !/Created \d+ demo project/.test(again.text) && (await total()) === 20);

  const adm = await req(admin, '/wp-admin/index.php'); check('administrator dashboard shows "Demo content is installed. Remove it before real launch."', /Demo content is installed\. Remove it before real launch\./.test(adm.text));
  const edn = await req(editor, '/wp-admin/index.php'); check('...but the editor does not see it', !/Remove it before real launch/.test(edn.text));
  const list = await req(admin, '/wp-admin/edit.php?post_type=rv_project'); check('All Projects shows a "Demo" badge on every demo row (20) and the "Demo content" state', (list.text.match(/>Demo<\/span>/g) || []).length >= 20 && /Demo content/.test(list.text), (list.text.match(/>Demo<\/span>/g) || []).length);
  const elist = await req(editor, '/wp-admin/edit.php?post_type=rv_project'); check('the editor sees the projects (20 rows) but no Demo badge or state', elist.status === 200 && /<tr id="post-/.test(elist.text) && !/>Demo<\/span>/.test(elist.text) && !/Demo content/.test(elist.text));

  // ---- re-install through the buttons: nothing new
  const ra = await req(admin, PAGE); const rf1 = form(ra.text, 'install'); const rc = await post(admin, { rvpdc_do: 'install', _wpnonce: rf1.nonce }); const rf2 = form(rc.text, 'install'); check('confirmation says 20 of 20 are installed and projects are not changed', /20 of 20 are installed now/.test(rc.text) && /not changed/.test(rc.text));
  const rr = await post(admin, { rvpdc_do: 'install', rvpdc_confirm: '1', _wpnonce: rf2.nonce }); const rd = await req(admin, (rr.loc || '').replace(WP, ''));
  check('re-install: "Created 0 demo project(s), imported 0 image(s), left 20 existing demo project(s) untouched" and still 20', /Created 0 demo project\(s\), imported 0 image\(s\), left 20 existing/.test(rd.text) && (await total()) === 20, rd.text.match(/Created[^<]*/));

  // ---- remove
  const ma = await req(admin, PAGE); const mf1 = form(ma.text, 'remove'); const mc = await post(admin, { rvpdc_do: 'remove', _wpnonce: mf1.nonce });
  check('remove confirmation warns it is permanent and names 20 projects and 20 images', /permanently deletes the 20 demo project\(s\) and the 20 demo image\(s\)/.test(mc.text) && /Projects and images you created yourself are not touched/.test(mc.text) && (await total()) === 20);
  const mf2 = form(mc.text, 'remove'); const mr = await post(admin, { rvpdc_do: 'remove', rvpdc_confirm: '1', _wpnonce: mf2.nonce }); const md = await req(admin, (mr.loc || '').replace(WP, ''));
  check('report: "Removed 20 demo project(s) and 20 demo image(s). Nothing else was touched."', /Removed 20 demo project\(s\) and 20 demo image\(s\)\. Nothing else was touched\./.test(md.text), md.text.match(/Removed[^<]*/));
  check('page now says 0 installed, public catalogue is empty, the notice is gone', /0 demo project\(s\) currently installed/.test(md.text) && (await total()) === 0 && !/Remove it before real launch/.test((await req(admin, '/wp-admin/index.php')).text));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
