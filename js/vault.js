import { dbGet, dbPut } from './db.js?v=202611171503';

// Accesso diretto alla cartella del vault Obsidian con la File System Access API (Chrome/Edge su PC).

export const vaultSupported = 'showDirectoryPicker' in window;

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules', '.compagno']);

export async function pickVault() {
  return window.showDirectoryPicker({ id: 'vault', mode: 'readwrite' });
}

export async function ensurePermission(handle, mode = 'read') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

/** Elenca ricorsivamente tutte le note .md del vault. */
export async function listNotes(dir, prefix = '') {
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.') && handle.kind === 'directory') continue;
    if (handle.kind === 'directory') {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...(await listNotes(handle, `${prefix}${name}/`)));
    } else if (name.toLowerCase().endsWith('.md')) {
      out.push({ path: `${prefix}${name}`, handle });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, 'it', { numeric: true }));
}

export async function readNote(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

async function getDir(root, parts, create) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return dir;
}

async function writeFile(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

/**
 * Aggiunge testo in fondo a una nota, dopo aver salvato una copia di sicurezza
 * in `.compagno/backup/` dentro il vault. Restituisce il percorso del backup.
 */
export async function appendToNote(root, path, addition) {
  if (!(await ensurePermission(root, 'readwrite'))) {
    throw new Error('Permesso di scrittura sul vault negato.');
  }
  const parts = path.split('/');
  const name = parts.pop();
  const dir = await getDir(root, parts, false);
  const fh = await dir.getFileHandle(name);
  const current = await (await fh.getFile()).text();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${path.replace(/\//g, '__').replace(/\.md$/i, '')}__${stamp}.md`;
  const backupDir = await getDir(root, ['.compagno', 'backup'], true);
  await writeFile(backupDir, backupName, current);

  const sep = current.endsWith('\n') ? '\n' : '\n\n';
  const w = await fh.createWritable();
  await w.write(current + sep + addition.trim() + '\n');
  await w.close();
  return `.compagno/backup/${backupName}`;
}

// --- Ricordare l'ultimo vault aperto (IndexedDB, solo in questo browser) ---

export async function saveVaultHandle(handle) {
  try { await dbPut('kv', handle, 'vault'); } catch { /* non indispensabile */ }
}

export async function loadVaultHandle() {
  try { return await dbGet('kv', 'vault'); } catch { return null; }
}

// --- Ricerca delle note per nome (es. "fluidodinamica 1 lezione tre") ---

const NUMBERS = {
  uno: 1, una: 1, primo: 1, prima: 1, due: 2, secondo: 2, seconda: 2, tre: 3, terzo: 3, terza: 3,
  quattro: 4, quarto: 4, quarta: 4, cinque: 5, quinto: 5, quinta: 5, sei: 6, sesto: 6, sesta: 6,
  sette: 7, settimo: 7, settima: 7, otto: 8, ottavo: 8, ottava: 8, nove: 9, nono: 9, nona: 9,
  dieci: 10, decimo: 10, decima: 10, undici: 11, dodici: 12, tredici: 13, quattordici: 14,
  quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19, venti: 20,
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};
const STOP = new Set([
  'il', 'lo', 'la', 'le', 'gli', 'l', 'un', 'di', 'del', 'della', 'dello', 'dei', 'delle', 'degli',
  'in', 'nel', 'nella', 'nei', 'nelle', 'e', 'a', 'al', 'alla', 'da', 'dal', 'dalla', 'su', 'sul',
  'per', 'con', 'mi', 'me', 'ci', 'numero', 'num', 'n', 'nr', 'cerca', 'apri', 'trova', 'md',
  'appunti', 'nota', 'note', 'file',
]);

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function tokens(s) {
  return (normalize(s).match(/[a-z]+|\d+/g) || [])
    .map((t) => (NUMBERS[t] !== undefined ? String(NUMBERS[t]) : t.replace(/^0+(?=\d)/, '')))
    .filter((t) => !STOP.has(t));
}

/**
 * Restituisce le note più simili alla richiesta, dalla più probabile.
 * `requireAll`: ogni parola cercata deve comparire (ricerca mentre scrivi, come in Obsidian).
 */
export function searchNotes(notes, query, limit = 12, { requireAll = false, withScore = false } = {}) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const scored = notes.map((n) => {
    const all = tokens(n.path.replace(/\.md$/i, ''));
    const name = tokens(n.path.split('/').pop().replace(/\.md$/i, ''));
    let score = 0;
    let matched = 0;
    const minPrefix = requireAll ? 2 : 4;
    for (const t of q) {
      const isNum = /^\d+$/.test(t);
      if (name.includes(t)) { score += isNum ? 4 : 3; matched++; }
      else if (all.includes(t)) { score += 2; matched++; }
      else if (!isNum && t.length >= minPrefix && all.some((w) => w.startsWith(t) || (t.startsWith(w) && w.length >= 4))) { score += 1; matched++; }
    }
    if (requireAll && matched < q.length) score = 0;
    return { path: n.path, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'it', { numeric: true }))
    .slice(0, limit)
    .map((s) => (withScore ? s : s.path));
}

/** Cartelle del vault (primi due livelli), per far capire al modello come è organizzato. */
export function folderOverview(notes, max = 80) {
  const set = new Set();
  for (const n of notes) {
    const parts = n.path.split('/').slice(0, -1);
    if (parts[0]) set.add(parts[0]);
    if (parts[1]) set.add(`${parts[0]}/${parts[1]}`);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'it', { numeric: true })).slice(0, max);
}
