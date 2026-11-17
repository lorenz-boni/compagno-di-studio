#!/bin/bash
# Avvia JARVIS su questo Mac (doppio clic). Lascia aperta la finestra mentre studi.
cd "$(dirname "$0")" || exit 1
PORT=8777
URL="http://localhost:$PORT/"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Serve python3: macOS proporrà di installare gli «Strumenti da riga di comando». Accetta e poi riapri questo file."
  python3 --version
  read -r -p "Premi Invio per chiudere…"
  exit 1
fi
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "JARVIS è già acceso: lo apro nel browser."
else
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER=$!
  trap 'kill $SERVER 2>/dev/null' EXIT
  sleep 1
fi
open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
echo ""
echo "  JARVIS - Compagno di studio"
echo "  Acceso su $URL"
echo "  Lascia aperta questa finestra mentre studi. Per spegnere JARVIS chiudila."
echo ""
wait
