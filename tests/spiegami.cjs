// Prova della modalità Spiegami: con una nota aperta, premendo il microfono il compagno inizia a spiegare.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || '.';
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
}).listen(8769);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let body;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    body = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Partiamo dalla prima sezione.' }] } }] })}\n\n` });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ key: 'TEST', mute: true }));
    class FakeRec { start() {} stop() {} }
    window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  });
  await page.goto('http://localhost:8769/');
  await page.click('button[data-mode="spiegami"]');
  await page.click('#btn-paste');
  await page.fill('#paste-text', '# Ciclo idrologico\nPrecipitazione 100, evaporazione 61, deflusso 38+1.');
  await page.click('#dlg-paste button[value=ok]');
  await page.click('#btn-mic');
  await page.waitForSelector('.bubble.bot >> text=prima sezione');
  const sys = body.systemInstruction.parts[0].text;
  console.log('modalità Spiegami nel prompt:', sys.includes('MODALITÀ "SPIEGAMI"'), '| regola spiegazioni complete:', sys.includes('SPIEGAZIONI:'));
  console.log('messaggio di avvio:', body.contents[0].parts[0].text, '| bolle utente visibili:', await page.$$eval('.bubble.user', (b) => b.length));
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
