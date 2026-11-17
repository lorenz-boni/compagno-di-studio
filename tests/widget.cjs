// Prova del widget: finestra sempre in primo piano (Document Picture-in-Picture) con i comandi a icone,
// e la versione dentro la pagina (trascinabile, fissa anche scorrendo, posizione ricordata).
const { chromium } = require('playwright');
const serve = require('./_server.cjs');
(async () => {
  const srv = serve(process.argv[2] || '.', 8779);
  const shots = process.argv[3] || '.';
  const browser = await chromium.launch();
  const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };
  const errors = [];
  const settings = JSON.stringify({ onboarded: true, annotate: false, key: 'TEST', mute: true });

  // --- Finestra sempre in primo piano ---
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((s) => {
    localStorage.setItem('compagno.settings', s);
    class FakeRec { start() {} stop() { this.onend && this.onend(); } }
    window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
  }, settings);
  await page.goto('http://localhost:8779/');
  const hasPip = await page.evaluate(() => 'documentPictureInPicture' in window);
  console.log('Document Picture-in-Picture disponibile in questo Chrome:', hasPip);
  if (hasPip) {
    const [pip] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null), page.click('#btn-widget')]);
    ok(Boolean(pip), 'si apre la finestra del widget');
    if (pip) {
      await pip.waitForSelector('.jw');
      const buttons = await pip.$$eval('.jw button', (b) => b.map((x) => x.getAttribute('aria-label')));
      ok(buttons.length === 5, `comandi solo a icone: ${buttons.join(' · ')}`);
      ok((await pip.textContent('.jw-state')) === 'In attesa', 'stato mostrato sotto il nome');
      ok(!(await pip.$$eval('.jw button', (b) => b.some((x) => x.textContent.trim()))), 'nessuna scritta sui pulsanti');
      await pip.click('[data-a="pause"]');
      ok(await page.getAttribute('#btn-pause', 'aria-pressed') === 'true' && await pip.getAttribute('[data-a="pause"]', 'aria-pressed') === 'true', 'Pausa dal widget mette in pausa JARVIS');
      await pip.keyboard.press('Space');
      ok(await page.getAttribute('#btn-pause', 'aria-pressed') === 'false', 'Spazio riprende');
      await pip.click('[data-a="mic"]');
      ok((await pip.getAttribute('.jw', 'data-core')) === 'listening' && (await page.textContent('#btn-mic .lbl')) === 'Smetti di ascoltare', 'microfono acceso dal widget, nucleo in ascolto');
      ok((await pip.textContent('.jw-state')) === 'Ti ascolto', 'stato: Ti ascolto');
      // Fotografie alle dimensioni reali della finestrella (Chrome può imporne una più alta di quella chiesta)
      for (const [w, h] of [[433, 250], [380, 210], [300, 190], [420, 96]]) {
        await pip.setViewportSize({ width: w, height: h });
        await pip.waitForTimeout(150);
        const over = await pip.evaluate(() => [...document.querySelectorAll('.jw button')].some((b) => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5; }));
        ok(!over, `${w}×${h}: nessun pulsante tagliato`);
        await pip.screenshot({ path: `${shots}/widget-pip-${w}x${h}.png` });
      }
      await pip.click('[data-a="mic"]');
      await pip.close();
      await page.waitForTimeout(300);
      ok(await page.getAttribute('#btn-widget', 'aria-pressed') === 'false', 'chiuso dal widget stesso');
    }
  }
  await ctx.close();

  // --- Versione dentro la pagina (browser senza Picture-in-Picture) ---
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.addInitScript((s) => {
    localStorage.setItem('compagno.settings', s);
    delete window.documentPictureInPicture;
  }, settings);
  await p2.goto('http://localhost:8779/');
  await p2.click('#btn-widget');
  await p2.waitForSelector('.jw.inline');
  ok(await p2.$eval('.jw.inline', (e) => getComputedStyle(e).position) === 'fixed', 'riquadro fisso: resta dov\'è anche scorrendo');
  const orb = await p2.$('.jw-orb');
  const b = await orb.boundingBox();
  await p2.mouse.move(b.x + 10, b.y + 10);
  await p2.mouse.down();
  await p2.mouse.move(200, 150, { steps: 6 });
  await p2.mouse.up();
  const pos1 = await p2.$eval('.jw.inline', (e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)]);
  ok(Math.abs(pos1[0] - 190) < 15 && Math.abs(pos1[1] - 140) < 15, `trascinato dove voglio (${pos1})`);
  await p2.screenshot({ path: `${shots}/widget-inline.png` });
  await p2.reload();
  await p2.click('#btn-widget');
  await p2.waitForSelector('.jw.inline');
  await p2.waitForTimeout(100);
  const pos2 = await p2.$eval('.jw.inline', (e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)]);
  ok(Math.abs(pos2[0] - pos1[0]) < 3 && Math.abs(pos2[1] - pos1[1]) < 3, 'riaperto, torna dove l\'avevo fissato');
  await p2.click('.jw [data-a="pause"]');
  ok(await p2.getAttribute('#btn-pause', 'aria-pressed') === 'true', 'i comandi funzionano anche nel riquadro');
  await ctx2.close();

  console.log('errori pagina:', errors.length ? errors : 'nessuno');
  if (errors.length) process.exitCode = 1;
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
