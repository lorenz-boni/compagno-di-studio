// Galleria delle voci di Gemini Live: schede con il "personaggio", il carattere, voce femminile/maschile,
// ▶ per ascoltare e stato (ascoltata / non disponibile con il motivo). Il valore scelto va in una <select> nascosta,
// così il resto dell'app legge la voce come prima.

function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * opts: { voices, select (HTMLSelectElement nascosta), play(voice) → Promise, state(voice) → { kind: ''|'ok'|'ko'|'busy', note } }
 */
export function mountVoicePicker(root, opts) {
  const { voices, select } = opts;
  if (!select.options.length) select.replaceChildren(...voices.map((v) => new Option(v.name, v.name)));

  function render() {
    const current = select.value;
    root.innerHTML = `<div class="vp-grid" role="radiogroup" aria-label="Voci">
        ${voices.map((v) => {
          const st = opts.state(v.name) || {};
          const badge = st.kind === 'ok' ? '<span class="vp-ok">✓ ascoltata</span>'
            : st.kind === 'ko' ? '<span class="vp-ko">non disponibile</span>'
              : st.kind === 'busy' ? '<span class="vp-busy">ascolta…</span>' : '';
          return `<div class="vp-card${v.name === current ? ' sel' : ''}${st.kind === 'ko' ? ' ko' : ''}" data-v="${v.name}">
            <button type="button" class="vp-choose" role="radio" aria-checked="${v.name === current}" title="Scegli «${esc(v.label)}»">
              <span class="vp-name">${esc(v.label)}</span>
              <span class="vp-desc">${esc(v.desc)}</span>
              <span class="vp-tech">${v.g === 'F' ? 'femminile' : 'maschile'} · ${esc(v.name)}</span>
              ${badge}
              ${st.note ? `<span class="vp-note">${esc(st.note)}</span>` : ''}
            </button>
            <button type="button" class="vp-play" aria-label="Ascolta «${esc(v.label)}»" title="Ascolta" ${st.kind === 'busy' ? 'disabled' : ''}>▶</button>
          </div>`;
        }).join('')}
      </div>`;
    root.querySelectorAll('.vp-card').forEach((card) => {
      const name = card.dataset.v;
      card.querySelector('.vp-choose').onclick = () => {
        select.value = name;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        render();
      };
      card.querySelector('.vp-play').onclick = async () => {
        select.value = name;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const p = opts.play(name);
        render(); // mostra "ascolta…"
        try { await p; } catch { /* lo stato lo mostra la scheda */ }
        render();
      };
    });
  }

  render();
  return { render };
}
