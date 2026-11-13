/* Lesson editor: one side sheet that creates a lesson or edits an existing one. File first: the lesson file (PDF,
   PowerPoint or Word) is the main field, the title fills in from its name and the lesson kind comes from the file.
   LessonSheet.open(moduleId, lesson|null, {onSaved, moduleTitle, position}) → Promise (resolves once the sheet is on screen)
   lesson is any row of the module's list; the full lesson (note, file) is fetched when editing.
   position (1-based) names the lesson's place in the module in the sheet's eyebrow when editing.
   onSaved() runs after a successful save so the page can reload its list.
   A new lesson needs a file. An existing lesson without one, or with a legacy attachment (video, image, GLB), saves
   without a new file and keeps its lesson_type; a new file makes it a 'reading' lesson.
   Needs app.js (API_BASE, showToast, escHtml), content-format.js, content-studio.js and pdf-viewer.js. */
'use strict';
const LessonSheet = (() => {
  const MAX_BYTES = 500 * 1024 * 1024;
  const ACCEPT = ['pdf', 'ppt', 'pptx', 'doc', 'docx'];
  const TOO_LARGE = 'File too large. Maximum size is 500 MB.';
  const WRONG_TYPE = 'Use a PDF, PowerPoint (.ppt, .pptx) or Word (.doc, .docx) file.';
  const KINDS_HINT = 'PDF, PowerPoint (.ppt, .pptx) or Word (.doc, .docx), up to 500 MB.';
<<<<<<< HEAD
  const STUDENTS_GET = {
    pdf: 'Students read it here in the viewer',
    slides: 'Students download it and open it in PowerPoint',
    document: 'Students download it and open it in Word',
  };
=======
  // A PowerPoint or Word file gets a PDF preview when it is saved, so students read it in the viewer too (view-only unless
  // the switch below is on). If no preview can be made the save says so and students download the file instead.
  const STUDENTS_GET = {
    pdf: 'Students read it here in the viewer',
    slides: 'Students read it here in the viewer',
    document: 'Students read it here in the viewer',
  };
  const SAVED = 'Saved. Students can view it in the app.';
  const NO_PREVIEW = 'Saved, but no preview could be made, so students will download this file instead.';
>>>>>>> 6288eaf (50%% revision)

  const extensionOf = name => (String(name).split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const baseName = url => { try { return decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop()); } catch { return String(url).split('/').pop(); } };
  const pages = n => `${n} page${n === 1 ? '' : 's'}`;
  function sizeLabel(bytes) {
    if (!(bytes > 0)) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  // "axial-and-appendicular-skeleton.pdf" → "Axial and appendicular skeleton"
  function titleFromFile(name) {
    const words = String(name).replace(/\.[^.]*$/, '').replace(/[-_\s]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : '';
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

    // The file: what is saved (current), a file chosen in this sheet (picked), or nothing (removed).
    const state = { current: lesson?.media_url || null, picked: null, removed: false, size: 0, pageCount: 0, blobUrl: null };
    let autoTitle = '';   // the last title filled in from a file name; typing anything else stops the auto-fill

    const form = document.createElement('form');
    form.id = 'lessonSheetForm';
    form.noValidate = true;
    form.innerHTML = `
      <div class="cs-field cs-file-field" data-file-panel><span class="cs-label" id="lsFileLabel">Lesson file</span>
        <div data-attach role="group" aria-labelledby="lsFileLabel" aria-describedby="lsFileHint"></div>
        <span class="cs-meta" id="lsFileHint" data-file-hint></span>
        <input type="file" id="lsFile" hidden accept="${ACCEPT.map(ext => '.' + ext).join(',')}"/></div>
      <div class="cs-field"><label for="lsTitle">Title</label>
        <input class="cs-input" id="lsTitle" name="title" type="text" maxlength="200" autocomplete="off" placeholder="What this lesson is called" value="${escHtml(lesson?.title || '')}"/>
        <span class="cs-meta" id="lsTitleHint" data-title-hint hidden>Filled in from the file name. Change it if you like.</span></div>
      <div class="cs-field"><label for="lsText">Note for students <span class="cs-meta">(optional)</span></label>
        <textarea class="cs-input cs-input--area" id="lsText" name="content_text" rows="3" aria-describedby="lsTextHint" placeholder="For example: read pages 1 and 2, then answer the questions at the end.">${escHtml(lesson?.content_text || '')}</textarea>
        <span class="cs-meta" id="lsTextHint">Shown above the file when a student opens it.</span></div>
<<<<<<< HEAD
=======
      <div class="cs-field" data-allow-field hidden><span class="cs-label">Download</span>
        <label class="cs-switch"><input type="checkbox" role="switch" name="allow_download"${lesson?.allow_download ? ' checked' : ''}/><i></i><span>Let students download this file</span></label>
        <span class="cs-meta">Off: students can only read it here. Teachers can always download it.</span></div>
>>>>>>> 6288eaf (50%% revision)
      <div class="cs-two"><div class="cs-field"><label for="lsMins">Time to study<span class="cs-sr"> in minutes</span></label>
          <span class="cs-unit"><input class="cs-input" id="lsMins" name="duration_mins" type="number" min="0" max="999" inputmode="numeric" placeholder="For example 15" value="${lesson?.duration_mins > 0 ? lesson.duration_mins : ''}"/><span class="cs-meta" aria-hidden="true">minutes</span></span></div>
        <div class="cs-field"><span class="cs-label">Visible to students</span>
          <label class="cs-switch"><input type="checkbox" role="switch" name="status"${!editing || lesson.status === 'published' ? ' checked' : ''}/><i></i><span data-switch-label></span></label></div></div>`;

    const foot = document.createElement('div');
    foot.innerHTML = `<span class="cs-meta" id="lsNote" role="status"></span>
      <button type="button" class="cs-btn" data-cancel>Cancel</button>
      <button type="submit" class="cs-btn cs-btn--primary" form="lessonSheetForm">${editing ? 'Save lesson' : 'Add lesson'}</button>`;

    const panel = form.querySelector('[data-file-panel]');
    // A file dropped anywhere but the file panel must not make the browser open it and lose the edits.
    const blockDrop = event => {
      if (panel.contains(event.target)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    };
    document.addEventListener('dragover', blockDrop);
    document.addEventListener('drop', blockDrop);
    const unblockDrop = () => { document.removeEventListener('dragover', blockDrop); document.removeEventListener('drop', blockDrop); };

    const where = moduleTitle || lesson?.module_title || 'Lessons';
    const sheet = Studio.sheet({ eyebrow: editing && position ? `${where} · Lesson ${position}` : where, title: editing ? 'Edit lesson' : 'Add lesson', body: form, footer: foot, onClose: unblockDrop });
    const note = foot.querySelector('#lsNote');
    const saveButton = foot.querySelector('[type="submit"]');
    const input = form.querySelector('#lsFile');
    const attach = form.querySelector('[data-attach]');
    const fileHint = form.querySelector('[data-file-hint]');
    const titleField = form.elements.title;
    const titleHint = form.querySelector('[data-title-hint]');
    const switchBox = form.elements.status;
    const say = (message, kind = '') => { note.textContent = message; note.classList.toggle('is-error', kind === 'error'); };
    foot.querySelector('[data-cancel]').addEventListener('click', () => sheet.close());
    const syncSwitch = () => { form.querySelector('[data-switch-label]').textContent = switchBox.checked ? 'Published' : 'Draft'; };
    switchBox.addEventListener('change', syncSwitch);
    syncSwitch();
    const syncTitleHint = () => {
      const auto = Boolean(autoTitle) && titleField.value === autoTitle;
      titleHint.hidden = !auto;
      if (auto) titleField.setAttribute('aria-describedby', 'lsTitleHint'); else titleField.removeAttribute('aria-describedby');
    };
    titleField.addEventListener('input', syncTitleHint);

    // ── File panel ───────────────────────────────────────────────
    function dropBlob() { if (state.blobUrl) { URL.revokeObjectURL(state.blobUrl); state.blobUrl = null; } }
    const shown = () => state.picked ? { name: state.picked.name } : state.removed || !state.current ? null : { name: baseName(state.current) };
<<<<<<< HEAD
    function drawAttach() {
      const file = shown();
      fileHint.textContent = file ? `${KINDS_HINT} Drop a file on this panel to replace it.` : KINDS_HINT;
=======
    // The download switch only means something for a PowerPoint or Word file.
    const allowField = form.querySelector('[data-allow-field]');
    const isOfficeKind = file => Boolean(file) && ['slides', 'document'].includes(ContentFormat.lessonKind({ lesson_type: type, media_url: file.name }));
    function drawAttach() {
      const file = shown();
      fileHint.textContent = file ? `${KINDS_HINT} Drop a file on this panel to replace it.` : KINDS_HINT;
      allowField.hidden = !isOfficeKind(file);
>>>>>>> 6288eaf (50%% revision)
      if (!file) {
        attach.innerHTML = `<div class="cs-drop cs-drop--file" data-drop>${Studio.icon('cloud-arrow-up')}
          <span>Drop the lesson file here</span>
          <button type="button" class="cs-btn cs-btn--sm" data-choose>Choose file</button></div>`;
        return;
      }
      const kind = ContentFormat.lessonKind({ lesson_type: type, media_url: file.name });
      const url = state.picked ? (state.blobUrl = state.blobUrl || URL.createObjectURL(state.picked)) : state.current;
      const ext = extensionOf(file.name);
      const thumb = kind === 'pdf' ? '<span class="cs-thumb"><canvas aria-hidden="true"></canvas></span>'
        : kind === 'slides' || kind === 'document'
          ? `<span class="cs-thumb cs-thumb--doc${kind === 'slides' ? ' cs-thumb--ppt' : ''}" aria-hidden="true"><span class="cs-thumb-file">${Studio.icon(ContentFormat.KINDS[kind].icon)}${escHtml(ext.toUpperCase())}</span></span>`
          : kind === 'image' ? `<span class="cs-thumb"><img src="${escHtml(url)}" alt=""/></span>`
            : `<span class="cs-thumb">${Studio.icon(ContentFormat.KINDS[kind].icon)}</span>`;
      attach.innerHTML = `<div class="cs-attach cs-attach--file">${thumb}
          <div><div class="cs-row-title" title="${escHtml(file.name)}">${escHtml(file.name)}</div><div class="cs-meta" data-attach-meta></div>
            <div class="cs-meta cs-attach-gets">${STUDENTS_GET[kind] || 'Students open it in the lesson reader'}</div></div>
          <button type="button" class="cs-btn cs-btn--sm" data-replace>Replace</button>
          <button type="button" class="cs-icon-btn" data-remove aria-label="Remove file">${Studio.icon('trash')}</button></div>`;
      state.pageCount = 0;
      const meta = () => {
        const parts = [ContentFormat.KINDS[kind].label];
        if (state.pageCount) parts.push(pages(state.pageCount));
        if (state.size) parts.push(sizeLabel(state.size));
        if (state.picked && state.current && !state.removed) parts.push('replaces the current file');
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
<<<<<<< HEAD
        fetch(saved, { method: 'HEAD', credentials: 'same-origin' }).then(r => {
=======
        // A PowerPoint or Word file's direct address is blocked; its size comes from the API's download address.
        const sizeUrl = (kind === 'slides' || kind === 'document') && lesson?.download_url ? lesson.download_url : saved;
        fetch(sizeUrl, { method: 'HEAD', credentials: 'same-origin' }).then(r => {
>>>>>>> 6288eaf (50%% revision)
          const bytes = Number(r.headers.get('Content-Length'));
          if (r.ok && bytes > 0 && state.current === saved && !state.picked && !state.removed) { state.size = bytes; meta(); }
        }).catch(() => {});
      }
    }

    function choose(file) {
      if (!file) return;
      if (!ACCEPT.includes(extensionOf(file.name))) { input.value = ''; say(WRONG_TYPE, 'error'); return; }
      if (file.size > MAX_BYTES) { input.value = ''; say(TOO_LARGE, 'error'); return; }
      dropBlob();
      state.picked = file;
      state.removed = false;
      state.size = file.size;
      say('');
      // The title follows the file name until the teacher types their own.
      const current = titleField.value.trim();
      if (!current || current === autoTitle) {
        const next = titleFromFile(file.name);
        if (next) { titleField.value = next; autoTitle = next; }
      }
      syncTitleHint();
      drawAttach();
      sheet.setDirty(true);
    }

    panel.addEventListener('click', event => {
      if (event.target.closest('[data-remove]')) {
        dropBlob();
        state.picked = null;
        state.removed = true;
        state.size = 0;
        input.value = '';
        say('');
        drawAttach();
        attach.querySelector('[data-choose]').focus({ preventScroll: true });
        sheet.setDirty(true);
        return;
      }
      if (event.target.closest('[data-choose], [data-replace], [data-drop]')) input.click();
    });
    input.addEventListener('change', () => choose(input.files[0]));
    // Panel-wide drop: the drop zone, the file card and the hint all take a file.
    panel.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); panel.classList.add('is-over'); } });
    panel.addEventListener('dragleave', event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove('is-over'); });
    panel.addEventListener('drop', event => {
      event.preventDefault();
      panel.classList.remove('is-over');
      choose(event.dataTransfer?.files[0]);
    });
    drawAttach();

    // ── Save ─────────────────────────────────────────────────────
    let saving = false;
    const cancelButton = foot.querySelector('[data-cancel]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      if (!editing && !state.picked) { say('Choose the lesson file.', 'error'); attach.querySelector('[data-choose]')?.focus(); return; }
      const title = titleField.value.trim();
      if (!title) { say('Add a title.', 'error'); titleField.focus(); return; }
      if (state.picked && state.picked.size > MAX_BYTES) { say(TOO_LARGE, 'error'); return; }
      const data = new FormData();
      data.append('title', title);
      // A new file makes it a reading lesson; a legacy lesson edited without one keeps its kind.
      data.append('lesson_type', state.picked || !editing ? 'reading' : type);
      data.append('content_text', form.elements.content_text.value.trim());
      data.append('duration_mins', String(Math.max(0, Math.floor(Number(form.elements.duration_mins.value) || 0))));
      data.append('status', switchBox.checked ? 'published' : 'draft');
      if (!editing) data.append('module_id', String(moduleId));
      if (state.picked) data.append('lesson_file', state.picked, state.picked.name);
      else if (editing && state.removed && state.current) data.append('remove_media', '1');
<<<<<<< HEAD
=======
      // The download switch is saved with a PowerPoint or Word file; for any other file it is left alone.
      const office = isOfficeKind(shown());
      if (office) data.append('allow_download', form.elements.allow_download.checked ? '1' : '0');
>>>>>>> 6288eaf (50%% revision)
      saving = true;
      sheet.setBusy(true);
      saveButton.disabled = true;
      cancelButton.disabled = true;
<<<<<<< HEAD
      say(state.picked ? 'Uploading…' : 'Saving…');
=======
      // Saving a new PowerPoint or Word file also makes its PDF preview, which takes a few seconds.
      say(state.picked ? (office ? (extensionOf(state.picked.name).startsWith('p') ? 'Preparing slides for viewing…' : 'Preparing document for viewing…') : 'Uploading…') : 'Saving…');
>>>>>>> 6288eaf (50%% revision)
      let result;
      try {
        const res = await fetch(`${API_BASE}/lessons.php${editing ? `?id=${lesson.lesson_id}` : ''}`, { method: 'POST', credentials: 'same-origin', body: data });
        // A web server that refuses the upload itself answers 413 with a page, not JSON.
        result = await res.json().catch(() => ({ success: false, message: res.status === 413 ? 'File too large for this server.' : 'The lesson could not be saved.' }));
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
<<<<<<< HEAD
      showToast(editing ? 'Lesson saved.' : 'Lesson added.', 'success');
=======
      // A new PowerPoint or Word file says whether students can view it in the app or will download it.
      if (office && state.picked) showToast(result.data?.preview ? SAVED : NO_PREVIEW, result.data?.preview ? 'success' : 'warning');
      else showToast(editing ? 'Lesson saved.' : 'Lesson added.', 'success');
>>>>>>> 6288eaf (50%% revision)
      if (onSaved) await onSaved();
    });
    return sheet;
  }

  return { open };
})();
