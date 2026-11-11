/* Lesson editor: one side sheet that creates a lesson or edits an existing one, attachment included.
   LessonSheet.open(moduleId, lesson|null, {onSaved, moduleTitle, position}) → Promise (resolves once the sheet is on screen)
   lesson is any row of the module's list; the full lesson (text, attachment) is fetched when editing.
   position (1-based) names the lesson's place in the module in the sheet's eyebrow when editing.
   onSaved() runs after a successful save so the page can reload its list.
   Needs app.js (API_BASE, showToast, escHtml), content-format.js, content-studio.js and pdf-viewer.js. */
'use strict';
const LessonSheet = (() => {
  const MAX_BYTES = 500 * 1024 * 1024;
  const ACCEPT = ['pdf', 'mp4', 'webm', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'glb'];
  const TYPES = [
    ['reading', 'Reading', 'reading', 'book-open'],
    ['video', 'Video', 'video', 'video-camera'],
    ['3d_model', '3D model', '3d', 'cube'],
    ['interactive', 'Interactive', 'interactive', 'game-controller'],
    ['quiz_prep', 'Quiz prep', 'prep', 'list-checks'],
  ];
  const TOO_LARGE = 'File too large. Maximum size is 500 MB.';

  const extensionOf = name => (String(name).split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const baseName = url => { try { return decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop()); } catch { return String(url).split('/').pop(); } };
  const pages = n => `${n} page${n === 1 ? '' : 's'}`;
  function sizeLabel(bytes) {
    if (!(bytes > 0)) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  async function fetchLesson(id) {
    try {
      const result = await fetch(`${API_BASE}/lessons.php?id=${id}`, { credentials: 'same-origin' }).then(r => r.json());
      return result.success ? result.data : null;
    } catch { return null; }
  }

  async function open(moduleId, row, { onSaved, moduleTitle, position } = {}) {
    let lesson = null;
    if (row) {
      lesson = await fetchLesson(row.lesson_id);
      if (!lesson) { showToast('The lesson could not be opened.', 'error'); return; }
    }
    const editing = Boolean(lesson);
    const type = lesson?.lesson_type || 'reading';

    // The attachment: what is saved (current), a file chosen in this sheet (picked), or nothing (removed).
    const state = { current: lesson?.media_url || null, picked: null, removed: false, size: 0, pageCount: 0, blobUrl: null };

    const form = document.createElement('form');
    form.id = 'lessonSheetForm';
    form.noValidate = true;
    form.innerHTML = `
      <div class="cs-field"><label for="lsTitle">Title</label>
        <input class="cs-input" id="lsTitle" name="title" type="text" maxlength="200" autocomplete="off" placeholder="What this lesson is called" value="${escHtml(lesson?.title || '')}"/></div>
      <div class="cs-field" role="radiogroup" aria-labelledby="lsTypeLabel"><span class="cs-label" id="lsTypeLabel">What students get</span>
        <div class="cs-types">${TYPES.map(([value, label, kind, icon]) => `<label class="cs-type t-${kind}"><input type="radio" name="lesson_type" value="${value}"${value === type ? ' checked' : ''}/>${Studio.icon(icon)}${label}</label>`).join('')}</div></div>
      <div class="cs-field"><span class="cs-label" id="lsAttachLabel">Attachment <span class="cs-meta">(optional)</span></span>
        <div data-attach aria-labelledby="lsAttachLabel"></div>
        <input type="file" id="lsFile" hidden accept=".pdf,.mp4,.webm,.jpg,.jpeg,.png,.webp,.gif,.glb"/></div>
      <div class="cs-field"><label for="lsText">Lesson text <span class="cs-meta">(optional)</span></label>
        <textarea class="cs-input cs-input--area" id="lsText" name="content_text" rows="5" placeholder="What students read, or how to use the attachment">${escHtml(lesson?.content_text || '')}</textarea></div>
      <div class="cs-two"><div class="cs-field"><label for="lsMins">Time to study<span class="cs-sr"> in minutes</span></label>
          <span class="cs-unit"><input class="cs-input" id="lsMins" name="duration_mins" type="number" min="0" max="999" inputmode="numeric" placeholder="For example 15" value="${lesson?.duration_mins > 0 ? lesson.duration_mins : ''}"/><span class="cs-meta" aria-hidden="true">minutes</span></span></div>
        <div class="cs-field"><span class="cs-label">Visible to students</span>
          <label class="cs-switch"><input type="checkbox" role="switch" name="status"${!editing || lesson.status === 'published' ? ' checked' : ''}/><i></i><span data-switch-label></span></label></div></div>`;

    const foot = document.createElement('div');
    foot.innerHTML = `<span class="cs-meta" id="lsNote" role="status"></span>
      <button type="button" class="cs-btn" data-cancel>Cancel</button>
      <button type="submit" class="cs-btn cs-btn--primary" form="lessonSheetForm">${editing ? 'Save lesson' : 'Add lesson'}</button>`;

    const where = moduleTitle || lesson?.module_title || 'Lessons';
    const sheet = Studio.sheet({ eyebrow: editing && position ? `${where} · Lesson ${position}` : where, title: editing ? 'Edit lesson' : 'New lesson', body: form, footer: foot });
    const note = foot.querySelector('#lsNote');
    const saveButton = foot.querySelector('[type="submit"]');
    const input = form.querySelector('#lsFile');
    const attach = form.querySelector('[data-attach]');
    const switchBox = form.elements.status;
    const say = (message, kind = '') => { note.textContent = message; note.classList.toggle('is-error', kind === 'error'); };
    foot.querySelector('[data-cancel]').addEventListener('click', () => sheet.close());
    const syncSwitch = () => { form.querySelector('[data-switch-label]').textContent = switchBox.checked ? 'Published' : 'Draft'; };
    switchBox.addEventListener('change', syncSwitch);
    syncSwitch();

    // ── Attachment card ──────────────────────────────────────────
    function dropBlob() { if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; } }
    const shown = () => state.picked ? { name: state.picked.name } : state.removed || !state.current ? null : { name: baseName(state.current) };
    function drawAttach() {
      const file = shown();
      const dropHint = `${Studio.icon('cloud-arrow-up')}<span>${file ? 'Or drop' : 'Drop'} a PDF, video (MP4, WebM), image or GLB model here, or choose a file. Max 500 MB.</span>`;
      if (!file) {
        attach.innerHTML = `<button type="button" class="cs-drop" data-drop>${dropHint}</button>`;
        return;
      }
      const kind = ContentFormat.lessonKind({ lesson_type: type, media_url: file.name });
      const url = state.picked ? (state.blobUrl = state.blobUrl || URL.createObjectURL(state.picked)) : state.current;
      const thumb = kind === 'pdf' ? '<canvas aria-hidden="true"></canvas>'
        : kind === 'image' ? `<img src="${escHtml(url)}" alt=""/>` : Studio.icon(ContentFormat.KINDS[kind].icon);
      attach.innerHTML = `<div class="cs-attach"><span class="cs-thumb">${thumb}</span>
          <div><div class="cs-row-title" title="${escHtml(file.name)}">${escHtml(file.name)}</div><div class="cs-meta" data-attach-meta></div></div>
          <button type="button" class="cs-btn cs-btn--sm" data-replace>Replace</button>
          <button type="button" class="cs-icon-btn" data-remove aria-label="Remove attachment">${Studio.icon('trash')}</button></div>
        <button type="button" class="cs-drop" data-drop>${dropHint}</button>`;
      state.pageCount = 0;
      const meta = () => {
        const parts = [ContentFormat.KINDS[kind].label];
        if (state.pageCount) parts.push(pages(state.pageCount));
        if (state.size) parts.push(sizeLabel(state.size));
        parts.push(state.picked ? (state.current && !state.removed ? 'replaces the current file' : 'uploads when you save') : kind === 'pdf' ? 'opens in the lesson viewer' : 'saved with the lesson');
        const el = attach.querySelector('[data-attach-meta]');
        if (el) el.textContent = parts.join(' · ');
      };
      meta();
      if (kind === 'pdf') {
        const canvas = attach.querySelector('canvas');
        PdfViewer.thumbnail(canvas, url).then(count => { if (canvas.isConnected) { state.pageCount = count; meta(); } })
          .catch(() => { if (canvas.isConnected) canvas.closest('.cs-thumb').innerHTML = Studio.icon('file-pdf'); });
      }
      if (!state.picked && state.size === 0) {
        const saved = state.current;
        fetch(saved, { method: 'HEAD', credentials: 'same-origin' }).then(r => {
          const bytes = Number(r.headers.get('Content-Length'));
          if (r.ok && bytes > 0 && state.current === saved && !state.picked && !state.removed) { state.size = bytes; meta(); }
        }).catch(() => {});
      }
    }

    function choose(file) {
      if (!file) return;
      if (file.size > MAX_BYTES) { input.value = ''; say(TOO_LARGE, 'error'); return; }
      if (!ACCEPT.includes(extensionOf(file.name))) { input.value = ''; say('That file type is not supported. Use PDF, MP4, WebM, JPG, PNG, WebP, GIF or GLB.', 'error'); return; }
      dropBlob();
      state.picked = file;
      state.removed = false;
      state.size = file.size;
      say('');
      drawAttach();
      sheet.setDirty(true);
    }

    attach.addEventListener('click', event => {
      if (event.target.closest('[data-drop], [data-replace]')) { input.click(); return; }
      if (event.target.closest('[data-remove]')) {
        dropBlob();
        state.picked = null;
        state.removed = true;
        state.size = 0;
        input.value = '';
        say('');
        drawAttach();
        attach.querySelector('[data-drop]').focus({ preventScroll: true });
        sheet.setDirty(true);
      }
    });
    input.addEventListener('change', () => choose(input.files[0]));
    attach.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); attach.querySelector('[data-drop]')?.classList.add('is-over'); } });
    attach.addEventListener('dragleave', () => attach.querySelector('[data-drop]')?.classList.remove('is-over'));
    attach.addEventListener('drop', event => {
      event.preventDefault();
      attach.querySelector('[data-drop]')?.classList.remove('is-over');
      choose(event.dataTransfer.files[0]);
    });
    drawAttach();

    // ── Save ─────────────────────────────────────────────────────
    let saving = false;
    const cancelButton = foot.querySelector('[data-cancel]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      const title = form.elements.title.value.trim();
      if (!title) { say('Add a title.', 'error'); form.elements.title.focus(); return; }
      if (state.picked && state.picked.size > MAX_BYTES) { say(TOO_LARGE, 'error'); return; }
      const data = new FormData();
      data.append('title', title);
      data.append('lesson_type', form.elements.lesson_type.value);
      data.append('content_text', form.elements.content_text.value.trim());
      data.append('duration_mins', String(Math.max(0, Math.floor(Number(form.elements.duration_mins.value) || 0))));
      data.append('status', switchBox.checked ? 'published' : 'draft');
      if (!editing) data.append('module_id', String(moduleId));
      if (state.picked) data.append('lesson_file', state.picked, state.picked.name);
      else if (editing && state.removed && state.current) data.append('remove_media', '1');
      saving = true;
      sheet.setBusy(true);
      saveButton.disabled = true;
      cancelButton.disabled = true;
      say(state.picked ? 'Uploading…' : 'Saving…');
      let result;
      try {
        const res = await fetch(`${API_BASE}/lessons.php${editing ? `?id=${lesson.lesson_id}` : ''}`, { method: 'POST', credentials: 'same-origin', body: data });
        result = await res.json();
      } catch { result = { success: false, message: 'The server could not be reached. Check that XAMPP is running.' }; }
      sheet.setBusy(false);
      if (!result.success) {
        saving = false;
        saveButton.disabled = false;
        cancelButton.disabled = false;
        say(result.message || 'The lesson could not be saved.', 'error');
        return;
      }
      sheet.setDirty(false);   // saved: stays "saving" so a stray Enter cannot submit again while the sheet closes
      await sheet.close();
      dropBlob();
      showToast(editing ? 'Lesson saved.' : 'Lesson added.', 'success');
      if (onSaved) await onSaved();
    });
    return sheet;
  }

  return { open };
})();
