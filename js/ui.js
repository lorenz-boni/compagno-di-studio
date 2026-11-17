// Interfaccia "JARVIS": pannelli, schermo intero, nucleo animato, onde sonore, indicatore di connessione
// e pannello del contesto. Solo presentazione: la logica resta in app.js.

const $ = (s) => document.querySelector(s);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Pannelli laterali, full immersion, schermo intero, schede
// ---------------------------------------------------------------------------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
};

const isNarrow = () => window.innerWidth <= 820;
const isMedium = () => window.innerWidth <= 1100;

function syncPanelButtons() {
  const b = document.body;
  $('#btn-toggle-library')?.setAttribute('aria-pressed', String(!b.classList.contains('no-library')));
  $('#btn-toggle-sessions')?.setAttribute('aria-pressed', String(!b.classList.contains('no-context')));
  $('#btn-focus')?.setAttribute('aria-pressed', String(b.classList.contains('no-library') && b.classList.contains('no-context')));
  $('#scrim').hidden = !(isNarrow() && !b.classList.contains('no-library')) && !(isMedium() && !b.classList.contains('no-context'));
}

export function setPanel(which, open) {
  const cls = which === 'library' ? 'no-library' : 'no-context';
  document.body.classList.toggle(cls, !open);
  // Sugli schermi piccoli i pannelli sono sovrapposti: se ne apri uno, chiudi l'altro.
  if (open && isNarrow()) document.body.classList.add(which === 'library' ? 'no-context' : 'no-library');
  if (!isMedium()) store.set(`jarvis.${which}`, open ? '1' : '0');
  syncPanelButtons();
}

export function showHistoryTab(show = true) {
  const ctx = $('#tab-context');
  const hist = $('#tab-history');
  ctx.setAttribute('aria-selected', String(!show));
  hist.setAttribute('aria-selected', String(show));
  $('#pane-context').hidden = show;
  $('#pane-history').hidden = !show;
  store.set('jarvis.tab', show ? 'history' : 'context');
}

function initChrome() {
  const b = document.body;
  // Stato iniziale: su desktop ricordiamo la scelta, su schermi piccoli i pannelli partono chiusi.
  const lib = isNarrow() ? false : store.get('jarvis.library') !== '0';
  const ctx = isMedium() ? false : store.get('jarvis.context') !== '0';
  b.classList.toggle('no-library', !lib);
  b.classList.toggle('no-context', !ctx);
  syncPanelButtons();

  $('#btn-toggle-library').onclick = () => setPanel('library', b.classList.contains('no-library'));
  $('#btn-toggle-sessions').onclick = () => setPanel('context', b.classList.contains('no-context'));
  $('#btn-focus').onclick = () => {
    const immersed = b.classList.contains('no-library') && b.classList.contains('no-context');
    setPanel('library', immersed);
    setPanel('context', immersed);
  };
  document.querySelectorAll('[data-close]').forEach((x) => { x.onclick = () => setPanel(x.dataset.close, false); });
  $('#scrim').onclick = () => {
    if (isNarrow()) setPanel('library', false);
    if (isMedium()) setPanel('context', false);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#scrim').hidden && !document.querySelector('dialog[open]')) $('#scrim').click();
  });
  window.addEventListener('resize', syncPanelButtons);

  // Schermo intero
  const fsBtn = $('#btn-fullscreen');
  if (!document.fullscreenEnabled) fsBtn.hidden = true;
  fsBtn.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => fsBtn.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement))));

  // Schede del pannello destro
  $('#tab-context').onclick = () => showHistoryTab(false);
  $('#tab-history').onclick = () => showHistoryTab(true);
  showHistoryTab(store.get('jarvis.tab') === 'history');

  // Casella di testo che cresce con il contenuto
  const ta = $('#text-input');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 128)}px`; };
  ta.addEventListener('input', grow);
  // Dopo l'invio (Invio o pulsante) la casella viene svuotata dall'app: la riportiamo all'altezza minima.
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(grow, 0); });
  ta.form.addEventListener('submit', () => setTimeout(grow, 0));
}

// ---------------------------------------------------------------------------
// Nucleo animato
// ---------------------------------------------------------------------------
const STATE_LABELS = {
  idle: 'In attesa',
  listening: 'Ti sto ascoltando',
  processing: 'Sto elaborando',
  speaking: 'Sto parlando',
  paused: 'In pausa',
  error: 'Qualcosa non va',
};
const STATE_ICON = { idle: 'i-mic', listening: 'i-mic', processing: 'i-target', speaking: 'i-wave', paused: 'i-pause', error: 'i-alert' };

let coreState = 'idle';
let levelProvider = () => null; // restituisce 0..1 se c'è un livello audio reale, altrimenti null

export function setLevelProvider(fn) {
  levelProvider = fn || (() => null);
}

export function setCoreState(state, label) {
  if (!STATE_LABELS[state]) state = 'idle';
  const changed = state !== coreState;
  coreState = state;
  document.body.dataset.core = state;
  const text = label || STATE_LABELS[state];
  const el = $('#state-label');
  if (el.textContent !== text) el.textContent = text;
  $('#core').setAttribute('aria-label', `JARVIS: ${text}`);
  if (changed) {
    $('.state-chip use').setAttribute('href', `#${STATE_ICON[state]}`);
    wave.kick();
  }
}

/** Indicatore nell'header. kind: idle | active | live | warn | error */
export function setConnection(kind, label) {
  const c = $('#conn');
  c.dataset.state = kind;
  const l = $('#conn-label');
  if (l.textContent !== label) l.textContent = label;
  c.title = label;
}

// Onde sonore ai lati del nucleo (canvas). Si animano solo quando serve.
const wave = {
  raf: 0,
  level: 0,
  t: 0,
  kick() {
    if (!this.canvas) return;
    if (!this.raf) this.raf = requestAnimationFrame((ts) => this.frame(ts));
  },
  init() {
    this.canvas = $('#core-wave');
    this.ctx = this.canvas.getContext('2d');
    const resize = () => {
      const r = this.canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.dpr = dpr;
      this.kick();
    };
    new ResizeObserver(resize).observe(this.canvas);
    resize();
  },
  target() {
    const real = levelProvider();
    if (typeof real === 'number' && (coreState === 'listening' || coreState === 'speaking')) return Math.min(1, real * 3.2);
    // Nessun audio misurabile (es. voce di Chrome): movimento leggero e regolare, non "finto parlato".
    if (coreState === 'speaking') return 0.35 + 0.15 * Math.sin(this.t * 0.006);
    if (coreState === 'listening') return 0.12;
    if (coreState === 'processing') return 0.18;
    return 0;
  },
  frame(ts) {
    this.raf = 0;
    const { ctx, canvas } = this;
    if (!ctx) return;
    this.t = ts;
    const active = ['listening', 'speaking', 'processing'].includes(coreState) && !reduceMotion.matches;
    const tgt = active ? this.target() : 0;
    this.level += (tgt - this.level) * 0.18;
    document.documentElement.style.setProperty('--level', (coreState === 'speaking' || coreState === 'listening') ? this.level.toFixed(3) : '0');

    const W = canvas.width;
    const H = canvas.height;
    const dpr = this.dpr || 1;
    ctx.clearRect(0, 0, W, H);
    const mid = H / 2;
    const coreW = $('#core').getBoundingClientRect().width * dpr;
    const gap = coreW * 0.42;
    const cx = W / 2;
    const span = Math.max(0, cx - gap - 10 * dpr);
    const step = 7 * dpr;
    const n = Math.floor(span / step);
    const color = coreState === 'error' ? '255,107,122' : '0,200,255';
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const x = cx + side * (gap + i * step);
        const fade = 1 - i / n; // più intense vicino al nucleo
        let h;
        if (active) {
          const wob = Math.sin(ts * 0.009 + i * 0.7) * 0.5 + Math.sin(ts * 0.004 + i * 1.9) * 0.5;
          h = (2 + (this.level * (0.55 + 0.45 * wob)) * fade * (H * 0.42)) ;
        } else {
          h = 1.2 * dpr;
        }
        ctx.fillStyle = `rgba(${color},${(0.12 + 0.6 * fade * (active ? 1 : 0.5)).toFixed(3)})`;
        const w = 2 * dpr;
        ctx.fillRect(x - w / 2, mid - Math.max(h, 1.2 * dpr) / 2, w, Math.max(h, 1.2 * dpr));
      }
    }
    // Continua ad animare solo mentre c'è attività (o finché le onde non si sono spente).
    if (active || this.level > 0.01) this.raf = requestAnimationFrame((t) => this.frame(t));
  },
};

// ---------------------------------------------------------------------------
// Misuratore del microfono per il microfono classico (il riconoscimento di Chrome non dà accesso all'audio)
// ---------------------------------------------------------------------------
export class MicMeter {
  async start() {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 512;
      this.buf = new Float32Array(this.an.fftSize);
      src.connect(this.an);
    } catch {
      this.stop();
    }
  }

  level() {
    if (!this.an) return null;
    this.an.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.an = null;
  }
}

// ---------------------------------------------------------------------------
// Pannello del contesto: solo dati reali
// ---------------------------------------------------------------------------
function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

export function renderContext(d) {
  setText('ctx-subject', d.subject || 'Nessuna materia');
  setText('ctx-lesson', d.lesson || 'Nessuna nota aperta');
  setText('ctx-mode', d.mode || '—');
  setText('ctx-duration', d.duration || '—');
  setText('ctx-turns', String(d.turns ?? 0));
  setText('ctx-voice', d.voice || '—');
  setText('ctx-mic', d.mic || '—');
  setText('ctx-latency', d.latency || '—');
}

// ---------------------------------------------------------------------------
// Progressi di studio (dati raccolti dall'annotatore: mai inventati)
// ---------------------------------------------------------------------------
function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fillList(id, items, render, onRemove) {
  const ul = document.getElementById(id);
  ul.replaceChildren(...items.map((it) => {
    const li = document.createElement('li');
    li.innerHTML = render(it);
    if (onRemove) {
      const b = document.createElement('button');
      b.className = 'rm';
      b.type = 'button';
      b.title = 'Togli (registrato per errore)';
      b.setAttribute('aria-label', `Togli «${it.text}»`);
      b.textContent = '✕';
      b.onclick = () => onRemove(it);
      li.append(b);
    }
    return li;
  }));
  const box = document.getElementById(`${id}-box`);
  box.hidden = !items.length;
  const n = document.getElementById(`${id}-n`);
  if (n) n.textContent = items.length ? String(items.length) : '';
}

/**
 * d: { study, prior, busy, enabled, onRemove(kind, item) }
 * study: { topic, learned[], review[], errors[] }  prior: { review[], errors[] }
 */
export function renderStudy(d) {
  const st = d.study || { learned: [], review: [], errors: [] };
  const prior = d.prior || { review: [], errors: [] };
  setText('ctx-topic-text', st.topic || (d.lesson ? 'In attesa del primo scambio' : '—'));
  fillList('study-review', st.review, (it) => `<span class="t">${esc(it.text)}</span>`, (it) => d.onRemove?.('review', it));
  fillList('study-errors', st.errors, (it) => `<span class="t">${esc(it.text)}${it.fix ? `<span class="sub">✓ ${esc(it.fix)}</span>` : ''}</span>${it.count > 1 ? `<span class="x">×${it.count}</span>` : ''}`, (it) => d.onRemove?.('errors', it));
  fillList('study-learned', st.learned, (it) => `<span class="t">${esc(it.text)}</span>`, (it) => d.onRemove?.('learned', it));
  const priorItems = [
    ...prior.errors.map((e) => ({ text: e.text, html: `<span class="t">${esc(e.text)}<span class="sub">errore${e.count > 1 ? ` ripetuto ${e.count} volte` : ''}${e.fix ? ` · ✓ ${esc(e.fix)}` : ''}</span></span>` })),
    ...prior.review.filter((r) => !prior.errors.some((e) => e.text.toLowerCase() === r.text.toLowerCase())).map((r) => ({ text: r.text, html: `<span class="t">${esc(r.text)}<span class="sub">da consolidare</span></span>` })),
  ];
  fillList('study-prior', priorItems, (it) => it.html, null);

  const total = st.learned.length + st.review.length;
  const ring = $('#study-ring');
  ring.hidden = total < 3;
  if (total >= 3) {
    const pct = Math.round((st.learned.length / total) * 100);
    $('#study-ring-text').textContent = `${pct}%`;
    $('#study-ring-fg').style.strokeDashoffset = String(97.4 * (1 - pct / 100));
    ring.title = `${st.learned.length} concetti chiari su ${total} emersi in questa sessione`;
  }
  const empty = !st.learned.length && !st.review.length && !st.errors.length && !priorItems.length;
  $('#study-empty').hidden = !empty;
  $('#study').dataset.busy = d.busy ? '1' : '0';
  setText('study-status', !d.enabled ? 'Registrazione disattivata nelle impostazioni.'
    : d.busy ? 'Aggiorno i progressi…'
      : d.error ? `Ultimo aggiornamento non riuscito: ${d.error}`
        : 'Registrati da JARVIS man mano che parlate.');
}

export function initUi() {
  initChrome();
  wave.init();
  reduceMotion.addEventListener?.('change', () => wave.kick());
}
