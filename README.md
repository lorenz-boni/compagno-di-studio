# 🎓 Compagno di studio

Un compagno di corso **vocale** che ti ascolta mentre ripeti e ti corregge quando sbagli, partendo dai **tuoi appunti Obsidian**.

È gratis, si usa dal browser e non va installato niente.

## Interfaccia (JARVIS)

- **Nucleo centrale animato** con 6 stati: in attesa, ascolto, elaborazione, parla, pausa, errore. In "Parla con JARVIS" le onde seguono il volume reale di microfono e voce. Con il microfono classico seguono il volume del microfono; mentre parla la voce di Chrome il movimento è solo indicativo, perché Chrome non dà accesso a quell'audio.
- **Libreria** a sinistra e **Contesto / Cronologia** a destra, comprimibili. Ci sono anche la modalità *full immersion* e lo schermo intero. Su smartphone i pannelli diventano pannelli apribili.
- **Contesto di studio**: mostra materia, argomento attuale, fonte, modalità, durata, interventi, voce, microfono e tempo di risposta.
- **Progressi**: dopo ogni risposta un *annotatore* lavora in background, quindi la conversazione non rallenta. Legge la tua frase e la risposta di JARVIS e registra argomento, concetti **chiari**, **da consolidare** ed **errori**. Gli errori ripetuti vengono contati (×2, ×3…). Registra solo ciò che emerge davvero dallo scambio, e puoi togliere a mano un elemento sbagliato. I progressi si salvano nella conversazione. Nelle conversazioni successive sugli stessi appunti compaiono come *"Dalle sessioni precedenti"* e JARVIS li riceve come memoria, così torna sui tuoi punti deboli. L'anello percentuale mostra i concetti chiari sul totale dei concetti emersi, ed è visibile solo da 3 concetti in su. Costa una richiesta in più a Gemini per ogni risposta: si disattiva in ⚙️ Impostazioni.
- I font Inter e Sora arrivano da Google Fonts dopo il caricamento della pagina. Se non si caricano, si usano quelli di sistema.

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

## Installarla come app (icona sul desktop)

L'app è installabile: si apre in una finestra sua, con l'icona di JARVIS sul desktop, nella barra delle applicazioni e nel menu Start.

1. Apri l'app in Chrome.
2. Clicca l'icona di installazione (un monitor con una freccia) a destra nella barra degli indirizzi, oppure apri il menu ⋮ → *Trasmetti, salva e condividi* → *Installa pagina come app…*
3. Conferma e lascia attivo *Crea collegamento sul desktop*.

Se avevi già un collegamento creato prima, eliminalo e reinstalla: Windows non aggiorna da solo l'icona delle scorciatoie vecchie.

Le icone sono in `icons/`. I PNG si rigenerano dagli SVG con `node tools/make-icons.cjs`.

## Appunti in PDF e Word (anche senza Obsidian)

Con **Collega cartella appunti** puoi scegliere un vault Obsidian oppure **qualsiasi cartella**. L'app legge:
- **Markdown** e **testo** (.md, .txt);
- **PDF**: il testo viene estratto pagina per pagina con pdf.js di Mozilla;
- **Word .docx**: titoli, paragrafi, elenchi e tabelle, con mammoth. Il vecchio formato .doc va prima salvato come .docx.

Il testo viene estratto **nel browser**, senza caricare i file da nessuna parte.

I **PDF scansionati** (immagini senza testo selezionabile) vengono trascritti da Gemini **una volta sola**. Il risultato resta salvato nel browser, quindi riaprendoli non si spende un'altra richiesta. Limite: 18 MB per file.

I PDF e i Word non vengono mai modificati: *Facciamo il punto* salva il resoconto in una nota `<nome> - ripassi.md` accanto al file. Anche **Carica file** accetta PDF e Word.

## Primo avvio, tono e voce

Alla prima apertura una **presentazione guidata** chiede:
1. nome e percorso di studi (università, corso, anno, note);
2. la chiave gratuita di Gemini, con la verifica;
3. il **tono** (*Confidenziale*, *Equilibrato* o *Professionale*) e la **voce**: 8 voci selezionate di Gemini Live, ognuna con un carattere (Il compagno di corso, La voce calda, Il narratore, La tutor paziente, L'amico rilassato, La voce leggera, L'energico, La prof), con ▶ per ascoltarle. Se una voce non funziona con un modello, l'app prova il successivo e se lo ricorda. Le anteprime già ascoltate si riascoltano senza consumare quota;
4. la cartella degli appunti.

Ogni passo si può saltare. Tutto si cambia in ⚙️ Impostazioni, da dove si può anche rivedere la presentazione.

La voce naturale è quella di **Parla con JARVIS** (Gemini Live). Il microfono classico usa la voce di Chrome, più meccanica.

## Condividerla con un amico

- **Il link**: https://lorenz-boni.github.io/compagno-di-studio/. Ognuno usa la sua chiave Gemini e i suoi appunti.
- **La guida per un'AI**: https://lorenz-boni.github.io/compagno-di-studio/download/JARVIS-guida-per-AI.pdf. Caricata in Claude, ChatGPT o Gemini, l'AI guida passo passo installazione, chiave, voce, cartella e problemi frequenti. Si rigenera con `node tools/make-guide.cjs` da `share/guida-ai.html`.
- **Il pacchetto da scaricare**: https://lorenz-boni.github.io/compagno-di-studio/download/JARVIS-compagno-di-studio.zip. Contiene l'app, la guida `LEGGIMI.txt` e gli avviatori per Windows (`.cmd`, che usa PowerShell già presente in Windows) e Mac (`.command`, che usa python3). L'app gira in locale su `http://localhost:8777`. Si rigenera con `tools/make-zip.sh`.

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
- `js/vault.js`: lettura e scrittura della cartella degli appunti.
- `js/docs.js`: lettura di PDF e Word (librerie in `vendor/`, caricate solo quando servono).
- `js/study.js`: annotatore dei progressi (argomento, concetti, errori) e memoria per JARVIS.
- `js/ui.js`: interfaccia (pannelli, nucleo animato, onde, indicatore di connessione, contesto).
- `tests/*.cjs`: prove automatiche con Playwright (Gemini, Gemini Live e microfono simulati). Si lanciano con `node tests/<nome>.cjs .`
- `PIANO.md`: piano di sviluppo.
- `share/`: guida e avviatori inclusi nel pacchetto ZIP; `tools/make-zip.sh` lo costruisce in `download/`.
- `tools/bump-version.sh`: da lanciare prima di ogni commit che cambia l'app. Aggiorna il numero di versione nei link ai file, così Chrome non usa file vecchi dalla cache.
