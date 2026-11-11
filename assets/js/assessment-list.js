/* Teacher Assessments page: the summary strip, search and body-system filter, rows grouped Open now,
   Drafts and Closed, each row's "more" menu, and the assessment sheet for new and existing assessments.
   One global, AssessmentList. Assessments have no type: every label, icon and tint comes from the
   questions inside (ContentFormat.assessmentKind, questionMix). Needs app.js, content-format.js and
   content-studio.js; the page's question builder opens through hooks.openQuestions(id, title). */
'use strict';
const AssessmentList = (() => {
  let rows = [], systems = [], modules = [], hooks = {}, loaded = false;
  const filters = { system: '', query: '' };
  const $ = id => document.getElementById(id);
  const count = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;
  const percent = value => String(Math.round(Number(value) * 10) / 10);
  const byId = id => rows.find(a => a.assessment_id === Number(id));
  const isDraft = a => !['active', 'closed'].includes(a.status);

  async function api(path, method = 'GET', body) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch {
      return { success: false, message: 'Server error. Make sure XAMPP is running.' };
    }
  }

  // ── Groups: open ones by due date (none last), drafts and closed ones newest first ──
  const newest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || b.assessment_id - a.assessment_id;
  const dueTime = a => (a.due_date ? new Date(String(a.due_date).replace(' ', 'T')).getTime() : Infinity);
  const soonest = (a, b) => dueTime(a) - dueTime(b) || newest(a, b);
  const GROUPS = [
    { key: 'open', title: 'Open now', has: a => a.status === 'active', order: soonest },
    { key: 'draft', title: 'Drafts', has: isDraft, order: newest },
    { key: 'closed', title: 'Closed', has: a => a.status === 'closed', order: newest },
  ];

  function normalise(a) {
    return {
      ...a,
      assessment_id: Number(a.assessment_id),
      module_id: a.module_id == null ? null : Number(a.module_id),
      time_limit_mins: Number(a.time_limit_mins) || null,
      passing_score: Number(a.passing_score) || 0,
      max_attempts: Number(a.max_attempts) || 1,
      question_count: Number(a.question_count) || 0,
      submission_count: Number(a.submission_count) || 0,
      avg_score: a.avg_score == null ? null : Number(a.avg_score) || 0,   // null: no finished attempts yet
      question_types: a.question_types || {},
    };
  }

  // ── Loading ───────────────────────────────────────────────────
  async function load({ focus } = {}) {
    const list = $('assessList');
    if (!loaded) list.innerHTML = '<div class="cs-empty" role="status"><p>Loading assessments…</p></div>';
    const [assessments, systemData, moduleData] = await Promise.all([
      api('assessments.php'),
      systems.length ? null : api('body-systems.php'),
      modules.length ? null : api('modules.php'),
    ]);
    if (!assessments.success) {
      if (loaded) showToast('Assessments could not reload. Check that XAMPP is running.', 'error');
      else list.innerHTML = '<div class="cs-empty" role="alert"><p>Assessments could not load. Check that XAMPP is running, then reload the page.</p></div>';
      return false;
    }
    rows = (assessments.data || []).map(normalise);
    if (systemData?.success) systems = systemData.data || [];
    if (moduleData?.success) modules = moduleData.data || [];
    loaded = true;
    renderSummary();
    renderSystemFilter();
    render({ focus });
    return true;
  }

  // ── Summary and filters ───────────────────────────────────────
  function renderSummary() {
    const stat = (id, n, word, many) => {
      const number = $(id);
      number.textContent = n;
      number.nextElementSibling.textContent = n === 1 ? word : many;
    };
    stat('sumOpen', rows.filter(GROUPS[0].has).length, 'open', 'open');
    stat('sumDraft', rows.filter(GROUPS[1].has).length, 'draft', 'drafts');
    stat('sumClosed', rows.filter(GROUPS[2].has).length, 'closed', 'closed');
    stat('sumAttempts', rows.reduce((sum, a) => sum + a.submission_count, 0), 'attempt', 'attempts');
  }

  // Only the body systems that have an assessment, in body-system order.
  function renderSystemFilter() {
    const present = new Map(rows.filter(a => a.system_code).map(a => [a.system_code, a.system_name]));
    const rank = code => { const at = systems.findIndex(s => s.system_code === code); return at < 0 ? systems.length : at; };
    if (!present.has(filters.system)) filters.system = '';
    const select = $('assessSystemFilter');
    select.innerHTML = '<option value="">All body systems</option>'
      + [...present.keys()].sort((x, y) => rank(x) - rank(y))
        .map(code => `<option value="${escHtml(code)}">${escHtml(present.get(code))}</option>`).join('');
    select.value = filters.system;
  }

  function matches(a) {
    if (filters.system && a.system_code !== filters.system) return false;
    return !filters.query || [a.title, a.system_name].some(text => String(text || '').toLowerCase().includes(filters.query));
  }

  function clearFilters() {
    Object.assign(filters, { system: '', query: '' });
    $('assessSearch').value = '';
    $('assessSystemFilter').value = '';
    render();
    $('assessSearch').focus();
  }

  // ── Rows ──────────────────────────────────────────────────────
  // A re-render keeps focus on the same row's button; focus: id puts it on that row's more button.
  function render({ focus } = {}) {
    const list = $('assessList');
    const active = document.activeElement?.closest?.('#assessList [data-more], #assessList [data-questions]');
    const restore = focus != null ? `[data-more="${Number(focus)}"]`
      : active ? (active.dataset.more ? `[data-more="${active.dataset.more}"]` : `[data-questions="${active.dataset.questions}"]`) : null;
    const shown = rows.filter(matches);
    if (!rows.length) {
      list.innerHTML = `<div class="cs-empty"><h2 class="cs-h2">No assessments yet</h2>
        <p>Make one, then add any mix of multiple choice, true or false, identification and hotspot questions.</p>
        <button type="button" class="cs-btn cs-btn--sm" data-new>New assessment</button></div>`;
    } else if (!shown.length) {
      list.innerHTML = `<div class="cs-empty"><h2 class="cs-h2">No assessments match</h2><p>Try another search or body system.</p>
        <button type="button" class="cs-btn cs-btn--sm" data-clear-filters>Clear filters</button></div>`;
    } else {
      list.innerHTML = GROUPS.map(group => {
        const items = shown.filter(group.has).sort(group.order);
        return items.length ? `<section class="cs-agroup" aria-labelledby="ag-${group.key}">
          <div class="cs-group-head"><h2 class="cs-h2" id="ag-${group.key}">${group.title}</h2><span class="cs-meta cs-num">${items.length}</span></div>
          ${items.map(rowHtml).join('')}</section>` : '';
      }).join('');
    }
    $('assessResults').textContent = `${count(shown.length, 'assessment')} shown`;
    if (restore) list.querySelector(restore)?.focus({ preventScroll: true });
  }

  function rowHtml(a) {
    const kind = ContentFormat.assessmentKind(a.question_types);
    const mix = ContentFormat.questionMix(a.question_types);
    const due = ContentFormat.dueLabel(a.due_date, new Date());
    const look = a.system_code ? ContentFormat.systemLook(a.system_code) : null;
    const id = a.assessment_id;
    const title = escHtml(a.title);
    const meta = [a.time_limit_mins ? `${a.time_limit_mins} min` : 'No time limit', `pass ${percent(a.passing_score)}%`, count(a.max_attempts, 'try', 'tries')].join(' · ');
    const total = a.question_count || mix.total;
    const chips = mix.parts.map(part => `<span class="cs-qchip q-${part.type}" title="${escHtml(part.label)}">${Studio.icon(part.icon, 'cs-ico--sm')}<span class="cs-sr">${escHtml(part.label)}: </span>${part.count}</span>`).join('');
    return `<article class="cs-arow" data-id="${id}" aria-labelledby="at-${id}"${look ? ` style="--sys:${look.colour}"` : ''}>
      <span class="cs-tile q-${kind.tone}" title="${escHtml(kind.label)}" aria-hidden="true">${Studio.icon(kind.icon)}</span>
      <div class="cs-acopy">
        <span class="cs-eyebrow">${look ? `<i aria-hidden="true"></i>${escHtml(a.system_name)}` : 'All body systems'}</span>
        <h3 class="cs-h3" id="at-${id}">${title}</h3>
        <span class="cs-meta">${meta}</span>
      </div>
      <div class="cs-qmix">${total ? `<span class="cs-qtotal"><b class="cs-num">${total}</b> ${total === 1 ? 'question' : 'questions'}</span>${chips}` : '<span class="cs-qtotal">No questions yet</span>'}</div>
      <div class="cs-due cs-due--${due.tone}"><span class="cs-meta">Due</span><b>${escHtml(due.label)}</b></div>
      <div class="cs-result">${resultHtml(a)}</div>
      <div class="cs-aend">${Studio.status(a.status, { plain: true })}
        <button type="button" class="cs-btn cs-btn--sm" data-questions="${id}" aria-label="Questions for ${title}">Questions</button>
        <button type="button" class="cs-icon-btn" data-more="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${title}">${Studio.icon('dots-three')}</button>
      </div>
    </article>`;
  }

  // Attempts and the class average, with an amber bar below the pass mark.
  function resultHtml(a) {
    if (!a.submission_count) return `<span class="cs-meta">${isDraft(a) ? 'Not published' : 'No attempts yet'}</span>`;
    if (a.avg_score == null) return '<span class="cs-meta">No finished attempts</span>';
    const avg = Math.round(a.avg_score);
    return `<span class="cs-meta">${count(a.submission_count, 'attempt')} · avg <b class="cs-num">${avg}%</b></span>`
      + `<span class="cs-bar${a.avg_score < a.passing_score ? ' cs-bar--low' : ''}" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, avg))}%"></i></span>`;
  }

  // ── More menu ─────────────────────────────────────────────────
  // Delete is offered only while nobody has taken the assessment; after that, Close keeps the results.
  function menuItems(a) {
    const items = a.status === 'active'
      ? [{ label: 'Pause', onSelect: () => pause(a) }, { label: 'Close', onSelect: () => closeAssessment(a) }]
      : [{ label: a.status === 'closed' ? 'Reopen' : 'Open', onSelect: () => openAssessment(a) }];
    items.push({ label: 'Edit settings', onSelect: () => openSheet(a) }, { label: 'Duplicate', onSelect: () => duplicate(a) });
    if (!a.submission_count) items.push({ label: 'Delete', danger: true, onSelect: () => remove(a) });
    return items;
  }

  async function setStatus(a, status, done) {
    const result = await api(`assessments.php?id=${a.assessment_id}`, 'PUT', { status });
    if (!result.success) { showToast(result.message || 'The assessment could not be updated.', 'error'); return; }
    showToast(done, 'success');
    await load({ focus: a.assessment_id });
  }
  async function pause(a) {
    const ok = await confirmToast({ title: 'Pause this assessment?', message: 'Students can’t start it until you open it again. Their results stay.', confirmText: 'Pause', cancelText: 'Cancel' });
    if (ok) await setStatus(a, 'draft', 'Assessment paused.');
  }
  async function closeAssessment(a) {
    const ok = await confirmToast({ title: 'Close this assessment?', message: 'Students can no longer start it. Their results stay.', confirmText: 'Close', cancelText: 'Cancel' });
    if (ok) await setStatus(a, 'closed', 'Assessment closed.');
  }
  async function openAssessment(a) {
    if (!a.question_count) { showToast('Add a question before you open this assessment.', 'error'); return; }
    await setStatus(a, 'active', 'Assessment opened.');
  }
  async function duplicate(a) {
    const ok = await confirmToast({ title: 'Duplicate this assessment?', message: 'The copy is a draft with every question and no due date.', confirmText: 'Duplicate', cancelText: 'Cancel' });
    if (!ok) return;
    const result = await api(`assessments.php?duplicate=${a.assessment_id}`, 'POST', {});
    if (!result.success) { showToast(result.message || 'The assessment could not be duplicated.', 'error'); return; }
    showToast('Copy saved as a draft.', 'success');
    await load({ focus: Number(result.data?.assessment_id) || a.assessment_id });
  }
  async function remove(a) {
    const ok = await confirmToast({ title: 'Delete this assessment?', message: 'Its questions are deleted too. This can’t be undone.', confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok) return;
    const result = await api(`assessments.php?id=${a.assessment_id}`, 'DELETE');
    if (!result.success) { showToast(result.message || 'The assessment could not be deleted.', 'error'); return; }
    // The API closes instead of deleting once a student has taken it.
    showToast(/archived/i.test(result.message || '') ? 'A student has taken it, so it was closed and the results kept.' : 'Assessment deleted.', 'success');
    await load();
    $('pageTitle').focus({ preventScroll: true });
  }

  // ── Assessment sheet ──────────────────────────────────────────
  // New: saves a draft, then opens the question builder on it. Existing: sends only the fields that
  // changed. Once a student has taken it, time limit, pass mark and tries are locked (the API refuses them).
  const FIELDS = ['title', 'system_id', 'module_id', 'instructions', 'time_limit_mins', 'passing_score', 'max_attempts', 'due_date'];
  const toLocalInput = value => (value ? String(value).replace(' ', 'T').slice(0, 16) : '');
  // POST leaves an empty value out (null); PUT clears it with ''.
  function toPayload(key, value, editing) {
    const empty = editing ? '' : null;
    if (key === 'title' || key === 'instructions') return value.trim();
    if (key === 'system_id' || key === 'module_id') return value ? Number(value) : empty;
    if (key === 'due_date') return value ? value.slice(0, 16).replace('T', ' ') + ':00' : empty;
    return Number(value);
  }

  function openSheet(a) {
    const editing = Boolean(a);
    const locked = editing && a.submission_count > 0;
    const caret = Studio.icon('caret-down', 'cs-ico--sm');
    // A system that is no longer active is not in the list: keep it as it is unless the teacher picks another.
    const knownSystem = editing && systems.find(s => s.system_code === a.system_code);
    const keepSystem = editing && a.system_code && !knownSystem;
    const lock = locked ? ' disabled aria-describedby="asLocked"' : '';
    const types = Object.entries(ContentFormat.QUESTION_TYPES)
      .map(([type, t]) => `<span class="cs-qchip q-${type}">${Studio.icon(t.icon, 'cs-ico--sm')}${escHtml(t.label)}</span>`).join('');

    const form = document.createElement('form');
    form.id = 'assessSheetForm';
    form.innerHTML = `
      <div class="cs-field"><label for="asTitle">Title</label>
        <input class="cs-input" id="asTitle" name="title" required maxlength="200" autocomplete="off" placeholder="e.g. Bones of the skull" value="${escHtml(a?.title || '')}"/></div>
      <div class="cs-two">
        <div class="cs-field"><label for="asSystem">Body system</label>
          <span class="cs-pick"><select class="cs-input" id="asSystem" name="system_id"><option value="">All body systems</option>${keepSystem ? `<option value="keep">${escHtml(a.system_name)}</option>` : ''}${systems.map(s => `<option value="${s.system_id}">${escHtml(s.system_name)}</option>`).join('')}</select>${caret}</span></div>
        <div class="cs-field"><label for="asModule">Module <span class="cs-meta">(optional)</span></label>
          <span class="cs-pick"><select class="cs-input" id="asModule" name="module_id"><option value="">No module</option></select>${caret}</span></div>
      </div>
      <div class="cs-field"><label for="asInstructions">Instructions for students <span class="cs-meta">(optional)</span></label>
        <textarea class="cs-input cs-input--area" id="asInstructions" name="instructions" rows="3" placeholder="e.g. Answer every question. You can go back before you submit.">${escHtml(a?.instructions || '')}</textarea></div>
      <div class="cs-two">
        <div class="cs-field"><label for="asTime">Time limit<span class="cs-sr">, in minutes</span></label>
          <span class="cs-unit"><input class="cs-input" id="asTime" name="time_limit_mins" type="number" required min="1" max="300" step="1" inputmode="numeric" value="${editing ? a.time_limit_mins ?? '' : 30}"${lock}/><span class="cs-meta" aria-hidden="true">minutes</span></span></div>
        <div class="cs-field"><label for="asPass">Pass mark<span class="cs-sr">, in percent</span></label>
          <span class="cs-unit"><input class="cs-input" id="asPass" name="passing_score" type="number" required min="1" max="100" step="any" inputmode="decimal" value="${editing ? percent(a.passing_score) : 75}"${lock}/><span class="cs-meta" aria-hidden="true">%</span></span></div>
      </div>
      <div class="cs-two">
        <div class="cs-field"><label for="asTries">Tries per student</label>
          <input class="cs-input" id="asTries" name="max_attempts" type="number" required min="1" max="10" step="1" inputmode="numeric" value="${editing ? a.max_attempts : 3}"${lock}/></div>
        <div class="cs-field"><label for="asDue">Due <span class="cs-meta">(optional)</span></label>
          <input class="cs-input" id="asDue" name="due_date" type="datetime-local" value="${toLocalInput(a?.due_date)}"/></div>
      </div>
      ${locked ? '<p class="cs-hint" id="asLocked">A student has taken this assessment, so its time limit, pass mark and tries are locked to keep results fair.</p>' : ''}
      <div class="cs-field"><span class="cs-label">Questions</span>
        <div class="cs-attach cs-anymix"><span class="cs-tile q-mixed" aria-hidden="true">${Studio.icon('stack')}</span>
          <div><div class="cs-row-title">Any mix of question types</div>
            <span class="cs-meta">${editing ? 'Add multiple choice, true or false, identification and hotspot questions in any order from Questions.' : 'After you create it, add multiple choice, true or false, identification and hotspot questions in any order.'}</span>
            <div class="cs-qmix">${types}</div></div></div></div>`;

    const foot = document.createElement('div');
    foot.className = 'cs-afoot';
    foot.innerHTML = `<span class="cs-meta" id="asNote" role="status">${editing ? '' : 'Saved as a draft'}</span>
      <button type="button" class="cs-btn" data-cancel>Cancel</button>
      <button type="submit" class="cs-btn cs-btn--primary" form="assessSheetForm">${editing ? 'Save settings' : 'Create and add questions'}</button>`;

    const sheet = Studio.sheet({ eyebrow: editing ? a.title : 'Assessments', title: editing ? 'Edit settings' : 'New assessment', body: form, footer: foot });
    const fields = form.elements;

    // Modules follow the body system; picking a module first fills in its system.
    const moduleOptions = systemId => modules
      .filter(m => (m.status !== 'archived' || (editing && Number(m.module_id) === a.module_id))
        && (!systemId || String(m.system_id) === systemId))
      .map(m => `<option value="${Number(m.module_id)}">${escHtml(m.title)}${systemId ? '' : ` · ${escHtml(m.system_name)}`}</option>`).join('');
    const fillModules = () => {
      const keep = fields.module_id.value;
      const systemId = fields.system_id.value === 'keep' ? '' : fields.system_id.value;
      fields.module_id.innerHTML = '<option value="">No module</option>' + moduleOptions(systemId);
      fields.module_id.value = [...fields.module_id.options].some(o => o.value === keep) ? keep : '';
    };
    fields.system_id.value = keepSystem ? 'keep' : knownSystem ? String(knownSystem.system_id) : '';
    fillModules();
    if (editing && a.module_id) fields.module_id.value = String(a.module_id);
    fields.system_id.addEventListener('change', fillModules);
    fields.module_id.addEventListener('change', () => {
      const module = modules.find(m => String(m.module_id) === fields.module_id.value);
      if (module && !fields.system_id.value) { fields.system_id.value = String(module.system_id); fillModules(); }
    });

    const snapshot = () => Object.fromEntries(FIELDS.map(name => [name, fields[name].value]));
    const initial = snapshot();
    const note = foot.querySelector('#asNote');
    const save = foot.querySelector('[type="submit"]');
    const cancel = foot.querySelector('[data-cancel]');
    cancel.addEventListener('click', () => sheet.close());
    let saving = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      const fail = message => { note.textContent = message; note.classList.add('is-error'); };
      const now = snapshot();
      if (!now.title.trim()) { fail('Add a title.'); fields.title.focus(); return; }
      const changed = FIELDS.filter(name => !editing || (now[name] !== initial[name] && !fields[name].disabled && now[name] !== 'keep'));
      if (editing && !changed.length) { sheet.setDirty(false); sheet.close(); return; }
      const payload = Object.fromEntries(changed.map(name => [name, toPayload(name, now[name], editing)]));
      if (!editing) payload.status = 'draft';

      saving = true;
      save.disabled = cancel.disabled = true;
      sheet.setBusy(true);
      note.classList.remove('is-error');
      note.textContent = 'Saving…';
      const result = await api(editing ? `assessments.php?id=${a.assessment_id}` : 'assessments.php', editing ? 'PUT' : 'POST', payload);
      saving = false;
      save.disabled = cancel.disabled = false;
      sheet.setBusy(false);
      if (!result.success) { fail(result.message || 'The assessment could not be saved.'); return; }
      sheet.setDirty(false);
      await sheet.close();
      if (editing) {
        showToast('Settings saved.', 'success');
        await load({ focus: a.assessment_id });
        return;
      }
      showToast('Assessment saved as a draft.', 'success');
      await load();
      hooks.openQuestions?.(Number(result.data?.assessment_id), now.title.trim());
    });
    return sheet;
  }

  // ── Page wiring ───────────────────────────────────────────────
  function init(options = {}) {
    hooks = options;
    $('newAssessmentBtn').addEventListener('click', () => openSheet(null));
    $('assessList').addEventListener('click', event => {
      const more = event.target.closest('[data-more]');
      if (more) {
        const a = byId(more.dataset.more);
        if (a) Studio.menu(more, menuItems(a));
        return;
      }
      const questions = event.target.closest('[data-questions]');
      if (questions) {
        const a = byId(questions.dataset.questions);
        if (a) hooks.openQuestions?.(a.assessment_id, a.title);
        return;
      }
      if (event.target.closest('[data-new]')) openSheet(null);
      if (event.target.closest('[data-clear-filters]')) clearFilters();
    });
    $('assessSystemFilter').addEventListener('change', event => { filters.system = event.target.value; render(); });
    $('assessSearch').addEventListener('input', event => { filters.query = event.target.value.trim().toLowerCase(); render(); });
    return load();
  }

  return { init, load, openSheet, find: byId };
})();
