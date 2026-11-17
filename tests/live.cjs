// Prova della chiamata dal vivo con un finto server Gemini Live (WebSocket simulato) e microfono finto.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8771);
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  await context.grantPermissions(['microphone']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const log = { setups: [], audioChunks: 0, clientContent: [], toolResponses: [] };
  // 1 kHz di silenzio in PCM 24 kHz, codificato base64 (finta voce del modello)
  const silence = Buffer.alloc(4800).toString('base64');
  await page.routeWebSocket(/BidiGenerateContent/, (ws) => {
    const send = (obj) => ws.send(Buffer.from(JSON.stringify(obj))); // Google invia frame binari
    ws.onMessage((raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.setup) {
        log.setups.push(msg.setup);
        if (msg.setup.model === 'models/gemini-2.5-flash-native-audio-latest') { ws.close({ code: 1008, reason: 'Modello non disponibile (simulato)' }); return; }
        send({ setupComplete: {} });
        send({ sessionResumptionUpdate: { newHandle: 'h1', resumable: true } });
      }
      if (msg.realtimeInput?.audio) {
        log.audioChunks++;
        if (log.audioChunks === 3) {
          // l'utente "dice" di aprire la lezione: trascrizione + chiamata a strumento
          send({ serverContent: { inputTranscription: { text: 'apri fluidodinamica 1 lezione 3' } } });
          send({ toolCall: { functionCalls: [{ id: 'c1', name: 'cerca_note', args: { query: 'fluidodinamica 1 lezione 3' } }] } });
        }
      }
      if (msg.toolResponse) {
        log.toolResponses.push(msg.toolResponse);
        send({ serverContent: { outputTranscription: { text: 'Ho aperto la lezione 3 su Bernoulli. ' } } });
        send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: silence } }] } } });
        send({ serverContent: { outputTranscription: { text: 'Raccontami pure.' } } });
        send({ serverContent: { turnComplete: true } });
      }
      if (msg.clientContent) {
        log.clientContent.push(msg.clientContent);
        if (!msg.clientContent.turnComplete) return;
        if (msg.clientContent.turnComplete) {
          send({ serverContent: { outputTranscription: { text: 'Ricevuto il testo scritto.' } } });
          send({ serverContent: { turnComplete: true } });
        }
      }
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', mute: true, liveModels: ['gemini-2.5-flash-native-audio-latest', 'gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live'] }));
    const file = (name, text) => ({ kind: 'file', name, getFile: async () => ({ text: async () => text }) });
    const dir = (name, children) => ({ kind: 'directory', name, async *entries() { for (const c of children) yield [c.name, c]; }, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getDirectoryHandle: async () => { throw new Error('no'); } });
    window.showDirectoryPicker = async () => dir('Università', [dir('Fluidodinamica 1', [file('Lezione 03 - Bernoulli.md', 'Bernoulli: p + ½ρv² = costante.'), file('Lezione 01.md', 'intro')])]);
  });
  await page.goto('http://localhost:8771/');
  await page.click('#btn-vault');
  await page.waitForSelector('#vault-status:not([hidden])');
  await page.click('#btn-live');
  await page.waitForSelector('.bubble.bot >> text=Raccontami pure', { timeout: 10000 });
  console.log('modelli provati:', log.setups.map((s) => s.model));
  const setup = log.setups[log.setups.length - 1];
  console.log('setup: voce', setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, '| strumenti', setup.tools?.[0]?.functionDeclarations.map((f) => f.name).join(','), '| trascrizioni', Boolean(setup.inputAudioTranscription && setup.outputAudioTranscription));
  console.log('pezzi audio dal microfono inviati:', log.audioChunks > 0);
  console.log('nota aperta dallo strumento:', await page.textContent('#current-title'), '| testo restituito al modello:', JSON.stringify(log.toolResponses[0].functionResponses[0].response).includes('Bernoulli: p'));
  console.log('chat:', await page.$$eval('#log .bubble', (b) => b.map((x) => `[${x.dataset.kind}] ${x.textContent}`)));
  console.log('stato:', await page.textContent('#status'), '| pulsante:', await page.textContent('#btn-live'), '| microfono normale disattivato:', await page.isDisabled('#btn-mic'));
  // Pausa durante la chiamata: il microfono non viene inviato, poi riprende
  await page.click('#btn-pause');
  const fermo = log.audioChunks;
  await page.waitForTimeout(700);
  console.log('in pausa nessun audio inviato:', log.audioChunks === fermo, '| nucleo:', await page.evaluate(() => document.body.dataset.core));
  await page.click('#btn-pause');
  await page.waitForTimeout(700);
  console.log('ripresa: il microfono riparte:', log.audioChunks > fermo);
  // Velocità cambiata durante la chiamata: JARVIS riceve la nota senza dover rispondere
  await page.click('#btn-settings');
  await page.fill('#set-rate', '0.8');
  await page.click('#dlg-settings button[value=ok]');
  await page.waitForTimeout(400);
  const nota = log.clientContent.find((c) => !c.turnComplete && JSON.stringify(c).includes('velocità'));
  console.log('nota sulla velocità inviata a JARVIS:', Boolean(nota));

  // testo scritto durante la chiamata
  await page.fill('#text-input', 'ti scrivo una cosa');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.bot >> text=Ricevuto il testo scritto');
  await page.click('#btn-live');
  await page.waitForTimeout(600);
  console.log('dopo chiusura:', await page.textContent('#btn-live'), '| conversazioni salvate:', await page.$$eval('.s-title', (t) => t.map((x) => x.textContent)));
  await page.screenshot({ path: process.argv[3] || 'live.png' });
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
