const { start, checker } = require('./lib.cjs'); const check = checker(); const APP = 'http://localhost:3012';
(async () => { const d = await start(); await d.viewport(1280);
  for (const p of ['/login']) {
    await d.go(APP + p, `!!document.querySelector('input[type=password]')`); await d.sleep(1500);
    await d.send('Emulation.setScriptExecutionDisabled', { value: true }); // = the page clicked before its JavaScript attached
    await d.ev(`1`); // (evaluation still works through CDP)
    await d.send('Runtime.evaluate', { expression: `(function(){document.querySelector('input[type=email]').value='nobody@example.com';document.querySelector('input[type=password]').value='NotARealPassword-123';document.querySelector('form').submit()})()` });
    await d.sleep(2500); const url = await d.ev('location.href');
    check(`${p}: a submit that bypasses the page script does not put the e-mail or password in the address`, !/password|NotARealPassword|nobody%40|nobody@/i.test(url), url);
  }
  d.close(); process.exit(check.done() ? 1 : 0); })().catch((e) => { console.error(e); process.exit(2); });
