// Conversazione dal vivo con Gemini Live (voce in tempo reale), via WebSocket direttamente dal browser.
// Approccio ispirato a addyosmani/jarvis (Apache-2.0): microfono 16 kHz PCM in ingresso, audio 24 kHz in uscita.

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Ordine di preferenza: prima i modelli stabili, poi le anteprime.
export const LIVE_PREFERENCE = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-3.1-flash-live-preview',
  'gemini-3.8-live',
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.5-flash-native-audio-preview-09-2025',
];
// Voci di Gemini Live selezionate: poche, con un carattere riconoscibile (4 femminili, 4 maschili).
// `label` è il "personaggio" mostrato all'utente, `name` il nome tecnico della voce di Google.
export const LIVE_VOICES = [
  { name: 'Achird', label: 'Il compagno di corso', desc: 'amichevole, spontaneo e alla mano', g: 'M' },
  { name: 'Sulafat', label: 'La voce calda', desc: 'avvolgente e rassicurante', g: 'F' },
  { name: 'Charon', label: 'Il narratore', desc: 'profonda e pacata', g: 'M' },
  { name: 'Vindemiatrix', label: 'La tutor paziente', desc: 'gentile e tranquilla', g: 'F' },
  { name: 'Zubenelgenubi', label: "L'amico rilassato", desc: 'informale, senza fretta', g: 'M' },
  { name: 'Aoede', label: 'La voce leggera', desc: 'ariosa e luminosa', g: 'F' },
  { name: 'Puck', label: "L'energico", desc: 'vivace, ti tiene sveglio', g: 'M' },
  { name: 'Kore', label: 'La prof', desc: 'chiara, decisa e sicura', g: 'F' },
];
export const DEFAULT_LIVE_VOICE = 'Achird';
// Le 8 voci storiche, supportate da tutti i modelli Live. Le altre richiedono i modelli «native audio».
export const CLASSIC_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
export const SAFE_LIVE_VOICE = 'Kore'; // supportata da tutti i modelli Live

/** Ordina i modelli Live disponibili: quello scelto, poi le preferenze, poi gli altri adatti. */
export function pickLiveModels(available, chosen) {
  const usable = available.filter((m) => !/(transcribe|translate|robotics|extended-thinking)/.test(m));
  const out = [];
  if (chosen && usable.includes(chosen)) out.push(chosen);
  for (const m of LIVE_PREFERENCE) if (usable.includes(m) && !out.includes(m)) out.push(m);
  for (const m of usable) if (!out.includes(m)) out.push(m);
  return out;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class LiveSession {
  /**
   * opts: { key, model, system, tools, voice, seed (turni testuali precedenti), kickoff (testo per farlo iniziare),
   *         onState(state), onUserText(t), onModelText(t), onTurnComplete(), onInterrupted(),
   *         onSpeaking(bool), onToolCall(fc) → risposta, onError(msg), onClosed(info) }
   */
  constructor(opts) {
    this.o = opts;
    this.stopped = false;
    this.connected = false; // setup completato almeno una volta
    this.handle = null; // per riprendere la sessione dopo una disconnessione
    this.reconnects = 0;
    this.sources = new Set();
    this.nextTime = 0;
  }

  async start() {
    this.o.onState?.('connecting');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.inCtx = new AudioContext({ sampleRate: 16000 });
    await this.inCtx.audioWorklet.addModule(new URL('./pcm-worklet.js?v=202611171533', import.meta.url));
    const src = this.inCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.inCtx, 'pcm-capture');
    this.node.port.onmessage = (e) => this.#sendAudio(e.data);
    const mute = this.inCtx.createGain();
    mute.gain.value = 0;
    src.connect(this.node).connect(mute).connect(this.inCtx.destination);
    // Misura del volume (solo per l'animazione del nucleo)
    this.inAn = this.inCtx.createAnalyser();
    this.inAn.fftSize = 512;
    src.connect(this.inAn);
    this.outCtx = new AudioContext({ sampleRate: 24000 });
    this.outGain = this.outCtx.createGain();
    this.outAn = this.outCtx.createAnalyser();
    this.outAn.fftSize = 512;
    this.outGain.connect(this.outAn);
    this.outAn.connect(this.outCtx.destination);
    this.#open();
  }

  #open() {
    const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(this.o.key)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      const setup = {
        model: `models/${this.o.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice || SAFE_LIVE_VOICE } } },
        },
        systemInstruction: { parts: [{ text: this.o.system }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.handle ? { handle: this.handle } : {},
      };
      if (this.o.tools) setup.tools = this.o.tools;
      ws.send(JSON.stringify({ setup }));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data));
      } catch {
        return;
      }
      this.#handle(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ready = false;
      if (this.stopped) return;
      // Fine sessione normale da parte di Google (es. limite di durata): ci ricolleghiamo riprendendo da dove eravamo.
      if (this.connected && this.handle && this.reconnects < 5) {
        this.reconnects++;
        this.o.onState?.('reconnecting');
        setTimeout(() => !this.stopped && this.#open(), 300);
        return;
      }
      this.o.onClosed?.({ code: e.code, reason: e.reason || '', everConnected: this.connected });
      this.stop();
    };
  }

  async #handle(msg) {
    if (msg.setupComplete) {
      const first = !this.connected;
      this.connected = true;
      this.ready = true;
      this.reconnects = 0;
      this.o.onState?.('connected');
      if (first) {
        const seed = (this.o.seed || []).filter((t) => t.parts?.length);
        if (seed.length) this.#send({ clientContent: { turns: seed, turnComplete: false } });
        if (this.o.kickoff) this.sendText(this.o.kickoff);
      }
      return;
    }
    if (msg.sessionResumptionUpdate?.newHandle && msg.sessionResumptionUpdate.resumable !== false) {
      this.handle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.toolCall?.functionCalls) {
      const functionResponses = [];
      for (const fc of msg.toolCall.functionCalls) {
        let response;
        try { response = await this.o.onToolCall?.(fc); } catch (err) { response = { errore: err.message }; }
        functionResponses.push({ id: fc.id, name: fc.name, response: response || { ok: true } });
      }
      this.#send({ toolResponse: { functionResponses } });
    }
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.#stopPlayback();
        this.o.onInterrupted?.();
      }
      if (sc.inputTranscription?.text) this.o.onUserText?.(sc.inputTranscription.text);
      if (sc.outputTranscription?.text) this.o.onModelText?.(sc.outputTranscription.text);
      for (const p of sc.modelTurn?.parts || []) {
        if (p.inlineData?.data && /audio/.test(p.inlineData.mimeType || 'audio')) this.#play(p.inlineData.data);
      }
      if (sc.turnComplete) this.o.onTurnComplete?.();
    }
  }

  #send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  #sendAudio(buffer) {
    if (!this.ready) return;
    this.#send({ realtimeInput: { audio: { data: toBase64(buffer), mimeType: 'audio/pcm;rate=16000' } } });
  }

  sendText(text) {
    this.#send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }

  #play(b64) {
    const ctx = this.outCtx;
    if (!ctx) return;
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    const buf = ctx.createBuffer(1, pcm.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain || ctx.destination);
    this.nextTime = Math.max(this.nextTime, ctx.currentTime + 0.02);
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    if (!this.sources.size) this.o.onSpeaking?.(true);
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.o.onSpeaking?.(false);
    };
  }

  #stopPlayback() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* già finito */ }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.o.onSpeaking?.(false);
  }

  /** Volume attuale (0..1) di microfono e voce del modello, per le animazioni. */
  levels() {
    const rms = (an) => {
      if (!an) return 0;
      if (!this._buf || this._buf.length !== an.fftSize) this._buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(this._buf);
      let sum = 0;
      for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
      return Math.sqrt(sum / this._buf.length);
    };
    return { input: rms(this.inAn), output: rms(this.outAn) };
  }

  /** Zittisce la risposta in corso (senza chiudere la chiamata). */
  silence() {
    this.#stopPlayback();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.#stopPlayback();
    try { this.ws?.close(1000); } catch { /* già chiuso */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    this.o.onState?.('closed');
  }
}

/** Riproduce pezzi di audio PCM 24 kHz (base64). Restituisce una Promise che si risolve a fine riproduzione. */
export function playChunks(chunks) {
  return new Promise((resolve) => {
    const ctx = new AudioContext({ sampleRate: 24000 });
    let next = ctx.currentTime + 0.05;
    for (const b64 of chunks) {
      const bytes = fromBase64(b64);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const buf = ctx.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(next);
      next += buf.duration;
    }
    setTimeout(() => { ctx.close().catch(() => {}); resolve(); }, Math.max(0, (next - ctx.currentTime) * 1000) + 150);
  });
}

/**
 * Fa ascoltare una voce di Gemini Live senza aprire il microfono: legge una frase e chiude.
 * Si risolve con i pezzi di audio ricevuti (per poterli riascoltare senza nuove richieste).
 * Rifiuta con un errore il cui campo `voiceProblem` è vero se il modello non accetta quella voce.
 */
export function previewVoice({ key, model, voice, text, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const ctx = new AudioContext({ sampleRate: 24000 });
    const chunks = [];
    let next = 0;
    let done = false;
    const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`);
    ws.binaryType = 'arraybuffer';
    const fail = (message, voiceProblem = false) => {
      const e = new Error(message);
      e.voiceProblem = voiceProblem;
      return e;
    };
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(1000); } catch { /* già chiuso */ }
      const wait = err ? 0 : Math.max(0, (next - ctx.currentTime) * 1000) + 150;
      setTimeout(() => { ctx.close().catch(() => {}); if (err) reject(err); else resolve(chunks); }, wait);
    };
    const timer = setTimeout(() => finish(chunks.length ? null : fail('nessun audio ricevuto in tempo', true)), timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({
      setup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        systemInstruction: { parts: [{ text: 'Leggi ad alta voce, in italiano, esattamente il testo che ricevi, con tono caldo e naturale. Non aggiungere altro.' }] },
      },
    }));
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)); } catch { return; }
      if (msg.setupComplete) {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
        return;
      }
      for (const p of msg.serverContent?.modelTurn?.parts || []) {
        if (!p.inlineData?.data) continue;
        chunks.push(p.inlineData.data);
        const bytes = fromBase64(p.inlineData.data);
        const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
        const buf = ctx.createBuffer(1, pcm.length, 24000);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        next = Math.max(next, ctx.currentTime + 0.03);
        src.start(next);
        next += buf.duration;
      }
      if (msg.serverContent?.turnComplete) finish(chunks.length ? null : fail('il modello non ha prodotto audio con questa voce', true));
    };
    ws.onclose = (e) => {
      if (done) return;
      if (chunks.length) { finish(null); return; }
      const reason = e.reason || `connessione chiusa (codice ${e.code})`;
      // Quota o chiave: non è colpa della voce
      const notVoice = /quota|exceeded|api key|permission|billing|rate/i.test(reason);
      finish(fail(reason, !notVoice));
    };
  });
}
