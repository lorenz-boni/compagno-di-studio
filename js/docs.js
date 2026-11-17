// Lettura degli appunti in vari formati, tutto nel browser (i file non vengono caricati da nessuna parte):
// Markdown e testo, PDF (pdf.js di Mozilla) e Word .docx (mammoth). Le librerie stanno in vendor/
// e vengono caricate solo la prima volta che serve.

export const NOTE_EXT = /\.(md|markdown|txt|pdf|docx)$/i;
export const ACCEPT = '.md,.markdown,.txt,.pdf,.docx';

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
  return { md: 'md', markdown: 'md', txt: 'txt', pdf: 'pdf', docx: 'docx', doc: 'doc' }[ext] || ext;
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

/**
 * Estrae il testo da un file di appunti.
 * Restituisce { text, kind, pages?, scanned } — `scanned` vero per PDF senza testo (scansioni).
 */
export async function extractText(file) {
  const kind = kindOf(file.name);
  if (kind === 'pdf') return { kind, ...(await pdfText(file)) };
  if (kind === 'docx') return { kind, ...(await docxText(file)) };
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
