// Prova: vault simulato + comando a voce "apri fluidodinamica 1 lezione 3" con chiamata a strumento.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || '.';
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
}).listen(8766);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bodies = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    bodies.push(body);
    const last = body.contents[body.contents.length - 1];
    let parts;
    const fr = last.parts.find((p) => p.functionResponse);
    if (!fr) parts = [{ functionCall: { name: 'cerca_note', args: { query: 'fluidodinamica 1 lezione 3' } }, thoughtSignature: 'sig1' }];
    else if (fr.functionResponse.name === 'cerca_note') parts = [{ functionCall: { name: 'apri_nota', args: { percorso: fr.functionResponse.response.risultati[0] } } }];
    else parts = [{ text: `Ho aperto ${fr.functionResponse.response.aperta}. Inizia pure a raccontare.` }];
    const sse = `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] })}\n\n`;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ key: 'TEST', pause: 1, mute: true }));
    const file = (name, text) => ({ kind: 'file', name, getFile: async () => ({ text: async () => text }) });
    const dir = (name, children) => ({
      kind: 'directory', name,
      async *entries() { for (const c of children) yield [c.name, c]; },
      queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    });
    const vault = dir('Università', [
      dir('.obsidian', [file('app.json', '{}')]),
      dir('Allegati', [file('foto.png', '')]),
      dir('Fluidodinamica 1', [file('Lezione 01 - Intro.md', 'intro'), file('Lezione 03 - Bernoulli.md', 'Teorema di Bernoulli: p + ½ρv² + ρgz = costante lungo una linea di corrente.')]),
      dir('Analisi 1', [file('Lezione 3.md', 'limiti')]),
    ]);
    window.showDirectoryPicker = async () => vault;
    indexedDB.deleteDatabase('compagno-di-studio');
  });
  await page.goto('http://localhost:8766/');
  await page.click('#btn-vault');
  await page.waitForSelector('#vault-status:not([hidden])');
  console.log('stato vault:', await page.textContent('#vault-status'));
  await page.fill('#text-input', 'cerca in fluidodinamica uno la lezione numero tre');
  await page.press('#text-input', 'Enter');
  await page.waitForSelector('.bubble.bot >> text=Inizia pure', { timeout: 5000 });
  console.log('nota aperta:', await page.textContent('#current-title'));
  const lastBody = bodies[bodies.length - 1];
  console.log('appunti nel prompt:', lastBody.systemInstruction.parts[0].text.includes('Teorema di Bernoulli'));
  console.log('firma conservata:', JSON.stringify(lastBody.contents).includes('sig1'));
  console.log('strumenti inviati:', lastBody.tools[0].functionDeclarations.map((f) => f.name).join(','));
  console.log('messaggi info:', await page.$$eval('.bubble.info', (b) => b.map((x) => x.textContent)));
  // Il ricollegamento automatico dopo una ricarica va provato in Chrome vero: una cartella finta non si può salvare in IndexedDB.
  await page.screenshot({ path: process.argv[3] || 'screenshot.png' });
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
