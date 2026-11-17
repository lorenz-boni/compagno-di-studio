#!/usr/bin/env bash
# Aggiorna il numero di versione in tutti i link ai file JS e CSS, così Chrome scarica sempre i file nuovi.
# Uso: tools/bump-version.sh   (da lanciare prima di ogni commit che cambia l'app)
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(date -u +%Y%m%d%H%M)"
sed -i -E "s/\?v=[0-9A-Za-z.-]+/?v=$V/g" index.html js/*.js
sed -i -E "s/(id=\"app-version\"[^>]*>)[^<]*/\1v$V/" index.html
echo "versione $V"
