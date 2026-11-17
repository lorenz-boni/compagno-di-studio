// Presentazione guidata al primo avvio: percorso di studi, chiave Gemini, tono e voce, cartella degli appunti.
// Riceve dall'app ciò che le serve (impostazioni, verifica della chiave, anteprima della voce, scelta cartella).

const $ = (s) => document.querySelector(s);

export function createOnboarding(deps) {
  // deps: { settings(), save(patch), verifyKey(key) → { ok, message, liveModels }, previewVoice(voice, key) → Promise,
  //         pickFolder() → Promise<string|null>, tones, voices, onFinish() }
  const dlg = $('#dlg-welcome');
  let step = 1;
  const last = 4;

  function fill() {
    const s = deps.settings();
    const p = s.profile || {};
    $('#wz-name').value = p.name || '';
    $('#wz-university').value = p.university || '';
    $('#wz-degree').value = p.degree || '';
    $('#wz-year').value = p.year || '';
    $('#wz-notes').value = p.notes || '';
    $('#wz-key').value = s.key || '';
    $('#wz-key-status').textContent = '';
    const tones = $('#wz-tones');
    tones.querySelectorAll('label').forEach((x) => x.remove());
    for (const [id, t] of Object.entries(deps.tones)) {
      const l = document.createElement('label');
      l.className = 'tone';
      l.innerHTML = `<input type="radio" name="wz-tone" value="${id}"><span><strong>${t.label}</strong><span class="tone-desc">${t.desc}</span></span>`;
      l.querySelector('input').checked = (s.tone || 'confidenziale') === id;
      tones.append(l);
    }
    const sel = $('#wz-voice');
    sel.replaceChildren(...deps.voices.map((v) => new Option(`${v.name} — ${v.desc}`, v.name)));
    sel.value = s.liveVoice || deps.voices[0].name;
    $('#wz-folder-status').textContent = deps.folderName?.() ? `Collegata: «${deps.folderName()}»` : '';
  }

  function collect() {
    return {
      profile: {
        name: $('#wz-name').value.trim(),
        university: $('#wz-university').value.trim(),
        degree: $('#wz-degree').value.trim(),
        year: $('#wz-year').value.trim(),
        notes: $('#wz-notes').value.trim(),
      },
      key: $('#wz-key').value.trim(),
      tone: dlg.querySelector('input[name="wz-tone"]:checked')?.value || 'confidenziale',
      liveVoice: $('#wz-voice').value,
    };
  }

  function show(n) {
    step = Math.max(1, Math.min(last, n));
    dlg.querySelectorAll('.wiz-pane').forEach((p) => { p.hidden = Number(p.dataset.step) !== step; });
    dlg.querySelectorAll('.wiz-steps li').forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle('done', k < step);
      if (k === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    $('#wz-back').hidden = step === 1;
    $('#wz-skip').hidden = step === last;
    $('#wz-next').textContent = step === last ? 'Inizia a studiare' : 'Avanti';
    dlg.querySelector(`.wiz-pane[data-step="${step}"] input, .wiz-pane[data-step="${step}"] button`)?.focus();
  }

  function finish() {
    deps.save({ ...collect(), onboarded: true });
    if (dlg.open) dlg.close();
    deps.onFinish?.();
  }

  $('#wz-next').onclick = () => {
    deps.save(collect());
    if (step === last) finish();
    else show(step + 1);
  };
  $('#wz-back').onclick = () => show(step - 1);
  $('#wz-skip').onclick = () => show(step + 1);
  // Chiudere con Esc vale come "finito": non riproponiamo la presentazione a ogni avvio.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });

  $('#wz-check').onclick = async () => {
    const st = $('#wz-key-status');
    const key = $('#wz-key').value.trim();
    st.className = 'hint';
    if (!key) { st.textContent = 'Incolla prima la chiave.'; return; }
    st.textContent = 'Verifico…';
    const r = await deps.verifyKey(key);
    st.textContent = r.message;
    st.className = `hint ${r.ok ? 'ok-text' : 'err-text'}`;
    if (r.ok) deps.save({ key });
  };

  $('#wz-listen').onclick = async () => {
    const st = $('#wz-voice-status');
    const key = $('#wz-key').value.trim() || deps.settings().key;
    if (!key) { st.textContent = 'Per ascoltare le voci serve la chiave (passo 2).'; st.className = 'hint err-text'; return; }
    deps.save(collect());
    const btn = $('#wz-listen');
    btn.disabled = true;
    st.className = 'hint';
    st.textContent = 'Ascolta…';
    try {
      await deps.previewVoice($('#wz-voice').value, key);
      st.textContent = 'Ti piace? Puoi provarne altre o andare avanti.';
    } catch (err) {
      st.textContent = `Anteprima non riuscita: ${err.message}`;
      st.className = 'hint err-text';
    } finally {
      btn.disabled = false;
    }
  };

  $('#wz-folder').onclick = async () => {
    const name = await deps.pickFolder();
    const st = $('#wz-folder-status');
    if (name) { st.textContent = `Collegata: «${name}»`; st.className = 'hint ok-text'; }
  };

  return {
    open() {
      fill();
      show(1);
      if (!dlg.open) dlg.showModal();
    },
  };
}
