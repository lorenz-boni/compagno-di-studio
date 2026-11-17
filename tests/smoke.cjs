// Prova automatica: Gemini e microfono simulati.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || '.';
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const ext = path.extname(p);
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
}).listen(8765);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let lastBody = null;
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    lastBody = JSON.parse(route.request().postData() || '{}');
    const isSummary = JSON.stringify(lastBody.contents).includes('Fine sessione');
    const text = isSummary ? '## Ripasso 2026-11-16\n**Come è andata:** bene.' : 'Aspetta, negli appunti c\'è scritto che l\'entropia aumenta. Vai avanti.';
    const parts = text.match(/.{1,20}/gs);
    const sse = parts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\n\n`).join('');
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: sse });
  });
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', pause: 1 }));
    class FakeRec { start() { window.__rec = this; } stop() { this.onend && this.onend(); } }
    window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
    window.__say = (t) => window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  await page.goto('http://localhost:8765/');
  // incolla appunti
  await page.click('#btn-paste');
  await page.fill('#paste-title', 'Termodinamica');
  await page.fill('#paste-text', 'Secondo principio: l\'entropia di un sistema isolato non diminuisce.');
  await page.click('#dlg-paste button[value=ok]');
  // parla
  await page.click('#btn-mic');
  await page.evaluate(() => window.__say('allora il secondo principio dice che l\'entropia diminuisce'));
  await page.waitForSelector('.bubble.bot >> text=Vai avanti', { timeout: 5000 });
  console.log('system contiene appunti:', lastBody.systemInstruction.parts[0].text.includes('entropia di un sistema isolato'));
  console.log('turni:', lastBody.contents.map((c) => c.role).join(','));
  // testo via casella (simula Wispr Flow incolla)
  await page.click('#btn-mic');
  await page.focus('#text-input');
  await page.evaluate(() => { const i = document.querySelector('#text-input'); i.value = 'e quindi il calore passa dal freddo al caldo'; i.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true })); });
  await page.waitForFunction(() => document.querySelectorAll('.bubble.user').length === 2, null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('.bubble.bot').length === 2, null, { timeout: 5000 });
  // riassunto
  await page.click('#btn-summary');
  await page.waitForSelector('#dlg-summary[open]', { timeout: 5000 });
  console.log('riassunto:', (await page.inputValue('#summary-text')).split('\n')[0]);
    await page.click('#dlg-summary button[value=cancel]'); await page.screenshot({ path: process.argv[3] || 'screenshot.png' });
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
