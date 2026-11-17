// Conversazioni salvate: nel browser (IndexedDB) e, se il vault è collegato,
// anche come copia di sicurezza in `.compagno/sessioni/` dentro il vault.
import { dbGetAll, dbPut, dbDelete } from './db.js?v=202611171618';

const DIR = ['.compagno', 'sessioni'];

export function newSession() {
  const now = Date.now();
  return {
    id: `s-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    notePath: '',
    noteTitle: '',
    noteText: '', // solo per appunti incollati o caricati (non dal vault)
    subject: '',
    mode: 'racconto',
    kickedOff: '',
    createdAt: now,
    updatedAt: now,
    history: [],
    log: [],
  };
}

export function hasContent(s) {
  return Boolean(s && s.history.length);
}

export async function listSessions() {
  try {
    const all = await dbGetAll('sessions');
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveSession(s, vaultRoot) {
  await dbPut('sessions', s);
  if (vaultRoot) {
    try {
      let dir = vaultRoot;
      for (const p of DIR) dir = await dir.getDirectoryHandle(p, { create: true });
      const fh = await dir.getFileHandle(`${s.id}.json`, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(s));
      await w.close();
    } catch { /* la copia nel vault è facoltativa */ }
  }
}

export async function deleteSession(id, vaultRoot) {
  await dbDelete('sessions', id);
  if (vaultRoot) {
    try {
      let dir = vaultRoot;
      for (const p of DIR) dir = await dir.getDirectoryHandle(p);
      await dir.removeEntry(`${id}.json`);
    } catch { /* non c'era */ }
  }
}

/** Recupera dal vault le conversazioni che il browser non ha (es. dati di Chrome cancellati). */
export async function importFromVault(vaultRoot) {
  let imported = 0;
  try {
    let dir = vaultRoot;
    for (const p of DIR) dir = await dir.getDirectoryHandle(p);
    const known = new Map((await listSessions()).map((s) => [s.id, s.updatedAt]));
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        const s = JSON.parse(await (await h.getFile()).text());
        if (!s?.id || !Array.isArray(s.history)) continue;
        if (!known.has(s.id) || known.get(s.id) < s.updatedAt) {
          await dbPut('sessions', s);
          imported++;
        }
      } catch { /* file rovinato: lo saltiamo */ }
    }
  } catch { /* nessuna cartella sessioni */ }
  return imported;
}

/** Materia = cartella che contiene la nota (es. "Acqua ed energia"). */
export function subjectOf(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}
