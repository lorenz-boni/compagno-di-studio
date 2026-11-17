// Prova dell'interfaccia JARVIS: stati del nucleo, indicatore di connessione, pannelli, schede, smartphone.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8772);
  const shots = process.argv[3] || '.';
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) process.exitCode = 1; };

  // --- Desktop ---
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  let mode = 'slow';
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    if (mode === 'fail') return route.fulfill({ status: 503, body: JSON.stringify({ error: { message: 'high demand' } }) });
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Giusto, vai avanti.' }] } }] })}\n\n` });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', mute: true }));
    class FakeRec { start() { window.__rec = this; } stop() { this.onend && this.onend(); } }
    window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  });
  await page.goto('http://localhost:8772/');
  const core = () => page.evaluate(() => document.body.dataset.core);
  const conn = () => page.evaluate(() => `${document.querySelector('#conn').dataset.state}:${document.querySelector('#conn-label').textContent}`);
  ok(await core() === 'idle', `stato iniziale: idle (${await core()})`);
  ok((await conn()).startsWith('idle'), `connessione: ${await conn()}`);

  await page.click('#btn-mic');
  ok(await core() === 'listening', `microfono classico acceso: listening (${await core()})`);
  ok((await page.textContent('#btn-mic .lbl')) === 'Smetti di ascoltare', 'etichetta del microfono aggiornata');
  await page.click('#btn-mic');

  await page.fill('#text-input', 'il secondo principio');
  await page.press('#text-input', 'Enter');
  await page.waitForTimeout(300);
  ok(await core() === 'processing', `in attesa della risposta: processing (${await core()})`);
  ok((await conn()).startsWith('active'), `connessione durante l'elaborazione: ${await conn()}`);
  await page.screenshot({ path: `${shots}/ui-processing.png` });
  await page.waitForSelector('.bubble.bot >> text=Giusto');
  await page.waitForTimeout(200);
  ok(await core() === 'paused', `conversazione ferma: paused (${await core()})`);
  ok((await page.textContent('#ctx-turns')) === '1', 'pannello contesto: 1 intervento');

  mode = 'fail';
  await page.fill('#text-input', 'altra frase');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.error', { timeout: 10000 });
  ok(await core() === 'error', `errore: error (${await core()})`);
  await page.screenshot({ path: `${shots}/ui-error.png` });

  // Pannelli e full immersion
  await page.click('#btn-toggle-library');
  ok(await page.evaluate(() => document.body.classList.contains('no-library')), 'libreria comprimibile');
  await page.click('#btn-toggle-library');
  await page.click('#btn-focus');
  ok(await page.evaluate(() => document.body.classList.contains('no-library') && document.body.classList.contains('no-context')), 'full immersion nasconde entrambi i pannelli');
  await page.screenshot({ path: `${shots}/ui-focus.png` });
  await page.click('#btn-focus');
  ok(await page.isVisible('#library') && await page.isVisible('#context-panel'), 'full immersion disattivata: pannelli di nuovo visibili');
  await page.click('#tab-history');
  ok(await page.isVisible('#session-list') && !(await page.isVisible('#pane-context')), 'scheda Cronologia');
  await page.click('#tab-context');
  ok(await page.isVisible('#pane-context'), 'scheda Contesto');

  // --- Smartphone ---
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on('pageerror', (e) => errors.push(e.message));
  await phone.addInitScript(() => localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', mute: true })));
  await phone.goto('http://localhost:8772/');
  ok(!(await phone.isVisible('#library')) && !(await phone.isVisible('#context-panel')), 'smartphone: pannelli chiusi all\'avvio');
  ok(await phone.isVisible('#btn-live') && await phone.isVisible('#core'), 'smartphone: nucleo e "Parla con JARVIS" visibili');
  const scroll = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(scroll <= 0, `smartphone: nessuno scorrimento orizzontale (${scroll}px)`);
  await phone.click('#btn-toggle-library');
  ok(await phone.isVisible('#library') && await phone.isVisible('#scrim'), 'smartphone: libreria apribile come pannello');
  await phone.screenshot({ path: `${shots}/ui-phone-library.png` });
  await phone.click('#scrim', { position: { x: 370, y: 400 } });
  ok(!(await phone.isVisible('#library')), 'smartphone: tocco fuori chiude il pannello');
  await phone.click('#btn-toggle-sessions');
  ok(await phone.isVisible('#context-panel'), 'smartphone: contesto apribile');
  await phone.screenshot({ path: `${shots}/ui-phone-context.png` });

  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
