// Continues contribute-wordpress.cjs: the contribution submitted from WordPress is reviewed through the app by a moderator, then an admin.
const { start, checker } = require('./lib.cjs'); const fs = require('fs'); const path = require('path'); const S = process.env.E2E_DIR; const APP = 'http://localhost:3012';
const pw = (n) => fs.readFileSync(path.join(S, 'pw-' + n + '.txt'), 'utf8').trim(); const check = checker();
(async () => {
  const d = await start(); await d.viewport(1280);
  const jv = async (expr) => JSON.parse(await d.ev(`(${expr}).then(x=>JSON.stringify(x))`));
  const api = (m, u, b) => jv(`fetch(${JSON.stringify(u)},{method:${JSON.stringify(m)},credentials:'include',headers:{'content-type':'application/json'},body:${b ? JSON.stringify(JSON.stringify(b)) : 'undefined'}}).then(async r=>({s:r.status,b:await r.json().catch(()=>null)}))`);
  const signin = async (who) => { await d.send('Network.clearBrowserCookies'); await d.go(APP + '/login', `document.readyState==='complete'`);
    return jv(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'audit-${who}@example.com',password:${JSON.stringify(pw(who))},remember:false})}).then(r=>r.status)`); };
  const counts = async () => Object.fromEntries(((await (await fetch(APP + '/api/contributions/sectors')).json()).sectors).map((s) => [s.slug, s.contributions]));
  check('before approval the public sector counts are 0 for both sectors', (await counts())['agriculture-dairy'] === 0 && (await counts()).education === 0, await counts());
  check('moderator signs in', (await signin('mod')) === 200);
  const q = await api('GET', '/api/review/queue'); const items = q.b.items || q.b.queue || q.b.contributions || q.b.data || [];
  const mine = items.find((x) => /Cow shed/.test(x.title)); check('the contribution submitted from WordPress is in the moderation queue (pending review)', !!mine, JSON.stringify(q.b).slice(0, 300));
  const id = mine && mine.id; const det = await api('GET', `/api/review/${id}`);
  check('moderator opens it and sees both sectors it was submitted to', det.s === 200 && JSON.stringify(det.b).includes('Education') && JSON.stringify(det.b).includes('Agriculture'), det.s);
  const ap = await api('POST', `/api/review/${id}/decision`, { action: 'approve' }); check('moderator cannot approve (403)', ap.s === 403, ap);
  const vf = await api('POST', `/api/review/${id}/decision`, { action: 'verify' }); check('moderator can verify (200)', vf.s === 200, vf);
  check('verifying does not publish: counts still 0', (await counts())['agriculture-dairy'] === 0);
  check('admin signs in', (await signin('admin')) === 200);
  const ap2 = await api('POST', `/api/review/${id}/decision`, { action: 'approve' }); check('admin approves and publishes (200)', ap2.s === 200, ap2);
  const c = await counts(); check('after approval each of the two sectors counts it once; the third sector stays 0', c['agriculture-dairy'] === 1 && c.education === 1 && c.healthcare === 0, c);
  d.close(); process.exit(check.done() ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
