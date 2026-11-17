// Prova della voce classica con pausa/ripresa (voce di Chrome simulata). Uso: node tests/speaker.mjs
const log = [];
let current = null;
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [],
    speak(u) { current = u; log.push(`parla: ${u.text}`); },
    cancel() { log.push('cancel'); const u = current; current = null; u?.onerror?.({ error: 'interrupted' }); },
  },
};
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
const { Speaker } = await import('../js/tts.js');
const ok = (c, l) => { console.log(`${c ? '✓' : '✗'} ${l}`); if (!c) process.exitCode = 1; };
const finish = () => { const u = current; current = null; u?.onend?.(); };

let starts = 0, ends = 0;
const sp = new Speaker({ onStart: () => starts++, onEnd: () => ends++ });
sp.say('Prima frase.'); sp.say('Seconda frase.'); sp.say('Terza frase.');
ok(current?.text === 'Prima frase.' && sp.speaking, 'inizia dalla prima frase');
sp.pause();
ok(current === null && sp.speaking && sp.paused, 'in pausa: voce ferma, discorso sospeso');
sp.say('Quarta frase.');
ok(current === null, 'in pausa le nuove frasi aspettano');
sp.resume();
ok(current?.text === 'Prima frase.', 'ripresa: ripete la frase interrotta');
finish(); ok(current?.text === 'Seconda frase.', 'poi la seconda');
finish(); finish(); ok(current?.text === 'Quarta frase.', 'poi le altre, in ordine');
finish();
ok(!sp.speaking && starts === 1 && ends === 1, `fine discorso segnalata una volta sola (inizio ${starts}, fine ${ends})`);
sp.say('Altra.'); sp.pause(); sp.cancel();
ok(!sp.speaking && !sp.paused && current === null, 'Silenzio: annulla tutto ed esce dalla pausa');
sp.rate = 0.8; sp.say('Lenta.');
ok(current?.rate === 0.8, 'la velocità vale dalla frase successiva');
