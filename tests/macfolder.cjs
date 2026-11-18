// Prova della diagnosi di una cartella "da Mac" senza appunti leggibili (Pages, foto, file solo su iCloud):
// JARVIS deve dire cosa ha trovato e cosa fare, invece di un generico «nessun appunto».
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8782);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };
  await page.addInitScript(() => {
    localStorage.setItem('compagno.settings', JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', mute: true }));
    const f = (name) => ({ kind: 'file', name, getFile: async () => new File([''], name) });
    const d = (name, ch) => ({ kind: 'directory', name, async *entries() { for (const c of ch) yield [c.name, c]; }, queryPermission: async () => 'granted', requestPermission: async () => 'granted', getDirectoryHandle: async () => { throw new Error('no'); } });
    window.__folder = d('Università', [d('Chimica', [f('Lezione 1.pages'), f('Lezione 2.pages'), f('Esercizi.key'), f('IMG_0001.HEIC'), f('IMG_0002.jpg'), f('.Lezione 3.pdf.icloud'), f('.DS_Store')])]);
    window.showDirectoryPicker = async () => window.__folder;
  });
  await page.goto('http://localhost:8782/');
  await page.click('#btn-vault');
  await page.waitForSelector('.bubble.error');
  const msg = await page.textContent('.bubble.error');
  ok(msg.includes('3 file di Pages/Keynote/Numbers') && msg.includes('Esporta in → PDF'), 'riconosce i file di Pages/Keynote e spiega come esportarli');
  ok(msg.includes('2 immagini') && msg.includes('Crea PDF'), 'riconosce le foto e spiega come farne un PDF');
  ok(msg.includes('solo su iCloud') && msg.includes('Scarica ora'), 'riconosce i file rimasti solo su iCloud');
  ok(!msg.includes('DS_Store'), 'ignora i file di sistema del Mac');
  console.log('messaggio:', msg.slice(0, 160), '…');
  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
