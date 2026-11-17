// Genera download/JARVIS-guida-per-AI.pdf da share/guida-ai.html (testo selezionabile, leggibile dalle AI).
// Uso: node tools/make-guide.cjs
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, '..', 'share', 'guida-ai.html'));
  const out = path.join(__dirname, '..', 'download', 'JARVIS-guida-per-AI.pdf');
  await p.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log(out);
})();
