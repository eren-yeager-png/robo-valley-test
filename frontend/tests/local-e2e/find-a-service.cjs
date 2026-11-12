// Find a Service in a real browser (Edge) against local WordPress + the local app. Real: WordPress page, widget JS, app API, database.
// Mocked: OpenStreetMap Nominatim answers (canned). Not used at all: Google (the widget only builds outbound Google Maps links).
const { start, checker } = require('./lib.cjs'); const path = require('path'); const SHOTS = path.join(process.env.E2E_DIR, 'shots');
const URL_ = 'http://localhost:8091/find-a-service/'; const check = checker();
(async () => {
  const d = await start(); const nomi = []; let nomiMode = 'ok';
  d.hooks.push((x) => {
    if (x.method !== 'Fetch.requestPaused') return false;
    const { requestId, request } = x.params; const u = request.url;
    if (/nominatim/.test(u)) {
      nomi.push(u); const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }];
      if (nomiMode === 'down') d.send('Fetch.fulfillRequest', { requestId, responseCode: 503, responseHeaders: cors, body: Buffer.from('{}').toString('base64') });
      else { const pin = new URL(u).searchParams.get('postalcode'); const body = pin === '531111' && nomiMode === 'ok' ? [{ lat: '17.6910', lon: '83.0036', display_name: 'Anakapalli' }] : []; d.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: cors, body: Buffer.from(JSON.stringify(body)).toString('base64') }); }
      return true;
    }
    d.send('Fetch.continueRequest', { requestId }); return true;
  });
  await d.send('Fetch.enable', { patterns: [{ urlPattern: 'https://nominatim.openstreetmap.org/*' }] });
  const J = (e) => d.ev(`JSON.stringify(${e})`).then((x) => { try { return JSON.parse(x); } catch { return x; } });
  const cards = () => J(`[].map.call(document.querySelectorAll('#rv-fas-list .rv-fas-card'),c=>({n:c.querySelector('h3').textContent,d:((c.querySelector('.rv-fas-dist')||{}).textContent||'')}))`);
  const st = () => J(`({summary:document.getElementById('rv-fas-summary').textContent,state:(document.getElementById('rv-fas-state')||{}).innerText||'',alert:(document.getElementById('rv-fas-alert')||{}).innerText||'',locErr:(document.getElementById('rv-fas-loc-err')||{}).innerText||''})`);
  const pickService = async (name) => { await d.type('#rv-fas-service', name); await d.key('ArrowDown', 'ArrowDown', 40); await d.key('Enter', 'Enter', 13, '\r'); await d.sleep(250); };
  const idle = () => d.waitFor(`!/Searching|Looking up/.test(document.getElementById('rv-fas-summary').textContent) && !document.getElementById('rv-fas-state').classList.contains('rv-fas-state--loading')`, 20000);
  const search = async (loc) => { await d.type('#rv-fas-location', loc); await d.click('#rv-fas-go'); await d.sleep(300); await idle(); await d.sleep(500); };
  const fresh = async (w) => { d.evs.length = 0; await d.viewport(w); await d.go(URL_, `!!document.getElementById('rv-fas-list')`); await d.waitFor(`!!(window.RvFasState&&window.RvFasState.ready)`, 30000); await d.sleep(800); };
  const km = (s) => s === 'Same PIN code' ? 0 : s.endsWith(' m') ? parseFloat(s) / 1000 : parseFloat(s);
  const setRadius = (v) => d.ev(`(function(){var r=document.getElementById('rv-fas-radius');r.value='${v}';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()`);

  // ---- page health at both widths
  for (const w of [1280, 390]) {
    await fresh(w);
    const m = await J(`({h1:(document.querySelector('h1')||{}).textContent,over:document.documentElement.scrollWidth>innerWidth+1,sw:document.documentElement.scrollWidth})`);
    check(`${w}px: Find a Service has a heading and no sideways scroll`, !!m.h1 && !m.over, m);
    check(`${w}px: no console errors on load`, d.errs().length === 0, d.errs());
    if (w === 1280) { const s = await st(); check('initial state asks to choose a service and a place (no silent default)', /Choose a service and a place/.test(s.summary), s); }
  }
  // ---- keyword / category
  await fresh(1280);
  await d.type('#rv-fas-service', 'zzzz'); const none = await d.ev(`document.getElementById('rv-fas-listbox').innerText`);
  check('service keyword with no match: says so (empty state, no crash)', /no |not /i.test(none || ''), none);
  await d.type('#rv-fas-service', 'robot'); const lb = await d.ev(`document.getElementById('rv-fas-listbox').innerText`);
  check('service keyword "robot" offers Robotics Labs and Robotics Training Centres', /Robotics Labs/.test(lb) && /Robotics Training Centres/.test(lb), lb);
  await d.key('Escape', 'Escape', 27);
  await pickService('Robotics Labs'); await search('520010');
  let s = await st(); check('category with no uploaded data (Robotics Labs): "Coming Soon" instead of results', /Coming Soon/.test(s.summary), s);
  await pickService('ATL Labs'); check('category ATL Labs chosen from the list', (await d.ev(`document.getElementById('rv-fas-service').value`)) === 'ATL Labs');
  // ---- PIN search
  await search('520010'); let c = await cards(); s = await st();
  check('valid PIN 520010: "4 schools within 25 km of 520010"', /^4 schools within 25 km of 520010$/.test(s.summary), s);
  check('same-PIN schools (3, the duplicate row merged into one) come first as "Same PIN code", then the 4.4 km one', c.length === 4 && c.slice(0, 3).every((x) => x.d === 'Same PIN code') && c[3].d === '4.4 km' && new Set(c.map((x) => x.n)).size === 4, c);
  check('results are ordered nearest first', c.every((x, i) => i === 0 || km(x.d) >= km(c[i - 1].d)), c);
  const pins = await J(`[].map.call(document.querySelectorAll('#rv-fas-map .rv-fas-pin-wrap'),m=>m.getAttribute('aria-label'))`); check('map: one grouped pin for the 3 same-PIN schools + one for school 4 + a start marker', Array.isArray(pins) && pins.length === 2 && /3 schools in PIN code 520010/.test(pins[0]) && /^4. Municipal School Governorpet/.test(pins[1]) && (await d.ev(`!!document.querySelector('#rv-fas-map .rv-fas-origin-wrap')`)), pins);
  const dir = await d.ev(`(function(){var a=document.querySelector('#rv-fas-list .rv-fas-card a.rv-fas-dir-link');return a?a.href+' | '+a.target:'none'})()`);
  check('each result card has a Directions link (outbound Google Maps, opens in a new tab)', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=.*India \| _blank$/.test(dir), dir);
  await setRadius(1); await d.click('#rv-fas-go'); await d.sleep(300); await idle(); c = await cards();
  check('radius 1 km: only the schools in the PIN itself (3)', c.length === 3, c);
  await setRadius(25); await d.sleep(300); await idle();
  // invalid PINs
  for (const bad of ['12345', '1234567', '000000']) { await search(bad); s = await st(); check(`invalid PIN "${bad}": shows "Enter a 6-digit PIN code, district or state", sends no search (previous results stay)`, /Enter a 6-digit PIN code, district or state/.test(s.locErr) && /4 schools within 25 km/.test(s.summary), s); }
  await search(''); s = await st(); check('empty location: asks for a PIN code, district or state', /Enter a PIN code, district or state/.test(s.locErr), s);
  // PIN with no schools
  await search('599999'); s = await st(); c = await cards();
  check('valid-format PIN with no schools (599999): a clear empty state, no crash', c.length === 0 && /couldn.t find that place|No schools/.test(s.state + s.summary), s);
  // PIN with schools but no stored position: geocoder (mock)
  nomiMode = 'ok'; nomi.length = 0; await search('531111'); c = await cards(); s = await st();
  check('PIN with no stored position (531111): asks the geocoder once (mocked) and lists the school', nomi.length === 1 && /postalcode=531111/.test(nomi[0]) && /countrycodes=in/.test(nomi[0]) && c.length >= 1 && c[0].n === 'Anakapalli School', { nomi: nomi.length, c, s });
  nomiMode = 'empty'; await search('531111'); c = await cards(); s = await st();
  check('geocoder finds nothing: only the schools in that exact PIN, with an explanation', c.length === 1 && /could not find PIN code 531111 on the map/.test(s.alert), { c, s });
  nomiMode = 'down'; await search('531111'); c = await cards(); s = await st();
  check('geocoder down (503): still lists the PIN’s own schools and does not crash', c.length === 1 && d.errs().length === 0, { c, s, errs: d.errs() });
  // district / state text search
  await search('Guntur'); c = await cards(); s = await st(); check('district "Guntur": 2 schools', c.length === 2 && /2 schools in Guntur/.test(s.summary), { c, s });
  await search('guntur  '); c = await cards(); check('district search is case-insensitive and trims spaces', c.length === 2, c);
  await search('Andhra Pradesh'); c = await cards(); s = await st(); check('state "Andhra Pradesh": all 8 schools', c.length === 8, { c: c.length, s });
  await search('Atlantis'); s = await st(); c = await cards(); check('unknown place: "We couldn’t find that place" and a hint', c.length === 0 && /couldn.t find that place/.test(s.state), s);
  await search('<img src=x onerror=alert(1)>'); check('markup typed as a location is plain text (no element created, no console error)', (await d.ev(`document.querySelectorAll('img[src="x"]').length`)) === 0 && d.errs().length === 0, d.errs());
  // error state: the app is unreachable
  await d.ev(`window.__f=window.fetch;window.fetch=function(u,o){return String(u).indexOf('/api/services/search')>=0?Promise.reject(new TypeError('network')):window.__f(u,o)}`); await search('520010'); s = await st();
  check('error state: when the search service is unreachable, a friendly message with Try again', /not available right now/i.test(s.state) && /Try again/.test(s.state), s);
  await d.ev(`window.fetch=window.__f`);
  // ---- mobile
  await fresh(390); await pickService('ATL Labs'); await search('520010'); c = await cards();
  check('390px: PIN search works and lists 4 schools', c.length === 4, c);
  const over = await d.ev(`document.documentElement.scrollWidth>innerWidth+1`); check('390px: no sideways scroll with results shown', over === false, over);
  await d.shot(SHOTS, 'fas-390-results'); check('390px: no console errors during the run', d.errs().length === 0, d.errs());
  d.close(); process.exit(check.done() ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR', e); process.exit(2); });
