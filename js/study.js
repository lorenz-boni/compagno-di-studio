// Annotatore dei progressi: dopo ogni scambio legge la frase dell'utente e la risposta di JARVIS
// ed estrae argomento, concetti chiari, concetti da consolidare ed errori. Gira in background,
// quindi non rallenta la conversazione. Registra solo ciò che emerge davvero dallo scambio.
import { complete } from './gemini.js?v=202611171503';

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    argomento: { type: 'STRING', description: 'Argomento di cui si sta parlando ora, 1-5 parole. Vuoto se non cambia o non è chiaro.' },
    acquisiti: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Concetti che l\'utente ha dimostrato di aver capito in QUESTO scambio (spiegati o risposti correttamente).' },
    da_consolidare: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Concetti che l\'utente ha dimenticato, saltato, spiegato in modo incompleto o confuso in QUESTO scambio.' },
    errori: {
      type: 'ARRAY',
      description: 'Errori veri e propri dell\'utente corretti da JARVIS in QUESTO scambio.',
      items: {
        type: 'OBJECT',
        properties: {
          concetto: { type: 'STRING', description: 'Concetto su cui ha sbagliato, 2-6 parole.' },
          errore: { type: 'STRING', description: 'Cosa ha detto di sbagliato, breve.' },
          correzione: { type: 'STRING', description: 'La versione corretta, breve.' },
        },
        required: ['concetto', 'errore', 'correzione'],
      },
    },
  },
  required: ['argomento', 'acquisiti', 'da_consolidare', 'errori'],
};

const SYSTEM = `Sei un assistente che prende appunti sull'apprendimento di uno studente universitario mentre ripassa a voce con un tutor (JARVIS).
Ricevi l'argomento attuale, l'ultimo scambio (frase dello studente e risposta del tutor) e i concetti già registrati.
Regole:
- Registra SOLO ciò che emerge chiaramente da questo scambio. Non inventare e non dedurre oltre.
- "acquisiti": solo se lo studente ha spiegato o risposto correttamente (non basta che il tutor abbia spiegato).
- "da_consolidare": concetti dimenticati, saltati, incompleti o confusi, oppure su cui lo studente ha detto di non ricordare.
- "errori": solo affermazioni sbagliate dello studente che il tutor ha corretto.
- Nomi dei concetti brevi (2-6 parole), in italiano, riusando ESATTAMENTE il nome di un concetto già registrato quando è lo stesso.
- Se lo scambio è organizzativo (aprire note, saluti, cambio modalità) o il tutor sta solo spiegando senza verificare, lascia le liste vuote.
- Se lo studente non dice nulla (il tutor spiega o fa una domanda), aggiorna al massimo l'argomento.`;

export function emptyStudy() {
  return { topic: '', learned: [], review: [], errors: [], updatedAt: 0 };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s, max = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

function upsert(list, text, extra = {}) {
  const k = norm(text);
  if (!k) return null;
  let item = list.find((x) => norm(x.text) === k);
  if (item) {
    Object.assign(item, extra, { at: Date.now() });
  } else {
    item = { text: clean(text), at: Date.now(), ...extra };
    list.push(item);
  }
  return item;
}

function removeFrom(list, text) {
  const k = norm(text);
  const i = list.findIndex((x) => norm(x.text) === k);
  if (i >= 0) list.splice(i, 1);
}

/** Unisce il risultato dell'annotatore allo stato. Restituisce true se qualcosa è cambiato. */
export function mergeStudy(study, delta) {
  if (!delta) return false;
  const before = JSON.stringify([study.topic, study.learned, study.review, study.errors]);
  const topic = clean(delta.argomento, 60);
  if (topic) study.topic = topic;
  for (const c of delta.acquisiti || []) {
    upsert(study.learned, c);
    removeFrom(study.review, c); // capito adesso: non è più da consolidare
  }
  for (const c of delta.da_consolidare || []) {
    upsert(study.review, c);
    removeFrom(study.learned, c);
  }
  for (const e of delta.errori || []) {
    if (!e?.concetto) continue;
    const prev = study.errors.find((x) => norm(x.text) === norm(e.concetto));
    upsert(study.errors, e.concetto, {
      count: (prev?.count || 0) + 1,
      wrong: clean(e.errore, 140),
      fix: clean(e.correzione, 160),
    });
    // un errore su un concetto lo rende da consolidare
    upsert(study.review, e.concetto);
    removeFrom(study.learned, e.concetto);
  }
  const changed = before !== JSON.stringify([study.topic, study.learned, study.review, study.errors]);
  if (changed) study.updatedAt = Date.now();
  return changed;
}

/** Chiede all'annotatore cosa è emerso dall'ultimo scambio. */
export async function annotate({ key, model, user, reply, study, noteTitle, signal }) {
  const known = [
    study.learned.length ? `Già chiari: ${study.learned.map((x) => x.text).join('; ')}` : '',
    study.review.length ? `Già da consolidare: ${study.review.map((x) => x.text).join('; ')}` : '',
    study.errors.length ? `Errori già registrati su: ${study.errors.map((x) => x.text).join('; ')}` : '',
  ].filter(Boolean).join('\n') || 'Nessun concetto registrato finora.';
  const prompt = `Appunti: ${noteTitle || 'nessuno'}
Argomento attuale: ${study.topic || 'non ancora definito'}
${known}

ULTIMO SCAMBIO
Studente: ${user ? user.slice(0, 2500) : '(non ha parlato: il tutor ha iniziato da solo)'}
Tutor (JARVIS): ${reply.slice(0, 3500)}`;
  const text = await complete({
    key,
    model,
    system: SYSTEM,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    json: SCHEMA,
    fast: true,
    signal,
    timeoutMs: 15000,
  });
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Punti deboli ed errori delle altre conversazioni sugli stessi appunti, non risolti in quella attuale. */
export function priorFromSessions(sessions, notePath, currentId, current) {
  const out = { review: [], errors: [] };
  if (!notePath) return out;
  const solved = new Set((current?.learned || []).map((x) => norm(x.text)));
  const inCurrent = new Set([...(current?.review || []), ...(current?.errors || [])].map((x) => norm(x.text)));
  const rev = new Map();
  const err = new Map();
  for (const s of sessions) {
    if (s.id === currentId || s.notePath !== notePath || !s.study) continue;
    const learnedThere = new Set((s.study.learned || []).map((x) => norm(x.text)));
    for (const r of s.study.review || []) {
      const k = norm(r.text);
      if (solved.has(k) || inCurrent.has(k) || learnedThere.has(k)) continue;
      if (!rev.has(k) || rev.get(k).at < r.at) rev.set(k, r);
    }
    for (const e of s.study.errors || []) {
      const k = norm(e.text);
      if (solved.has(k) || inCurrent.has(k)) continue;
      const prev = err.get(k);
      err.set(k, { ...e, count: (prev?.count || 0) + (e.count || 1) });
    }
  }
  out.review = [...rev.values()].sort((a, b) => b.at - a.at).slice(0, 12);
  out.errors = [...err.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  return out;
}

/** Testo della "memoria" per JARVIS (vuoto se non c'è niente). */
export function memoryText(study, prior) {
  const lines = [];
  const review = [...(study?.review || []), ...(prior?.review || [])].map((x) => x.text);
  const errors = [...(study?.errors || []), ...(prior?.errors || [])]
    .map((e) => `${e.text}${e.fix ? ` (corretto: ${e.fix})` : ''}${e.count > 1 ? ` — ${e.count} volte` : ''}`);
  const learned = (study?.learned || []).map((x) => x.text);
  if (study?.topic) lines.push(`Argomento attuale: ${study.topic}.`);
  if (review.length) lines.push(`Da consolidare: ${[...new Set(review)].slice(0, 15).join('; ')}.`);
  if (errors.length) lines.push(`Errori già fatti: ${errors.slice(0, 10).join('; ')}.`);
  if (learned.length) lines.push(`Già chiari in questa sessione: ${learned.slice(0, 15).join('; ')}.`);
  return lines.join('\n');
}
