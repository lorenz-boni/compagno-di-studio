// Prova del caso «Google non concede il piano gratuito a questa chiave» (successo a un utente reale su Mac):
// la verifica della chiave e le schede delle voci devono spiegarlo in italiano, senza dire «Chiave valida».
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
const GOOGLE_MSG = 'The Gemini API free tier is not available for this project. To use the Gemini API, please set up billing to upgrade to the paid tier.';
(async () => {
  const srv = serve(process.argv[2] || '.', 8780);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    if (!route.request().url().includes('GenerateContent')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [
        { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-native-audio-latest', supportedGenerationMethods: ['bidiGenerateContent'] },
      ] }) });
    }
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, message: GOOGLE_MSG } }) });
  });
  await page.routeWebSocket(/BidiGenerateContent/, (ws) => {
    ws.onMessage((raw) => { if (JSON.parse(raw.toString()).setup) ws.close({ code: 1008, reason: GOOGLE_MSG.slice(0, 120) }); });
  });
  await page.goto('http://localhost:8780/');
  await page.click('#wz-next');
  await page.fill('#wz-key', 'AIzaBLOCCATA');
  await page.click('#wz-check');
  await page.waitForFunction(() => !document.querySelector('#wz-key-status').textContent.includes('Verifico'), null, { timeout: 30000 });
  const msg = await page.textContent('#wz-key-status');
  ok(!msg.includes('valida') && msg.includes('piano gratuito') && msg.includes('Gmail personale'), `verifica chiave: «${msg.slice(0, 90)}…»`);
  ok(await page.$eval('#wz-key-status', (e) => e.classList.contains('err-text')), 'messaggio mostrato come errore');
  await page.click('#wz-next');
  await page.click('#wz-voice-picker .vp-card:has-text("La voce calda") .vp-play');
  await page.waitForFunction(() => document.querySelector('#wz-voice-picker .vp-card.sel .vp-note'), null, { timeout: 30000 });
  const note = await page.textContent('#wz-voice-picker .vp-card.sel .vp-note');
  ok(note.includes('piano gratuito') && !note.includes('free tier'), `scheda della voce: «${note}»`);
  ok(!(await page.textContent('#wz-voice-picker .vp-card.sel')).includes('non disponibile'), 'la voce non viene segnata come «non disponibile» (non è colpa della voce)');
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
