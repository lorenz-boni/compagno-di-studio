// Chiamate dirette all'API Gemini dal browser (piano gratuito di Google AI Studio).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Google a volte non concede il piano gratuito a un progetto (account universitari/aziendali, progetti segnalati…).
export const NO_FREE_TIER_MSG = 'Google non concede l\'uso gratuito di Gemini a questa chiave: il progetto in cui è stata creata non ha il piano gratuito. '
  + 'Prova a creare una chiave nuova con un account Gmail personale (non universitario o aziendale) in un progetto nuovo su aistudio.google.com/apikey. '
  + 'In alternativa si può attivare la fatturazione su Google AI Studio (a pagamento).';

export function isNoFreeTier(text) {
  return /free tier is not available|set up billing|project has been denied access|denied access/i.test(String(text || ''));
}

async function toError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || '';
  } catch { /* corpo non JSON */ }
  if (isNoFreeTier(detail)) {
    const e = new GeminiError(NO_FREE_TIER_MSG, res.status);
    e.noFreeTier = true;
    return e;
  }
  if (res.status === 429) {
    return new GeminiError('Quota gratuita di Gemini esaurita per ora (anche sui modelli di riserva): aspetta un minuto e riprova.', 429);
  }
  if (res.status === 503 || res.status === 500) {
    return new GeminiError('I server di Gemini sono sovraccarichi in questo momento (anche i modelli di riserva). Riprova tra qualche secondo.', res.status);
  }
  if (res.status === 400 && /api key/i.test(detail)) {
    return new GeminiError('Chiave API non valida: controllala nelle impostazioni.', 400);
  }
  if (res.status === 403) {
    return new GeminiError('Chiave API rifiutata (403): controlla che sia una chiave di Google AI Studio.', 403);
  }
  if (res.status === 404) {
    return new GeminiError(`Modello non trovato: scegline un altro nelle impostazioni. (${detail})`, 404);
  }
  return new GeminiError(`Errore Gemini ${res.status}: ${detail || res.statusText}`, res.status);
}

/** Tutti i modelli visibili con la chiave: [{ id, methods, displayName }]. */
export async function listAllModels(key) {
  const out = [];
  let pageToken = '';
  do {
    const res = await fetch(`${BASE}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await toError(res);
    const j = await res.json();
    for (const m of j.models || []) {
      out.push({ id: m.name.replace(/^models\//, ''), methods: m.supportedGenerationMethods || [], displayName: m.displayName || '' });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Modelli adatti a una conversazione veloce: testuali, Gemini, possibilmente Flash/Lite. */
export function chatCandidates(all) {
  return all
    .filter((m) => m.methods.includes('generateContent') && m.id.includes('gemini'))
    .map((m) => m.id)
    .filter((id) => !/(image|tts|embedding|live|audio|vision|robotics|computer-use|exp-)/.test(id))
    .filter((id) => /flash|lite/.test(id))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true })); // i più recenti per primi
}

/** Modelli che supportano la conversazione vocale in tempo reale (Gemini Live). */
export function liveCandidates(all) {
  return all.filter((m) => m.methods.includes('bidiGenerateContent')).map((m) => m.id);
}

/** Elenca i modelli testuali Gemini utilizzabili con la chiave. */
export async function listModels(key) {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  return (j.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => n.includes('gemini') && !/(image|tts|embedding|live|audio|vision)/.test(n))
    .sort();
}

function post(model, key, body, signal) {
  return fetch(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
}

const THINKING = [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, null];
const thinkingChoice = new Map();

/**
 * Risposta in streaming: per ogni pezzo restituisce { text, parts }.
 * `text` è il testo da mostrare/leggere, `parts` sono le parti originali
 * (testo, chiamate a strumenti, firme) da rimettere tali e quali nella cronologia.
 * `fast` disattiva il "ragionamento" del modello per ridurre l'attesa;
 * se il modello non lo supporta si riprova senza.
 */
export const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
// Elenco di riserva effettivo: quello misurato con la chiave dell'utente, se c'è.
let fallbackModels = FALLBACK_MODELS;
export function setFallbackModels(list) {
  if (Array.isArray(list) && list.length) fallbackModels = list;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Interrotto', 'AbortError')); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Interrotto', 'AbortError')); }, { once: true });
});

/** Una richiesta a un modello, provando i modi di spegnere il "ragionamento" finché uno è accettato. */
async function openStream(model, key, body, fast, signal) {
  let i = fast ? (thinkingChoice.get(model) ?? 0) : THINKING.length - 1;
  for (;;) {
    const cfg = THINKING[i];
    if (cfg) body.generationConfig.thinkingConfig = cfg;
    else delete body.generationConfig.thinkingConfig;
    const res = await post(model, key, body, signal);
    // Un 400 con un'impostazione di "ragionamento" attiva quasi sempre significa che il modello non la
    // accetta (a volte con un messaggio generico «invalid argument»): proviamo la successiva.
    if (res.status === 400 && cfg) { i++; continue; }
    if (res.ok && fast) thinkingChoice.set(model, i);
    return res;
  }
}

// Modelli che di recente sono stati lenti o sovraccarichi: per qualche minuto li proviamo per ultimi.
const penalty = new Map();
const PENALTY_MS = 5 * 60 * 1000;
export const FIRST_CHUNK_TIMEOUT = 10000;

function orderModels(model) {
  const all = [model, ...fallbackModels.filter((m) => m !== model)];
  const now = Date.now();
  const ok = all.filter((m) => !(penalty.get(m) > now));
  const bad = all.filter((m) => penalty.get(m) > now);
  return [...ok, ...bad];
}

/** Legge gli eventi SSE e restituisce gli oggetti JSON uno alla volta. */
async function* readEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try { yield JSON.parse(data); } catch { /* riga incompleta */ }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Apre la risposta su un modello e aspetta il primo pezzo entro `timeoutMs`.
 * Restituisce { status, events, first } oppure { status: 'timeout' }.
 */
async function startModel(model, key, body, fast, signal, timeoutMs) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      res = await openStream(model, key, body, fast, ctrl.signal);
      if (![500, 503].includes(res.status)) break;
      if (attempt === 0) await sleep(800, ctrl.signal);
    }
    if (!res.ok) return { status: res.status, res };
    const events = readEvents(res);
    const first = await events.next();
    return { status: 200, events, first };
  } catch (err) {
    if (timedOut && !signal?.aborted) return { status: 'timeout' };
    throw err;
  } finally {
    // L'ascolto di `signal` resta attivo: serve a interrompere lo streaming anche dopo il primo pezzo.
    clearTimeout(timer);
  }
}

function toChunk(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  return parts.length ? { text, parts, modelVersion: json.modelVersion } : null;
}

/**
 * Risposta in streaming. Se il modello è sovraccarico (503), ha finito la quota (429)
 * o non inizia a rispondere entro 10 s, si passa da soli ai modelli di riserva.
 */
export async function* streamChat({ key, model, system, contents, tools, json, fast = true, signal, onNotice, timeoutMs = FIRST_CHUNK_TIMEOUT }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5 },
  };
  if (tools) body.tools = tools;
  // Risposta strutturata (JSON con schema), usata dall'annotatore dei progressi.
  if (json) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = json;
    body.generationConfig.temperature = 0.2;
  }

  const models = orderModels(model);
  let started = null;
  let lastFail = null;
  for (let m = 0; m < models.length; m++) {
    const r = await startModel(models[m], key, body, fast, signal, timeoutMs);
    if (r.status === 200) { started = r; break; }
    const switchable = r.status === 'timeout' || [429, 500, 503].includes(r.status) || (m > 0 && [400, 404].includes(r.status));
    lastFail = r;
    if (!switchable) break;
    penalty.set(models[m], Date.now() + PENALTY_MS);
    if (m < models.length - 1) {
      const why = r.status === 'timeout' ? `non risponde entro ${timeoutMs / 1000} s`
        : r.status === 429 ? 'ha finito la quota gratuita per ora' : 'è sovraccarico';
      onNotice?.(`${models[m]} ${why}: provo con ${models[m + 1]}.`);
    }
  }
  if (!started) {
    if (lastFail?.status === 'timeout') throw new GeminiError('Nessun modello Gemini ha risposto in tempo: i server sono molto carichi. Riprova tra poco.', 0);
    throw await toError(lastFail.res);
  }

  if (!started.first.done) {
    const c = toChunk(started.first.value);
    if (c) yield c;
  }
  for await (const json of started.events) {
    const c = toChunk(json);
    if (c) yield c;
  }
}

/** Versione non in streaming: restituisce tutto il testo. */
export async function complete(opts) {
  let out = '';
  for await (const chunk of streamChat(opts)) out += chunk.text;
  return out;
}

/**
 * Diagnostica: per ogni modello misura quanto ci mette a iniziare a rispondere a una domanda breve.
 * Restituisce [{ model, ms, status, text }].
 */
/** Controllo di riserva: richiesta normale (senza streaming e senza impostazioni sul ragionamento). */
async function plainCheck(model, key, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Ciao, come va? Rispondi con una frase.' }] }] }),
      signal: ctrl.signal,
    });
    const ms = Math.round(performance.now() - t0);
    if (res.ok) return `richiesta semplice: risponde in ${(ms / 1000).toFixed(1)} s`;
    let d = '';
    try { d = (await res.json())?.error?.message || ''; } catch { /* ignora */ }
    return `richiesta semplice: errore ${res.status} ${d.slice(0, 100)}`;
  } catch {
    return `richiesta semplice: nessuna risposta entro ${timeoutMs / 1000} s`;
  } finally {
    clearTimeout(timer);
  }
}

export async function benchmark(key, models, onResult, { timeoutMs = 15000 } = {}) {
  const out = [];
  let plainChecks = 0;
  for (const model of models) {
    const t0 = performance.now();
    let row;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await startModel(model, key, {
        systemInstruction: { parts: [{ text: 'Rispondi in italiano con una sola frase breve.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Ciao, come va?' }] }],
        generationConfig: { temperature: 0.5 },
      }, true, ctrl.signal, timeoutMs);
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      if (r.status === 200) {
        const c = r.first.done ? null : toChunk(r.first.value);
        row = { model, ms, status: 'ok', text: c?.text || '' };
        for await (const _ of r.events) { /* svuota */ }
      } else if (r.status === 'timeout') {
        row = { model, ms, status: `oltre ${timeoutMs / 1000} s` };
      } else {
        let detail = '';
        try { detail = (await r.res.json())?.error?.message || ''; } catch { /* corpo non JSON */ }
        row = isNoFreeTier(detail)
          ? { model, ms, status: 'niente piano gratuito', detail: 'Google non concede l\'uso gratuito a questa chiave (vedi la guida: chiave da un account Gmail personale, progetto nuovo).' }
          : { model, ms, status: `errore ${r.status}`, detail: detail.slice(0, 160) };
      }
    } catch (err) {
      row = { model, ms: Math.round(performance.now() - t0), status: err.name === 'AbortError' ? `oltre ${timeoutMs / 1000} s` : err.message };
    }
    // Per capire se il blocco dipende dal modo di chiamare il modello, sui primi modelli lenti o rifiutati
    // (non per quota finita) proviamo anche una richiesta semplice.
    if (row.status !== 'ok' && !String(row.status).includes('429') && plainChecks < 3) {
      plainChecks++;
      row.detail = [row.detail, await plainCheck(model, key)].filter(Boolean).join(' · ');
    }
    out.push(row);
    onResult?.(row);
  }
  return out;
}
