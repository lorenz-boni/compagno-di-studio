// Prova del caso «la voce non si collega» (connessione interrotta senza motivo, es. codice 1006 da rete/VPN/browser):
// le risposte scritte funzionano, la Verifica avverte, le schede delle voci non dicono «non disponibile».
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8781);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };
  let setups = 0;
  await page.route('https://generativelanguage.googleapis.com/**', (route) => {
    if (!route.request().url().includes('GenerateContent')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [
        { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-native-audio-latest', supportedGenerationMethods: ['bidiGenerateContent'] },
        { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
      ] }) });
    }
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })}\n\n` });
  });
  // La connessione vocale si chiude subito, senza motivo (come quando una rete o un'estensione la blocca)
  await page.routeWebSocket(/BidiGenerateContent/, (ws) => { ws.onMessage(() => { setups++; ws.close(); }); });
  await page.goto('http://localhost:8781/');
  await page.click('#wz-next');
  await page.fill('#wz-key', 'AIzaOK');
  await page.click('#wz-check');
  await page.waitForFunction(() => !document.querySelector('#wz-key-status').textContent.includes('Verifico'), null, { timeout: 30000 });
  const msg = await page.textContent('#wz-key-status');
  ok(msg.includes('Chiave valida') && msg.includes('non riesce a collegarsi') && msg.includes('Chrome'), `verifica: «${msg.slice(0, 110)}…»`);
  ok(await page.$eval('#wz-key-status', (e) => e.classList.contains('warn-text')), 'mostrato come avviso (arancione)');
  await page.click('#wz-next');
  const before = setups;
  await page.click('#wz-voice-picker .vp-card:has-text("Il narratore") .vp-play');
  await page.waitForFunction(() => document.querySelector('#wz-voice-picker .vp-card.sel .vp-note'), null, { timeout: 30000 });
  const card = await page.textContent('#wz-voice-picker .vp-card.sel');
  ok(!card.includes('non disponibile') && card.includes('Non riesco a collegarmi alla voce di Google'), 'scheda: spiega che è un problema di connessione, non della voce');
  ok(setups - before === 1, `non prova inutilmente altri modelli (${setups - before} tentativo)`);
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
