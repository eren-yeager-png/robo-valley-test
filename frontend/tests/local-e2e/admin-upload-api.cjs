// Real HTTP upload scenarios against the local app as the seeded admin (password from a file, never printed).
const fs = require('fs'), path = require('path'); const S = process.env.E2E_DIR; const APP = 'http://localhost:3012';
const pw = fs.readFileSync(path.join(S, 'au-pw-admin.txt'), 'utf8').trim();
let pass = 0, fail = 0; const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (!ok ? '  -> ' + JSON.stringify(d).slice(0, 400) : '')); };
let cookie = '';
const H = (extra = {}) => ({ Origin: APP, cookie, ...extra });
async function up(name, text, type = 'text/csv', category = 'atl-labs') {
  const f = new FormData(); f.append('file', new Blob([text], { type }), name); if (category) f.append('category', category);
  const r = await fetch(APP + '/api/services/upload', { method: 'POST', headers: H(), body: f }); return { s: r.status, b: await r.json().catch(() => null) };
}
const confirm = async (id) => { const r = await fetch(APP + '/api/services/upload/confirm', { method: 'POST', headers: H({ 'content-type': 'application/json' }), body: JSON.stringify({ datasetId: id }) }); return { s: r.status, b: await r.json().catch(() => null) }; };
(async () => {
  const lr = await fetch(APP + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', Origin: APP }, body: JSON.stringify({ email: 'audit-admin@example.com', password: pw, remember: false }) });
  cookie = lr.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); check('admin signs in', lr.status === 200 && /rv_session/.test(cookie), lr.status);
  const HEAD = 'School Name,State,District,Pincode,UDISE Code\n';
  // wrong columns / empty / not a spreadsheet / no category
  let r = await up('bad.csv', 'Name,Town\nA,B\n'); check('wrong columns: rejected, nothing staged', r.s >= 400 && r.s < 500 && r.b && r.b.success === false, r);
  r = await up('empty.csv', ''); check('empty file: rejected', r.s === 400 && r.b.success === false, r);
  r = await up('headonly.csv', HEAD); check('header only: rejected (422, no data rows)', r.s === 422 && r.b.success === false, r);
  r = await up('x.csv', HEAD + 'A,AP,NTR,520010,1\n', 'text/csv', ''); check('no category: rejected with "Choose which category"', r.s === 400 && /category/i.test(r.b.message), r);
  r = await up('x.csv', HEAD + 'A,AP,NTR,520010,1\n', 'text/csv', 'not-a-category'); check('unknown category: rejected', r.s === 400, r);
  r = await up('x.exe', 'MZ', 'application/octet-stream'); check('wrong file type: rejected', r.s >= 400 && r.s < 500, r);
  r = await up('big.csv', HEAD + 'A,AP,NTR,520010,1\n' + 'x'.repeat(4.2 * 1024 * 1024)); check('large file (4.2 MB): refused with a clear message', (r.s === 413 || r.s === 400) && r.b && /4 MB/.test(r.b.message || ''), r);
  // the seed dataset: duplicates + invalid PINs + a row with no school name
  const rows = [
    'ZPHS Benz Circle,Andhra Pradesh,NTR,520010,1001', 'ZPHS Benz Circle,Andhra Pradesh,NTR,520010,1001', 'Sri Sai School Benz Circle,Andhra Pradesh,NTR,520010,1002', 'Ravi Public School,Andhra Pradesh,NTR,520010,1003',
    'Municipal School Governorpet,Andhra Pradesh,NTR,520002,1004', 'Guntur ATL School,Andhra Pradesh,Guntur,522001,2001', 'Brodipet High School,Andhra Pradesh,Guntur,522002,2002',
    'Vizag Naval School,Andhra Pradesh,Visakhapatnam,530001,3001', 'Anakapalli School,Andhra Pradesh,Anakapalli,531111,3002',
    'Bad Pin School,Andhra Pradesh,Guntur,12345,4001', ',Andhra Pradesh,Guntur,522001,4002'];
  r = await up('schools.csv', HEAD + rows.join('\n') + '\n');
  check('valid file with problems: staged, 11 rows read, 1 duplicate merged, 2 invalid reported with row numbers', r.s === 200 && r.b.success && r.b.invalidRowCount === 2 && r.b.invalidRows.some((x) => /Pincode must be 6 digits/.test(x.reason)) && r.b.invalidRows.some((x) => /school name/i.test(x.reason)), r);
  console.log('   staged:', JSON.stringify({ rowCount: r.b.rowCount, invalid: r.b.invalidRowCount, dup: r.b.duplicatesSkipped }));
  const pub = await (await fetch(APP + '/api/services/search?pageSize=50')).json(); check('staged data is invisible until confirmed', pub.success && pub.total === 0, pub.total);
  const c = await confirm(r.b.datasetId); check('confirm makes it live', c.s === 200 && c.b.success, c);
  const s = await (await fetch(APP + '/api/services/search?pageSize=50')).json(); check('search now returns the 8 unique valid schools (duplicate merged, invalid rows left out)', s.total === 8, s.total);
  r = await up('schools.csv', HEAD + rows.join('\n') + '\n'); check('same file again: "identical, no changes"', r.s === 200 && r.b.unchanged === true, r);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
