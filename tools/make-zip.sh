#!/usr/bin/env bash
# Crea il pacchetto da condividere: download/JARVIS-compagno-di-studio.zip
# Contiene solo l'app (niente test né strumenti), la guida LEGGIMI.txt e gli avviatori per Windows e Mac.
# Uso: tools/make-zip.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="download/JARVIS-compagno-di-studio.zip"
TMP="$(mktemp -d)"
DEST="$TMP/JARVIS"
mkdir -p "$DEST" download
cp -r index.html styles.css manifest.webmanifest js vendor icons "$DEST/"
cp share/LEGGIMI.txt "share/Avvia JARVIS (Windows).cmd" "share/Avvia JARVIS (Mac).command" "$DEST/"
cp -r share/avvio "$DEST/"
[ -f download/JARVIS-guida-per-AI.pdf ] && cp download/JARVIS-guida-per-AI.pdf "$DEST/Guida per AI (Claude, ChatGPT, Gemini).pdf"
chmod +x "$DEST/Avvia JARVIS (Mac).command"
rm -f "$OUT"
(cd "$TMP" && zip -qrX9 "$OLDPWD/$OUT" JARVIS)
rm -rf "$TMP"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
