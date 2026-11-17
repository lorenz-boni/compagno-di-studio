// Prova dei progressi di studio: annotatore in background, errori ripetuti, concetti chiari,
// memoria dalle sessioni precedenti nel prompt di JARVIS, salvataggio dopo una ricarica.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8773);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) process.exitCode = 1; };
  const mainBodies = [];
  let annotations = 0;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    const sse = (text) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n` });
    if (body.generationConfig?.responseMimeType === 'application/json') {
      annotations++;
      const prompt = body.contents[0].parts[0].text;
      let delta = { argomento: 'Secondo principio', acquisiti: [], da_consolidare: [], errori: [] };
      if (prompt.includes('entropia diminuisce')) delta.errori = [{ concetto: 'Entropia di un sistema isolato', errore: 'diminuisce', correzione: 'non diminuisce mai' }];
      if (prompt.includes('dal caldo al freddo')) delta.acquisiti = ['Verso del flusso di calore'];
      if (prompt.includes('non ricordo Carnot')) delta.da_consolidare = ['Rendimento di Carnot'];
      await new Promise((r) => setTimeout(r, 300));
      return sse(JSON.stringify(delta));
    }
    mainBodies.push(body);
    return sse('Ok, ti seguo.');
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, key: 'TEST', mute: true }));
    const file = (name, text) => ({ kind: 'file', name, getFile: async () => ({ text: async () => text }) });
    const dir = (name, children) => ({ kind: 'directory', name, async *entries() { for (const c of children) yield [c.name, c]; }, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getDirectoryHandle: async () => { throw new Error('no'); } });
    window.showDirectoryPicker = async () => dir('Università', [dir('Fisica tecnica', [file('Lezione 4 - Secondo principio.md', "L'entropia di un sistema isolato non diminuisce.")])]);
  });
  await page.goto('http://localhost:8773/');
  await page.click('#btn-vault');
  await page.click('summary:has-text("Fisica tecnica")');
  await page.click('.tree-note:has-text("Lezione 4")');

  const say = async (t) => {
    const before = await page.$$eval('.bubble.bot', (b) => b.length);
    const ann = annotations;
    await page.fill('#text-input', t);
    await page.press('#text-input', 'Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.bubble.bot').length > n, before);
    // aspetta che l'annotatore abbia elaborato questo scambio
    for (let i = 0; i < 50 && annotations <= ann; i++) await page.waitForTimeout(100);
    await page.waitForFunction(() => document.querySelector('#study').dataset.busy === '0');
  };
  await say("l'entropia diminuisce sempre");
  ok((await page.textContent('#ctx-topic-text')) === 'Secondo principio', `argomento attuale: ${await page.textContent('#ctx-topic-text')}`);
  await say("quindi l'entropia diminuisce, giusto?");
  const errs = await page.$$eval('#study-errors li', (l) => l.map((x) => x.textContent));
  ok(errs.length === 1 && errs[0].includes('×2'), `errore ripetuto contato due volte: ${JSON.stringify(errs)}`);
  ok((await page.$$eval('#study-review li', (l) => l.map((x) => x.textContent))).some((t) => t.includes('Entropia')), "l'errore rende il concetto da consolidare");
  await say('il calore va dal caldo al freddo');
  ok((await page.$$eval('#study-learned li', (l) => l.map((x) => x.textContent))).some((t) => t.includes('Verso del flusso')), 'concetto chiaro registrato');
  await say('non ricordo Carnot');
  ok(!(await page.isHidden('#study-ring')), `anello visibile con 3 concetti: ${await page.textContent('#study-ring-text')}`);
  await page.screenshot({ path: `${process.argv[3] || '.'}/study-panel.png` });

  // rimozione manuale di un elemento registrato per errore
  await page.hover('#study-review li:has-text("Rendimento di Carnot")');
  await page.click('#study-review li:has-text("Rendimento di Carnot") .rm');
  ok(!(await page.$$eval('#study-review li', (l) => l.map((x) => x.textContent))).some((t) => t.includes('Carnot')), 'elemento tolto a mano');

  // la conversazione non aspetta l'annotatore
  ok(annotations === 4, `annotazioni fatte: ${annotations}`);

  // nuova conversazione sulla stessa lezione: memoria dalle sessioni precedenti
  await page.click('#btn-reset');
  await page.waitForTimeout(800);
  ok((await page.$$eval('#study-prior li', (l) => l.map((x) => x.textContent))).some((t) => t.includes('Entropia') && t.includes('2 volte')), 'sessione precedente: errore ricorrente mostrato');
  await say('ricominciamo');
  const sys = mainBodies[mainBodies.length - 1].systemInstruction.parts[0].text;
  ok(sys.includes('MEMORIA DELLO STUDIO') && sys.includes('Entropia di un sistema isolato'), 'la memoria arriva a JARVIS nel prompt');

  // ricarica: i progressi restano salvati nella conversazione
  await page.reload();
  await page.click('#tab-history');
  await page.click('.session-item:has-text("Lezione 4") >> nth=1');
  await page.click('#tab-context');
  await page.waitForTimeout(400);
  ok((await page.$$eval('#study-errors li', (l) => l.map((x) => x.textContent))).some((t) => t.includes('Entropia')), 'dopo la ricarica i progressi della conversazione ci sono ancora');

  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
