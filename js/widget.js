// Widget di JARVIS: una mini barra con il nucleo e i comandi essenziali (solo icone), da tenere accanto
// agli appunti. In Chrome usa il "Document Picture-in-Picture": una finestrella che resta SOPRA a tutte le
// altre app (Obsidian, PDF, Word…) e si sposta dove vuoi. Altrove diventa un riquadro fisso nella pagina,
// trascinabile, che resta dove l'hai messo anche scorrendo.

const CSS = `
.jw { --cyan:#00C8FF; --blue:#1677FF; --text:#EAF4FF; --muted:#91A9C2; --line:rgb(0 200 255 / .22); --danger:#FF6B7A; --orange:#FFB547; --ok:#2FE6A6;
  --accent:var(--cyan); box-sizing:border-box; color:var(--text); user-select:none;
  font:14px "Inter", system-ui, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
.jw * { box-sizing:border-box; }
.jw[data-core="paused"] { --accent:var(--orange); }
.jw[data-core="error"] { --accent:var(--danger); }

/* --- Finestra sempre in primo piano: scheda che riempie la finestra --- */
.jw.pip { position:fixed; inset:0; display:flex; flex-direction:column; justify-content:center; gap:clamp(10px, 6vh, 18px);
  padding:clamp(10px, 5vh, 18px) clamp(12px, 4.5vw, 20px);
  background:
    radial-gradient(90% 120% at 18% 0%, rgb(0 200 255 / .14), transparent 60%),
    radial-gradient(80% 90% at 100% 100%, rgb(22 119 255 / .12), transparent 60%),
    linear-gradient(180deg, #0A1B2E, #030B16); }

/* --- Riquadro dentro la pagina: pillola trascinabile --- */
.jw.inline { position:fixed; z-index:60; display:flex; align-items:center; gap:10px; padding:8px 10px 8px 8px; border-radius:999px;
  background:linear-gradient(180deg, rgb(13 32 53 / .96), rgb(3 11 22 / .96)); border:1px solid var(--line);
  box-shadow:0 14px 40px rgb(0 0 0 / .55), 0 0 0 1px rgb(0 200 255 / .1), 0 0 30px rgb(0 200 255 / .08); backdrop-filter:blur(10px); }
.jw.inline .jw-info, .jw.inline .jw-bars { display:none; }

/* Intestazione: nucleo, nome, stato, onde */
.jw-head { display:flex; align-items:center; gap:12px; min-width:0; }
.jw-orb { --s:clamp(40px, 22vh, 58px); width:var(--s); height:var(--s); flex:none; border-radius:50%; position:relative;
  background:radial-gradient(circle, #F4FCFF 0 5%, #8FE9FF 13%, #19B9FF 30%, #0C5FD6 56%, #082C5C 78%, #041326 100%);
  box-shadow:0 0 calc(10px + var(--lvl,0)*30px) rgb(0 200 255 / calc(.3 + var(--lvl,0)*.5)), inset 0 0 10px rgb(0 200 255 / .55);
  transform:scale(calc(1 + var(--lvl,0)*.12)); transition:filter .3s; }
.jw-orb::before { content:""; position:absolute; inset:-6px; border-radius:50%; border:1px dashed rgb(0 200 255 / .3); }
.jw-orb::after { content:""; position:absolute; inset:-3px; border-radius:50%; border:2px solid transparent; border-top-color:var(--accent); border-right-color:rgb(0 200 255 / .25); }
.jw.inline .jw-orb { --s:40px; cursor:grab; }
.jw.inline .jw-orb:active { cursor:grabbing; }
.jw[data-core="idle"] .jw-orb, .jw[data-core="paused"] .jw-orb { filter:saturate(.75) brightness(.78); }
.jw[data-core="error"] .jw-orb { filter:hue-rotate(150deg) saturate(.6); }
.jw[data-core="processing"] .jw-orb::after { animation:jw-spin 1s linear infinite; }
.jw[data-core="listening"] .jw-orb::after, .jw[data-core="speaking"] .jw-orb::after { animation:jw-spin 5s linear infinite; }
@keyframes jw-spin { to { transform:rotate(360deg); } }

.jw-info { display:flex; flex-direction:column; min-width:0; flex:1; line-height:1.15; }
.jw-name { font:600 clamp(12px, 3.6vw, 15px)/1.1 "Sora", "Inter", system-ui, sans-serif; letter-spacing:.32em; }
.jw-state { margin-top:4px; font-size:clamp(11px, 3.2vw, 13px); color:var(--accent); display:flex; align-items:center; gap:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.jw-state::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); flex:none; }
.jw[data-core="idle"] .jw-state { color:var(--muted); }
.jw[data-core="idle"] .jw-state::before { background:var(--muted); box-shadow:none; }

.jw-bars { display:flex; align-items:center; gap:3px; height:28px; flex:none; }
.jw-bars i { display:block; width:3px; border-radius:2px; background:var(--accent); opacity:.85;
  height:calc(4px + var(--lvl,0) * var(--h,1) * 24px); transition:height .08s linear; }
.jw-bars i:nth-child(1) { --h:.45; } .jw-bars i:nth-child(2) { --h:.8; } .jw-bars i:nth-child(3) { --h:1; }
.jw-bars i:nth-child(4) { --h:.7; } .jw-bars i:nth-child(5) { --h:.4; }
.jw[data-core="idle"] .jw-bars i, .jw[data-core="paused"] .jw-bars i { opacity:.3; }

/* Comandi */
.jw-ctrls { display:flex; align-items:center; justify-content:space-between; gap:clamp(4px, 2vw, 10px); }
.jw.inline .jw-ctrls { gap:8px; }
.jw button { --b:clamp(34px, 12.5vw, 50px); width:var(--b); height:var(--b); flex:none; border-radius:50%; padding:0; display:grid; place-items:center; cursor:pointer;
  color:var(--text); border:1px solid var(--line); background:rgb(13 32 53 / .8); transition:background .15s, border-color .15s, box-shadow .15s, transform .1s; }
.jw.inline button { --b:38px; }
.jw button:hover:not(:disabled) { border-color:var(--cyan); background:rgb(0 200 255 / .14); }
.jw button:active:not(:disabled) { transform:scale(.94); }
.jw button:disabled { opacity:.35; cursor:not-allowed; }
.jw button:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
.jw button svg { width:44%; height:44%; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.jw button[data-a="mic"] { order:1; } .jw button[data-a="pause"] { order:2; } .jw button[data-a="stop"] { order:4; }
.jw button[data-a="done"] { order:5; } .jw button[data-a="back"] { order:6; }
.jw button[data-a="call"] { --b:clamp(42px, 15.5vw, 62px); order:3; border:1px solid var(--cyan); color:#fff;
  background:linear-gradient(180deg, rgb(0 200 255 / .45), rgb(22 119 255 / .45)); box-shadow:0 0 0 4px rgb(0 200 255 / .08), 0 0 22px rgb(0 200 255 / .3); }
.jw.inline button[data-a="call"] { --b:44px; }
.jw button[data-a="call"][aria-pressed="true"] { border-color:var(--danger); background:linear-gradient(180deg, rgb(255 107 122 / .45), rgb(255 107 122 / .25)); box-shadow:0 0 0 4px rgb(255 107 122 / .1), 0 0 22px rgb(255 107 122 / .3); }
.jw button[data-a="mic"][aria-pressed="true"] { border-color:var(--cyan); color:var(--cyan); background:rgb(0 200 255 / .14); }
.jw button[data-a="pause"][aria-pressed="true"] { border-color:var(--orange); color:var(--orange); background:rgb(255 181 71 / .12); }
.jw button[data-a="done"] { color:var(--orange); border-color:rgb(255 181 71 / .45); }
.jw button[data-a="back"] { --b:30px; background:transparent; border-color:transparent; color:var(--muted); }

/* Finestra molto bassa: tutto su una riga */
@media (max-height: 130px) {
  .jw.pip { flex-direction:row; align-items:center; justify-content:space-between; gap:10px; }
  .jw.pip .jw-info, .jw.pip .jw-bars { display:none; }
  .jw.pip .jw-orb { --s:40px; }
  .jw.pip button { --b:clamp(30px, 9vw, 42px); }
  .jw.pip button[data-a="call"] { --b:clamp(34px, 10.5vw, 48px); }
}
@media (prefers-reduced-motion: reduce) { .jw * { animation:none !important; transition:none !important; } }
`;

const STATES = {
  idle: 'In attesa', listening: 'Ti ascolto', processing: 'Sto pensando', speaking: 'Sto parlando', paused: 'In pausa', error: 'Qualcosa non va',
};

const BUTTONS = [
  ['call', 'Parla con JARVIS (chiamata dal vivo)', 'i-mic'],
  ['mic', 'Microfono classico', 'i-wave'],
  ['pause', 'Pausa (Spazio)', 'i-pause'],
  ['stop', 'Silenzio: interrompi la risposta', 'i-stop'],
  ['done', 'Ho finito (Invio)', 'i-flag'],
];

/**
 * opts: { actions: { call, mic, pause, stop, done }, getState() → { core, live, paused, mic }, level() → 0..1 | null, onClose() }
 */
export function createWidget(opts) {
  let pip = null; // finestra Picture-in-Picture
  let el = null; // radice del widget (nella finestra PiP o nella pagina)
  let raf = 0;
  let win = window;

  function build(doc, mode) {
    if (!doc.getElementById('jw-style')) {
      const st = doc.createElement('style');
      st.id = 'jw-style';
      st.textContent = CSS;
      doc.head.append(st);
    }
    // Le icone: copiamo i simboli SVG dell'app nella finestra del widget
    if (mode === 'pip') {
      const sprite = document.querySelector('svg defs')?.closest('svg');
      if (sprite) doc.body.append(doc.importNode(sprite, true));
      const font = document.querySelector('link[href*="fonts.googleapis"]');
      if (font) doc.head.append(doc.importNode(font, true));
      doc.body.style.margin = '0';
      doc.body.style.background = '#030B16';
      doc.title = 'JARVIS';
    }
    const root = doc.createElement('div');
    root.className = `jw ${mode}`;
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'Comandi di JARVIS');
    root.innerHTML = `<div class="jw-head">
        <div class="jw-orb" title="${mode === 'inline' ? 'JARVIS — trascinami dove vuoi' : 'JARVIS'}" aria-hidden="true"></div>
        <div class="jw-info"><span class="jw-name">JARVIS</span><span class="jw-state" aria-live="polite">In attesa</span></div>
        <div class="jw-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="jw-ctrls">`
      + BUTTONS.map(([a, t, i]) => `<button type="button" data-a="${a}" title="${t}" aria-label="${t}" aria-pressed="false"><svg><use href="#${i}"/></svg></button>`).join('')
      + (mode === 'inline' ? `<button type="button" data-a="back" title="Chiudi il widget" aria-label="Chiudi il widget"><svg><use href="#i-x"/></svg></button>` : '')
      + `</div>`;
    root.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.a === 'back') { close(); return; }
        opts.actions[b.dataset.a]?.();
      };
    });
    // Scorciatoie: Spazio = pausa/riprendi, Invio = ho finito
    doc.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      if (e.key === ' ') { e.preventDefault(); opts.actions.pause?.(); }
      if (e.key === 'Enter') { e.preventDefault(); opts.actions.done?.(); }
    });
    doc.body.append(root);
    return root;
  }

  function placeInline(root) {
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem('jarvis.widgetPos') || 'null'); } catch { /* ignora */ }
    const apply = (x, y) => {
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      const nx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
      const ny = Math.max(8, Math.min(window.innerHeight - h - 8, y));
      root.style.left = `${nx}px`;
      root.style.top = `${ny}px`;
      return { x: nx, y: ny };
    };
    requestAnimationFrame(() => {
      const p = pos || { x: window.innerWidth - root.offsetWidth - 24, y: window.innerHeight - root.offsetHeight - 120 };
      apply(p.x, p.y);
    });
    // Trascinamento dal nucleo
    const handle = root.querySelector('.jw-orb');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const r = root.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev) => apply(ev.clientX - dx, ev.clientY - dy);
      const up = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        const p = apply(ev.clientX - dx, ev.clientY - dy);
        try { localStorage.setItem('jarvis.widgetPos', JSON.stringify(p)); } catch { /* ignora */ }
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    window.addEventListener('resize', () => {
      const r = root.getBoundingClientRect();
      apply(r.left, r.top);
    });
  }

  function loop() {
    raf = 0;
    if (!el) return;
    const st = opts.getState();
    const active = st.core === 'speaking' || st.core === 'listening';
    const lv = active ? Math.min(1, (opts.level() ?? (st.core === 'speaking' ? 0.25 : 0.08)) * 3.2) : 0;
    const prev = Number(el.style.getPropertyValue('--lvl')) || 0;
    el.style.setProperty('--lvl', (prev + (lv - prev) * 0.25).toFixed(3));
    if (active || prev > 0.01) raf = win.requestAnimationFrame(loop);
  }

  function update() {
    if (!el) return;
    const st = opts.getState();
    el.dataset.core = st.core;
    const label = st.live && st.core === 'listening' ? 'In chiamata · ti ascolto' : STATES[st.core] || '';
    const stEl = el.querySelector('.jw-state');
    if (stEl.textContent !== label) stEl.textContent = label;
    const set = (a, on, title) => {
      const b = el.querySelector(`[data-a="${a}"]`);
      b.setAttribute('aria-pressed', String(Boolean(on)));
      if (title) { b.title = title; b.setAttribute('aria-label', title); }
    };
    set('call', st.live, st.live ? 'Chiudi la chiamata' : 'Parla con JARVIS (chiamata dal vivo)');
    el.querySelector('[data-a="call"] use').setAttribute('href', st.live ? '#i-phone-off' : '#i-mic');
    set('mic', st.mic, st.mic ? 'Spegni il microfono classico' : 'Microfono classico');
    el.querySelector('[data-a="mic"]').disabled = Boolean(st.live);
    set('pause', st.paused, st.paused ? 'Riprendi (Spazio)' : 'Pausa (Spazio)');
    el.querySelector('[data-a="pause"] use').setAttribute('href', st.paused ? '#i-play' : '#i-pause');
    el.querySelector('[data-a="done"]').disabled = Boolean(st.live);
    if (!raf) raf = win.requestAnimationFrame(loop);
  }

  async function open() {
    if (el) return;
    if ('documentPictureInPicture' in window) {
      try {
        pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 210 });
        win = pip;
        el = build(pip.document, 'pip');
        pip.addEventListener('pagehide', () => { el = null; pip = null; win = window; opts.onClose?.(); });
        update();
        return 'pip';
      } catch {
        pip = null;
        win = window;
      }
    }
    el = build(document, 'inline');
    placeInline(el);
    update();
    return 'inline';
  }

  function close() {
    if (pip) { pip.close(); return; } // il resto lo fa 'pagehide'
    el?.remove();
    el = null;
    opts.onClose?.();
  }

  return {
    open,
    close,
    update,
    get isOpen() { return Boolean(el); },
    get mode() { return el ? (pip ? 'pip' : 'inline') : null; },
  };
}
