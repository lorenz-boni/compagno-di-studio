// Riconoscimento vocale continuo con la Web Speech API del browser (gratis, it-IT).
// Chrome invia l'audio ai server Google per la trascrizione.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(Recognition);

export class Listener {
  constructor({ lang = 'it-IT', onInterim, onFinal, onState, onError } = {}) {
    this.lang = lang;
    this.onInterim = onInterim || (() => {});
    this.onFinal = onFinal || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.wanted = false;
    this.rec = null;
  }

  get active() {
    return this.wanted;
  }

  start() {
    if (!Recognition) {
      this.onError('Il riconoscimento vocale non è disponibile in questo browser: usa Chrome, oppure scrivi o detta con Wispr Flow nella casella di testo.');
      return;
    }
    this.wanted = true;
    this.#spawn();
    this.onState(true);
  }

  stop() {
    this.wanted = false;
    if (this.rec) {
      try { this.rec.stop(); } catch { /* già fermo */ }
    }
    this.onState(false);
  }

  #spawn() {
    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          if (text.trim()) this.onFinal(text.trim());
        } else {
          interim += text;
        }
      }
      this.onInterim(interim.trim());
    };

    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wanted = false;
        this.onState(false);
        this.onError('Permesso del microfono negato: consentilo dalla barra degli indirizzi di Chrome.');
        return;
      }
      if (e.error === 'network') {
        this.onError('Il riconoscimento vocale di Chrome non raggiunge i server Google (errore di rete). Riprovo…');
        return;
      }
      this.onError(`Errore del riconoscimento vocale: ${e.error}`);
    };

    // Chrome chiude la sessione dopo un po' di silenzio: la riapriamo finché serve.
    rec.onend = () => {
      if (this.rec !== rec) return;
      if (this.wanted) {
        setTimeout(() => {
          if (this.wanted && this.rec === rec) this.#spawn();
        }, 250);
      }
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (err) {
      this.onError(`Impossibile avviare il microfono: ${err.message}`);
    }
  }
}
