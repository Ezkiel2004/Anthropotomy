/* Module workspace on teacher/modules.html?module=<id>: the module hero, its lessons in order, its materials and the
   quizzes linked to it. One global, ModuleWorkspace.
   ModuleWorkspace.open(root, module, hooks) draws it into root; update(module) redraws the hero and the lesson list
   after the page reloads its module list; close() empties root.
   hooks: previewRoot (a .sd-reader element), reload() → Promise (fetch the modules again, which calls update),
          editDetails(module), setStatus(module, status), addLesson(moduleId), editLesson(moduleId, lesson), back(event).
   Lessons reorder by drag and drop, or by Move up and Move down in each row's more menu (the keyboard path). A refused
   order (the list changed in another tab) shows a toast and reloads the list.
   Needs app.js, content-format.js, content-studio.js, pdf-viewer.js, lesson-reader.js and teacher-files.js. */
'use strict';
const ModuleWorkspace = (() => {
  let root = null, module = null, hooks = null, dragId = null;
  let saving = Promise.resolve();
  const pages = new Map(), counting = new Set();   // PDF lesson url -> page count
  const bound = new WeakSet();
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const lessonById = id => (module?.lessons || []).find(l => l.lesson_id === Number(id));

  async function api(path, method = 'GET', body) {
    try {
      const res = await fetch(`${API_BASE}/${path}`, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      return await res.json();
    } catch {
      return { success: false, message: 'Server error. Make sure XAMPP is running.' };
    }
  }

  // Replaces el's markup and puts focus back on the same control (by id, or by data attribute within the same lesson row).
  function redraw(el, html) {
    const active = el.contains(document.activeElement) ? document.activeElement : null;
    let selector = null;
    if (active?.id) selector = '#' + CSS.escape(active.id);
    else if (active) {
      const attr = [...active.attributes].find(a => a.name.startsWith('data-'))?.name;
      const row = active.closest('[data-lesson]');
      if (attr) selector = (row ? `[data-lesson="${row.dataset.lesson}"] ` : '') + `[${attr}]`;
    }
    el.innerHTML = html;
    if (selector) el.querySelector(selector)?.focus({ preventScroll: true });
  }
  const announce = text => { const live = root?.querySelector('[data-announce]'); if (live) live.textContent = text; };

  // ── Hero ──────────────────────────────────────────────────────
  function updatedLabel(stamp) {
    const when = stamp ? new Date(String(stamp).replace(' ', 'T')) : null;
    if (!when || Number.isNaN(when.getTime())) return '';
    const now = new Date(), day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((day(now) - day(when)) / 86400000);
    if (days <= 0) return 'Updated today';
    if (days === 1) return 'Updated yesterday';
    return 'Updated ' + when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(when.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  }
  function heroMeta() {
    const lessons = module.lessons || [];
    const minutes = lessons.reduce((sum, l) => sum + (Number(l.duration_mins) || 0), 0);
    return [count(lessons.length, 'lesson'), minutes ? `${minutes} min` : '',
      module.material_count ? count(module.material_count, 'material') : '', updatedLabel(module.updated_at)].filter(Boolean).join(' · ');
  }
  function heroHtml() {
    const look = ContentFormat.systemLook(module.system_code);
    const status = ['published', 'draft', 'archived'].includes(module.status) ? module.status : 'draft';
    const [label, icon, next] = status === 'published' ? ['Unpublish', 'eye-slash', 'draft']
      : status === 'archived' ? ['Restore as draft', 'arrow-counter-clockwise', 'draft'] : ['Publish', 'check-circle', 'published'];
    return `${look.art ? `<img src="${look.art}" alt="" decoding="async">` : ''}
      <span class="cs-eyebrow">${escHtml(module.system_name)} · Module</span>
      <h2 id="wsTitle" tabindex="-1">${escHtml(module.title)}</h2>
      ${module.description ? `<p>${escHtml(module.description)}</p>` : ''}
      <div class="cs-hero-row">${Studio.status(status)}<span class="cs-meta" data-hero-meta>${escHtml(heroMeta())}</span></div>
      <div class="cs-hero-row">
        <button type="button" class="cs-btn cs-btn--sm" data-edit-module>${Studio.icon('pencil-simple', 'cs-ico--sm')}Edit details</button>
        ${(module.lessons || []).length ? `<button type="button" class="cs-btn cs-btn--sm cs-btn--ghost" data-preview-module>${Studio.icon('eye', 'cs-ico--sm')}Preview as student</button>` : ''}
        <button type="button" class="cs-btn cs-btn--sm cs-btn--ghost" data-module-status="${next}">${Studio.icon(icon, 'cs-ico--sm')}${label}</button>
      </div>`;
  }
  function renderHero() {
    const hero = root.querySelector('[data-hero]');
    hero.style.setProperty('--sys', ContentFormat.systemLook(module.system_code).colour);
    redraw(hero, heroHtml());
  }

  // ── Lessons ───────────────────────────────────────────────────
  // "PDF, 3 pages · 12 min", or "Reading · no time set" without a duration. Page counts arrive after the first draw.
  function lessonMeta(lesson) {
    const kind = ContentFormat.lessonKind(lesson);
    const n = kind === 'pdf' ? pages.get(lesson.media_url) : 0;
    return `${ContentFormat.KINDS[kind].label}${n ? ', ' + count(n, 'page') : ''} · ${lesson.duration_mins > 0 ? lesson.duration_mins + ' min' : 'no time set'}`;
  }
  function countPages() {
    for (const lesson of module.lessons || []) {
      const url = lesson.media_url;
      if (ContentFormat.lessonKind(lesson) !== 'pdf' || pages.has(url) || counting.has(url)) continue;
      counting.add(url);
      PdfViewer.pageCount(url).then(n => pages.set(url, n), () => pages.set(url, 0)).finally(() => {
        counting.delete(url);
        root?.querySelectorAll('.cs-row').forEach(row => {
          const shown = lessonById(row.dataset.lesson);
          if (shown?.media_url === url) row.querySelector('[data-meta]').textContent = lessonMeta(shown);
        });
      });
    }
  }
  function rowHtml(lesson, i) {
    const kind = ContentFormat.lessonKind(lesson);
    const title = escHtml(lesson.title);
    const status = lesson.status === 'published' ? 'published' : 'draft';
    return `<li class="cs-row" draggable="true" data-lesson="${lesson.lesson_id}">
      <span class="cs-grip" aria-hidden="true" title="Drag to reorder">${Studio.icon('dots-six-vertical', 'cs-ico--sm')}</span>
      <span class="cs-idx cs-num" aria-hidden="true">${i + 1}</span>
      <span class="cs-tile t-${kind}" aria-hidden="true">${Studio.icon(ContentFormat.KINDS[kind].icon)}</span>
      <span class="cs-row-copy"><span class="cs-row-title">${title}</span><span class="cs-meta" data-meta>${escHtml(lessonMeta(lesson))}</span></span>
      <span class="cs-row-actions">
        <button type="button" class="cs-icon-btn" data-preview aria-label="Preview ${title}">${Studio.icon('eye')}</button>
        <button type="button" class="cs-icon-btn" data-edit aria-label="Edit ${title}">${Studio.icon('pencil-simple')}</button>
        <button type="button" class="cs-icon-btn" data-row-more aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${title}">${Studio.icon('dots-three')}</button>
      </span>
      ${Studio.status(status, { plain: true })}
    </li>`;
  }
  function renderLessons() {
    const lessons = module.lessons || [];
    const list = root.querySelector('[data-lessons]');
    redraw(list, lessons.map(rowHtml).join(''));
    list.hidden = !lessons.length;
    root.querySelector('[data-lessons-empty]').hidden = lessons.length > 0;
    countPages();
  }

  function rowMenu(lesson) {
    const at = module.lessons.indexOf(lesson), items = [];
    if (at > 0) items.push({ label: 'Move up', onSelect: () => move(lesson, -1) });
    if (at < module.lessons.length - 1) items.push({ label: 'Move down', onSelect: () => move(lesson, 1) });
    items.push(lesson.status === 'published'
      ? { label: 'Unpublish', onSelect: () => setLessonStatus(lesson, 'draft') }
      : { label: 'Publish', onSelect: () => setLessonStatus(lesson, 'published') });
    items.push({ label: 'Delete', danger: true, onSelect: () => deleteLesson(lesson) });
    return items;
  }

  function move(lesson, step) {
    const order = module.lessons.map(l => l.lesson_id);
    const from = order.indexOf(lesson.lesson_id), to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    saveOrder(order, lesson.lesson_id);
  }

  // Shows the new order at once, then saves it. Saves run one after another; any refusal shows the
  // server's message and reloads the list, so the page never keeps an order the server did not take.
  function saveOrder(order, movedId) {
    const moduleId = module.module_id;
    const byId = new Map(module.lessons.map(l => [l.lesson_id, l]));
    module.lessons = order.map(id => byId.get(id));
    renderLessons();
    announce(`Moved to position ${order.indexOf(movedId) + 1} of ${order.length}.`);
    saving = saving.then(async () => {
      const result = await api('lessons.php?reorder=1', 'PUT', { module_id: moduleId, order });
      if (result.success) return;
      showToast(result.message || 'The new order could not be saved.', 'error');
      if (module?.module_id === moduleId) await hooks.reload();
    }).catch(error => console.error(error));
  }

  async function setLessonStatus(lesson, status) {
    const result = await api(`lessons.php?id=${lesson.lesson_id}`, 'PUT', { status });
    if (!result.success) { showToast(result.message || 'The lesson could not be updated.', 'error'); return; }
    showToast(status === 'published' ? 'Lesson published.' : 'Lesson unpublished.', 'success');
    await hooks.reload();
  }

  async function deleteLesson(lesson) {
    const ok = await confirmToast({ title: 'Delete this lesson?', message: `“${lesson.title}” leaves this module and students no longer see it.`, confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok) return;
    const lessons = module.lessons, at = lessons.indexOf(lesson);
    const neighbour = (lessons[at + 1] || lessons[at - 1])?.lesson_id;
    const result = await api(`lessons.php?id=${lesson.lesson_id}`, 'DELETE');
    if (!result.success) { showToast(result.message || 'The lesson could not be deleted.', 'error'); return; }
    showToast('Lesson deleted.', 'success');
    await hooks.reload();
    (root?.querySelector(`[data-lesson="${neighbour}"] [data-row-more]`) || root?.querySelector('.cs-panel-head [data-add-lesson]'))?.focus({ preventScroll: true });
  }

  // A PowerPoint or Word lesson file downloads under the lesson's title, as it does for students.
  function download(lesson) {
    const ext = String(lesson.media_url).split(/[?#]/)[0].split('.').pop().toLowerCase();
    const link = document.createElement('a');
    link.href = lesson.media_url;
    link.download = `${lesson.title}.${ext}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  }

  // Teacher preview, the way a student opens the lesson: a PDF full screen in the viewer with the note for students,
  // a PowerPoint or Word file as a download, anything else in the lesson reader without the 3D links.
  // The list rows carry no lesson text, so the lesson is fetched.
  async function preview(lesson, opener) {
    if (!lesson) return;
    if (['slides', 'document'].includes(ContentFormat.lessonKind(lesson))) { download(lesson); return; }
    const context = `${module.title} · Lesson ${module.lessons.indexOf(lesson) + 1}`;
    const result = await api(`lessons.php?id=${lesson.lesson_id}`);
    if (!result.success) { showToast(result.message || 'The lesson could not be opened.', 'error'); return; }
    const full = result.data;
    if (ContentFormat.opensInViewer(ContentFormat.lessonKind(full))) {
      if (opener?.isConnected) opener.focus({ preventScroll: true });   // the viewer hands focus back to what had it when it opened
      PdfViewer.open({ url: full.media_url, title: full.title, context, note: full.content_text || '' });
      return;
    }
    LessonReader.show(hooks.previewRoot, full, {
      exploreHref: null,
      onClose: () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); },
    });
  }

  // ── Drag and drop (a pointer extra; Move up and Move down are the keyboard path) ──
  function dropTarget(event) {
    const row = event.target.closest?.('.cs-row');
    if (!row || Number(row.dataset.lesson) === dragId) return null;
    const box = row.getBoundingClientRect();
    return { row, after: event.clientY > box.top + box.height / 2 };
  }
  function clearDrag() {
    root?.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after').forEach(el => el.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
  }
  function bindDrag(list) {
    list.addEventListener('dragstart', event => {
      const row = event.target.closest?.('.cs-row');
      if (!row || !module) return;
      dragId = Number(row.dataset.lesson);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.querySelector('.cs-row-title').textContent);
      row.classList.add('is-dragging');
    });
    list.addEventListener('dragover', event => {
      if (dragId === null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.is-drop-before, .is-drop-after').forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
      const target = dropTarget(event);
      if (target) target.row.classList.add(target.after ? 'is-drop-after' : 'is-drop-before');
    });
    list.addEventListener('dragleave', event => {
      if (dragId !== null && !list.contains(event.relatedTarget)) list.querySelectorAll('.is-drop-before, .is-drop-after').forEach(el => el.classList.remove('is-drop-before', 'is-drop-after'));
    });
    list.addEventListener('drop', event => {
      if (dragId === null) return;
      event.preventDefault();
      const target = dropTarget(event), moved = dragId;
      dragId = null;
      clearDrag();
      if (!target || !module) return;
      const current = module.lessons.map(l => l.lesson_id);
      const order = current.filter(id => id !== moved);
      order.splice(order.indexOf(Number(target.row.dataset.lesson)) + (target.after ? 1 : 0), 0, moved);
      if (order.join() !== current.join()) saveOrder(order, moved);
    });
    list.addEventListener('dragend', () => { dragId = null; clearDrag(); });
  }

  // ── Quizzes linked to the module ──────────────────────────────
  function quizHtml(a) {
    const kind = ContentFormat.assessmentKind(a.question_types || {});
    const results = a.submission_count ? (a.avg_score == null ? 'No finished attempts' : `${count(a.submission_count, 'attempt')} · avg ${Math.round(a.avg_score)}%`)
      : a.due_date ? `due ${ContentFormat.dueLabel(a.due_date, new Date()).label}` : 'No attempts yet';
    const meta = [{ draft: 'Draft', closed: 'Closed' }[a.status], a.question_count ? count(a.question_count, 'question') : 'No questions yet',
      a.question_count ? results : ''].filter(Boolean).join(' · ');
    return `<a class="cs-quiz" href="assessments.html">
      <span class="cs-tile q-${escHtml(kind.tone)}" aria-hidden="true">${Studio.icon(kind.icon)}</span>
      <span class="cs-row-copy"><span class="cs-row-title">${escHtml(a.title)}</span><span class="cs-meta">${escHtml(meta)}</span></span></a>`;
  }
  async function loadQuizzes(moduleId) {
    const result = await api(`assessments.php?module_id=${moduleId}`);
    if (module?.module_id !== moduleId) return;
    const quizzes = result.success ? result.data || [] : null;
    root.querySelector('[data-quiz-count]').textContent = quizzes ? `${quizzes.length} linked` : '';
    root.querySelector('[data-quizzes]').innerHTML = !quizzes ? '<p class="cs-panel-empty">Quizzes could not load. Reload the page to try again.</p>'
      : !quizzes.length ? '<p class="cs-panel-empty">No quizzes use this module yet. Link one when you make it on the Assessments page.</p>'
      : quizzes.map(quizHtml).join('');
  }

  // ── Shell and events ──────────────────────────────────────────
  function shell() {
    return `<a class="cs-crumb" href="modules.html" data-back>${Studio.icon('arrow-left', 'cs-ico--sm')}All modules</a>
      <h1 class="cs-sr">Modules and lessons</h1>
      <section class="cs-hero" data-hero aria-labelledby="wsTitle"></section>
      <div class="cs-split">
        <section class="cs-panel cs-lessons" aria-labelledby="wsLessons">
          <div class="cs-panel-head"><h3 class="cs-h2" id="wsLessons">Lessons</h3><span class="cs-meta">Drag to reorder · students see them in this order</span>
            <button type="button" class="cs-btn cs-btn--primary cs-btn--sm" data-add-lesson>${Studio.icon('plus', 'cs-ico--sm')}Add lesson</button></div>
          <ol class="cs-rows" data-lessons></ol>
          <p class="cs-panel-empty" data-lessons-empty hidden>No lessons yet. Students see this module once it has a published lesson.</p>
          <button type="button" class="cs-add-row" data-add-lesson>${Studio.icon('plus', 'cs-ico--sm')}Add a lesson</button>
          <p class="cs-sr" role="status" data-announce></p>
        </section>
        <aside class="cs-side" aria-label="Materials and quizzes">
          <section class="cs-panel" data-materials-panel></section>
          <section class="cs-panel" aria-labelledby="wsQuizzes">
            <div class="cs-panel-head"><h3 class="cs-h2" id="wsQuizzes">Quizzes</h3><span class="cs-meta" data-quiz-count></span>
              <a class="cs-icon-btn" href="assessments.html" aria-label="New assessment">${Studio.icon('plus')}</a></div>
            <div class="cs-quizzes" data-quizzes><p class="cs-panel-empty">Loading quizzes…</p></div>
          </section>
        </aside>
      </div>`;
  }

  function onClick(event) {
    if (!module) return;
    const target = event.target;
    const hit = selector => target.closest(selector);
    if (hit('[data-back]')) { hooks.back(event); return; }
    if (hit('[data-edit-module]')) { hooks.editDetails(module); return; }
    if (hit('[data-module-status]')) { hooks.setStatus(module, hit('[data-module-status]').dataset.moduleStatus); return; }
    if (hit('[data-preview-module]')) {
      const lessons = module.lessons || [];
      preview(lessons.find(l => l.status === 'published') || lessons[0], hit('[data-preview-module]'));
      return;
    }
    if (hit('[data-add-lesson]')) { hooks.addLesson(module.module_id); return; }
    const lesson = lessonById(hit('.cs-row')?.dataset.lesson);
    if (!lesson) return;
    if (hit('[data-preview]')) preview(lesson, hit('[data-preview]'));
    else if (hit('[data-edit]')) hooks.editLesson(module.module_id, lesson);
    else if (hit('[data-row-more]')) Studio.menu(hit('[data-row-more]'), rowMenu(lesson));
  }

  function open(el, next, options) {
    close();
    root = el;
    module = next;
    hooks = options;
    root.innerHTML = shell();
    if (!bound.has(root)) {
      bound.add(root);
      root.addEventListener('click', onClick);
    }
    bindDrag(root.querySelector('[data-lessons]'));
    renderHero();
    renderLessons();
    const moduleId = next.module_id;
    TeacherFiles.mount(root.querySelector('[data-materials-panel]'), {
      kind: 'material', moduleId, compact: true, context: `${next.title} · Materials`,
      onChange: files => {
        if (module?.module_id !== moduleId) return;
        module.material_count = files.length;
        root.querySelector('[data-hero-meta]').textContent = heroMeta();
      },
    });
    loadQuizzes(moduleId);
  }

  function update(next) {
    if (!root || !next || next.module_id !== module?.module_id) return;
    module = next;
    renderHero();
    renderLessons();
  }

  function close() {
    if (!root) return;
    Studio.closeMenu(false);
    if (hooks?.previewRoot && !hooks.previewRoot.hidden) LessonReader.close(hooks.previewRoot);
    root.innerHTML = '';
    root = module = hooks = dragId = null;
  }

  return { open, update, close };
})();
