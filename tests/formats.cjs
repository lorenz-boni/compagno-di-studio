// Prova degli appunti in PDF e Word e del profilo universitario.
// Usa file veri (tests/fixtures) dentro una cartella simulata in memoria su cui l'app può anche scrivere.
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8775);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (cond, label) => { console.log(`${cond ? '✓' : '✗'} ${label}`); if (!cond) process.exitCode = 1; };
  let ocrCalls = 0;
  const mainBodies = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    const sse = (text) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n` });
    if (JSON.stringify(body.contents).includes('application/pdf')) { ocrCalls++; return sse('--- Pagina 1 ---\n# Legge di Darcy\nLa portata è proporzionale al gradiente idraulico.'); }
    if (body.systemInstruction?.parts?.[0]?.text?.startsWith('Sei un assistente che prende appunti')) return sse('{"argomento":"","acquisiti":[],"da_consolidare":[],"errori":[]}');
    mainBodies.push(body);
    if (JSON.stringify(body.contents).includes('Fine sessione')) return sse('## Ripasso 2026-11-17\n**Come è andata:** bene.');
    return sse('Va bene, partiamo.');
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({
      key: 'TEST', mute: true, annotate: false,
      profile: { university: 'Politecnico di Milano', degree: 'Ingegneria per l\'ambiente e il territorio', year: '1° anno magistrale', notes: 'esame orale' },
    }));
    // Cartella simulata in memoria (lettura e scrittura) con i file veri di tests/fixtures
    const mkFile = (name, src) => {
      const f = { kind: 'file', name, data: null, src };
      f.getFile = async () => {
        if (f.data === null && f.src) f.data = await (await fetch(f.src)).arrayBuffer();
        return new File([f.data ?? ''], name, { lastModified: 1 });
      };
      f.createWritable = async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { f.data = buf; } }; };
      return f;
    };
    const mkDir = (name, children = []) => {
      const d = { kind: 'directory', name, children: new Map(children.map((c) => [c.name, c])) };
      d.entries = async function* () { for (const c of d.children.values()) yield [c.name, c]; };
      d.getDirectoryHandle = async (n, o = {}) => { if (!d.children.has(n)) { if (!o.create) throw new DOMException('no', 'NotFoundError'); d.children.set(n, mkDir(n)); } return d.children.get(n); };
      d.getFileHandle = async (n, o = {}) => { if (!d.children.has(n)) { if (!o.create) throw new DOMException('no', 'NotFoundError'); d.children.set(n, mkFile(n)); } return d.children.get(n); };
      d.queryPermission = async () => 'granted';
      d.requestPermission = async () => 'granted';
      return d;
    };
    const fx = (n) => mkFile(n, `/tests/fixtures/${encodeURIComponent(n)}`);
    window.__root = mkDir('Appunti', [mkDir('Acqua ed energia', [
      fx('Lezione 1 - Ciclo idrologico.pdf'), fx('Lezione 2 - Darcy scansione.pdf'), fx('Lezione 3 - Nitrificazione.docx'),
      mkFile('~$Lezione 3 - Nitrificazione.docx'), mkFile('foto.png'),
    ])]);
    window.showDirectoryPicker = async () => window.__root;
  });
  await page.goto('http://localhost:8775/');
  await page.click('#btn-vault');
  await page.waitForSelector('#vault-status:not([hidden])');
  await page.click('summary:has-text("Acqua ed energia")');
  await page.waitForSelector('.tree-note');
  const items = await page.$$eval('.tree-note', (b) => b.map((x) => x.textContent.trim()));
  ok(items.length === 3, `elenco: ${JSON.stringify(items)} (niente file temporanei di Word né immagini)`);
  ok(items.some((t) => t.includes('PDF')) && items.some((t) => t.includes('DOCX')), 'etichette PDF e DOCX');

  // PDF con testo
  await page.click('.tree-note:has-text("Ciclo idrologico")');
  await page.waitForFunction(() => document.querySelector('#current-text').textContent.includes('Bilancio'), null, { timeout: 15000 });
  const pdfText = await page.textContent('#current-text');
  ok(pdfText.includes('Bilancio idrologico globale') && pdfText.includes('--- Pagina 2 ---') && pdfText.includes('falde acquifere'), 'PDF: testo estratto con le pagine');

  // Word
  await page.click('.tree-note:has-text("Nitrificazione")');
  await page.waitForFunction(() => document.querySelector('#current-text').textContent.includes('Nitrificazione'), null, { timeout: 15000 });
  const docText = await page.textContent('#current-text');
  ok(docText.includes('# Nitrificazione') && docText.includes('## Batteri coinvolti') && docText.includes('AOB'), 'Word: testo con titoli');

  // PDF scansionato → trascrizione con Gemini una sola volta
  await page.click('.tree-note:has-text("Darcy")');
  await page.waitForFunction(() => document.querySelector('#current-text').textContent.includes('Legge di Darcy'), null, { timeout: 15000 });
  ok(ocrCalls === 1, `PDF scansionato trascritto da Gemini (${ocrCalls} richiesta)`);
  await page.click('.tree-note:has-text("Ciclo idrologico")');
  await page.waitForFunction(() => document.querySelector('#current-text').textContent.includes('Bilancio'));
  await page.click('.tree-note:has-text("Darcy")');
  await page.waitForFunction(() => document.querySelector('#current-text').textContent.includes('Legge di Darcy'));
  ok(ocrCalls === 1, 'riaperto: trascrizione presa dalla memoria, nessuna nuova richiesta');

  // Profilo nel prompt
  await page.fill('#text-input', 'partiamo da Darcy');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.bot >> text=partiamo');
  const sys = mainBodies[mainBodies.length - 1].systemInstruction.parts[0].text;
  ok(sys.includes("CHI È L'UTENTE") && sys.includes('Politecnico di Milano') && sys.includes('1° anno magistrale'), 'profilo universitario nel prompt di JARVIS');
  ok(sys.includes('Legge di Darcy'), 'il testo trascritto è negli appunti per JARVIS');

  // Resoconto su un PDF → nota «… - ripassi.md» accanto
  await page.click('#btn-summary');
  await page.waitForSelector('#dlg-summary[open]');
  ok((await page.textContent('#summary-target')).includes('Lezione 2 - Darcy scansione - ripassi.md'), 'resoconto: destinazione accanto al PDF');
  await page.click('#btn-save-summary');
  await page.waitForSelector('.bubble.info >> text=Resoconto salvato');
  const saved = await page.evaluate(async () => {
    const d = await window.__root.getDirectoryHandle('Acqua ed energia');
    const f = await d.getFileHandle('Lezione 2 - Darcy scansione - ripassi.md');
    return (await f.getFile()).text();
  });
  ok(saved.startsWith('## Ripasso'), 'nota dei ripassi creata con il resoconto');
  ok(await page.$$eval('.tree-note', (b) => b.some((x) => x.textContent.includes('ripassi'))), 'la nuova nota compare nella libreria');
  await page.click('#dlg-summary button[value=cancel]');

  // Impostazioni: i campi del profilo
  await page.click('#btn-settings');
  ok((await page.inputValue('#set-university')) === 'Politecnico di Milano', 'profilo visibile nelle impostazioni');
  await page.fill('#set-year', '2° anno magistrale');
  await page.click('#dlg-settings button[value=ok]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('compagno.settings')).profile.year) === '2° anno magistrale', 'profilo salvato');

  // Carica file: un PDF e un Word insieme
  await page.setInputFiles('#file-input', [`${__dirname}/fixtures/Lezione 1 - Ciclo idrologico.pdf`, `${__dirname}/fixtures/Lezione 3 - Nitrificazione.docx`]);
  await page.waitForFunction(() => document.querySelector('#current-title').textContent.includes('+'), null, { timeout: 15000 });
  const up = await page.textContent('#current-text');
  ok(up.includes('Bilancio idrologico') && up.includes('AOB'), `Carica file con PDF + Word: «${await page.textContent('#current-title')}»`);

  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
