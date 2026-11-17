# 🎓 Compagno di studio

Un compagno di corso **vocale** che ti ascolta mentre ripeti e ti corregge quando sbagli, partendo dai **tuoi appunti Obsidian**.

È gratis, si usa dal browser e non va installato niente.

## Cosa fa

- **📞 Dal vivo**: conversazione vocale in tempo reale con Gemini Live, come una telefonata. Risponde in circa un secondo, ha una voce naturale e si può interrompere. Usa gli stessi appunti e strumenti del vault. L'approccio audio è ispirato a [addyosmani/jarvis](https://github.com/addyosmani/jarvis) (Apache-2.0).
- **🗂️ Conversazioni**: il pannello a destra salva da solo ogni conversazione, raggruppata per materia. Riaprendola il compagno ricorda dove eravate arrivati. Le conversazioni restano nel browser e, con il vault collegato, anche in `.compagno/sessioni/`.
- **Spiegami**: rispiega gli appunti sezione per sezione, senza saltare niente, con una domanda di verifica alla fine di ogni parte.

- **Te lo racconto**: spieghi l'argomento a voce come lo racconteresti a un compagno. Lui ti corregge a ogni pausa, oppure alla fine con un resoconto completo e un voto. Dice sempre se la correzione viene *dagli appunti* o dalla *conoscenza generale*.
- **Interrogami**: ti fa domande sugli appunti, una alla volta, e corregge le risposte.
- **Chiacchiera**: discussione libera sull'argomento.
- **Facciamo il punto**: scrive un resoconto in Markdown (punti chiari, errori, cose da ripassare). Se la nota è stata aperta dal vault, lo aggiunge in fondo alla nota dopo la tua conferma. Prima di modificarla salva una copia in `.compagno/backup/`.

## Come si usa (PC, Chrome)

1. Apri la pagina dell'app in **Google Chrome**. Edge ha problemi noti col microfono in Italia.
2. Crea una chiave gratuita su <https://aistudio.google.com/apikey> e incollala in ⚙️ Impostazioni.
3. Collega il vault **una volta sola**: clicca **📁 Collega vault Obsidian** e scegli la cartella *principale* del vault, cioè quella che contiene la cartella nascosta `.obsidian`. Nella finestra di Windows non vedrai le note, solo le cartelle: è normale. Entra nella cartella del vault e premi **Seleziona cartella**. Quando Chrome chiede il permesso, scegli **«Consenti a ogni visita»**: dalle volte successive il vault si collega da solo.
4. Per scegliere l'argomento basta dirlo: *«apri Fluidodinamica 1, lezione 3»*. Il compagno cerca la nota, la apre e si parte. In alternativa clicca una nota dall'elenco, oppure usa **📄 Carica .md** / **📋 Incolla testo**.
5. Premi **🎙️ Inizia a parlare** e racconta. Conviene usare le **cuffie**, così il microfono non sente la voce del compagno.

### Con Wispr Flow
Metti il cursore nella casella di testo in basso e detta con la scorciatoia di Wispr Flow. Il testo dettato viene inviato da solo; l'opzione si può disattivare nelle impostazioni.

Wispr Flow è più preciso coi termini tecnici. Il piano gratuito però ha un limite di parole a settimana (circa 2.000 su PC), quindi conviene usarlo per i pezzi difficili e il microfono di Chrome per il resto.

## Costi e privacy

- **Gemini**: piano gratuito di Google AI Studio. In caso di errore 429 (quota finita) aspetta un minuto o cambia modello nelle impostazioni. Nel piano gratuito Google può usare i testi per migliorare i suoi servizi: non inserire dati sensibili.
- **Riconoscimento vocale**: quello di Chrome, gratis. L'audio viene elaborato dai server Google.
- **Voce**: le voci italiane del tuo sistema, gratis.
- La chiave e le impostazioni restano **solo nel tuo browser**. Non esiste un server dell'app.

## Pubblicarla gratis (GitHub Pages)

Nel repository vai su Settings → Pages → *Deploy from a branch* → `main` / `(root)`. Dopo un minuto l'app è su `https://<utente>.github.io/<repo>/`.

Per provarla in locale basta un server statico qualsiasi:

```bash
python3 -m http.server 8000
```

Poi apri <http://localhost:8000>.

## Struttura

- `index.html`, `styles.css`: interfaccia.
- `js/app.js`: logica della conversazione.
- `js/prompts.js`: il "carattere" del compagno (le istruzioni al modello).
- `js/gemini.js`: chiamate a Gemini in streaming.
- `js/speech.js`: microfono, con il riconoscimento vocale del browser.
- `js/tts.js`: voce, con la sintesi vocale del browser.
- `js/vault.js`: lettura e scrittura del vault Obsidian.
- `tests/smoke.cjs`: prova automatica con Playwright, con Gemini e microfono simulati.
- `PIANO.md`: piano di sviluppo.
- `tools/bump-version.sh`: da lanciare prima di ogni commit che cambia l'app. Aggiorna il numero di versione nei link ai file, così Chrome non usa file vecchi dalla cache.
