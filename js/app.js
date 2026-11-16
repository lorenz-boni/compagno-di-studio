import { streamChat, complete, listModels } from './gemini.js';
import { Listener, speechSupported } from './speech.js';
import { Speaker, splitSentences, italianVoices, pickVoice, looksLikeEcho, ttsSupported } from './tts.js';
import { vaultSupported, pickVault, ensurePermission, listNotes, readNote, appendToNote, saveVaultHandle, loadVaultHandle } from './vault.js';
import { buildSystem, FINISHED_PREFIX, START_QUIZ, summaryRequest } from './prompts.js';

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
let history = []; // turni nel formato Gemini: { role, parts: [{ text }] }
let controller = null; // risposta in corso
let buffer = ''; // ciò che hai detto e non è ancora stato inviato
let silenceTimer = null;
let lastSpeechEnd = 0;

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
  if (last?.role === 'user') last.parts[0].text += `\n${text}`;
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

async function respond() {
  const ctrl = new AbortController();
  controller = ctrl;
  updateStatus();
  const bubble = addBubble('bot', '…');
  let full = '';
  let pending = '';
  try {
    const stream = streamChat({
      key: settings.key,
      model: settings.model || DEFAULTS.model,
      fast: settings.fast,
      system: buildSystem({ mode, correction: settings.correction, note }),
      contents: history,
      signal: ctrl.signal,
    });
    for await (const chunk of stream) {
      full += chunk;
      pending += chunk;
      const [ready, rest] = splitSentences(pending);
      pending = rest;
      ready.forEach((s) => speaker.say(s));
      renderInto(bubble, full);
      scrollLog();
    }
    const [last] = splitSentences(pending, true);
    last.forEach((s) => speaker.say(s));
  } catch (err) {
    if (err.name !== 'AbortError') addBubble('error', err.message || String(err));
  } finally {
    if (full.trim()) {
      history.push({ role: 'model', parts: [{ text: full }] });
      if (ctrl.signal.aborted) renderInto(bubble, `${full} …`);
    } else {
      bubble.remove();
    }
    if (controller === ctrl) controller = null;
    updateStatus();
  }
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
function updateStatus() {
  const el = $('#status');
  let text = 'Pronto.';
  let cls = '';
  if (controller) { text = 'Il compagno sta pensando…'; cls = 'thinking'; }
  else if (speaker.speaking) { text = 'Il compagno sta parlando… (parla pure per interromperlo)'; cls = 'speaking'; }
  else if (listener.active) {
    cls = 'listening';
    text = mode === 'racconto' && settings.correction === 'fine'
      ? 'Ti ascolto… premi "Ho finito" quando hai concluso.'
      : 'Ti ascolto…';
  }
  el.textContent = text;
  el.className = `status ${cls}`;
}
function updateModeHelp() {
  $('#mode-help').textContent = MODE_HELP[mode]();
}

// ---------- Interfaccia: appunti ----------
function setNote(n) {
  note = n;
  const box = $('#current-note');
  box.hidden = !n;
  $('#notes-hint').hidden = Boolean(n);
  if (n) {
    $('#current-title').textContent = n.title;
    $('#current-text').textContent = n.text;
  }
  document.querySelectorAll('#note-list button').forEach((b) => {
    b.setAttribute('aria-current', String(Boolean(n?.path) && b.dataset.path === n.path));
  });
  if (history.length) addBubble('info', n ? `Ora gli appunti sono: «${n.title}».` : 'Appunti rimossi: il compagno userà la conoscenza generale.');
}

function renderNoteList() {
  const q = $('#note-search').value.trim().toLowerCase();
  const list = $('#note-list');
  const items = vault.notes.filter((n) => !q || n.path.toLowerCase().includes(q)).slice(0, 400);
  list.replaceChildren(...items.map((n) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.dataset.path = n.path;
    const slash = n.path.lastIndexOf('/');
    b.innerHTML = slash >= 0
      ? `<span class="dir">${escapeHtml(n.path.slice(0, slash + 1))}</span>${escapeHtml(n.path.slice(slash + 1, -3))}`
      : escapeHtml(n.path.slice(0, -3));
    b.setAttribute('aria-current', String(note?.path === n.path));
    b.onclick = async () => {
      try {
        const text = await readNote(n.handle);
        setNote({ title: n.path.split('/').pop().replace(/\.md$/i, ''), text, path: n.path });
      } catch (err) {
        addBubble('error', `Non riesco a leggere la nota: ${err.message}`);
      }
    };
    li.append(b);
    return li;
  }));
}

async function openVault(handle) {
  try {
    if (!(await ensurePermission(handle, 'readwrite'))) {
      addBubble('error', 'Permesso sul vault negato.');
      return;
    }
    vault = { root: handle, notes: await listNotes(handle) };
    await saveVaultHandle(handle);
    $('#note-search').hidden = false;
    $('#btn-vault-reopen').hidden = true;
    renderNoteList();
    addBubble('info', `Vault «${handle.name}» aperto: ${vault.notes.length} note.`);
  } catch (err) {
    if (err.name !== 'AbortError') addBubble('error', `Impossibile aprire il vault: ${err.message}`);
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
  $('#btn-mic').onclick = () => {
    if (listener.active) {
      listener.stop();
      flush();
    } else {
      listener.start();
      startQuizIfNeeded();
    }
  };
  $('#btn-done').onclick = () => {
    if (!flush({ finished: true })) startQuizIfNeeded();
  };
  $('#btn-stop-voice').onclick = () => speaker.cancel();
  $('#btn-reset').onclick = () => resetSession();

  // Testo / Wispr Flow
  const input = $('#text-input');
  let autoTimer = null;
  const sendTyped = () => {
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
    const h = await loadVaultHandle();
    if (h) await openVault(h);
  };
  loadVaultHandle().then((h) => { if (h && vaultSupported) { $('#btn-vault-reopen').hidden = false; $('#btn-vault-reopen').textContent = `↻ Riapri «${h.name}»`; } });
  $('#note-search').oninput = renderNoteList;
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
