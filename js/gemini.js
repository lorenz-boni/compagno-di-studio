// Chiamate dirette all'API Gemini dal browser (piano gratuito di Google AI Studio).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function toError(res) {
  let detail = '';
  try {
    const j = await res.json();
    detail = j?.error?.message || '';
  } catch { /* corpo non JSON */ }
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
    if (res.status === 400 && cfg) {
      const detail = await res.clone().text();
      if (/thinking/i.test(detail)) { i++; continue; }
    }
    if (res.ok && fast) thinkingChoice.set(model, i);
    return res;
  }
}

// Modelli che di recente sono stati lenti o sovraccarichi: per qualche minuto li proviamo per ultimi.
const penalty = new Map();
const PENALTY_MS = 5 * 60 * 1000;
export const FIRST_CHUNK_TIMEOUT = 10000;

function orderModels(model) {
  const all = [model, ...FALLBACK_MODELS.filter((m) => m !== model)];
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
export async function* streamChat({ key, model, system, contents, tools, fast = true, signal, onNotice, timeoutMs = FIRST_CHUNK_TIMEOUT }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5 },
  };
  if (tools) body.tools = tools;

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
export async function benchmark(key, models, onResult) {
  const out = [];
  for (const model of models) {
    const t0 = performance.now();
    let row;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      const r = await startModel(model, key, {
        systemInstruction: { parts: [{ text: 'Rispondi in italiano con una sola frase breve.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Ciao, come va?' }] }],
        generationConfig: { temperature: 0.5 },
      }, true, ctrl.signal, 30000);
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      if (r.status === 200) {
        const c = r.first.done ? null : toChunk(r.first.value);
        row = { model, ms, status: 'ok', text: c?.text || '' };
        for await (const _ of r.events) { /* svuota */ }
      } else {
        row = { model, ms, status: r.status === 'timeout' ? 'oltre 30 s' : `errore ${r.status}` };
      }
    } catch (err) {
      row = { model, ms: Math.round(performance.now() - t0), status: err.name === 'AbortError' ? 'oltre 30 s' : err.message };
    }
    out.push(row);
    onResult?.(row);
  }
  return out;
}
