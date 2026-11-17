// Widget di JARVIS: una mini barra con il nucleo e i comandi essenziali (solo icone), da tenere accanto
// agli appunti. In Chrome usa il "Document Picture-in-Picture": una finestrella che resta SOPRA a tutte le
// altre app (Obsidian, PDF, Word…) e si sposta dove vuoi. Altrove diventa un riquadro fisso nella pagina,
// trascinabile, che resta dove l'hai messo anche scorrendo.

const CSS = `
.jw { --cyan:#00C8FF; --text:#EAF4FF; --muted:#91A9C2; --line:rgb(0 200 255 / .25); --danger:#FF6B7A; --orange:#FFB547; --ok:#2FE6A6;
  display:flex; align-items:center; gap:8px; padding:10px 12px; box-sizing:border-box;
  background:radial-gradient(120% 140% at 20% 50%, #0D2035 0%, #030B16 70%); color:var(--text);
  font:14px system-ui, "Segoe UI", sans-serif; user-select:none; }
.jw.pip { position:fixed; inset:0; }
.jw.inline { position:fixed; z-index:60; border:1px solid var(--line); border-radius:999px; box-shadow:0 12px 40px rgb(0 0 0 / .5), 0 0 0 1px rgb(0 200 255 / .15); }
.jw-orb { width:40px; height:40px; flex:none; border-radius:50%; position:relative; cursor:grab;
  background:radial-gradient(circle, #F4FCFF 0 6%, #8FE9FF 14%, #19B9FF 32%, #0C5FD6 58%, #082C5C 80%);
  box-shadow:0 0 calc(8px + var(--lvl,0)*26px) rgb(0 200 255 / calc(.35 + var(--lvl,0)*.5)), inset 0 0 8px rgb(0 200 255 / .6);
  transform:scale(calc(1 + var(--lvl,0)*.14)); transition:filter .3s, opacity .3s; }
.jw-orb::after { content:""; position:absolute; inset:-5px; border-radius:50%; border:1.5px solid rgb(0 200 255 / .35); border-top-color:var(--cyan); }
.jw.pip .jw-orb { cursor:default; }
.jw[data-core="idle"] .jw-orb, .jw[data-core="paused"] .jw-orb { filter:saturate(.7) brightness(.75); }
.jw[data-core="processing"] .jw-orb::after { animation:jw-spin 1.1s linear infinite; }
.jw[data-core="listening"] .jw-orb::after { animation:jw-spin 6s linear infinite; }
.jw[data-core="error"] .jw-orb { filter:hue-rotate(150deg) saturate(.6); }
.jw[data-core="paused"] .jw-orb::after { border-top-color:var(--orange); }
@keyframes jw-spin { to { transform:rotate(360deg); } }
.jw-sep { width:1px; height:26px; background:var(--line); margin:0 2px; }
.jw button { width:38px; height:38px; flex:none; border-radius:50%; border:1px solid var(--line); background:rgb(13 32 53 / .85);
  color:var(--text); display:grid; place-items:center; cursor:pointer; padding:0; transition:background .15s, border-color .15s; }
.jw button:hover { border-color:var(--cyan); background:rgb(0 200 255 / .15); }
.jw button:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
.jw button svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.jw button[data-a="call"] { width:44px; height:44px; border-color:var(--cyan); background:linear-gradient(180deg, rgb(0 200 255 / .35), rgb(22 119 255 / .35)); }
.jw button[data-a="call"][aria-pressed="true"] { border-color:var(--danger); background:rgb(255 107 122 / .28); }
.jw button[data-a="mic"][aria-pressed="true"] { border-color:var(--cyan); color:var(--cyan); }
.jw button[data-a="pause"][aria-pressed="true"] { border-color:var(--orange); color:var(--orange); }
.jw button[data-a="done"] { color:var(--orange); border-color:rgb(255 181 71 / .5); }
.jw button[data-a="back"] { width:30px; height:30px; background:transparent; border-color:transparent; color:var(--muted); }
@media (prefers-reduced-motion: reduce) { .jw * { animation:none !important; transition:none !important; } }
`;

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
      doc.body.style.margin = '0';
      doc.body.style.background = '#030B16';
      doc.title = 'JARVIS';
    }
    const root = doc.createElement('div');
    root.className = `jw ${mode}`;
    root.setAttribute('role', 'toolbar');
    root.setAttribute('aria-label', 'Comandi di JARVIS');
    root.innerHTML = `<div class="jw-orb" title="JARVIS — trascinami dove vuoi" aria-hidden="true"></div><span class="jw-sep"></span>`
      + BUTTONS.map(([a, t, i]) => `<button type="button" data-a="${a}" title="${t}" aria-label="${t}" aria-pressed="false"><svg><use href="#${i}"/></svg></button>`).join('')
      + `<span class="jw-sep"></span><button type="button" data-a="back" title="Chiudi il widget" aria-label="Chiudi il widget"><svg><use href="#i-x"/></svg></button>`;
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
        pip = await window.documentPictureInPicture.requestWindow({ width: 340, height: 68 });
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
