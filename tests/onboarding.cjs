// Prova della presentazione al primo avvio: percorso di studi, verifica della chiave, tono e voce
// (con anteprima su un finto Gemini Live), salvataggio; alla riapertura non ricompare.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8776);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) process.exitCode = 1; };
  const bodies = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url();
    if (!url.includes(':streamGenerateContent')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [
        { name: 'models/gemini-flash-lite-latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-native-audio-latest', supportedGenerationMethods: ['bidiGenerateContent'] },
      ] }) });
    }
    const body = JSON.parse(route.request().postData());
    if (body.generationConfig?.responseMimeType === 'application/json') {
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"argomento":"","acquisiti":[],"da_consolidare":[],"errori":[]}' }] } }] })}\n\n` });
    }
    bodies.push(body);
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ciao Giulia, partiamo!' }] } }] })}\n\n` });
  });
  const previews = [];
  await page.routeWebSocket(/BidiGenerateContent/, (ws) => {
    const send = (o) => ws.send(Buffer.from(JSON.stringify(o)));
    ws.onMessage((raw) => {
      const m = JSON.parse(raw.toString());
      if (m.setup) { previews.push(m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName); send({ setupComplete: {} }); }
      if (m.clientContent) {
        send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(4800).toString('base64') } }] } } });
        send({ serverContent: { turnComplete: true } });
      }
    });
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('primo')) { localStorage.clear(); sessionStorage.setItem('primo', '1'); }
  });
  await page.goto('http://localhost:8776/');
  ok(await page.isVisible('#dlg-welcome'), 'al primo avvio si apre la presentazione');
  await page.screenshot({ path: `${process.argv[3] || '.'}/onboarding-1.png` });

  // 1. Percorso di studi
  await page.fill('#wz-name', 'Giulia');
  await page.fill('#wz-university', 'Università di Bologna');
  await page.fill('#wz-degree', 'Biotecnologie');
  await page.fill('#wz-year', '2° anno');
  await page.click('#wz-next');
  // 2. Chiave
  await page.fill('#wz-key', 'AIzaTEST');
  await page.click('#wz-check');
  await page.waitForFunction(() => document.querySelector('#wz-key-status').textContent.includes('valida'));
  ok((await page.textContent('#wz-key-status')).includes('voce dal vivo è disponibile'), `verifica chiave: ${await page.textContent('#wz-key-status')}`);
  await page.click('#wz-next');
  // 3. Tono e voce
  ok(await page.isChecked('input[name="wz-tone"][value="confidenziale"]'), 'tono predefinito: confidenziale');
  ok((await page.inputValue('#wz-voice')) === 'Achird', 'voce predefinita: Achird (amichevole)');
  ok((await page.$$eval('#wz-voice option', (o) => o.length)) === 30, '30 voci tra cui scegliere');
  await page.selectOption('#wz-voice', 'Sulafat');
  await page.click('#wz-listen');
  await page.waitForFunction(() => document.querySelector('#wz-voice-status').textContent.includes('Ti piace'), null, { timeout: 10000 });
  ok(previews.includes('Sulafat'), `anteprima con la voce scelta (${previews.join(', ')})`);
  await page.screenshot({ path: `${process.argv[3] || '.'}/onboarding-3.png` });
  await page.click('#wz-next');
  // 4. Appunti: saltato
  ok((await page.textContent('#wz-next')) === 'Inizia a studiare', 'ultimo passo');
  await page.click('#wz-next');
  ok(!(await page.isVisible('#dlg-welcome')), 'presentazione chiusa');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('compagno.settings')));
  ok(st.onboarded && st.profile.name === 'Giulia' && st.profile.university === 'Università di Bologna' && st.key === 'AIzaTEST' && st.liveVoice === 'Sulafat' && st.tone === 'confidenziale', 'impostazioni salvate');

  // Il prompt di JARVIS contiene nome, percorso e tono
  await page.fill('#text-input', 'ciao');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.bot >> text=partiamo');
  const sys = bodies[bodies.length - 1].systemInstruction.parts[0].text;
  ok(sys.includes('TONO: confidenziale') && sys.includes('"Giulia"') && sys.includes('Biotecnologie'), 'tono, nome e corso nel prompt');

  // Riapertura: niente presentazione; si può rivedere dalle impostazioni
  await page.reload();
  await page.waitForTimeout(400);
  ok(!(await page.isVisible('#dlg-welcome')), 'alla riapertura la presentazione non ricompare');
  await page.click('#btn-settings');
  ok((await page.inputValue('#set-name')) === 'Giulia' && (await page.inputValue('#set-tone')) === 'confidenziale', 'nome e tono nelle impostazioni');
  await page.selectOption('#set-tone', 'professionale');
  await page.click('#dlg-settings button[value=ok]');
  await page.waitForTimeout(300);
  await page.fill('#text-input', 'riprendiamo');
  await page.press('#text-input', 'Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.bubble.bot').length >= 1, 1);
  await page.waitForTimeout(300);
  ok(bodies[bodies.length - 1].systemInstruction.parts[0].text.includes('TONO: da tutor universitario'), 'cambio di tono applicato');
  await page.click('#btn-settings');
  await page.click('#btn-welcome');
  ok(await page.isVisible('#dlg-welcome') && (await page.inputValue('#wz-name')) === 'Giulia', 'presentazione rivedibile, con i dati già inseriti');

  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
