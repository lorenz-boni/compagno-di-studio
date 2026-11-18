import { streamChat, complete, isNoFreeTier, NO_FREE_TIER_MSG, listModels, benchmark, listAllModels, chatCandidates, liveCandidates, setFallbackModels } from './gemini.js?v=202611180940';
import { Listener, speechSupported } from './speech.js?v=202611180940';
import { Speaker, cleanForSpeech, splitSentences, italianVoices, pickVoice, looksLikeEcho, ttsSupported } from './tts.js?v=202611180940';
import { vaultSupported, pickVault, ensurePermission, listNotes, readNote, readNoteFull, appendToNote, saveVaultHandle, loadVaultHandle, searchNotes, folderOverview } from './vault.js?v=202611180940';
import { buildSystem, TONES, rateLabel, speedInstruction, FINISHED_PREFIX, START_QUIZ, START_EXPLAIN, summaryRequest, VAULT_TOOLS, LIVE_EXTRA } from './prompts.js?v=202611180940';

import { newSession, hasContent, listSessions, saveSession, deleteSession, importFromVault, subjectOf } from './sessions.js?v=202611180940';
import { LiveSession, NaturalReader, pickLiveModels, LIVE_VOICES, previewVoice, playChunks, DEFAULT_LIVE_VOICE, SAFE_LIVE_VOICE, CLASSIC_VOICES } from './live.js?v=202611180940';
import { createWidget } from './widget.js?v=202611180940';
import { mountVoicePicker } from './voicepicker.js?v=202611180940';
import { createOnboarding } from './onboarding.js?v=202611180940';
import { initUi, setCoreState, setConnection, setLevelProvider, renderContext, MicMeter, renderStudy } from './ui.js?v=202611180940';
import { emptyStudy, mergeStudy, annotate, priorFromSessions, memoryText } from './study.js?v=202611180940';
import { stripExt, isMarkdown, kindOf, extractText, fileToBase64, OCR_PROMPT, ACCEPT } from './docs.js?v=202611180940';
import { dbGet, dbPut } from './db.js?v=202611180940';

const $ = (s) => document.querySelector(s);

// ---------- Impostazioni (solo in questo browser) ----------
const DEFAULTS = {
  key: '',
  model: 'gemini-flash-latest',
  fast: true,
  correction: 'subito',
  pause: 2.5,
  voice: '',
  fallbacks: [], // modelli di riserva misurati con «Prova velocità modelli», dal più veloce
  liveModel: '', // modello Gemini Live preferito (vuoto = scelta automatica)
  liveVoice: DEFAULT_LIVE_VOICE,
  tone: 'confidenziale', // confidenziale | equilibrato | professionale
  onboarded: false, // presentazione iniziale completata
  voiceSupport: {}, // per ogni voce: con quale modello Live funziona (ok) e con quali no (ko)
  voiceEngine: 'naturale', // risposte lette con la voce naturale di Gemini ('naturale') o con quella di Chrome ('chrome')
  liveModels: [], // modelli Live disponibili per la chiave
  annotate: true, // registra argomento, concetti ed errori dopo ogni risposta
  profile: { name: '', university: '', degree: '', year: '', notes: '' }, // percorso di studi, per dare contesto a JARVIS
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
let session = newSession(); // conversazione corrente (salvata nel pannello a destra)
let sessionsCache = [];
let restoring = false;
// Conversazione dal vivo (Gemini Live)
let live = null;
let liveQueue = [];
let liveState = '';
let liveSpeaking = false;
let liveUser = '';
let liveBot = '';
let liveBotBubble = null;
let liveUserStopped = false;
let liveModelName = '';
let lastErrorAt = 0;
let widget = null; // mini barra sempre in primo piano (creata più sotto)
let paused = false; // pausa: JARVIS non parla e non ascolta finché non riprendi
let pausedListening = false; // il microfono classico era acceso quando hai messo in pausa
let activityStart = 0; // inizio della sessione di studio corrente (per la durata nel pannello)
const micMeter = new MicMeter();
// Progressi di studio (annotatore in background)
let pendingUser = ''; // ciò che l'utente ha detto dall'ultima risposta di JARVIS
let annotating = false;
const annotateQueue = [];
let studyError = '';
let studySig = '';

const MODE_HELP = {
  racconto: () => settings.correction === 'fine'
    ? 'Racconta tutto l\'argomento di fila. Quando hai finito premi "Ho finito": riceverai un resoconto completo.'
    : 'Racconta l\'argomento come a un compagno di corso. A ogni pausa ti dice se va bene o ti corregge. Parla sopra la sua voce per interromperlo.',
  spiegami: () => 'Il compagno ti rispiega gli appunti sezione per sezione, senza saltare niente, e alla fine di ogni parte ti fa una domanda. Premi 🎙️ per iniziare; di\' «vai avanti» per passare alla parte successiva.',
  interrogami: () => 'Premi 🎙️ (o "Ho finito"): il compagno inizia con la prima domanda. Rispondi a voce.',
  libera: () => 'Fai domande o discuti liberamente dell\'argomento.',
};

// ---------- Voce ----------
// Voce delle risposte: naturale (una voce di Gemini Live legge il testo) con la voce di Chrome come riserva.
const chromeSpeaker = new Speaker({
  onStart: updateStatus,
  onEnd: () => { lastSpeechEnd = Date.now(); updateStatus(); },
});
let naturalFailedAt = 0;
function naturalModel() {
  const models = settings.liveModels || [];
  return models.length ? orderModelsForVoice(pickLiveModels(models, settings.liveModel), settings.liveVoice)[0] : '';
}
function useNatural() {
  return settings.voiceEngine !== 'chrome' && Boolean(settings.key) && Boolean(naturalModel())
    && Date.now() - naturalFailedAt > 5 * 60 * 1000;
}
const reader = new NaturalReader({
  getConfig: () => ({ key: settings.key, model: naturalModel(), voice: settings.liveVoice || DEFAULT_LIVE_VOICE, speed: speedInstruction(settings.rate) }),
  onStart: updateStatus,
  onEnd: () => { lastSpeechEnd = Date.now(); updateStatus(); },
  onFail: (err, left) => {
    naturalFailedAt = Date.now();
    addBubble('info', isNoFreeTier(err.message)
      ? `🔈 ${NO_FREE_TIER_MSG} Intanto leggo con la voce di Chrome.`
      : `🔈 Voce naturale non disponibile in questo momento (${err.message}): per qualche minuto uso la voce di Chrome.`, { transient: true });
    left.forEach((t) => chromeSpeaker.say(t));
  },
});
const speaker = {
  get speaking() { return chromeSpeaker.speaking || reader.speaking; },
  get spoken() { return reader.speaking ? reader.spoken : chromeSpeaker.spoken; },
  set voiceName(v) { chromeSpeaker.voiceName = v; },
  set rate(r) { chromeSpeaker.rate = r; },
  set muted(m) { chromeSpeaker.muted = m; },
  say(text) {
    if (settings.mute) return;
    if (useNatural()) reader.say(cleanForSpeech(text));
    else chromeSpeaker.say(text);
  },
  pause() { chromeSpeaker.pause(); reader.pause(); },
  resume() { chromeSpeaker.resume(); reader.resume(); },
  cancel() { chromeSpeaker.cancel(); reader.cancel(); },
  level() { return reader.speaking ? reader.level() : null; },
};
function applyVoiceSettings() {
  speaker.voiceName = settings.voice;
  speaker.rate = Number(settings.rate);
  speaker.muted = settings.mute;
}
applyVoiceSettings();
setFallbackModels(settings.fallbacks);

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
    b.querySelector('.lbl').textContent = on ? 'Smetti di ascoltare' : 'Microfono classico';
    if (on) micMeter.start(); else micMeter.stop();
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

// ---------- Pausa ----------
function updatePauseUi() {
  const b = $('#btn-pause');
  b.setAttribute('aria-pressed', String(paused));
  b.querySelector('.lbl').textContent = paused ? 'Riprendi' : 'Pausa';
  b.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  b.title = paused ? 'Riprendi da dove JARVIS si era fermato' : 'Metti in pausa JARVIS (poi riparte da dove era rimasto)';
  updateStatus();
}

function setPaused(on) {
  if (on === paused) return;
  paused = on;
  lastErrorAt = 0; // hai appena fatto qualcosa: il segnale d'errore non serve più
  if (on) {
    pausedListening = listener.active;
    if (listener.active) listener.stop();
    clearTimeout(silenceTimer);
    speaker.pause();
    live?.pause();
  } else {
    speaker.resume();
    live?.resume();
    if (pausedListening && !live) listener.start();
    pausedListening = false;
  }
  updatePauseUi();
}

/** Esce dalla pausa senza riprendere ciò che era rimasto in sospeso (es. quando dici o scrivi qualcosa di nuovo). */
function clearPause() {
  if (!paused) return;
  paused = false;
  pausedListening = false;
  live?.resume();
  updatePauseUi();
}

// ---------- Conversazione ----------
function addUserTurn(text) {
  const last = history[history.length - 1];
  if (last?.role === 'user') last.parts.push({ text });
  else history.push({ role: 'user', parts: [{ text }] });
}

function sendUser(text, prefix = '', { hidden = false } = {}) {
  if (!activityStart) activityStart = Date.now();
  clearPause();
  lastErrorAt = 0;
  if (!settings.key) {
    addBubble('error', 'Manca la chiave API di Gemini: inseriscila nelle impostazioni.');
    openSettings();
    return;
  }
  if (controller) controller.abort();
  speaker.cancel();
  if (!hidden) {
    addBubble('user', text);
    pendingUser += `${pendingUser ? '\n' : ''}${text}`;
  }
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
        system: buildSystem({ mode, correction: settings.correction, note, vault: vaultInfo(), memory: studyMemory(), profile: settings.profile, tone: settings.tone }),
        contents: modelHistory(),
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
    if (full.trim() && !ctrl.signal.aborted) {
      queueAnnotate(pendingUser, full);
      pendingUser = '';
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
    touchSession();
  }
}

async function runTool({ name, args = {} }, { live: isLive = false } = {}) {
  // In chiamata dal vivo il prompt non si può aggiornare: gli appunti aperti vanno restituiti per intero.
  const fullText = () => (isLive ? { testo: note.text.slice(0, 60000) } : {});
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
        return { aperta: n.path, altri_risultati: risultati.filter((p) => p !== n.path).slice(0, 5), inizio: note.text.slice(0, 600), ...fullText() };
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
      return { aperta: found.path, caratteri: note.text.length, inizio: note.text.slice(0, 800), ...fullText() };
    } catch (err) {
      return { errore: `Impossibile leggere la nota: ${err.message}` };
    }
  }
  return { errore: `Strumento sconosciuto: ${name}` };
}

/** Testo con cui il compagno inizia da solo (Interrogami / Spiegami), una volta per modalità e conversazione. */
function kickoffText() {
  if (session.kickedOff === mode) return '';
  if (mode === 'interrogami') return START_QUIZ;
  if (mode === 'spiegami' && note) return START_EXPLAIN;
  return '';
}

function startQuizIfNeeded() {
  if (controller) return false;
  const k = kickoffText();
  if (!k) return false;
  session.kickedOff = mode;
  sendUser(k, '', { hidden: true });
  return true;
}

/** Cronologia da mandare al modello: le ultime N voci, iniziando sempre da un messaggio dell'utente. */
function modelHistory(max = 40) {
  let h = history.slice(-max);
  while (h.length && !(h[0].role === 'user' && h[0].parts.some((p) => p.text))) h = h.slice(1);
  return h;
}

async function startNewSession() {
  clearPause();
  if (live) stopLive();
  if (controller) controller.abort();
  speaker.cancel();
  await flushSave();
  session = newSession();
  session.mode = mode;
  activityStart = 0;
  pendingUser = '';
  history = [];
  buffer = '';
  showLive('');
  $('#log').replaceChildren();
  addBubble('info', note ? `Nuova conversazione su «${note.title}».` : 'Nuova conversazione.', { transient: true });
  renderSessions();
}

// ---------- Conversazione dal vivo (Gemini Live) ----------
function commitLiveUser() {
  const t = liveUser.trim();
  liveUser = '';
  showLive('');
  if (!t) return;
  addBubble('user', t);
  addUserTurn(t);
  pendingUser += `${pendingUser ? '\n' : ''}${t}`;
}
function commitLiveBot(suffix = '') {
  const t = liveBot.trim();
  if (t) {
    history.push({ role: 'model', parts: [{ text: t }] });
    if (suffix && liveBotBubble) renderInto(liveBotBubble, t + suffix);
    queueAnnotate(pendingUser, t);
    pendingUser = '';
  }
  liveBot = '';
  liveBotBubble = null;
}
/** Turni precedenti solo testuali, per dare a Gemini Live il contesto della conversazione. */
function liveSeed() {
  const out = [];
  for (const h of modelHistory(30)) {
    const parts = h.parts.filter((p) => p.text).map((p) => ({ text: p.text }));
    if (!parts.length) continue;
    const last = out[out.length - 1];
    if (last?.role === h.role) last.parts.push(...parts);
    else out.push({ role: h.role, parts });
  }
  return out;
}
function updateLiveUi() {
  const b = $('#btn-live');
  b.querySelector('.lbl').textContent = live ? 'Chiudi chiamata' : 'Parla con JARVIS';
  b.querySelector('use').setAttribute('href', live ? '#i-phone-off' : '#i-mic');
  b.setAttribute('aria-pressed', String(Boolean(live)));
  $('#btn-mic').disabled = Boolean(live);
  $('#btn-done').disabled = Boolean(live);
  updateStatus();
}

async function startLive() {
  if (!settings.key) { openSettings(); return; }
  clearPause();
  reader.close(); // una sola sessione vocale alla volta
  if (controller) controller.abort();
  speaker.cancel();
  if (listener.active) listener.stop();
  buffer = '';
  showLive('');
  let available = settings.liveModels;
  if (!available?.length) {
    try {
      available = liveCandidates(await listAllModels(settings.key));
      settings.liveModels = available;
      saveSettings();
    } catch (err) {
      addBubble('error', err.message || String(err));
      return;
    }
  }
  liveQueue = orderModelsForVoice(pickLiveModels(available, settings.liveModel), settings.liveVoice);
  if (!liveQueue.length) {
    addBubble('error', 'La tua chiave non ha modelli Gemini Live disponibili.');
    return;
  }
  connectLive(0);
}

async function connectLive(i, voice = settings.liveVoice) {
  const model = liveQueue[i];
  liveModelName = model;
  const kickoff = kickoffText();
  if (kickoff) session.kickedOff = mode;
  let announced = false;
  liveUserStopped = false;
  const s = new LiveSession({
    key: settings.key,
    model,
    voice,
    system: buildSystem({ mode, correction: settings.correction, note, vault: vaultInfo(), memory: studyMemory(), profile: settings.profile, tone: settings.tone }) + LIVE_EXTRA
      + (speedInstruction(settings.rate) ? `\n\nRITMO: ${speedInstruction(settings.rate)}` : ''),
    tools: vault.root ? VAULT_TOOLS : undefined,
    seed: liveSeed(),
    kickoff,
    onState: (st) => {
      liveState = st;
      if (st === 'connected' && !announced) {
        announced = true;
        addBubble('info', `📞 In chiamata (${model}). Parla pure: puoi interromperlo quando vuoi. Con le cuffie funziona meglio.`, { transient: true });
      }
      updateStatus();
    },
    onUserText: (t) => { liveUser += t; showLive(liveUser); },
    onModelText: (t) => {
      commitLiveUser();
      if (!liveBotBubble) liveBotBubble = addBubble('bot', '');
      liveBot += t;
      renderInto(liveBotBubble, liveBot);
      scrollLog();
    },
    onTurnComplete: () => { commitLiveUser(); commitLiveBot(); touchSession(); },
    onInterrupted: () => commitLiveBot(' …'),
    onSpeaking: (b) => { liveSpeaking = b; updateStatus(); },
    onToolCall: (fc) => { commitLiveUser(); return runTool(fc, { live: true }); },
    onClosed: ({ code, reason, everConnected }) => {
      if (live === s) live = null;
      updateLiveUi();
      if (liveUserStopped) return;
      commitLiveUser();
      commitLiveBot();
      if (!everConnected && voice !== SAFE_LIVE_VOICE && /voice|voce|speech/i.test(reason)) {
        addBubble('info', `⏳ La voce ${voice} non è disponibile con ${model}: uso ${SAFE_LIVE_VOICE}.`, { transient: true });
        connectLive(i, SAFE_LIVE_VOICE);
      } else if (!everConnected && i + 1 < liveQueue.length) {
        addBubble('info', `⏳ ${model} non disponibile${reason ? ` (${reason})` : ''}: provo con ${liveQueue[i + 1]}.`, { transient: true });
        connectLive(i + 1);
      } else {
        addBubble('error', isNoFreeTier(reason) ? NO_FREE_TIER_MSG : `La chiamata si è chiusa${reason ? `: ${reason}` : ''} (codice ${code}).${everConnected ? '' : ' Nessun modello Live ha accettato la connessione.'}`);
        touchSession();
      }
    },
  });
  live = s;
  updateLiveUi();
  try {
    await s.start();
  } catch (err) {
    if (live === s) live = null;
    s.stop();
    updateLiveUi();
    addBubble('error', err.name === 'NotAllowedError' ? 'Permesso del microfono negato: consentilo dalla barra degli indirizzi di Chrome.' : `Impossibile avviare la chiamata: ${err.message}`);
  }
}

function stopLive() {
  clearPause();
  liveUserStopped = true;
  const s = live;
  live = null;
  s?.stop();
  commitLiveUser();
  commitLiveBot();
  liveSpeaking = false;
  updateLiveUi();
  touchSession();
}

// ---------- Progressi di studio ----------
function studyOf(s = session) {
  if (!s.study) s.study = emptyStudy();
  return s.study;
}
function priorStudy() {
  return priorFromSessions(sessionsCache, note?.path || session.notePath, session.id, studyOf());
}
function studyMemory() {
  return memoryText(studyOf(), priorStudy());
}
function annotatorModel() {
  return settings.fallbacks?.[0] || settings.model || DEFAULTS.model;
}
function queueAnnotate(user, reply) {
  if (!settings.annotate || !settings.key || !String(reply).trim()) return;
  annotateQueue.push({ user: user.trim(), reply, sessionId: session.id, noteTitle: note?.title || '' });
  runAnnotator();
}
async function runAnnotator() {
  if (annotating) return;
  annotating = true;
  refreshStudy();
  while (annotateQueue.length) {
    const job = annotateQueue.shift();
    const target = job.sessionId === session.id ? session : sessionsCache.find((x) => x.id === job.sessionId);
    if (!target) continue;
    try {
      const delta = await annotate({ key: settings.key, model: annotatorModel(), user: job.user, reply: job.reply, study: studyOf(target), noteTitle: job.noteTitle });
      studyError = delta ? '' : 'risposta non valida';
      if (mergeStudy(studyOf(target), delta)) {
        if (target === session) touchSession();
        else await saveSession(target, vault.root);
      }
    } catch (err) {
      studyError = String(err.message || err).slice(0, 90);
    }
  }
  annotating = false;
  refreshStudy();
}
function removeStudyItem(kind, item) {
  const list = studyOf()[kind];
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
  studyOf().updatedAt = Date.now();
  touchSession();
  refreshStudy(true);
}
function refreshStudy(force = false) {
  const st = studyOf();
  const prior = priorStudy();
  const sig = JSON.stringify([session.id, st, prior, annotating, settings.annotate, studyError, note?.title]);
  if (!force && sig === studySig) return;
  studySig = sig;
  renderStudy({ study: st, prior, busy: annotating, enabled: settings.annotate, error: studyError, lesson: note?.title, onRemove: removeStudyItem });
}

// ---------- Conversazioni salvate (pannello a destra) ----------
let saveTimer = null;
function touchSession() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistSession, 400);
}
async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await persistSession();
  }
}
function firstUserText() {
  for (const h of history) {
    if (h.role !== 'user') continue;
    const t = h.parts.find((p) => p.text && !p.text.startsWith('['))?.text;
    if (t) return t.length > 50 ? `${t.slice(0, 50)}…` : t;
  }
  return '';
}
async function persistSession() {
  saveTimer = null;
  if (!history.length) return;
  session.history = history;
  session.mode = mode;
  session.notePath = note?.path || '';
  session.noteTitle = note?.title || '';
  session.noteText = note && !note.path ? note.text.slice(0, 200000) : '';
  session.subject = subjectOf(session.notePath) || (note && !note.path ? 'Appunti caricati' : 'Senza appunti');
  session.title = session.noteTitle || firstUserText() || 'Conversazione';
  session.log = [...$('#log').querySelectorAll('.bubble')]
    .filter((el) => el.dataset.kind && !el.classList.contains('transient') && el.dataset.kind !== 'error' && el.dataset.raw && el.dataset.raw !== '…')
    .map((el) => ({ kind: el.dataset.kind, text: el.dataset.raw }));
  session.updatedAt = Date.now();
  try {
    await saveSession(session, vault.root);
  } catch (err) {
    addBubble('error', `Non riesco a salvare la conversazione: ${err.message}`);
  }
  renderSessions();
}

const MODE_NAMES = { spiegami: 'Spiegami', racconto: 'Te lo racconto', interrogami: 'Interrogami', libera: 'Chiacchiera' };
function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `oggi ${hm}`;
  if (d.toDateString() === y.toDateString()) return `ieri ${hm}`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

async function renderSessions() {
  sessionsCache = await listSessions();
  refreshStudy();
  const box = $('#session-list');
  if (!box) return;
  if (!sessionsCache.length) {
    box.innerHTML = '<p class="hint">Qui compariranno le tue conversazioni, raggruppate per materia. Si salvano da sole.</p>';
    return;
  }
  const groups = new Map();
  for (const s of sessionsCache) {
    const g = s.subject || 'Senza appunti';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  box.replaceChildren(...[...groups].map(([subject, items]) => {
    const sec = document.createElement('section');
    sec.className = 'session-group';
    sec.innerHTML = `<h3>${escapeHtml(subject)}</h3>`;
    for (const s of items) {
      const row = document.createElement('div');
      row.className = 'session-row';
      const b = document.createElement('button');
      b.className = 'session-item';
      b.setAttribute('aria-current', String(s.id === session.id));
      const last = [...(s.log || [])].reverse().find((e) => e.kind === 'user' || e.kind === 'bot');
      b.innerHTML = `<span class="s-title">${escapeHtml(s.title || 'Conversazione')}</span>`
        + `<span class="s-meta">${escapeHtml(MODE_NAMES[s.mode] || '')} · ${escapeHtml(when(s.updatedAt))}</span>`
        + (last ? `<span class="s-last">${escapeHtml(last.text.slice(0, 80))}</span>` : '');
      b.onclick = () => loadSession(s.id);
      const del = document.createElement('button');
      del.className = 'ghost small s-del';
      del.title = 'Elimina conversazione';
      del.textContent = '✕';
      del.onclick = async () => {
        if (!confirm(`Eliminare la conversazione «${s.title}»?`)) return;
        await deleteSession(s.id, vault.root);
        if (s.id === session.id) { session = newSession(); session.mode = mode; history = []; $('#log').replaceChildren(); }
        renderSessions();
      };
      row.append(b, del);
      sec.append(row);
    }
    return sec;
  }));
}

async function loadSession(id) {
  if (id === session.id) return;
  const s = sessionsCache.find((x) => x.id === id);
  if (!s) return;
  clearPause();
  if (live) stopLive();
  if (controller) controller.abort();
  speaker.cancel();
  if (listener.active) listener.stop();
  await flushSave();
  restoring = true;
  try {
    session = s;
    activityStart = Date.now();
    pendingUser = '';
    history = Array.isArray(s.history) ? s.history : [];
    setMode(s.mode || 'racconto', { silent: true });
    $('#log').replaceChildren();
    for (const e of s.log || []) addBubble(e.kind, e.text);
    if (s.notePath && vault.root) {
      const n = vault.notes.find((x) => x.path === s.notePath);
      if (n) await openNote(n, { announce: false });
      else addBubble('info', `La nota «${s.notePath}» non è più nel vault.`, { transient: true });
    } else if (s.noteText) {
      setNote({ title: s.noteTitle || 'Appunti', text: s.noteText }, { announce: false });
    } else if (s.notePath) {
      addBubble('info', 'Collega il vault per riaprire gli appunti di questa conversazione.', { transient: true });
    } else {
      setNote(null, { announce: false });
    }
  } finally {
    restoring = false;
  }
  addBubble('info', `↩️ Ripresa «${s.title}» (${when(s.updatedAt)}): il compagno ricorda dove eravate arrivati. Continua pure a parlare.`, { transient: true });
  renderSessions();
}

function setMode(m, { silent = false } = {}) {
  if (!MODE_NAMES[m]) m = 'racconto';
  const changed = m !== mode;
  mode = m;
  document.querySelectorAll('.modes button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.mode === m)));
  updateModeHelp();
  updateStatus();
  if (silent || !changed) return;
  if (live) {
    stopLive();
    addBubble('info', 'Ho chiuso la chiamata per cambiare modalità: premi di nuovo «📞 Dal vivo» per continuare.', { transient: true });
  }
  if (history.length) addBubble('info', `Modalità: ${MODE_NAMES[m]}. Continuiamo la stessa conversazione.`);
  touchSession();
}

// ---------- Interfaccia: chat ----------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderInto(el, text) {
  el.dataset.raw = text;
  const html = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  el.innerHTML = html;
}
function addBubble(kind, text, { transient = false } = {}) {
  const li = document.createElement('li');
  li.className = `bubble ${kind}${transient ? ' transient' : ''}`;
  li.dataset.kind = kind;
  if (kind === 'error') {
    lastErrorAt = Date.now();
    setTimeout(updateStatus, 6100);
  }
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

/** Stato del nucleo, indicatore di connessione e pannello del contesto. */
function coreStateNow() {
  if (Date.now() - lastErrorAt < 6000) return 'error';
  if (paused) return 'paused';
  if (live) {
    if (liveState === 'connecting' || liveState === 'reconnecting') return 'processing';
    return liveSpeaking ? 'speaking' : 'listening';
  }
  if (controller) return 'processing';
  if (speaker.speaking) return 'speaking';
  if (listener.active) return 'listening';
  return 'idle';
}

function userTurns() {
  return history.filter((h) => h.role === 'user' && h.parts.some((p) => p.text && !p.text.startsWith('['))).length;
}

function contextData() {
  if (history.length && !activityStart) activityStart = Date.now();
  const mins = activityStart ? Math.max(0, Math.round((Date.now() - activityStart) / 60000)) : null;
  return {
    subject: subjectOf(note?.path) || (note ? 'Appunti caricati' : ''),
    lesson: note?.title || '',
    mode: MODE_NAMES[mode],
    duration: mins === null ? '—' : `${mins} min`,
    turns: userTurns(),
    voice: live ? `Dal vivo · ${liveModelName}` : (settings.mute ? 'Solo testo' : useNatural() ? `Naturale · ${LIVE_VOICES.find((v) => v.name === settings.liveVoice)?.label || settings.liveVoice}` : 'Voce di Chrome'),
    mic: live ? 'In chiamata' : (listener.active ? 'Attivo (Chrome)' : 'Spento'),
    latency: lastTiming ? lastTiming.replace('Risposta iniziata dopo ', '') : '—',
  };
}

function refreshChrome() {
  const st = coreStateNow();
  const label = live && liveState === 'connecting' ? 'Mi collego…' : live && liveState === 'reconnecting' ? 'Riconnessione…' : undefined;
  setCoreState(st, label);
  if (live && liveState === 'connected') setConnection('live', 'Sessione live');
  else if (live) setConnection('warn', liveState === 'reconnecting' ? 'Riconnessione…' : 'Connessione…');
  else if (!settings.key) setConnection('warn', 'Chiave mancante');
  else if (st === 'error') setConnection('error', 'Errore');
  else if (controller) setConnection('active', 'Elaborazione');
  else if (listener.active) setConnection('active', 'Microfono attivo');
  else setConnection('idle', 'Pronto');
  renderContext(contextData());
  refreshStudy();
  widget?.update();
}

function updateStatus() {
  updateStatusText();
  refreshChrome();
}

function updateStatusText() {
  if (paused) {
    const el = $('#status');
    el.textContent = 'In pausa: JARVIS non parla e non ti ascolta. Premi «Riprendi» per continuare da dove si era fermato.';
    el.className = 'status';
    return;
  }
  const el = $('#status');
  let text = 'Pronto.';
  let cls = '';
  if (live) {
    cls = liveSpeaking ? 'speaking' : 'listening';
    text = {
      connecting: 'Mi collego a Gemini Live…',
      reconnecting: 'Riconnessione alla chiamata…',
    }[liveState] || (liveSpeaking ? `JARVIS sta parlando… (interrompilo quando vuoi) · ${liveModelName}` : `📞 In chiamata: parla pure. · ${liveModelName}`);
    el.textContent = text;
    el.className = `status ${cls}`;
    return;
  }
  if (controller) {
    const secs = Math.floor((Date.now() - thinkingSince) / 1000);
    text = `JARVIS sta pensando…${secs >= 2 ? ` ${secs} s` : ''}`;
    cls = 'thinking';
  }
  else if (speaker.speaking) { text = 'JARVIS sta parlando… (parla pure per interromperlo)'; cls = 'speaking'; }
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
  if (history.length) touchSession();
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
    node.notes.push({ ...n, name: stripExt(file), kind: kindOf(file) });
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
    container.append(noteButton(n, `${escapeHtml(n.name)}${badge(n.kind)}`));
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
      const name = escapeHtml(stripExt(p.slice(slash + 1))) + badge(kindOf(p));
      const dir = slash >= 0 ? `<span class="dir">${escapeHtml(p.slice(0, slash))}</span>` : '';
      box.append(noteButton(n, `<span>${name}</span>${dir}`));
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

function badge(kind) {
  return kind && kind !== 'md' ? ` <span class="badge badge-${kind}">${kind.toUpperCase()}</span>` : '';
}

/** Testo di un appunto; per i PDF scansionati (senza testo) lo fa trascrivere a Gemini una volta sola. */
async function noteText(r, label) {
  if (!r.scanned) return r.text;
  const f = r.file;
  const cacheKey = `ocr:${label}:${f.size}:${f.lastModified}`;
  const cached = await dbGet('kv', cacheKey).catch(() => null);
  if (cached) return cached;
  if (!settings.key) {
    addBubble('error', `«${label}» è un PDF scansionato (senza testo selezionabile): per leggerlo serve la chiave Gemini nelle impostazioni.`);
    return r.text;
  }
  if (f.size > 18 * 1024 * 1024) {
    addBubble('error', `«${label}» è un PDF scansionato troppo grande per la trascrizione (${Math.round(f.size / 1048576)} MB, massimo 18). Dividilo in parti più piccole.`);
    return r.text;
  }
  const info = addBubble('info', `📄 «${label}» è una scansione senza testo: la faccio trascrivere a Gemini (solo la prima volta, poi resta salvata)…`, { transient: true });
  try {
    const text = await complete({
      key: settings.key,
      model: settings.model || DEFAULTS.model,
      system: 'Sei un trascrittore preciso di appunti universitari.',
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'application/pdf', data: await fileToBase64(f) } }, { text: OCR_PROMPT }] }],
      fast: true,
      timeoutMs: 90000,
    });
    if (text.trim()) {
      await dbPut('kv', text, cacheKey).catch(() => {});
      renderInto(info, `📄 Trascrizione di «${label}» pronta.`);
      return text;
    }
  } catch (err) {
    addBubble('error', `Trascrizione di «${label}» non riuscita: ${err.message}`);
  }
  return r.text;
}

async function openNote(n, opts) {
  const r = await readNoteFull(n.handle);
  const text = await noteText(r, n.path);
  setNote({ title: stripExt(n.path.split('/').pop()), text, path: n.path, kind: r.kind }, opts);
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
    $('#search-box').hidden = false;
    $('#btn-vault-reopen').hidden = true;
    $('#btn-vault').textContent = 'Cambia cartella';
    $('#btn-vault').className = 'btn-ghost small';
    const status = $('#vault-status');
    status.hidden = false;
    status.textContent = `✅ Collegato a «${handle.name}» · ${vault.notes.length} note`;
    renderNoteList();
    importFromVault(handle).then((n) => { if (n) renderSessions(); });
    if (!vault.notes.length) {
      addBubble('error', `Nella cartella «${handle.name}» non ho trovato appunti (Markdown, PDF, Word .docx o testo). Scegli la cartella che contiene i tuoi appunti, non una sottocartella di sole immagini.`);
    } else if (!quiet) {
      addBubble('info', `Cartella «${handle.name}» collegata: ${vault.notes.length} appunti. Ora puoi dire, per esempio, «apri Fluidodinamica 1, lezione 3».`, { transient: true });
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

function fillLiveModels() {
  const sel = $('#set-live-model');
  if (!sel) return;
  const models = pickLiveModels(settings.liveModels || [], '');
  sel.replaceChildren(new Option('Automatico (il migliore disponibile)', ''), ...models.map((m) => new Option(m, m)));
  sel.value = models.includes(settings.liveModel) ? settings.liveModel : '';
}

function openSettings() {
  $('#set-voice-engine').value = settings.voiceEngine === 'chrome' ? 'chrome' : 'naturale';
  $('#set-annotate').checked = settings.annotate !== false;
  const pr = settings.profile || {};
  $('#set-name').value = pr.name || '';
  $('#set-tone').replaceChildren(...Object.entries(TONES).map(([id, t]) => new Option(`${t.label} — ${t.desc}`, id)));
  $('#set-tone').value = settings.tone || 'confidenziale';
  $('#set-university').value = pr.university || '';
  $('#set-degree').value = pr.degree || '';
  $('#set-year').value = pr.year || '';
  $('#set-profile-notes').value = pr.notes || '';
  fillLiveModels();
  mountVoices($('#set-voice-picker'), $('#set-live-voice'), () => $('#set-key').value.trim() || settings.key);
  $('#set-key').value = settings.key;
  $('#set-model').value = settings.model;
  $('#set-fast').checked = settings.fast;
  document.querySelectorAll('input[name="correction"]').forEach((r) => { r.checked = r.value === settings.correction; });
  $('#set-pause').value = settings.pause;
  $('#out-pause').textContent = settings.pause;
  $('#set-rate').value = settings.rate;
  $('#out-rate').textContent = rateLabel(settings.rate);
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
  const oldRate = settings.rate;
  settings.rate = Number($('#set-rate').value);
  if (live && rateLabel(oldRate) !== rateLabel(settings.rate)) {
    live.addContext(`[Nota per JARVIS: l'utente ha cambiato la velocità di parola. Da ora: ${speedInstruction(settings.rate) || 'parla a ritmo normale.'}]`);
  }
  settings.mute = $('#set-mute').checked;
  settings.autosend = $('#set-autosend').checked;
  settings.liveModel = $('#set-live-model').value;
  settings.annotate = $('#set-annotate').checked;
  settings.voiceEngine = $('#set-voice-engine').value;
  if (settings.voiceEngine === 'naturale') naturalFailedAt = 0;
  settings.profile = {
    name: $('#set-name').value.trim(),
    university: $('#set-university').value.trim(),
    degree: $('#set-degree').value.trim(),
    year: $('#set-year').value.trim(),
    notes: $('#set-profile-notes').value.trim(),
  };
  refreshStudy(true);
  settings.liveVoice = $('#set-live-voice').value || DEFAULT_LIVE_VOICE;
  settings.tone = $('#set-tone').value || 'confidenziale';
  saveSettings();
  applyVoiceSettings();
  updateModeHelp();
  updateStatus();
}

// ---------- Widget (mini barra sempre in primo piano) ----------
widget = createWidget({
  actions: {
    call: () => $('#btn-live').click(),
    mic: () => $('#btn-mic').click(),
    pause: () => setPaused(!paused),
    stop: () => $('#btn-stop-voice').click(),
    done: () => $('#btn-done').click(),
  },
  getState: () => ({ core: coreStateNow(), live: Boolean(live), paused, mic: listener.active }),
  level: () => {
    if (live) { const l = live.levels?.(); return l ? (liveSpeaking ? l.output : l.input) : null; }
    if (speaker.speaking) return speaker.level();
    return listener.active ? micMeter.level() : null;
  },
  onClose: () => $('#btn-widget')?.setAttribute('aria-pressed', 'false'),
});

// ---------- Presentazione iniziale e voci ----------
async function verifyKey(key) {
  let lives = [];
  try {
    const all = await listAllModels(key);
    lives = liveCandidates(all);
    settings.liveModels = lives;
    saveSettings();
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
  // La chiave esiste: ora una vera richiesta di prova (Google può bloccarne l'uso anche se la chiave è valida).
  try {
    await complete({
      key,
      model: 'gemini-flash-lite-latest',
      system: 'Rispondi solo: ok',
      contents: [{ role: 'user', parts: [{ text: 'ok?' }] }],
      timeoutMs: 15000,
    });
  } catch (err) {
    if (err.noFreeTier || isNoFreeTier(err.message)) return { ok: false, message: NO_FREE_TIER_MSG };
    if (err.status === 429) return { ok: true, message: 'Chiave valida ✓ — però in questo momento la quota gratuita è finita: riprova tra poco.' };
    return { ok: true, message: `Chiave valida ✓ — i server di Google rispondono lenti in questo momento (${err.message}).` };
  }
  return { ok: true, message: `Chiave valida e funzionante ✓ — ${lives.length ? 'anche la voce dal vivo è disponibile' : 'la voce dal vivo non è disponibile con questa chiave'}.` };
}

/** Ordina i modelli Live per una voce: prima quello con cui è già stata sentita, poi i «native audio» (che hanno tutte le 30 voci). */
function orderModelsForVoice(models, voice) {
  const sup = settings.voiceSupport?.[voice] || {};
  let order = [...models];
  if (!CLASSIC_VOICES.includes(voice)) order = [...order.filter((m) => /native-audio/.test(m)), ...order.filter((m) => !/native-audio/.test(m))];
  const ko = sup.ko || [];
  order = [...order.filter((m) => !ko.includes(m)), ...order.filter((m) => ko.includes(m))];
  if (sup.ok && order.includes(sup.ok)) order = [sup.ok, ...order.filter((m) => m !== sup.ok)];
  return order;
}

function previewText() {
  const name = settings.profile?.name;
  return settings.tone === 'professionale'
    ? `Ciao${name ? ` ${name}` : ''}, sono JARVIS. Quando vuoi iniziamo il ripasso: tu esponi e io ti correggo.`
    : `Ciao${name ? ` ${name}` : ''}! Sono JARVIS. Dai, quando vuoi ripassiamo insieme: tu mi racconti e io ti dico se fila tutto.`;
}

/** Anteprima di una voce: dalla memoria se già ascoltata, altrimenti prova fino a 3 modelli Live. */
async function previewLiveVoice(voice, key = settings.key) {
  const text = previewText();
  const cacheKey = `vprev:${voice}:${text}`;
  const cached = await dbGet('kv', cacheKey).catch(() => null);
  if (cached?.chunks?.length) {
    await playChunks(cached.chunks);
    return { model: cached.model, cached: true };
  }
  let models = settings.liveModels;
  if (!models?.length) {
    models = liveCandidates(await listAllModels(key));
    settings.liveModels = models;
    saveSettings();
  }
  if (!models.length) throw new Error('la tua chiave non ha modelli per la voce dal vivo');
  settings.voiceSupport = settings.voiceSupport || {};
  const sup = settings.voiceSupport[voice] || (settings.voiceSupport[voice] = { ok: '', ko: [] });
  let last = null;
  for (const model of orderModelsForVoice(pickLiveModels(models, settings.liveModel), voice).slice(0, 3)) {
    try {
      const chunks = await previewVoice({ key, model, voice, text });
      sup.ok = model;
      sup.ko = sup.ko.filter((m) => m !== model);
      saveSettings();
      dbPut('kv', { model, chunks }, cacheKey).catch(() => {});
      return { model };
    } catch (err) {
      last = err;
      if (!err.voiceProblem) throw err; // quota, chiave, rete: inutile provare altri modelli
      if (!sup.ko.includes(model)) sup.ko.push(model);
      saveSettings();
    }
  }
  const e = new Error(`nessun modello della tua chiave la fa parlare${last ? ` (${last.message})` : ''}`);
  e.voiceProblem = true;
  throw e;
}

// Stato delle schede delle voci (ascoltata, non disponibile, errore)
const voiceState = {};
function voiceStateOf(voice) {
  if (voiceState[voice]) return voiceState[voice];
  const sup = settings.voiceSupport?.[voice];
  if (sup?.ok) return { kind: 'ok' };
  return {};
}
async function playVoiceCard(voice, key) {
  voiceState[voice] = { kind: 'busy' };
  try {
    await previewLiveVoice(voice, key);
    voiceState[voice] = { kind: 'ok' };
  } catch (err) {
    voiceState[voice] = isNoFreeTier(err.message)
      ? { kind: '', note: 'La chiave non ha il piano gratuito di Google: torna al passo «Chiave» e premi «Verifica» per sapere cosa fare.' }
      : err.voiceProblem
        ? { kind: 'ko', note: err.message }
        : { kind: '', note: `Non riesco a farla ascoltare: ${err.message}` };
    throw err;
  }
}
function mountVoices(root, select, keyGetter) {
  select.replaceChildren(...LIVE_VOICES.map((v) => new Option(v.name, v.name)));
  // Voci non più in elenco (scelte in versioni precedenti) → quella predefinita
  select.value = LIVE_VOICES.some((v) => v.name === settings.liveVoice) ? settings.liveVoice : DEFAULT_LIVE_VOICE;
  return mountVoicePicker(root, {
    voices: LIVE_VOICES,
    select,
    play: (v) => {
      const key = keyGetter();
      if (!key) {
        voiceState[v] = { kind: '', note: 'Per ascoltare le voci serve la chiave Gemini.' };
        return Promise.reject(new Error('chiave mancante'));
      }
      return playVoiceCard(v, key);
    },
    state: voiceStateOf,
  });
}

const onboarding = createOnboarding({
  settings: () => settings,
  save: (patch) => {
    Object.assign(settings, patch);
    saveSettings();
    updateStatus();
  },
  verifyKey,
  previewVoice: previewLiveVoice,
  pickFolder: async () => {
    try {
      const h = await pickVault();
      return (await openVault(h)) ? h.name : null;
    } catch {
      return null;
    }
  },
  folderName: () => vault.root?.name || '',
  tones: TONES,
  mountVoices: (root, select) => mountVoices(root, select, () => $('#wz-key').value.trim() || settings.key),
  onFinish: () => {
    const n = settings.profile?.name;
    addBubble('info', `Tutto pronto${n ? `, ${n}` : ''}! Apri una lezione (o dimmi «apri …») e premi «Parla con JARVIS».`, { transient: true });
    updateStatus();
  },
});

// ---------- Collegamento dei pulsanti ----------
function init() {
  initUi();
  setLevelProvider(() => {
    if (live) {
      const l = live.levels?.();
      return l ? (liveSpeaking ? l.output : l.input) : null;
    }
    if (speaker.speaking) return speaker.level();
    return listener.active ? micMeter.level() : null;
  });
  setInterval(() => renderContext(contextData()), 15000);
  updateModeHelp();
  updateStatus();

  if (!speechSupported) addBubble('info', 'Questo browser non ha il riconoscimento vocale: usa Chrome, oppure detta con Wispr Flow nella casella in basso.');
  if (!ttsSupported) addBubble('info', 'Questo browser non può leggere le risposte ad alta voce.');
  if (!vaultSupported) $('#btn-vault').hidden = true;

  // Modalità
  document.querySelectorAll('.modes button').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode);
  });

  // Microfono
  $('#btn-mic').onclick = async () => {
    if (live) return;
    if (paused) { setPaused(false); if (listener.active) return; }
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
  $('#btn-stop-voice').onclick = () => { speaker.cancel(); live?.silence(); clearPause(); };
  $('#btn-pause').onclick = () => setPaused(!paused);
  $('#btn-widget').onclick = async () => {
    if (widget.isOpen) { widget.close(); return; }
    const mode = await widget.open();
    $('#btn-widget').setAttribute('aria-pressed', 'true');
    if (mode === 'inline') addBubble('info', 'Il widget è dentro la pagina: trascinalo dal cerchio. (Per tenerlo sopra le altre app serve Chrome aggiornato.)', { transient: true });
  };
  $('#btn-reset').onclick = () => startNewSession();
  $('#btn-new-session').onclick = () => startNewSession();
  $('#btn-live').onclick = async () => {
    if (live) { stopLive(); return; }
    if (savedVault && !vault.root) await openVault(savedVault, { quiet: true });
    startLive();
  };
  renderSessions();
  window.addEventListener('beforeunload', () => { if (saveTimer) persistSession(); });

  // Testo / Wispr Flow
  const input = $('#text-input');
  let autoTimer = null;
  const sendTyped = async () => {
    if (savedVault && !vault.root) await openVault(savedVault, { quiet: true });
    clearTimeout(autoTimer);
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    if (live) {
      clearPause();
      commitLiveUser();
      addBubble('user', t);
      addUserTurn(t);
      pendingUser += `${pendingUser ? '\n' : ''}${t}`;
      live.sendText(t);
      return;
    }
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
    const texts = [];
    for (const f of files) {
      try {
        texts.push(await noteText({ ...(await extractText(f)), file: f }, f.name));
      } catch (err) {
        addBubble('error', `Non riesco a leggere «${f.name}»: ${err.message}`);
        texts.push('');
      }
    }
    const titles = files.map((f) => stripExt(f.name));
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
  $('#set-rate').oninput = (e) => {
    $('#out-rate').textContent = rateLabel(e.target.value);
    speaker.rate = Number(e.target.value); // si sente subito sulla prossima frase
  };
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
    let rows = [];
    try {
    // Chiediamo a Google quali modelli esistono davvero per questa chiave.
    const all = await listAllModels(key);
    const live = liveCandidates(all);
    const models = [...new Set([current, ...chatCandidates(all)])].slice(0, 10);
    const info = document.createElement('li');
    info.className = 'hint';
    info.textContent = `La tua chiave vede ${all.length} modelli. Ne provo ${models.length} adatti alla conversazione…`;
    out.append(info);
    rows = await benchmark(key, models, (r) => {
      const li = document.createElement('li');
      const ok = r.status === 'ok';
      li.innerHTML = `<button type="button" class="ghost small" ${ok ? '' : 'disabled'}>Usa</button> <strong>${escapeHtml(r.model)}</strong>: ${ok ? `${(r.ms / 1000).toFixed(1)} s` : escapeHtml(String(r.status))}${r.detail ? `<br><span class="hint">${escapeHtml(r.detail)}</span>` : ''}`;
      li.querySelector('button').onclick = () => { $('#set-model').value = r.model; };
      out.append(li);
    });
    settings.liveModels = live;
    if (!settings.liveModel || !live.includes(settings.liveModel)) settings.liveModel = pickLiveModels(live, '')[0] || '';
    fillLiveModels();
    const liveLi = document.createElement('li');
    liveLi.className = 'hint';
    liveLi.textContent = live.length ? `Modelli Gemini Live (voce in tempo reale) disponibili: ${live.join(', ')}` : 'Nessun modello Gemini Live disponibile per questa chiave.';
    out.append(liveLi);
    const fast = rows.filter((r) => r.status === 'ok').sort((a, b) => a.ms - b.ms).map((r) => r.model);
    settings.fallbacks = fast;
    saveSettings();
    setFallbackModels(fast);
    } catch (err) {
      const li = document.createElement('li');
      li.textContent = `Errore durante la prova: ${err.message}`;
      out.append(li);
    }
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

  $('#btn-welcome').onclick = () => { $('#dlg-settings').close(); onboarding.open(); };

  if (!settings.onboarded) {
    onboarding.open();
  } else if (!settings.key) {
    addBubble('info', 'Manca la chiave gratuita di Gemini: incollala nelle impostazioni.', { transient: true });
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
  btn.querySelector('.lbl').textContent = 'Sto scrivendo…';
  try {
    const date = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-GG
    const text = await complete({
      key: settings.key,
      model: settings.model || DEFAULTS.model,
      fast: false,
      timeoutMs: 40000,
      system: buildSystem({ mode, correction: settings.correction, note, profile: settings.profile, tone: settings.tone }),
      contents: [...modelHistory(60), { role: 'user', parts: [{ text: summaryRequest(date) }] }],
    });
    $('#summary-text').value = text.trim();
    $('#btn-copy-summary').textContent = '📋 Copia';
    const target = summaryTarget();
    const save = $('#btn-save-summary');
    save.disabled = !target;
    save.textContent = target && target !== note.path ? '💾 Salva nella nota dei ripassi' : '💾 Aggiungi alla nota';
    $('#summary-target').textContent = !target
      ? 'Per salvarlo direttamente apri gli appunti dalla cartella collegata; altrimenti copialo e incollalo tu.'
      : target === note.path
        ? `Verrà aggiunto in fondo a «${note.path}». Prima viene salvata una copia in .compagno/backup/.`
        : `I PDF e i file Word non si modificano: il resoconto va in «${target}», accanto agli appunti (la crea se non c'è).`;
    $('#dlg-summary').showModal();
  } catch (err) {
    addBubble('error', err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.querySelector('.lbl').textContent = 'Facciamo il punto';
  }
}

/** Dove salvare il resoconto: la nota stessa se è Markdown, altrimenti «<nome> - ripassi.md» accanto. */
function summaryTarget() {
  if (!note?.path || !vault.root) return '';
  if (isMarkdown(note.path)) return note.path;
  return `${stripExt(note.path)} - ripassi.md`;
}

async function saveSummary() {
  const btn = $('#btn-save-summary');
  try {
    const target = summaryTarget();
    const backup = await appendToNote(vault.root, target, $('#summary-text').value);
    if (target === note.path) {
      const fresh = vault.notes.find((n) => n.path === note.path);
      if (fresh) note.text = await readNote(fresh.handle);
      $('#current-text').textContent = note.text;
    } else if (!vault.notes.some((n) => n.path === target)) {
      vault.notes = await listNotes(vault.root);
      renderNoteList();
    }
    btn.textContent = 'Salvato ✓';
    btn.disabled = true;
    addBubble('info', `Resoconto salvato in «${target}».${backup ? ` Copia di sicurezza: ${backup}` : ''}`);
    touchSession();
  } catch (err) {
    addBubble('error', `Salvataggio non riuscito: ${err.message}`);
  }
}

init();
