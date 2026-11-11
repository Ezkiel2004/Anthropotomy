/* Question builder for the teacher Assessments page. One global, QuestionBuilder.
   The builder is a centred Studio sheet: the assessment's body system and title, then Questions,
   Points, Time, Pass mark and Status, then every question as a card with its answer shown (options
   with the correct one marked, "Answer: <term>", or the hotspot picture with its target ring).
   Add and Edit open the question form, a side sheet stacked over the builder.
   Once a student has taken the assessment its questions are locked (the API refuses edits with 409):
   the cards keep their answers but lose their menus, and Duplicate to edit makes a draft copy with
   every question and switches the builder to it.

   QuestionBuilder.init({ find(id) → assessment row, refresh() → Promise, onClose(id) })
   QuestionBuilder.open(assessmentId) → Promise
   QuestionBuilder.openForm(assessmentId, question|null) → the form for a new or an existing question
   Needs app.js (API_BASE, escHtml, showToast, confirmToast), content-format.js and content-studio.js. */
'use strict';
const QuestionBuilder = (() => {
  const TYPES = ContentFormat.QUESTION_TYPES;
  const LOCKED = 'A student has taken this assessment, so its questions are locked to keep past results fair.';
  const STATUS = { active: ['Open', 'open'], closed: ['Closed', 'closed'] };
  const FOOT_NOTES = {
    locked: 'Questions are locked.',
    active: 'Students see changes when they next start it.',
    closed: 'Closed. Students can’t start it.',
    draft: 'Students can’t see it until you open it.',
  };
  let hooks = {};
  let view = null;      // the open builder: { id, row, sheet, body, add, note, questions, loaded, locked, token }
  let formOpen = false;

  // ── Formatting ────────────────────────────────────────────────
  const round = (n, places) => Math.round(Number(n) * 10 ** places) / 10 ** places;
  const number = n => String(round(n, 2));
  const points = n => `${number(n)} ${Number(n) === 1 ? 'point' : 'points'}`;
  const percent = fraction => String(round(Number(fraction) * 100, 1));   // .07 → "7", .465 → "46.5"
  const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
  const filled = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));
  // Pictures come from this site (../ or /) or the web; anything else is not drawn.
  const safeUrl = url => (/^(https?:\/\/|\/(?!\/)|\.\.\/)[^\s"'<>]*$/i.test(String(url || '').trim()) ? String(url).trim() : '');
  const hotspotOf = q => (q.hotspot_data && typeof q.hotspot_data === 'object' && !Array.isArray(q.hotspot_data) ? q.hotspot_data : {});
  // Retired types read as their nearest current one: fill in the blank is identification, diagram is multiple choice.
  const typeOf = q => (TYPES[q.question_type] ? q.question_type : q.question_type === 'fill_blank' ? 'identification' : 'multiple_choice');
  const termOf = q => String(hotspotOf(q).target_label || q.options?.[0]?.option_text || '');
  const statusOf = row => STATUS[row.status] || ['Draft', 'draft'];

  async function api(path, method = 'GET', body) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({ success: false }));
      return { ...json, status: res.status };
    } catch {
      return { success: false, status: 0, message: 'Server error. Make sure XAMPP is running.' };
    }
  }

  // The list row (from the page's list, or the API when the page has none) carries the attempt count.
  async function rowFor(id) {
    let row = hooks.find?.(id);
    if (!row) {
      const list = await api('assessments.php');
      row = (list.data || []).find(a => Number(a.assessment_id) === id);
    }
    return row ? {
      ...row,
      assessment_id: Number(row.assessment_id),
      time_limit_mins: Number(row.time_limit_mins) || null,
      passing_score: Number(row.passing_score) || 0,
      question_count: Number(row.question_count) || 0,
      submission_count: Number(row.submission_count) || 0,
    } : null;
  }

  // ── Builder ───────────────────────────────────────────────────
  async function open(assessmentId) {
    const id = Number(assessmentId);
    if (view && !(await view.sheet.close())) return;
    const row = await rowFor(id);
    if (!row) { showToast('That assessment could not be found.', 'error'); return; }

    const body = document.createElement('div');
    body.className = 'cs-qb';
    const foot = document.createElement('div');
    foot.className = 'cs-afoot';
    foot.innerHTML = `<span class="cs-meta" id="qbNote"></span>
      <button type="button" class="cs-btn" data-qb-close>Close</button>
      <button type="button" class="cs-btn cs-btn--primary" data-qb-add aria-describedby="qbNote">${Studio.icon('plus', 'cs-ico--sm')}Add question</button>`;
    view = { id, row, body, foot, add: foot.querySelector('[data-qb-add]'), note: foot.querySelector('#qbNote'), questions: [], loaded: false, locked: row.submission_count > 0, token: 0 };
    render();
    // First focus: Duplicate to edit when locked, otherwise Add question.
    (view.locked ? body.querySelector('[data-qb-duplicate]') : view.add).setAttribute('autofocus', '');

    const current = view;
    current.sheet = Studio.sheet({
      eyebrow: row.system_name || 'All body systems', title: row.title, body, footer: foot, size: 'center',
      onClose: () => { if (view === current) view = null; hooks.onClose?.(current.id); },
    });
    body.querySelector('[autofocus]')?.removeAttribute('autofocus');
    view.add.removeAttribute('autofocus');
    current.sheet.root.querySelector('.cs-sheet-head h3').tabIndex = -1;   // focus lands here after Duplicate to edit or a lock

    foot.querySelector('[data-qb-close]').addEventListener('click', () => current.sheet.close());
    view.add.addEventListener('click', () => openForm(current.id, null));
    body.addEventListener('click', event => {
      const more = event.target.closest('[data-q-more]');
      if (more) {
        const question = current.questions.find(q => q.question_id === Number(more.dataset.qMore));
        if (question) Studio.menu(more, menuItems(question));
        return;
      }
      const duplicate = event.target.closest('[data-qb-duplicate]');
      if (duplicate) { duplicateToEdit(duplicate); return; }
      if (event.target.closest('[data-qb-retry]')) load();
    });
    // A picture that does not load keeps its place and its ring, with a note instead of the image.
    body.addEventListener('error', event => {
      if (event.target.matches?.('.cs-hs img')) event.target.closest('figure').classList.add('is-missing');
    }, true);
    await load();
  }

  async function load({ focus } = {}) {
    const v = view;
    if (!v) return;
    const token = ++v.token;
    const result = await api(`questions.php?assessment_id=${v.id}`);
    if (view !== v || v.token !== token) return;
    if (!result.success) {
      v.failed = true;
      render();
      return;
    }
    v.failed = false;
    v.loaded = true;
    v.questions = (result.data || []).map(q => ({ ...q, question_id: Number(q.question_id), points: Number(q.points) || 0, sort_order: Number(q.sort_order) || 0, options: q.options || [] }));
    render({ focus });
  }

  // focus: a question id (its menu button), 'add', 'title' or nothing (focus stays where it was when it can).
  function render({ focus } = {}) {
    const v = view;
    const hadFocus = v.body.contains(document.activeElement);
    Studio.closeMenu(false);
    const total = v.loaded ? v.questions.length : v.row.question_count;
    const [statusLabel, statusTone] = statusOf(v.row);
    const stat = (label, value, cls = '') => `<div><span class="cs-meta">${label}</span><b class="cs-num${cls}">${escHtml(value)}</b></div>`;
    v.body.innerHTML = `<div class="cs-qhead">
        ${stat('Questions', String(total))}
        ${stat('Points', v.loaded ? number(v.questions.reduce((sum, q) => sum + q.points, 0)) : '…')}
        ${stat('Time', v.row.time_limit_mins ? `${v.row.time_limit_mins} min` : 'No limit')}
        ${stat('Pass mark', `${number(v.row.passing_score)}%`)}
        ${stat('Status', statusLabel, ` cs-qstat--${statusTone}`)}
      </div>
      ${v.locked ? `<div class="cs-lock">${Studio.icon('lock-key')}<span id="qbLock">${LOCKED}</span><button type="button" class="cs-lock-btn" data-qb-duplicate aria-describedby="qbLock">Duplicate to edit</button></div>` : ''}
      ${questionsHtml(v)}`;
    v.add.disabled = v.locked;
    v.note.textContent = v.locked ? FOOT_NOTES.locked : FOOT_NOTES[v.row.status] || FOOT_NOTES.draft;

    const target = typeof focus === 'number' ? v.body.querySelector(`[data-q-more="${focus}"]`)
      : focus === 'add' ? (v.add.disabled ? null : v.add)
      : focus === 'title' ? v.sheet?.root.querySelector('.cs-sheet-head h3') : null;
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
    } else if (hadFocus && !v.body.contains(document.activeElement)) {
      (v.add.disabled ? v.sheet.root.querySelector('[data-sheet-close]') : v.add).focus({ preventScroll: true });
    }
  }

  function questionsHtml(v) {
    if (v.failed) {
      return `<div class="cs-qempty" role="alert"><p>Questions could not load. Check that XAMPP is running, then try again.</p>
        <button type="button" class="cs-btn cs-btn--sm" data-qb-retry>Try again</button></div>`;
    }
    if (!v.loaded) return '<p class="cs-meta" role="status">Loading questions…</p>';
    if (!v.questions.length) {
      return `<div class="cs-qempty"><h4 class="cs-h3">No questions yet</h4>
        <p>Add any mix of multiple choice, true or false, identification and hotspot questions. Students answer them in this order.</p></div>`;
    }
    return `<ol class="cs-qlist" aria-label="Questions">${v.questions.map((q, i) => cardHtml(q, i, v.locked)).join('')}</ol>`;
  }

  function cardHtml(q, index, locked) {
    const type = typeOf(q);
    const t = TYPES[type];
    const n = index + 1;
    return `<li class="cs-q" data-q="${q.question_id}">
      <div class="cs-q-top"><span class="cs-q-n"><span class="cs-sr">Question </span>${n}</span>
        <span class="cs-qtype q-${type}">${Studio.icon(t.icon, 'cs-ico--sm')}${escHtml(t.label)}</span>
        <span class="cs-meta">${points(q.points)}</span>
        ${locked ? '' : `<button type="button" class="cs-icon-btn" data-q-more="${q.question_id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for question ${n}">${Studio.icon('dots-three')}</button>`}</div>
      <p class="cs-q-text">${escHtml(q.question_text)}</p>
      ${answerHtml(q, type)}</li>`;
  }

  function answerHtml(q, type) {
    if (type === 'identification') {
      return `<span class="cs-answer">${Studio.icon('check-circle', 'cs-ico--sm')}<span>Answer: ${escHtml(termOf(q))} <span class="cs-meta">· capital letters ignored</span></span></span>`;
    }
    if (type === 'hotspot') {
      const hs = hotspotOf(q);
      const url = safeUrl(hs.image_url || q.image_url);
      const placed = filled(hs.x) && filled(hs.y) && filled(hs.radius);
      const ring = placed ? `<b style="left:${percent(clamp(Number(hs.x), 0, 1))}%;top:${percent(clamp(Number(hs.y), 0, 1))}%;width:${percent(clamp(Number(hs.radius), 0, 1) * 2)}%"></b>` : '';
      return `<div class="cs-hs"><figure${url ? '' : ' class="is-missing"'}>${url ? `<img src="${escHtml(url)}" alt=""/>` : ''}<span class="cs-hs-missing">Picture not found</span>${ring}</figure>
        <div class="cs-row-copy"><span class="cs-answer">${Studio.icon('crosshair', 'cs-ico--sm')}<span>Target: ${escHtml(hs.target_label || 'not named')}</span></span>
          <span class="cs-meta">${placed ? `Tolerance ${percent(hs.radius)}% of the picture` : 'No target set yet. Edit the question to set it.'}</span></div></div>`;
    }
    const options = q.options || [];
    if (!options.length) return '<p class="cs-meta">No answer choices yet.</p>';
    return `<ul class="cs-opts">${options.map(o => o.is_correct
      ? `<li class="cs-opt ok">${Studio.icon('check-circle')}<span>${escHtml(o.option_text)}</span><em>Correct</em></li>`
      : `<li class="cs-opt"><i aria-hidden="true"></i><span>${escHtml(o.option_text)}</span></li>`).join('')}</ul>`;
  }

  // ── Question actions ──────────────────────────────────────────
  function menuItems(q) {
    return [
      { label: 'Edit', onSelect: () => openForm(view.id, q) },
      { label: 'Duplicate', onSelect: () => duplicateQuestion(q) },
      { label: 'Delete', danger: true, onSelect: () => removeQuestion(q) },
    ];
  }

  const nextSort = () => Math.max(0, ...(view?.questions || []).map(q => q.sort_order)) + 1;

  // The API refuses with 409 once someone has taken the assessment: the builder locks.
  function refused(result, fallback) {
    if (result.success) return false;
    if (result.status === 409 && view) {
      view.locked = true;
      render({ focus: 'title' });
      showToast('A student has taken this assessment, so its questions are locked. Duplicate it to edit.', 'error');
      hooks.refresh?.();
    } else {
      showToast(result.message || fallback, 'error');
    }
    return true;
  }

  async function afterChange(focus) {
    await Promise.all([load({ focus }), hooks.refresh?.()]);
  }

  async function duplicateQuestion(q) {
    const ok = await confirmToast({ title: 'Duplicate this question?', message: 'The copy is added at the end.', confirmText: 'Duplicate', cancelText: 'Cancel' });
    if (!ok || !view) return;
    const hs = hotspotOf(q);
    const result = await api('questions.php', 'POST', {
      assessment_id: view.id,
      question_text: q.question_text,
      question_type: q.question_type,
      points: q.points,
      image_url: q.image_url || null,
      hotspot_data: Object.keys(hs).length ? hs : null,
      options: q.options.map(o => ({ option_text: o.option_text, is_correct: Boolean(o.is_correct), sort_order: o.sort_order })),
      sort_order: nextSort(),
    });
    if (refused(result, 'The question could not be duplicated.')) return;
    showToast('Question duplicated.', 'success');
    await afterChange(Number(result.data?.question_id));
  }

  async function removeQuestion(q) {
    const ok = await confirmToast({ title: 'Delete this question?', message: 'It is removed from this assessment. This can’t be undone.', confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok || !view) return;
    const ids = view.questions.map(x => x.question_id);
    const at = ids.indexOf(q.question_id);
    const result = await api(`questions.php?id=${q.question_id}`, 'DELETE');
    if (refused(result, 'The question could not be deleted.')) return;
    showToast('Question deleted.', 'success');
    await afterChange(ids[at + 1] ?? ids[at - 1] ?? 'add');
  }

  // A draft copy with every question; the builder switches to it so the teacher can edit straight away.
  async function duplicateToEdit(button) {
    const v = view;
    button.disabled = true;
    v.sheet.setBusy(true);
    const result = await api(`assessments.php?duplicate=${v.id}`, 'POST', {});
    v.sheet.setBusy(false);
    if (!result.success) {
      button.disabled = false;
      showToast(result.message || 'The assessment could not be duplicated.', 'error');
      return;
    }
    const copyId = Number(result.data?.assessment_id);
    await hooks.refresh?.();
    if (view !== v) return;
    v.row = await rowFor(copyId) || { ...v.row, assessment_id: copyId, title: `${v.row.title} (copy)`, status: 'draft', submission_count: 0 };
    v.id = copyId;
    v.locked = v.row.submission_count > 0;
    v.loaded = false;
    v.questions = [];
    v.sheet.root.querySelector('.cs-sheet-head .cs-eyebrow').textContent = v.row.system_name || 'All body systems';
    v.sheet.root.querySelector('.cs-sheet-head h3').textContent = v.row.title;
    render({ focus: 'title' });
    showToast('Copy saved as a draft. You can edit its questions.', 'success');
    await load();
  }

  // ── Question form ─────────────────────────────────────────────
  function openForm(assessmentId, question = null) {
    const id = Number(assessmentId);
    const context = view && view.id === id ? view : null;
    if (formOpen) return null;
    if (context?.locked) { showToast('A student has taken this assessment, so its questions are locked. Duplicate it to edit.', 'error'); return null; }
    const editing = Boolean(question);
    const type = editing ? typeOf(question) : 'multiple_choice';
    const hs = editing ? hotspotOf(question) : {};
    const choices = editing && type === 'multiple_choice' ? question.options || [] : [];
    const correctAt = Math.max(0, choices.findIndex(o => o.is_correct));
    const trueIsCorrect = !(editing && type === 'true_false')
      || String(question.options?.find(o => o.is_correct)?.option_text ?? 'True').toLowerCase() === 'true';
    const letter = i => String.fromCharCode(65 + i);
    const inPercent = value => (filled(value) ? percent(value) : '');

    const form = document.createElement('form');
    form.id = 'questionForm';
    form.className = 'cs-qform';
    form.noValidate = true;
    form.innerHTML = `
      <div class="cs-field"><label for="qfText">Question</label>
        <textarea class="cs-input cs-input--area cs-input--question" id="qfText" name="question_text" rows="3" maxlength="2000" autofocus placeholder="e.g. Which bone protects the brain?">${escHtml(question?.question_text || '')}</textarea></div>
      <div class="cs-field" role="radiogroup" aria-labelledby="qfTypeLabel"><span class="cs-label" id="qfTypeLabel">Question type</span>
        <div class="cs-types cs-types--4">${Object.entries(TYPES).map(([value, t]) => `<label class="cs-type q-${value}"><input type="radio" name="question_type" value="${value}"${value === type ? ' checked' : ''}/>${Studio.icon(t.icon)}${escHtml(t.label)}</label>`).join('')}</div></div>
      <div class="cs-field" data-for="multiple_choice" role="group" aria-labelledby="qfChoicesLabel"><span class="cs-label" id="qfChoicesLabel">Answer choices <span class="cs-meta">· mark the correct one</span></span>
        <div class="cs-choices">${Array.from({ length: Math.max(4, choices.length) }, (_, i) => `<div class="cs-choice">
          <label class="cs-choice-ok"><input type="radio" name="correct" value="${i}"${i === correctAt ? ' checked' : ''}/><i aria-hidden="true"></i><span class="cs-sr">Choice ${letter(i)} is the correct answer</span></label>
          <input class="cs-input" type="text" name="choice" maxlength="500" autocomplete="off" aria-label="Choice ${letter(i)}" placeholder="Choice ${letter(i)}${i > 1 ? ' (optional)' : ''}" value="${escHtml(choices[i]?.option_text || '')}"/></div>`).join('')}</div></div>
      <div class="cs-field" data-for="true_false" role="radiogroup" aria-labelledby="qfTfLabel"><span class="cs-label" id="qfTfLabel">Correct answer</span>
        <div class="cs-seg"><label><input type="radio" name="tf" value="True"${trueIsCorrect ? ' checked' : ''}/>True</label><label><input type="radio" name="tf" value="False"${trueIsCorrect ? '' : ' checked'}/>False</label></div></div>
      <div class="cs-field" data-for="identification"><label for="qfTerm">Answer</label>
        <input class="cs-input" type="text" id="qfTerm" name="term" maxlength="255" autocomplete="off" placeholder="e.g. Femur" aria-describedby="qfTermHint" value="${escHtml(type === 'identification' && editing ? termOf(question) : '')}"/>
        <span class="cs-hint" id="qfTermHint">Students type this term. Capital letters are ignored.</span></div>
      <div class="cs-qform-hs" data-for="hotspot">
        <div class="cs-field"><label for="qfLabel">Structure to find</label>
          <input class="cs-input" type="text" id="qfLabel" name="target_label" maxlength="255" autocomplete="off" placeholder="e.g. Sternum" value="${escHtml(hs.target_label || '')}"/></div>
        <div class="cs-field"><label for="qfImage">Picture address</label>
          <input class="cs-input" type="text" id="qfImage" name="image_url" maxlength="500" autocomplete="off" spellcheck="false" placeholder="e.g. ../assets/img/hero/skeletal.webp" aria-describedby="qfImageHint" value="${escHtml(hs.image_url || '')}"/>
          <span class="cs-hint" id="qfImageHint">A picture on this site (starting with ../ or /) or a web address.</span></div>
        <div class="cs-field"><span class="cs-label">Target</span>
          <figure class="cs-hs-pick" data-pick hidden><b data-ring hidden></b></figure>
          <span class="cs-hint" data-pick-hint role="status"></span></div>
        <div class="cs-three">
          <div class="cs-field"><label for="qfX">Across<span class="cs-sr">, percent of the picture from the left</span></label>
            <span class="cs-unit cs-unit--pct"><input class="cs-input" type="number" id="qfX" name="target_x" min="0" max="100" step="0.1" inputmode="decimal" value="${inPercent(hs.x)}"/><span class="cs-meta" aria-hidden="true">%</span></span></div>
          <div class="cs-field"><label for="qfY">Down<span class="cs-sr">, percent of the picture from the top</span></label>
            <span class="cs-unit cs-unit--pct"><input class="cs-input" type="number" id="qfY" name="target_y" min="0" max="100" step="0.1" inputmode="decimal" value="${inPercent(hs.y)}"/><span class="cs-meta" aria-hidden="true">%</span></span></div>
          <div class="cs-field"><label for="qfTol">Tolerance<span class="cs-sr">, percent of the picture width</span></label>
            <span class="cs-unit cs-unit--pct"><input class="cs-input" type="number" id="qfTol" name="tolerance" min="1" max="25" step="1" inputmode="numeric" value="${filled(hs.radius) ? percent(hs.radius) : 5}"/><span class="cs-meta" aria-hidden="true">%</span></span></div>
        </div>
        <span class="cs-hint">A click counts when it lands within the tolerance of the target, measured as a share of the picture’s width.</span>
      </div>
      <div class="cs-field cs-field--points"><label for="qfPoints">Points</label>
        <input class="cs-input" type="number" id="qfPoints" name="points" min="0" step="any" inputmode="decimal" value="${editing ? number(question.points) : 1}"/></div>`;

    const foot = document.createElement('div');
    foot.className = 'cs-afoot';
    foot.innerHTML = `<span class="cs-meta" id="qfNote" role="status"></span>
      <button type="button" class="cs-btn" data-cancel>Cancel</button>
      <button type="submit" class="cs-btn cs-btn--primary" form="questionForm">${editing ? 'Save question' : 'Add question'}</button>`;

    formOpen = true;
    const title = context?.row.title || hooks.find?.(id)?.title || 'Questions';
    const sheet = Studio.sheet({ eyebrow: title, title: editing ? 'Edit question' : 'New question', body: form, footer: foot, onClose: () => { formOpen = false; } });
    form.querySelector('[autofocus]').removeAttribute('autofocus');
    const fields = form.elements;
    const note = foot.querySelector('#qfNote');
    const save = foot.querySelector('[type="submit"]');
    const cancel = foot.querySelector('[data-cancel]');
    cancel.addEventListener('click', () => sheet.close());

    // Only the chosen type's fields show.
    const selected = () => form.querySelector('[name="question_type"]:checked').value;
    const showType = () => form.querySelectorAll('[data-for]').forEach(group => { group.hidden = group.dataset.for !== selected(); });
    form.addEventListener('change', event => { if (event.target.name === 'question_type') showType(); });
    showType();

    // Hotspot: the picture previews from its address; a click on it sets the target; the ring follows.
    const pick = form.querySelector('[data-pick]');
    const ring = pick.querySelector('[data-ring]');
    const img = document.createElement('img');   // gets its src from the address field
    img.alt = 'The picture students click. Click it to set the target.';
    pick.prepend(img);
    const pickHint = form.querySelector('[data-pick-hint]');
    const drawRing = () => {
      const placed = filled(fields.target_x.value) && filled(fields.target_y.value);
      ring.hidden = !placed;
      if (!placed) return;
      const tolerance = filled(fields.tolerance.value) ? clamp(Number(fields.tolerance.value), 1, 25) : 5;
      ring.style.left = `${clamp(Number(fields.target_x.value), 0, 100)}%`;
      ring.style.top = `${clamp(Number(fields.target_y.value), 0, 100)}%`;
      ring.style.width = `${tolerance * 2}%`;
    };
    const showPicture = () => {
      const url = safeUrl(fields.image_url.value);
      if (!url) {
        pick.hidden = true;
        img.removeAttribute('src');
        pickHint.textContent = 'Add the picture address, then click the picture to set the target.';
        return;
      }
      if (img.getAttribute('src') !== url) img.setAttribute('src', url);
      pick.hidden = false;
      pickHint.textContent = 'Click the picture to set the target, or type where it is below.';
    };
    img.addEventListener('error', () => { pick.hidden = true; pickHint.textContent = 'That picture could not be loaded. Check the address.'; });
    img.addEventListener('load', () => { if (safeUrl(fields.image_url.value)) pick.hidden = false; });
    img.addEventListener('click', event => {
      const box = img.getBoundingClientRect();
      fields.target_x.value = String(round(clamp((event.clientX - box.left) / box.width, 0, 1) * 100, 1));
      fields.target_y.value = String(round(clamp((event.clientY - box.top) / box.height, 0, 1) * 100, 1));
      drawRing();
      sheet.setDirty(true);
    });
    fields.image_url.addEventListener('change', showPicture);
    for (const name of ['target_x', 'target_y', 'tolerance']) fields[name].addEventListener('input', drawRing);
    showPicture();
    drawRing();

    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      const fail = (message, field) => {
        note.textContent = message;
        note.classList.add('is-error');
        field?.focus();
      };
      const kind = selected();
      const text = fields.question_text.value.trim();
      if (!text) return fail('Write the question.', fields.question_text);
      // Any positive number, as the API accepts: older questions can be worth 0.5 or 12.
      const worth = Number(fields.points.value);
      if (!filled(fields.points.value) || !(worth > 0)) return fail('Points must be more than 0.', fields.points);

      let options = [];
      // On an edit, a type that no longer uses them clears the old answer term or target.
      let hotspot = editing && Object.keys(hotspotOf(question)).length ? {} : null;
      if (kind === 'multiple_choice') {
        const inputs = [...form.querySelectorAll('[name="choice"]')];
        const texts = inputs.map(input => input.value.trim());
        const correct = Number(form.querySelector('[name="correct"]:checked')?.value ?? -1);
        if (texts.filter(Boolean).length < 2) return fail('Add at least two answer choices.', inputs.find(input => !input.value.trim()));
        if (!texts[correct]) return fail('Mark a filled-in choice as the correct answer.', inputs[correct] || inputs[0]);
        options = texts.map((option_text, i) => ({ option_text, is_correct: i === correct }))
          .filter(o => o.option_text).map((o, i) => ({ ...o, sort_order: i + 1 }));
      } else if (kind === 'true_false') {
        const isTrue = form.querySelector('[name="tf"]:checked')?.value !== 'False';
        options = [{ option_text: 'True', is_correct: isTrue, sort_order: 1 }, { option_text: 'False', is_correct: !isTrue, sort_order: 2 }];
      } else if (kind === 'identification') {
        const term = fields.term.value.trim();
        if (!term) return fail('Enter the answer students should type.', fields.term);
        hotspot = { target_label: term };
        options = [{ option_text: term, is_correct: true, sort_order: 1 }];
      } else {
        const label = fields.target_label.value.trim();
        const url = safeUrl(fields.image_url.value);
        if (!label) return fail('Name the structure students should find.', fields.target_label);
        if (!url) return fail('Add a picture address that starts with ../, / or https://.', fields.image_url);
        if (!filled(fields.target_x.value) || !filled(fields.target_y.value)) return fail('Click the picture to set the target.', fields.target_x);
        const x = Number(fields.target_x.value), y = Number(fields.target_y.value), tolerance = Number(fields.tolerance.value);
        if (x < 0 || x > 100 || y < 0 || y > 100) return fail('Across and down must be from 0 to 100%.', fields.target_x);
        if (!filled(fields.tolerance.value) || tolerance < 1 || tolerance > 25) return fail('Tolerance must be from 1 to 25%.', fields.tolerance);
        hotspot = { target_label: label, image_url: url, x: round(x / 100, 3), y: round(y / 100, 3), radius: round(tolerance / 100, 3) };
      }

      const payload = { question_text: text, question_type: kind, points: worth, options, hotspot_data: hotspot };
      if (!editing) Object.assign(payload, { assessment_id: id, sort_order: context ? nextSort() : 0 });
      saving = true;
      save.disabled = cancel.disabled = true;
      sheet.setBusy(true);
      note.classList.remove('is-error');
      note.textContent = 'Saving…';
      const result = await api(editing ? `questions.php?id=${question.question_id}` : 'questions.php', editing ? 'PUT' : 'POST', payload);
      saving = false;
      save.disabled = cancel.disabled = false;
      sheet.setBusy(false);
      if (!result.success && result.status !== 409) { fail(result.message || 'The question could not be saved.'); return; }
      sheet.setDirty(false);
      await sheet.close();
      if (refused(result, '')) return;
      showToast(editing ? 'Question saved.' : 'Question added.', 'success');
      const saved = editing ? question.question_id : Number(result.data?.question_id);
      if (view && view.id === id) await afterChange(saved);
      else await hooks.refresh?.();
    });
    return sheet;
  }

  function init(options = {}) { hooks = options; }

  return { init, open, openForm };
})();
