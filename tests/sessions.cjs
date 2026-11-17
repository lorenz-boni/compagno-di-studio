// Prova del pannello Conversazioni: due conversazioni, ripresa della prima con la sua cronologia.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8770);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bodies = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    bodies.push(body);
    const last = body.contents[body.contents.length - 1].parts.map((p) => p.text).join(' ');
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: `Risposta a: ${last}` }] } }] })}\n\n` });
  });
  await page.addInitScript(() => localStorage.setItem('compagno.settings', JSON.stringify({ key: 'TEST', mute: true })));
  await page.goto('http://localhost:8770/');
  const say = async (t) => { await page.fill('#text-input', t); await page.press('#text-input', 'Enter'); await page.waitForSelector(`.bubble.bot >> text=Risposta a: ${t}`); };
  // conversazione 1 su appunti incollati
  await page.click('#btn-paste');
  await page.fill('#paste-title', 'Idrologia');
  await page.fill('#paste-text', 'Bilancio idrologico: P = E + R.');
  await page.click('#dlg-paste button[value=ok]');
  await say('il bilancio è P uguale E più R');
  await page.waitForSelector('.session-item');
  // conversazione 2
  await page.click('#btn-new-session');
  await page.click('#btn-clear-note');
  await say('parliamo di metodi numerici');
  await page.waitForFunction(() => document.querySelectorAll('.session-item').length === 2);
  console.log('pannello:', await page.$$eval('.session-group', (g) => g.map((x) => `${x.querySelector('h3').textContent}: ${[...x.querySelectorAll('.s-title')].map((t) => t.textContent).join(', ')}`)));
  // riprendi la prima
  await page.click('.session-item:has-text("Idrologia")');
  await page.waitForSelector('.bubble.info >> text=Ripresa');
  console.log('bolle ripristinate:', await page.$$eval('#log .bubble.user, #log .bubble.bot', (b) => b.map((x) => x.textContent)));
  console.log('appunti ripristinati:', await page.textContent('#current-title'));
  await say('e quindi l\'evaporazione');
  const lastBody = bodies[bodies.length - 1];
  console.log('cronologia inviata dopo la ripresa:', lastBody.contents.map((c) => `${c.role}: ${c.parts.map((p) => p.text).join(' ').slice(0, 40)}`));
  // ricarica: le conversazioni restano
  await page.reload();
  await page.waitForSelector('.session-item');
  console.log('dopo ricarica:', await page.$$eval('.s-title', (t) => t.map((x) => x.textContent)));
  await page.screenshot({ path: process.argv[3] || 'sessions.png' });
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
