// Sintesi vocale con le voci italiane già presenti nel sistema (gratis, offline o quasi).

const synth = window.speechSynthesis;
export const ttsSupported = Boolean(synth);

/** Toglie la formattazione markdown, che non va letta ad alta voce. */
export function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Divide il testo che arriva in streaming in frasi complete da leggere subito.
 * Restituisce [frasi pronte, resto ancora incompleto].
 */
export function splitSentences(buffer, flush = false) {
  const out = [];
  // Fine frase = punteggiatura seguita da uno spazio (così "3.14" non viene spezzato) oppure un a capo.
  const re = /[.!?…:;]+(?=\s)|\n+/g;
  let last = 0;
  let m;
  while ((m = re.exec(buffer)) !== null) {
    const end = m.index + m[0].length;
    const s = buffer.slice(last, end).trim();
    if (s) out.push(s);
    last = end;
  }
  let rest = buffer.slice(last);
  if (flush && rest.trim()) {
    out.push(rest.trim());
    rest = '';
  }
  return [out, rest];
}

export function italianVoices() {
  if (!synth) return [];
  return synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('it'));
}

/** Sceglie la voce migliore: prima quella salvata, poi le voci "naturali"/Google. */
export function pickVoice(name) {
  const voices = italianVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => v.name === name) ||
    voices.find((v) => /natural|online/i.test(v.name)) ||
    voices.find((v) => /google/i.test(v.name)) ||
    voices[0]
  );
}

export class Speaker {
  constructor({ onStart, onEnd } = {}) {
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.voiceName = '';
    this.rate = 1.05;
    this.muted = false;
    this.pending = 0;
    this.spoken = ''; // testo detto di recente, per riconoscere l'eco nel microfono
  }

  get speaking() {
    return this.pending > 0;
  }

  say(text) {
    if (!synth || this.muted) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice(this.voiceName);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'it-IT';
    u.rate = this.rate;
    if (this.pending === 0) {
      this.spoken = '';
      this.onStart();
    }
    this.pending++;
    this.spoken += ' ' + clean;
    const done = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.onEnd();
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }

  cancel() {
    if (!synth) return;
    const was = this.pending > 0;
    this.pending = 0;
    synth.cancel();
    if (was) this.onEnd();
  }
}

/** Vero se ciò che il microfono ha sentito è probabilmente la voce del compagno stesso. */
export function looksLikeEcho(heard, spoken) {
  const words = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) || [];
  const h = words(heard);
  if (!h.length) return true;
  const s = new Set(words(spoken));
  const hits = h.filter((w) => s.has(w)).length;
  return hits / h.length >= 0.6;
}
