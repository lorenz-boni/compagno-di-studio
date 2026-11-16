# Piano: "Compagno di studio" vocale per Obsidian

## Obiettivo
Un compagno di corso virtuale con cui parlare in italiano. Lo usi per:
1. **Raccontargli** un argomento: ti ascolta e ti corregge quando sbagli o dimentichi qualcosa (modalità principale).
2. **Farti interrogare** sui tuoi appunti.
3. **Fare il punto** a fine sessione e aggiornare le note Obsidian.

## Vincoli
- **Gratis**: nessun abbonamento e nessuna carta di credito.
- **Facile**: si apre un link in Chrome e si incolla una chiave gratuita. Niente server, niente Python, niente plugin obbligatori.
- **Sicuro per gli appunti**: nessuna modifica senza conferma e backup prima di scrivere.

## Architettura (scelta finale)
Una sola pagina web (PWA), ospitata gratis su GitHub Pages, che gira tutta nel browser:

| Pezzo | Scelta gratuita | Riserva |
|---|---|---|
| Ascolto (riconoscimento vocale) | Web Speech API del browser, lingua it-IT (Chrome) | Groq Whisper (chiave gratuita), più preciso con i termini tecnici |
| Cervello (LLM) | Gemini Flash, piano gratuito di Google AI Studio | Groq Llama (piano gratuito) |
| Voce (sintesi vocale) | speechSynthesis del browser, voci italiane di sistema | Piper nel browser, voce italiana offline |
| Accesso a Obsidian | File System Access API: scegli la cartella del vault e la pagina legge e scrive i .md direttamente | Carica o incolla una nota (telefono, Safari) |
| Ripasso dilazionato | ts-fsrs (FSRS v6), con lo stato nel frontmatter della nota | — |

Perché così:
- Il motore vocale del browser e la pagina statica sono gratis e non richiedono installazioni.
- Il vault si apre direttamente, quindi Obsidian non deve essere aperto e non serve il plugin Local REST API.
- La chiave API resta solo nel browser (localStorage).

Note:
- Nel piano gratuito Google può usare i contenuti per migliorare i servizi. Non incollare dati sensibili.
- I limiti gratuiti cambiano: la pagina gestisce l'errore 429 passando a Groq.
- Edge ha un bug noto con il riconoscimento vocale in Italia (aprile 2026): usare Chrome.

## Modalità "Te lo racconto" (il compagno di corso)
- Parli liberamente. Il microfono resta acceso e si riavvia da solo dopo le pause.
- A ogni pausa di circa 2–3 secondi, oppure col pulsante "ho finito", il testo va al modello insieme alla nota di riferimento.
- Il modello risponde come un compagno di corso, a voce e in modo breve:
  - "Giusto." / "Aspetta, qui hai detto X ma negli appunti c'è Y."
  - "Hai saltato Z, che è importante perché…"
  - Distingue sempre **[dagli appunti]** da **[conoscenza generale]**, per non inventare.
- Due livelli di severità:
  - **Correggimi subito**: corregge dopo ogni pausa.
  - **Correggimi alla fine**: ascolta tutto e poi fa il resoconto.
- Puoi interromperlo parlando: la sintesi vocale si ferma (barge-in).

## Altre modalità
- **Interrogami**: domande progressive con valutazione 1–4 (Again/Hard/Good/Easy), che aggiorna FSRS.
- **Facciamo il punto**: riassunto dei punti forti e deboli, proposto come testo da aggiungere alla nota (`## Ripasso AAAA-MM-GG`). Scrive solo dopo il tuo "sì".
- **Cosa ripasso oggi**: elenco delle note in scadenza secondo FSRS.
- **Solo chiacchiera**: nessuna nota, solo conoscenza generale.

## Sicurezza delle note
- Ogni modifica viene mostrata come anteprima (diff) e confermata, a voce o con un clic.
- Prima di scrivere viene salvata una copia della nota in `.compagno/backup/`.
- La pagina scrive solo sezioni appendibili e frontmatter. Non riscrive mai interi file senza conferma esplicita.

## Fasi
1. **MVP "Te lo racconto"** (prima consegna):
   - Pagina singola con impostazioni della chiave Gemini.
   - Scelta della nota (incolla, carica o cartella del vault).
   - Microfono continuo, correzioni a voce e trascrizione a schermo.
2. **Vault completo**: navigazione e ricerca delle note nel vault, collegamenti [[wikilink]] come contesto aggiuntivo.
3. **Interrogami + FSRS**: valutazioni e scadenze nel frontmatter.
4. **Facciamo il punto + scrittura** con conferma e backup.
5. **Rifiniture**:
   - Groq Whisper e Piper come opzioni.
   - Installazione come app (PWA) su desktop e Android.
   - Opzionale: modalità Gemini Live, voce in tempo reale ancora più fluida, se la quota gratuita lo permette.

## Wispr Flow (già installato sul PC)
- La casella di testo accetta la dettatura di Wispr Flow. Il testo inserito tutto insieme viene inviato da solo.
- Il piano gratuito è limitato a circa 2.000 parole a settimana su PC, e il numero esatto non è più pubblicato da novembre 2026. Dieci minuti di racconto sono circa 1.300 parole, quindi il microfono di Chrome resta la scelta principale e Wispr Flow serve per precisione sui termini tecnici.

## Cosa prendere dai "Jarvis" su GitHub (ricerca novembre 2026)
| Repo | Cosa fa | Cosa ne prendiamo |
|---|---|---|
| isair/jarvis (2,3k★) | Assistente locale: Whisper + Ollama + Piper, memoria, MCP | Idea della memoria personale: in futuro, registrare gli errori ricorrenti per argomento |
| ethanplusai/jarvis (1k★) | Voce per Claude Code su Mac | Niente per ora: è pensato per programmare |
| addyosmani/jarvis | Gemini Live in React (Apache-2.0) | Riferimento per la fase 5 (modalità Gemini Live) |
| alpunlu12-commits/jarvis (427★) | App desktop con Gemini Live e chiave gratuita | Conferma che Gemini Live con chiave gratuita è usabile. Licenza non commerciale |
| swayinfo/elton-ai (MIT) | Plugin Obsidian vocale: cartelle private, livelli di permesso, annulla modifiche | Cartelle escluse e livelli di accesso (sola lettura / scrittura) per la fase 2 |
| zohaibtahirkhan/Tzar (Apache-2.0) | Vault + Whisper + Ollama + Kokoro, citazioni generate dal codice | Mostrare da quale nota viene ogni correzione (fase 2) |
| Priler/jarvis, llm-guy/jarvis | Assistenti offline per comandi del PC | Non pertinenti allo studio |

Nessuno di questi fa quello che vogliamo noi: un compagno di corso che ascolta il ripasso e corregge. Sono quasi tutti assistenti generici da installare (Python, Ollama, GPU), mentre il nostro progetto resta una pagina web gratuita senza installazione.

## Test
- Test automatici della logica: prompt, parsing del frontmatter, FSRS, diff.
- Prova nel browser con Playwright, con microfono simulato.
- Prova reale tua su una nota di un esame.
