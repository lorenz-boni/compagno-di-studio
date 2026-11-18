// Lettura degli appunti in vari formati, tutto nel browser (i file non vengono caricati da nessuna parte):
// Markdown e testo, PDF (pdf.js di Mozilla) e Word .docx (mammoth). Le librerie stanno in vendor/
// e vengono caricate solo la prima volta che serve.

export const NOTE_EXT = /\.(md|markdown|txt|pdf|docx|pptx|odt)$/i;
export const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.pptx,.odt';

export function isSupported(name) {
  return NOTE_EXT.test(name);
}

export function stripExt(name) {
  return name.replace(NOTE_EXT, '');
}

export function isMarkdown(name) {
  return /\.(md|markdown)$/i.test(name || '');
}

export function kindOf(name) {
  const m = /\.([a-z]+)$/i.exec(name || '');
  const ext = m ? m[1].toLowerCase() : '';
  return { md: 'md', markdown: 'md', txt: 'txt', pdf: 'pdf', docx: 'docx', doc: 'doc', pptx: 'pptx', odt: 'odt' }[ext] || ext;
}

// ---------- PDF ----------
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(new URL('../vendor/pdfjs/pdf.min.js', import.meta.url).href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.js', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function pdfText(file) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      text += item.hasEOL ? '\n' : (item.str && !item.str.endsWith(' ') ? ' ' : '');
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    page.cleanup();
  }
  await doc.destroy();
  const body = pages.map((t, i) => `--- Pagina ${i + 1} ---\n${t}`).join('\n\n');
  const chars = pages.join('').replace(/\s/g, '').length;
  // Poche lettere per pagina: quasi certamente una scansione (immagini senza testo).
  const scanned = chars < 40 * pages.length;
  return { text: body, pages: pages.length, scanned };
}

// ---------- Word (.docx) ----------
let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) { resolve(window.mammoth); return; }
      const s = document.createElement('script');
      s.src = new URL('../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href;
      s.onload = () => (window.mammoth ? resolve(window.mammoth) : reject(new Error('mammoth non disponibile')));
      s.onerror = () => reject(new Error('impossibile caricare il lettore di file Word'));
      document.head.append(s);
    });
  }
  return mammothPromise;
}

/** HTML prodotto da mammoth → testo con titoli ed elenchi in stile Markdown (utile per "Spiegami" sezione per sezione). */
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const walk = (el) => {
    for (const node of el.children) {
      const tag = node.tagName.toLowerCase();
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (/^h[1-6]$/.test(tag)) { if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`); }
      else if (tag === 'p') { if (text) out.push(text); }
      else if (tag === 'ul' || tag === 'ol') {
        [...node.children].forEach((li, i) => {
          const t = li.textContent.replace(/\s+/g, ' ').trim();
          if (t) out.push(`${tag === 'ol' ? `${i + 1}.` : '-'} ${t}`);
        });
      } else if (tag === 'table') {
        for (const tr of node.querySelectorAll('tr')) {
          out.push(`| ${[...tr.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')} |`);
        }
      } else if (node.children.length) walk(node);
      else if (text) out.push(text);
    }
  };
  walk(doc.body);
  return out.join('\n\n');
}

async function docxText(file) {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return { text: htmlToMarkdown(value), scanned: false };
}

// ---------- File "zip" di Office/OpenDocument (PowerPoint .pptx, OpenDocument .odt) ----------
/** Legge dallo zip solo i file che servono (decompressione nativa del browser, nessuna libreria). */
async function unzip(buffer, wanted) {
  const dv = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('il file non è un documento valido');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = new Uint8Array(buffer, start, size);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out[name] = dec.decode(bytes);
  }
  return out;
}

const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const paraText = (p, tag) => [...p.getElementsByTagName(tag)].map((t) => t.textContent).join('').replace(/\s+/g, ' ').trim();

async function pptxText(file) {
  const files = await unzip(await file.arrayBuffer(), (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const num = (n) => Number(/(\d+)\.xml$/.exec(n)[1]);
  const slides = Object.keys(files).filter((n) => n.startsWith('ppt/slides/')).sort((a, b) => num(a) - num(b));
  const parts = slides.map((name, i) => {
    const paras = [...xml(files[name]).getElementsByTagName('a:p')].map((p) => paraText(p, 'a:t')).filter(Boolean);
    const notesName = `ppt/notesSlides/notesSlide${num(name)}.xml`;
    const notes = files[notesName] ? [...xml(files[notesName]).getElementsByTagName('a:p')].map((p) => paraText(p, 'a:t')).filter((t) => t && !/^\d+$/.test(t)) : [];
    const [title, ...rest] = paras;
    return `--- Slide ${i + 1} ---\n${title ? `## ${title}\n` : ''}${rest.map((t) => `- ${t}`).join('\n')}${notes.length ? `\nNote del relatore: ${notes.join(' ')}` : ''}`;
  });
  return { text: parts.join('\n\n'), pages: slides.length, scanned: false };
}

async function odtText(file) {
  const { 'content.xml': content } = await unzip(await file.arrayBuffer(), (n) => n === 'content.xml');
  if (!content) throw new Error('documento OpenDocument senza contenuto');
  const doc = xml(content);
  const out = [];
  const walk = (el) => {
    for (const node of el.children) {
      if (node.tagName === 'text:h') {
        const level = Number(node.getAttribute('text:outline-level')) || 1;
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(`${'#'.repeat(Math.min(6, level))} ${t}`);
      } else if (node.tagName === 'text:p') {
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(node.parentElement?.tagName === 'text:list-item' ? `- ${t}` : t);
      } else if (node.children.length) walk(node);
    }
  };
  walk(doc.documentElement);
  return { text: out.join('\n\n'), scanned: false };
}

/**
 * Estrae il testo da un file di appunti.
 * Restituisce { text, kind, pages?, scanned } — `scanned` vero per PDF senza testo (scansioni).
 */
export async function extractText(file) {
  const kind = kindOf(file.name);
  if (kind === 'pdf') return { kind, ...(await pdfText(file)) };
  if (kind === 'docx') return { kind, ...(await docxText(file)) };
  if (kind === 'pptx') return { kind, ...(await pptxText(file)) };
  if (kind === 'odt') return { kind, ...(await odtText(file)) };
  if (kind === 'doc') throw new Error('Il vecchio formato Word .doc non è supportato: aprilo con Word e salvalo come .docx.');
  return { kind, text: await file.text(), scanned: false };
}

/** Codifica un file in base64 (per la trascrizione dei PDF scansionati con Gemini). */
export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const OCR_PROMPT = `Trascrivi fedelmente in Markdown il contenuto di questo documento di appunti universitari (può essere scansionato o scritto a mano).
Mantieni l'ordine, i titoli (#), gli elenchi e le formule (scritte in modo leggibile). Indica le pagine con "--- Pagina N ---".
Descrivi brevemente tra parentesi quadre schemi o figure importanti, per esempio [Figura: schema del ciclo idrologico].
Non aggiungere commenti, introduzioni o conclusioni: solo la trascrizione.`;

/** Spiega i file trovati che JARVIS non sa leggere, con cosa fare. skipped: { estensione: quanti } */
export function describeSkipped(skipped) {
  const n = (k) => skipped[k] || 0;
  const parts = [];
  const tips = [];
  const apple = n('pages') + n('key') + n('numbers');
  if (apple) {
    parts.push(`${apple} file di Pages/Keynote/Numbers`);
    tips.push('aprili con Pages o Keynote e usa File → Esporta in → PDF');
  }
  if (n('doc') || n('ppt')) {
    parts.push(`${n('doc') + n('ppt')} file Word/PowerPoint vecchio formato (.doc/.ppt)`);
    tips.push('aprili e salvali come .docx/.pptx oppure come PDF');
  }
  const img = n('jpg') + n('jpeg') + n('png') + n('heic') + n('webp');
  if (img) {
    parts.push(`${img} immagini`);
    tips.push('per le foto degli appunti: selezionale nel Finder → clic destro → Azioni rapide → Crea PDF (i PDF scansionati li faccio trascrivere a Gemini)');
  }
  if (n('icloud')) {
    parts.push(`${n('icloud')} file che sono solo su iCloud e non sul Mac`);
    tips.push('nel Finder fai clic destro sulla cartella → «Scarica ora», poi ricollegala');
  }
  const other = Object.entries(skipped).filter(([k]) => !['pages', 'key', 'numbers', 'doc', 'ppt', 'jpg', 'jpeg', 'png', 'heic', 'webp', 'icloud'].includes(k))
    .reduce((a, [, v]) => a + v, 0);
  if (other) parts.push(`${other} altri file`);
  return { text: parts.join(', '), tips: tips.join('; '), important: apple + n('doc') + n('ppt') + n('icloud') > 0 };
}
