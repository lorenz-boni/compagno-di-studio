// Prova della voce naturale: le risposte vengono lette da una voce di Gemini Live (finta) invece che da Chrome;
// se la voce naturale non è disponibile si passa da soli alla voce di Chrome.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');

async function run(browser, { failNatural }) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ws = { setups: [], turns: [] };
  await page.route('https://generativelanguage.googleapis.com/**', (route) => route.fulfill({
    status: 200, headers: { 'content-type': 'text/event-stream' },
    body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Giusto, il bilancio torna. Ora dimmi cosa succede alle falde. Vai pure.' }] } }] })}\n\n`,
  }));
  await page.routeWebSocket(/BidiGenerateContent/, (sock) => {
    const send = (o) => sock.send(Buffer.from(JSON.stringify(o)));
    sock.onMessage((raw) => {
      const m = JSON.parse(raw.toString());
      if (m.setup) {
        ws.setups.push(m.setup);
        if (failNatural) { sock.close({ code: 1008, reason: 'Quota simulata esaurita' }); return; }
        send({ setupComplete: {} });
      }
      if (m.clientContent) {
        ws.turns.push(m.clientContent.turns[0].parts[0].text);
        setTimeout(() => {
          send({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(24000).toString('base64') } }] } } });
          send({ serverContent: { turnComplete: true } });
        }, 100);
      }
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({
      onboarded: true, annotate: false, key: 'TEST', liveModels: ['gemini-2.5-flash-native-audio-latest'], liveVoice: 'Sulafat', rate: 0.8,
    }));
    window.__chromeSays = [];
    const real = window.speechSynthesis;
    if (real) {
      const speak = real.speak.bind(real);
      real.speak = (u) => { window.__chromeSays.push(u.text); u.onend?.(); };
      void speak;
    }
  });
  await page.goto('http://localhost:8778/');
  await page.fill('#text-input', 'il bilancio idrologico');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.bot >> text=Vai pure');
  await page.waitForTimeout(1500);
  const chrome = await page.evaluate(() => window.__chromeSays);
  const info = await page.$$eval('.bubble.info', (b) => b.map((x) => x.textContent).join(' | '));
  await page.close();
  return { ws, chrome, info, errors };
}

(async () => {
  const srv = serve(process.argv[2] || '.', 8778);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };

  const a = await run(browser, { failNatural: false });
  const setup = a.ws.setups[0];
  ok(a.ws.setups.length === 1, 'una sola sessione di lettura per tutta la risposta');
  ok(setup?.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Sulafat', 'legge con la voce scelta (Sulafat)');
  ok(setup?.systemInstruction.parts[0].text.includes('ESATTAMENTE') && setup.systemInstruction.parts[0].text.includes('lentamente'), 'istruzioni: leggere parola per parola, al ritmo scelto (lento)');
  ok(a.ws.turns.join(' ').includes('Ora dimmi cosa succede alle falde.') && a.ws.turns.join(' ').includes('Vai pure.'), `tutto il testo letto dalla voce naturale (${a.ws.turns.length} turni)`);
  ok(a.chrome.length === 0, 'la voce di Chrome non viene usata');
  ok(!a.errors.length, `nessun errore nella pagina ${a.errors.join(' ')}`);

  const b = await run(browser, { failNatural: true });
  ok(b.info.includes('Voce naturale non disponibile'), 'se Gemini non risponde, lo dice');
  ok(b.chrome.join(' ').includes('Vai pure.'), `e la risposta la legge la voce di Chrome (${b.chrome.length} frasi)`);
  ok(!b.errors.length, `nessun errore nella pagina ${b.errors.join(' ')}`);

  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
