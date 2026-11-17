// Genera i PDF di prova: uno con testo e uno "scansionato" (solo immagine, senza testo).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<h1>Ciclo idrologico</h1><p>Bilancio idrologico globale: precipitazione 100, evaporazione 61, deflusso 39.</p><div style="page-break-before:always"></div><h2>Acque sotterranee</h2><p>Le falde acquifere contengono circa il 30% dell’acqua dolce.</p>');
  await p.pdf({ path: __dirname + '/Lezione 1 - Ciclo idrologico.pdf' });
  // pagina "scansionata": il testo è disegnato su un canvas e inserito come immagine
  await p.setContent('<canvas id="c" width="600" height="200"></canvas><script>const x=document.getElementById("c").getContext("2d");x.font="28px serif";x.fillText("Appunti a mano: legge di Darcy",20,80);</script>');
  const png = await p.locator('#c').screenshot();
  await p.setContent(`<img src="data:image/png;base64,${png.toString('base64')}">`);
  await p.pdf({ path: __dirname + '/Lezione 2 - Darcy scansione.pdf' });
  await b.close();
})();
