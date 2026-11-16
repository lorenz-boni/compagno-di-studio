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
  return out.sort((a, b) => a.path.localeCompare(b.path, 'it'));
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

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('compagno-di-studio', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveVaultHandle(handle) {
  try {
    const d = await db();
    d.transaction('kv', 'readwrite').objectStore('kv').put(handle, 'vault');
  } catch { /* non indispensabile */ }
}

export async function loadVaultHandle() {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction('kv').objectStore('kv').get('vault');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
