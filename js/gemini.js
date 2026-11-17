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
    return new GeminiError('Quota gratuita di Gemini esaurita per ora: aspetta un minuto o scegli un altro modello nelle impostazioni.', 429);
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

/**
 * Risposta in streaming: per ogni pezzo restituisce { text, parts }.
 * `text` è il testo da mostrare/leggere, `parts` sono le parti originali
 * (testo, chiamate a strumenti, firme) da rimettere tali e quali nella cronologia.
 * `fast` disattiva il "ragionamento" del modello per ridurre l'attesa;
 * se il modello non lo supporta si riprova senza.
 */
export async function* streamChat({ key, model, system, contents, tools, fast = true, signal }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.5 },
  };
  if (tools) body.tools = tools;
  if (fast) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };

  let res = await post(model, key, body, signal);
  if (res.status === 400 && fast) {
    delete body.generationConfig.thinkingConfig;
    res = await post(model, key, body, signal);
  }
  if (!res.ok) throw await toError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
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
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join('');
      if (parts.length) yield { text, parts };
    }
  }
}

/** Versione non in streaming: restituisce tutto il testo. */
export async function complete(opts) {
  let out = '';
  for await (const chunk of streamChat(opts)) out += chunk.text;
  return out;
}
