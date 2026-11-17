// Prova del pulsante "Prova velocità modelli" con risposte simulate (un modello sovraccarico).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || '.';
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
}).listen(8767);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const delays = { 'gemini-3-pro-lite': 400, 'gemini-flash-latest': 503, 'gemini-flash-lite-latest': 300, 'gemini-2.5-flash': 900, 'gemini-2.5-flash-lite': 200 };
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    if (!route.request().url().includes(':streamGenerateContent')) {
      const models = [
        ...Object.keys(delays).map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ['generateContent'] })),
        { name: 'models/gemini-3-flash-live', supportedGenerationMethods: ['bidiGenerateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models }) });
    }
    const model = decodeURIComponent(route.request().url().match(/models\/([^:]+)/)[1]);
    const d = delays[model];
    if (d === 503) return route.fulfill({ status: 503, body: JSON.stringify({ error: { message: 'high demand' } }) });
    if (d === 400) return route.fulfill({ status: 400, body: JSON.stringify({ error: { message: 'Esempio di messaggio di errore dettagliato' } }) });
    await new Promise((r) => setTimeout(r, d));
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ciao!' }] } }] })}\n\n` });
  });
  await page.addInitScript(() => localStorage.setItem('compagno.settings', JSON.stringify({ key: 'TEST' })));
  await page.goto('http://localhost:8767/');
  await page.click('#btn-settings');
  await page.click('#btn-bench');
  await page.waitForSelector('#bench-results li:has-text("Ho scelto")', { timeout: 15000 });
  console.log(await page.$$eval('#bench-results li', (l) => l.map((x) => x.textContent.trim())));
  console.log('modello scelto:', await page.inputValue('#set-model'));
  console.log('riserve salvate:', await page.evaluate(() => JSON.parse(localStorage.getItem('compagno.settings')).fallbacks));
  await page.locator('#dlg-settings').screenshot({ path: process.argv[3] || 'bench.png' });
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
