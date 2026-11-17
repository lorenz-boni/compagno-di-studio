import { streamChat, complete, listModels, benchmark, FALLBACK_MODELS } from './gemini.js';
import { Listener, speechSupported } from './speech.js';
import { Speaker, splitSentences, italianVoices, pickVoice, looksLikeEcho, ttsSupported } from './tts.js';
import { vaultSupported, pickVault, ensurePermission, listNotes, readNote, appendToNote, saveVaultHandle, loadVaultHandle, searchNotes, folderOverview } from './vault.js';
import { buildSystem, FINISHED_PREFIX, START_QUIZ, summaryRequest, VAULT_TOOLS } from './prompts.js';

const $ = (s) => document.querySelector(s);

// ---------- Impostazioni (solo in questo browser) ----------
const DEFAULTS = {
  key: '',
  model: 'gemini-flash-latest',
  fast: true,
  correction: 'subito',
  pause: 2.5,
  voice: '',
  rate: 1.05,
  mute: false,
  autosend: true,
};
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('compagno.settings') || '{}') };
} catch { /* storage non disponibile */ }
function saveSettings() {
  try { localStorage.setItem('compagno.settings', JSON.stringify(settings)); } catch { /* ignora */ }
}

// ---------- Stato ----------
let mode = 'racconto';
let note = null; // { title, text, path? }
let vault = { root: null, notes: [] };
let savedVault = null; // vault ricordato ma non ancora ricollegato (serve un clic per il permesso)
let history = []; // turni nel formato Gemini: { role, parts: [{ text }] }
let controller = null; // risposta in corso
let buffer = ''; // ciò che hai detto e non è ancora stato inviato
let silenceTimer = null;
let lastSpeechEnd = 0;
let thinkingSince = 0;
let lastTiming = '';

const MODE_HELP = {
  racconto: () => settings.correction === 'fine'
    ? 'Racconta tutto l\'argomento di fila. Quando hai finito premi "Ho finito": riceverai un resoconto completo.'
    : 'Racconta l\'argomento come a un compagno di corso. A ogni pausa ti dice se va bene o ti corregge. Parla sopra la sua voce per interromperlo.',
  interrogami: () => 'Premi 🎙️ (o "Ho finito"): il compagno inizia con la prima domanda. Rispondi a voce.',
  libera: () => 'Fai domande o discuti liberamente dell\'argomento.',
};

// ---------- Voce ----------
const speaker = new Speaker({
  onStart: updateStatus,
  onEnd: () => { lastSpeechEnd = Date.now(); updateStatus(); },
});
function applyVoiceSettings() {
  speaker.voiceName = settings.voice;
  speaker.rate = Number(settings.rate);
  speaker.muted = settings.mute;
}
applyVoiceSettings();

const listener = new Listener({
  onInterim: (t) => {
    if (!t) return;
    if (isEcho(t)) return;
    if (speaker.speaking && t.split(/\s+/).length >= 3) bargeIn();
    showLive(`${buffer} ${t}`);
    if (buffer) scheduleFlush();
  },
  onFinal: (t) => {
    if (isEcho(t)) return;
    if (speaker.speaking) bargeIn();
    buffer = `${buffer} ${t}`.trim();
    showLive(buffer);
    scheduleFlush();
  },
  onState: (on) => {
    const b = $('#btn-mic');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = on ? '⏹️ Smetti di ascoltare' : '🎙️ Inizia a parlare';
    updateStatus();
  },
  onError: (msg) => addBubble('error', msg),
});

function isEcho(heard) {
  const recentlySpeaking = speaker.speaking || Date.now() - lastSpeechEnd < 1200;
  return recentlySpeaking && looksLikeEcho(heard, speaker.spoken);
}

function bargeIn() {
  speaker.cancel();
  if (controller) controller.abort();
}

function scheduleFlush() {
  clearTimeout(silenceTimer);
  if (mode === 'racconto' && settings.correction === 'fine') return;
  silenceTimer = setTimeout(() => flush(), settings.pause * 1000);
}

function flush({ finished = false } = {}) {
  clearTimeout(silenceTimer);
  const text = buffer.trim();
  buffer = '';
  showLive('');
  if (!text) return false;
  const prefix = finished && mode === 'racconto' && settings.correction === 'fine' ? FINISHED_PREFIX : '';
  sendUser(text, prefix);
  return true;
}

// ---------- Conversazione ----------
function addUserTurn(text) {
  const last = history[history.length - 1];
  if (last?.role === 'user') last.parts.push({ text });
  else history.push({ role: 'user', parts: [{ text }] });
}

function sendUser(text, prefix = '', { hidden = false } = {}) {
  if (!settings.key) {
    addBubble('error', 'Manca la chiave API di Gemini: inseriscila nelle impostazioni.');
    openSettings();
    return;
  }
  if (controller) controller.abort();
  speaker.cancel();
  if (!hidden) addBubble('user', text);
  addUserTurn(prefix + text);
  respond();
}

function vaultInfo() {
  return vault.root ? { count: vault.notes.length, folders: folderOverview(vault.notes) } : null;
}

const FIRST_TOKEN_TIMEOUT = 60000; // sicurezza finale: i cambi di modello avvengono già dopo 10 s

async function respond() {
  const ctrl = new AbortController();
  controller = ctrl;
  const started = performance.now();
  thinkingSince = Date.now();
  updateStatus();
  const bubble = addBubble('bot', '…');
  let full = '';
  let parts = [];
  let timedOut = false;
  let timer = null;
  let firstAt = 0;
  let modelVersion = '';
  // Se nel frattempo è partita un'altra risposta (hai parlato di nuovo), questa non deve più toccare la cronologia.
  const current = () => controller === ctrl && !ctrl.signal.aborted;
  try {
    // Il modello può usare gli strumenti del vault prima di rispondere: al massimo 4 passaggi.
    for (let step = 0; step < 4; step++) {
      parts = [];
      let pending = '';
      if (full && !/\s$/.test(full)) full += ' ';
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, FIRST_TOKEN_TIMEOUT);
      const stream = streamChat({
        key: settings.key,
        model: settings.model || DEFAULTS.model,
        fast: settings.fast,
        system: buildSystem({ mode, correction: settings.correction, note, vault: vaultInfo() }),
        contents: history,
        tools: vault.root ? VAULT_TOOLS : undefined,
        signal: ctrl.signal,
        onNotice: (msg) => { addBubble('info', `⏳ ${msg}`); $('#log').append(bubble); },
      });
      for await (const chunk of stream) {
        clearTimeout(timer);
        if (!firstAt) firstAt = performance.now();
        if (chunk.modelVersion) modelVersion = chunk.modelVersion;
        parts.push(...chunk.parts);
        if (!chunk.text) continue;
        full += chunk.text;
        pending += chunk.text;
        const [ready, rest] = splitSentences(pending);
        pending = rest;
        ready.forEach((x) => speaker.say(x));
        renderInto(bubble, full);
        scrollLog();
      }
      clearTimeout(timer);
      splitSentences(pending, true)[0].forEach((x) => speaker.say(x));
      if (!current()) return;

      const calls = parts.filter((p) => p.functionCall);
      if (parts.length) history.push({ role: 'model', parts });
      parts = [];
      if (!calls.length) break;
      const responses = [];
      for (const c of calls) {
        responses.push({ functionResponse: { name: c.functionCall.name, response: await runTool(c.functionCall) } });
      }
      if (!current()) { history.pop(); return; } // chiamata rimasta senza risposta: la togliamo
      history.push({ role: 'user', parts: responses });
      $('#log').append(bubble); // la risposta va sotto ai messaggi "Cerco… / Appunti…"
    }
  } catch (err) {
    if (timedOut) addBubble('error', `Gemini non ha risposto entro ${FIRST_TOKEN_TIMEOUT / 1000} secondi. Riprova; in ⚙️ Impostazioni puoi usare «Prova velocità modelli» per scegliere il più rapido.`);
    else if (err.name !== 'AbortError') addBubble('error', err.message || String(err));
  } finally {
    clearTimeout(timer);
    if (controller === ctrl) {
      // Risposta interrotta parlandoci sopra: teniamo il testo già detto, mai una chiamata a strumento senza risposta.
      if (parts.some((p) => p.text) && !parts.some((p) => p.functionCall)) {
        history.push({ role: 'model', parts: parts.filter((p) => p.text) });
      }
      const last = history[history.length - 1];
      if (last?.role === 'model' && last.parts.some((p) => p.functionCall)) history.pop();
      controller = null;
    }
    if (full.trim()) {
      if (ctrl.signal.aborted && !timedOut) renderInto(bubble, `${full} …`);
    } else {
      bubble.remove();
    }
    if (firstAt) {
      lastTiming = `Risposta iniziata dopo ${((firstAt - started) / 1000).toFixed(1)} s${modelVersion ? ` · ${modelVersion}` : ''}`;
    }
    updateStatus();
  }
}

async function runTool({ name, args = {} }) {
  if (!vault.root) return { errore: 'Nessun vault collegato.' };
  if (name === 'cerca_note') {
    const query = String(args.query || '');
    const risultati = searchNotes(vault.notes, query);
    // Se una sola nota contiene tutte le parole cercate (o vince nettamente), la apriamo subito:
    // si risparmia un passaggio con Gemini e la risposta arriva prima.
    const strict = searchNotes(vault.notes, query, 2, { requireAll: true, withScore: true });
    const clear = strict.length === 1 || (strict.length === 2 && strict[0].score >= strict[1].score + 2);
    if (clear) {
      const n = vault.notes.find((x) => x.path === strict[0].path);
      try {
        await openNote(n);
        return { aperta: n.path, altri_risultati: risultati.filter((p) => p !== n.path).slice(0, 5), inizio: note.text.slice(0, 600) };
      } catch { /* se non si legge, restituiamo solo i risultati */ }
    }
    addBubble('info', `🔎 Cerco «${query}»: ${risultati.length ? `${risultati.length} risultati` : 'nessun risultato'}.`);
    return risultati.length ? { risultati } : { risultati: [], cartelle_disponibili: folderOverview(vault.notes) };
  }
  if (name === 'apri_nota') {
    const wanted = String(args.percorso || '');
    const found = vault.notes.find((n) => n.path === wanted)
      || vault.notes.find((n) => n.path.toLowerCase() === wanted.toLowerCase())
      || vault.notes.find((n) => n.path === searchNotes(vault.notes, wanted, 1)[0]);
    if (!found) return { errore: `Nota non trovata: ${wanted}. Usa prima cerca_note.` };
    try {
      await openNote(found);
      return { aperta: found.path, caratteri: note.text.length, inizio: note.text.slice(0, 800) };
    } catch (err) {
      return { errore: `Impossibile leggere la nota: ${err.message}` };
    }
  }
  return { errore: `Strumento sconosciuto: ${name}` };
}

function startQuizIfNeeded() {
  if (mode === 'interrogami' && history.length === 0 && !controller) {
    sendUser(START_QUIZ, '', { hidden: true });
    return true;
  }
  return false;
}

function resetSession(message = 'Nuova sessione.') {
  if (controller) controller.abort();
  speaker.cancel();
  history = [];
  buffer = '';
  showLive('');
  $('#log').replaceChildren();
  addBubble('info', message);
}

// ---------- Interfaccia: chat ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderInto(el, text) {
  const html = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  el.innerHTML = html;
}
function addBubble(kind, text) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}`;
  renderInto(li, text);
  $('#log').append(li);
  scrollLog();
  return li;
}
function scrollLog() {
  const log = $('#log');
  log.scrollTop = log.scrollHeight;
}
function showLive(text) {
  const el = $('#live');
  el.textContent = text.trim();
  el.hidden = !text.trim();
}
setInterval(() => { if (controller) updateStatus(); }, 1000);

function updateStatus() {
  const el = $('#status');
  let text = 'Pronto.';
  let cls = '';
  if (controller) {
    const secs = Math.floor((Date.now() - thinkingSince) / 1000);
    text = `Il compagno sta pensando…${secs >= 2 ? ` ${secs} s` : ''}`;
    cls = 'thinking';
  }
  else if (speaker.speaking) { text = 'Il compagno sta parlando… (parla pure per interromperlo)'; cls = 'speaking'; }
  else if (listener.active) {
    cls = 'listening';
    text = mode === 'racconto' && settings.correction === 'fine'
      ? 'Ti ascolto… premi "Ho finito" quando hai concluso.'
      : 'Ti ascolto…';
  }
  if (!controller && lastTiming) text += ` · ${lastTiming}`;
  el.textContent = text;
  el.className = `status ${cls}`;
}
function updateModeHelp() {
  $('#mode-help').textContent = MODE_HELP[mode]();
}

// ---------- Interfaccia: appunti ----------
function setNote(n, { announce = true } = {}) {
  note = n;
  try {
    if (n?.path) localStorage.setItem('compagno.lastNote', n.path);
    else localStorage.removeItem('compagno.lastNote');
  } catch { /* ignora */ }
  const box = $('#current-note');
  box.hidden = !n;
  $('#notes-hint').hidden = Boolean(n);
  if (n) {
    $('#current-title').textContent = n.title;
    $('#current-text').textContent = n.text;
  }
  highlightCurrent();
  if (announce) addBubble('info', n ? `📂 Appunti: «${n.path || n.title}».` : 'Appunti rimossi.');
}

// ---------- Esploratore delle note (come in Obsidian) ----------
let openFolders = new Set();
try { openFolders = new Set(JSON.parse(localStorage.getItem('compagno.openFolders') || '[]')); } catch { /* ignora */ }
function saveOpenFolders() {
  try { localStorage.setItem('compagno.openFolders', JSON.stringify([...openFolders])); } catch { /* ignora */ }
}

function buildTree(notes) {
  const root = { folders: new Map(), notes: [], count: 0 };
  for (const n of notes) {
    const parts = n.path.split('/');
    const file = parts.pop();
    let node = root;
    node.count++;
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      if (!node.folders.has(p)) node.folders.set(p, { path: acc, folders: new Map(), notes: [], count: 0 });
      node = node.folders.get(p);
      node.count++;
    }
    node.notes.push({ ...n, name: file.replace(/\.md$/i, '') });
  }
  return root;
}

const byName = (a, b) => a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' });

function noteButton(n, label) {
  const b = document.createElement('button');
  b.className = 'tree-note';
  b.dataset.path = n.path;
  b.setAttribute('role', 'treeitem');
  b.innerHTML = label;
  b.title = n.path;
  b.onclick = async () => {
    try { await openNote(n); } catch (err) { addBubble('error', `Non riesco a leggere la nota: ${err.message}`); }
  };
  return b;
}

function renderFolder(node, container) {
  for (const name of [...node.folders.keys()].sort(byName)) {
    const f = node.folders.get(name);
    const det = document.createElement('details');
    det.className = 'tree-folder';
    det.dataset.path = f.path;
    det.open = openFolders.has(f.path);
    const sum = document.createElement('summary');
    sum.innerHTML = `<span class="folder-name">${escapeHtml(name)}</span><span class="count">${f.count}</span>`;
    det.append(sum);
    const inner = document.createElement('div');
    inner.className = 'tree-children';
    det.append(inner);
    // Il contenuto viene creato solo quando apri la cartella: veloce anche con vault grandi.
    const fill = () => { if (!inner.childElementCount) renderFolder(f, inner); };
    det.fill = fill;
    if (det.open) fill();
    det.addEventListener('toggle', () => {
      if (det.open) { openFolders.add(f.path); fill(); highlightCurrent(); } else openFolders.delete(f.path);
      saveOpenFolders();
    });
    container.append(det);
  }
  for (const n of [...node.notes].sort((a, b) => byName(a.name, b.name))) {
    container.append(noteButton(n, `📄 ${escapeHtml(n.name)}`));
  }
}

function renderNoteList() {
  const tree = $('#note-tree');
  const q = $('#note-search').value.trim();
  if (q) {
    const lower = q.toLowerCase();
    const found = searchNotes(vault.notes, q, 60, { requireAll: true });
    const extra = vault.notes.filter((n) => n.path.toLowerCase().includes(lower) && !found.includes(n.path)).map((n) => n.path);
    const paths = [...found, ...extra].slice(0, 60);
    const box = document.createElement('div');
    box.className = 'search-results';
    if (!paths.length) box.innerHTML = '<p class="hint">Nessuna nota trovata.</p>';
    for (const p of paths) {
      const n = vault.notes.find((x) => x.path === p);
      const slash = p.lastIndexOf('/');
      const name = escapeHtml(p.slice(slash + 1).replace(/\.md$/i, ''));
      const dir = slash >= 0 ? `<span class="dir">${escapeHtml(p.slice(0, slash))}</span>` : '';
      box.append(noteButton(n, `<span>📄 ${name}</span>${dir}`));
    }
    tree.replaceChildren(box);
  } else {
    tree.replaceChildren();
    renderFolder(buildTree(vault.notes), tree);
  }
  highlightCurrent();
}

/** Evidenzia la nota aperta e apre le sue cartelle, come fa Obsidian. */
function highlightCurrent({ reveal = false } = {}) {
  const tree = $('#note-tree');
  if (!tree) return;
  if (reveal && note?.path && !$('#note-search').value.trim()) {
    const parts = note.path.split('/').slice(0, -1);
    let acc = '';
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      const det = tree.querySelector(`details[data-path="${CSS.escape(acc)}"]`);
      if (!det) break;
      det.open = true;
      det.fill(); // crea subito il contenuto, così la sottocartella successiva esiste già
      openFolders.add(acc);
    }
    saveOpenFolders();
  }
  tree.querySelectorAll('.tree-note').forEach((b) => {
    const cur = Boolean(note?.path) && b.dataset.path === note.path;
    b.setAttribute('aria-current', String(cur));
    if (cur && reveal) b.scrollIntoView({ block: 'nearest' });
  });
}

async function openNote(n, opts) {
  const text = await readNote(n.handle);
  setNote({ title: n.path.split('/').pop().replace(/\.md$/i, ''), text, path: n.path }, opts);
  highlightCurrent({ reveal: true });
}

/** Collega il vault. `quiet`: all'avvio automatico, senza messaggi se va tutto bene. */
async function openVault(handle, { quiet = false } = {}) {
  try {
    if (!(await ensurePermission(handle, 'readwrite'))) {
      addBubble('error', 'Permesso sul vault negato. Quando Chrome lo chiede, scegli «Consenti a ogni visita».');
      return false;
    }
    vault = { root: handle, notes: await listNotes(handle) };
    savedVault = null;
    await saveVaultHandle(handle);
    $('#note-search').hidden = false;
    $('#btn-vault-reopen').hidden = true;
    $('#btn-vault').textContent = '📁 Cambia vault';
    const status = $('#vault-status');
    status.hidden = false;
    status.textContent = `✅ Collegato a «${handle.name}» · ${vault.notes.length} note`;
    renderNoteList();
    if (!vault.notes.length) {
      addBubble('error', `Nella cartella «${handle.name}» non ho trovato note .md. Devi scegliere la cartella principale del vault (quella che contiene la cartella .obsidian), non una sottocartella di allegati.`);
    } else if (!quiet) {
      addBubble('info', `Vault «${handle.name}» collegato: ${vault.notes.length} note. Ora puoi dire, per esempio, «apri Fluidodinamica 1, lezione 3».`);
    }
    // Riapre l'ultima nota usata.
    let last = null;
    try { last = localStorage.getItem('compagno.lastNote'); } catch { /* ignora */ }
    const n = last && !note && vault.notes.find((x) => x.path === last);
    if (n) await openNote(n, { announce: !quiet });
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') addBubble('error', `Impossibile aprire il vault: ${err.message}`);
    return false;
  }
}

/** All'avvio: se Chrome ha già il permesso ("Consenti a ogni visita") il vault si collega da solo. */
async function autoConnectVault() {
  if (!vaultSupported) return;
  const h = await loadVaultHandle();
  if (!h) return;
  let state = 'prompt';
  try { state = await h.queryPermission({ mode: 'readwrite' }); } catch { /* ignora */ }
  if (state === 'granted') {
    await openVault(h, { quiet: true });
  } else {
    savedVault = h;
    const b = $('#btn-vault-reopen');
    b.hidden = false;
    b.textContent = `↻ Ricollega «${h.name}»`;
  }
}

// ---------- Impostazioni: dialog ----------
function fillVoices() {
  const sel = $('#set-voice');
  const voices = italianVoices();
  sel.replaceChildren(...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.name)));
  if (!voices.length) sel.append(new Option('Nessuna voce italiana trovata', ''));
  const chosen = pickVoice(settings.voice);
  if (chosen) sel.value = chosen.name;
}

function openSettings() {
  $('#set-key').value = settings.key;
  $('#set-model').value = settings.model;
  $('#set-fast').checked = settings.fast;
  document.querySelectorAll('input[name="correction"]').forEach((r) => { r.checked = r.value === settings.correction; });
  $('#set-pause').value = settings.pause;
  $('#out-pause').textContent = settings.pause;
  $('#set-rate').value = settings.rate;
  $('#out-rate').textContent = settings.rate;
  $('#set-mute').checked = settings.mute;
  $('#set-autosend').checked = settings.autosend;
  fillVoices();
  $('#dlg-settings').showModal();
}

function readSettingsForm() {
  settings.key = $('#set-key').value.trim();
  settings.model = $('#set-model').value.trim() || DEFAULTS.model;
  settings.fast = $('#set-fast').checked;
  settings.correction = document.querySelector('input[name="correction"]:checked')?.value || 'subito';
  settings.pause = Number($('#set-pause').value);
  settings.voice = $('#set-voice').value;
  settings.rate = Number($('#set-rate').value);
  settings.mute = $('#set-mute').checked;
  settings.autosend = $('#set-autosend').checked;
  saveSettings();
  applyVoiceSettings();
  updateModeHelp();
  updateStatus();
}

// ---------- Collegamento dei pulsanti ----------
function init() {
  updateModeHelp();
  updateStatus();

  if (!speechSupported) addBubble('info', 'Questo browser non ha il riconoscimento vocale: usa Chrome, oppure detta con Wispr Flow nella casella in basso.');
  if (!ttsSupported) addBubble('info', 'Questo browser non può leggere le risposte ad alta voce.');
  if (!vaultSupported) $('#btn-vault').hidden = true;

  // Modalità
  document.querySelectorAll('.modes button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.mode === mode) return;
      mode = b.dataset.mode;
      document.querySelectorAll('.modes button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      updateModeHelp();
      resetSession(`Modalità: ${b.textContent}.`);
    };
  });

  // Microfono
  $('#btn-mic').onclick = async () => {
    if (listener.active) {
      listener.stop();
      flush();
    } else {
      if (savedVault && !vault.root) await openVault(savedVault, { quiet: true });
      listener.start();
      startQuizIfNeeded();
    }
  };
  $('#btn-done').onclick = async () => {
    if (savedVault && !vault.root) await openVault(savedVault, { quiet: true });
    if (!flush({ finished: true })) startQuizIfNeeded();
  };
  $('#btn-stop-voice').onclick = () => speaker.cancel();
  $('#btn-reset').onclick = () => resetSession();

  // Testo / Wispr Flow
  const input = $('#text-input');
  let autoTimer = null;
  const sendTyped = async () => {
    if (savedVault && !vault.root) await openVault(savedVault, { quiet: true });
    clearTimeout(autoTimer);
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    const prefix = mode === 'racconto' && settings.correction === 'fine' ? FINISHED_PREFIX : '';
    sendUser(t, prefix);
  };
  $('#text-form').onsubmit = (e) => { e.preventDefault(); sendTyped(); };
  input.addEventListener('keydown', (e) => {
    clearTimeout(autoTimer);
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendTyped(); }
  });
  // Wispr Flow inserisce il testo dettato tutto insieme (come un incolla): in quel caso lo inviamo da solo.
  input.addEventListener('input', (e) => {
    if (!settings.autosend) return;
    const bulk = e.inputType === 'insertFromPaste' || e.inputType === 'insertReplacementText' || (e.inputType === 'insertText' && (e.data || '').length > 12);
    if (!bulk) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(sendTyped, 1200);
  });

  // Appunti
  $('#btn-vault').onclick = async () => {
    try { await openVault(await pickVault()); } catch (err) { if (err.name !== 'AbortError') addBubble('error', err.message); }
  };
  $('#btn-vault-reopen').onclick = async () => {
    const h = savedVault || (await loadVaultHandle());
    if (h) await openVault(h);
  };
  autoConnectVault();
  $('#note-search').oninput = renderNoteList;
  $('#note-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#note-tree .tree-note')?.click(); }
    if (e.key === 'Escape') { e.target.value = ''; renderNoteList(); }
  });
  $('#file-input').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const texts = await Promise.all(files.map((f) => f.text()));
    const titles = files.map((f) => f.name.replace(/\.(md|markdown|txt)$/i, ''));
    const text = files.length === 1 ? texts[0] : texts.map((t, i) => `# ${titles[i]}\n\n${t}`).join('\n\n');
    setNote({ title: titles.join(' + '), text });
    e.target.value = '';
  };
  $('#btn-paste').onclick = () => {
    $('#paste-title').value = '';
    $('#paste-text').value = '';
    $('#dlg-paste').showModal();
  };
  $('#dlg-paste').addEventListener('close', () => {
    if ($('#dlg-paste').returnValue !== 'ok') return;
    const text = $('#paste-text').value.trim();
    if (text) setNote({ title: $('#paste-title').value.trim() || 'Appunti incollati', text });
  });
  $('#btn-clear-note').onclick = () => setNote(null);

  // Impostazioni
  $('#btn-settings').onclick = openSettings;
  $('#dlg-settings').addEventListener('close', readSettingsForm);
  $('#set-pause').oninput = (e) => { $('#out-pause').textContent = e.target.value; };
  $('#set-rate').oninput = (e) => { $('#out-rate').textContent = e.target.value; };
  $('#btn-test-voice').onclick = () => {
    const prev = { ...settings };
    settings.voice = $('#set-voice').value;
    settings.rate = Number($('#set-rate').value);
    settings.mute = false;
    applyVoiceSettings();
    speaker.say('Ciao! Sono il tuo compagno di studio. Raccontami cosa hai studiato oggi.');
    Object.assign(settings, prev);
    applyVoiceSettings();
  };
  $('#btn-bench').onclick = async () => {
    const key = $('#set-key').value.trim();
    if (!key) { $('#set-key').focus(); return; }
    const btn = $('#btn-bench');
    const out = $('#bench-results');
    btn.disabled = true;
    btn.textContent = '⏱️ Sto misurando…';
    out.replaceChildren();
    const current = $('#set-model').value.trim() || DEFAULTS.model;
    const models = [...new Set([current, 'gemini-flash-latest', ...FALLBACK_MODELS])];
    const rows = await benchmark(key, models, (r) => {
      const li = document.createElement('li');
      const ok = r.status === 'ok';
      li.innerHTML = `<button type="button" class="ghost small" ${ok ? '' : 'disabled'}>Usa</button> <strong>${escapeHtml(r.model)}</strong>: ${ok ? `${(r.ms / 1000).toFixed(1)} s` : escapeHtml(String(r.status))}`;
      li.querySelector('button').onclick = () => { $('#set-model').value = r.model; };
      out.append(li);
    });
    const best = rows.filter((r) => r.status === 'ok').sort((a, b) => a.ms - b.ms)[0];
    if (best) {
      $('#set-model').value = best.model;
      const p = document.createElement('li');
      p.className = 'hint';
      p.textContent = `Ho scelto il più veloce: ${best.model}. Premi «Salva» per tenerlo.`;
      out.append(p);
    }
    btn.disabled = false;
    btn.textContent = '⏱️ Prova velocità modelli';
  };
  $('#btn-load-models').onclick = async () => {
    const key = $('#set-key').value.trim();
    if (!key) { $('#set-key').focus(); return; }
    try {
      const models = await listModels(key);
      $('#model-list').replaceChildren(...models.map((m) => new Option(m, m)));
      $('#btn-load-models').textContent = `${models.length} modelli ✓`;
    } catch (err) {
      $('#btn-load-models').textContent = 'Errore';
      alert(err.message);
    }
  };
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { if ($('#dlg-settings').open) fillVoices(); };

  // Facciamo il punto
  $('#btn-summary').onclick = makeSummary;
  $('#btn-copy-summary').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#summary-text').value);
      $('#btn-copy-summary').textContent = 'Copiato ✓';
    } catch {
      $('#summary-text').select();
    }
  };
  $('#btn-save-summary').onclick = saveSummary;

  if (!settings.key) {
    addBubble('info', 'Benvenuto! Per iniziare incolla la tua chiave gratuita di Gemini nelle impostazioni.');
    openSettings();
  }
}

// ---------- Facciamo il punto ----------
async function makeSummary() {
  if (!history.some((h) => h.role === 'model')) {
    addBubble('info', 'Prima studiamo un po\': non c\'è ancora niente da riassumere.');
    return;
  }
  if (!settings.key) { openSettings(); return; }
  speaker.cancel();
  const btn = $('#btn-summary');
  btn.disabled = true;
  btn.textContent = '📝 Sto scrivendo…';
  try {
    const date = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-GG
    const text = await complete({
      key: settings.key,
      model: settings.model || DEFAULTS.model,
      fast: false,
      timeoutMs: 40000,
      system: buildSystem({ mode, correction: settings.correction, note }),
      contents: [...history, { role: 'user', parts: [{ text: summaryRequest(date) }] }],
    });
    $('#summary-text').value = text.trim();
    $('#btn-copy-summary').textContent = '📋 Copia';
    const canSave = Boolean(note?.path && vault.root);
    const save = $('#btn-save-summary');
    save.disabled = !canSave;
    save.textContent = '💾 Aggiungi alla nota';
    $('#summary-target').textContent = canSave
      ? `Verrà aggiunto in fondo a «${note.path}». Prima viene salvata una copia in .compagno/backup/ nel vault.`
      : 'Per salvarlo direttamente apri la nota dal vault Obsidian; altrimenti copialo e incollalo tu.';
    $('#dlg-summary').showModal();
  } catch (err) {
    addBubble('error', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '📝 Facciamo il punto';
  }
}

async function saveSummary() {
  const btn = $('#btn-save-summary');
  try {
    const backup = await appendToNote(vault.root, note.path, $('#summary-text').value);
    const fresh = vault.notes.find((n) => n.path === note.path);
    if (fresh) note.text = await readNote(fresh.handle);
    $('#current-text').textContent = note.text;
    btn.textContent = 'Salvato ✓';
    btn.disabled = true;
    addBubble('info', `Resoconto aggiunto a «${note.path}». Copia di sicurezza: ${backup}`);
  } catch (err) {
    addBubble('error', `Salvataggio non riuscito: ${err.message}`);
  }
}

init();
