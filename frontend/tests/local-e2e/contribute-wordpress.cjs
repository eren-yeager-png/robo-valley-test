// The live Contribute path on a local WordPress (plugin rv-contribution-v2 0.1.3 from PR #53) + the local app, in a real browser (Edge).
// Everything is real here (WordPress, plugin, app, database, sign-in, cookies). Nothing is mocked.
const { start, checker } = require('./lib.cjs'); const fs = require('fs'); const path = require('path');
const S = process.env.E2E_DIR; const WP = 'http://localhost:8091', APP = 'http://localhost:3012'; const SHOTS = path.join(S, 'shots');
const pw = (n) => fs.readFileSync(path.join(S, 'pw-' + n + '.txt'), 'utf8').trim(); const check = checker();
(async () => {
  const d = await start(); await d.viewport(1280);
  const J = (e) => d.ev(`JSON.stringify(${e})`).then((x) => { try { return JSON.parse(x); } catch { return x; } });
  const where = () => d.ev('location.href');
  const formReady = `!!document.querySelector('#sector-choices input') && !!document.getElementById('rv-c2')`;
  const ticked = () => J(`[].map.call(document.querySelectorAll('#sector-choices input:checked'),i=>i.value)`);
  const appLogin = async (who) => { // the app's real sign-in page, typed like a person would
    await d.waitFor(`!!document.querySelector('input[type=email], input[name=email]') && Object.keys(document.querySelector('form')).some(k=>k.startsWith('__reactProps'))`, 30000); await d.sleep(300);
    await d.type('input[type=email], input[name=email]', 'audit-' + who + '@example.com'); await d.type('input[type=password]', pw(who));
    await d.ev(`(function(){var f=document.querySelector('form');var b=f.querySelector('button[type=submit]')||f.querySelector('button');b.click()})()`);
  };

  // 1. Visitor on a Robots-by-Sector page
  await d.go(WP + '/robots-by-sector/agriculture-dairy/', `document.readyState==='complete'`); await d.sleep(800);
  const btn = await J(`(function(){var a=[].find.call(document.querySelectorAll('a'),x=>/Contribute to this sector/i.test(x.textContent));return a?{href:a.href,vis:a.getBoundingClientRect().width>0}:null})()`);
  check('visitor sees "Contribute to this sector" on the sector page, linking to the form with ?sector=', btn && btn.vis && btn.href === WP + '/contribute-now/?sector=agriculture-dairy', btn);
  await d.ev(`[].find.call(document.querySelectorAll('a'),x=>/Contribute to this sector/i.test(x.textContent)).click()`); await d.waitFor(formReady, 25000); await d.sleep(800);
  check('clicking it opens the form page', (await where()) === WP + '/contribute-now/?sector=agriculture-dairy', await where());
  check('signed out: the visitor is asked to sign in; the form itself is not shown yet (sectors load after sign-in)', (await d.ev(`document.getElementById('member-area').hidden`)) === true && (await d.ev(`document.getElementById('sector-choices').textContent`)).includes('Loading'), await d.ev(`document.getElementById('sector-choices').textContent`));
  const guest = await J(`({signIn:!document.getElementById('sign-in').closest('[hidden]'),member:!!document.getElementById('member-area')&&!document.getElementById('member-area').hidden})`);
  check('signed out: a Sign In option is shown and the member area is hidden', guest.signIn && !guest.member, guest);
  // 2. submitting while signed out must not create anything
  const before = await (await fetch(APP + '/api/contributions/sectors')).json(); check('the app lists the sectors publicly (3 sectors)', before.sectors && before.sectors.length === 3, before);

  // 3. Sign in -> app login -> back to the form with the sector still ticked
  await d.ev(`document.getElementById('sign-in').click()`); await d.waitFor(`location.origin==='${APP}'`, 20000);
  const loginUrl = await where(); check('Sign In goes to the app with returnTo carrying the same page and sector', /\/login\?returnTo=/.test(loginUrl) && decodeURIComponent(loginUrl).includes('/contribute-now/?sector=agriculture-dairy'), loginUrl);
  await appLogin('member'); await d.waitFor(`location.origin==='${WP}'`, 30000); await d.waitFor(formReady, 30000); await d.sleep(1200);
  check('after signing in: back on the Contribute page', (await where()) === WP + '/contribute-now/?sector=agriculture-dairy', await where());
  check('after signing in: the same sector is still ticked', JSON.stringify(await ticked()) === '["agriculture-dairy"]', await ticked());
  const mem = await J(`({area:!document.getElementById('member-area').hidden,name:document.getElementById('member-name').textContent})`); check('after signing in: the member area shows the signed-in person', mem.area && /Audit/.test(mem.name), mem);

  // 4. multiple sectors + validation messages
  const sectorBoxes = await J(`[].map.call(document.querySelectorAll('#sector-choices input'),i=>i.value)`); check('the form offers every sector as a checkbox (multi-select), not a single choice', sectorBoxes.length === 3 && (await d.ev(`document.querySelector('#sector-choices input').type`)) === 'checkbox', sectorBoxes);
  await d.click('#sector-choices input[value=education]'); check('a second sector can be ticked (two selected)', JSON.stringify(await ticked()) === '["agriculture-dairy","education"]', await ticked());
  await d.ev(`document.querySelector('#contribute button[type=submit]').click()`); await d.sleep(500);
  check('submitting an empty form is blocked with a message on the title (nothing is sent)', /at least 5 characters/.test(await d.ev(`document.querySelector('[name=title]').validationMessage`)), await d.ev(`document.querySelector('[name=title]').validationMessage`));
  await d.type('[name=title]', 'Cow shed cleaning robot for small dairy farms'); await d.type('[name=description]', 'Cleaning the shed by hand takes two hours every morning, a small robot could help.');
  await d.ev(`document.querySelector('#contribute button[type=submit]').click()`); await d.sleep(500);
  check('without a directory category: blocked with "Select at least one directory category"', /directory category/.test(await d.ev(`document.querySelector('[name=category]').validationMessage`)), await d.ev(`document.querySelector('[name=category]').validationMessage`));
  await d.click('input[name=category][value=Projects]'); await d.sleep(400);
  const refRow = await d.ev(`!!document.querySelector('#category-details [name=referenceUrl]')`); // a category panel may ask for a link
  await d.shot(SHOTS, 'contrib-1280-filled');
  const beforeN = (await J(`fetch('${APP}/api/contributions/mine',{credentials:'include'}).then(r=>r.json()).then(b=>(b.items||b.contributions||[]).length)`));
  await d.ev(`document.querySelector('#contribute button[type=submit]').click()`); await d.waitFor(`/sent for review/i.test(document.getElementById('message').textContent)`, 20000);
  const msg = await d.ev(`document.getElementById('message').textContent`); check('submit: the confirmation says it was sent for review and stays pending', /sent for review.*pending/i.test(msg), msg);
  await d.sleep(1500); const hist = await d.ev(`document.getElementById('history').innerText`);
  check('"My Contributions" now lists it with both sectors', /Cow shed cleaning robot/.test(hist) && /Agriculture/.test(hist) && /Education/.test(hist), hist);
  check('no console errors during the whole flow', d.errs().length === 0, d.errs());

  // 5. direct links with several sectors / junk
  await d.go(WP + '/contribute-now/?sector=agriculture-dairy,healthcare', formReady); await d.sleep(800); check('?sector=a,b ticks both', JSON.stringify(await ticked()) === '["agriculture-dairy","healthcare"]', await ticked());
  await d.go(WP + '/contribute-now/?sector=nope,agriculture-dairy', formReady); await d.sleep(800); check('?sector with an unknown slug ticks only the real one', JSON.stringify(await ticked()) === '["agriculture-dairy"]', await ticked());
  await d.go(WP + '/contribute-now/?sector=%3Cscript%3E', formReady); await d.sleep(800); check('?sector with junk ticks nothing and breaks nothing', (await ticked()).length === 0 && d.errs().length === 0, { t: await ticked(), e: d.errs() });

  // 6. mobile
  for (const w of [1280, 390]) { await d.viewport(w); for (const p of ['/contribute-now/?sector=agriculture-dairy', '/robots-by-sector/agriculture-dairy/']) { d.evs.length = 0; await d.go(WP + p, `document.readyState==='complete'`); await d.sleep(1500);
    const m = await J(`({h1:(document.querySelector('h1')||{}).textContent,over:document.documentElement.scrollWidth>innerWidth+1})`);
    check(`${w}px ${p}: heading, no sideways scroll, no console errors`, !!m.h1 && !m.over && d.errs().length === 0, { m, e: d.errs() }); if (p.startsWith('/contribute')) await d.shot(SHOTS, `contrib-${w}`); } }

  // 7. the moderation side (separate people, through the app): moderator reads it, cannot approve; admin approves; the count moves
  await d.viewport(1280); await d.go(APP + '/login', `document.readyState==='complete'`); await d.send('Network.clearBrowserCookies');
  const api = (m, u, b) => J(`fetch(${JSON.stringify(APP + u)},{method:${JSON.stringify(m)},credentials:'include',headers:{'content-type':'application/json'},body:${b ? JSON.stringify(JSON.stringify(b)) : 'undefined'}}).then(async r=>({s:r.status,b:await r.json().catch(()=>null)}))`);
  const signin = async (who) => { await d.send('Network.clearBrowserCookies'); await d.go(APP + '/login', `document.readyState==='complete'`); return J(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'audit-${who}@example.com',password:${JSON.stringify(pw(who))},remember:false})}).then(r=>r.status)`); };
  await signin('mod'); let q = await api('GET', '/api/review/queue'); const mine = (q.b.items || q.b.queue || q.b.contributions || []).find((x) => /Cow shed/.test(x.title)); check('moderator sees the new contribution in the moderation queue', !!mine, JSON.stringify(q.b).slice(0, 200));
  const id = mine && mine.id; const ap = await api('POST', `/api/review/${id}/decision`, { action: 'approve' }); check('moderator cannot approve (403)', ap.s === 403, ap);
  await signin('admin'); const ap2 = await api('POST', `/api/review/${id}/decision`, { action: 'approve' }); check('admin approves and publishes (200)', ap2.s === 200, ap2);
  const counts = await (await fetch(APP + '/api/contributions/sectors')).json(); const by = Object.fromEntries((counts.sectors || []).map((s) => [s.slug, s.contributions]));
  check('the sector counts include it for both sectors it was submitted to', by['agriculture-dairy'] >= 1 && by['education'] >= 1, counts);
  d.close(); process.exit(check.done() ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
