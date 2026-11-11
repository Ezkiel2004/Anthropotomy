/* Teacher file lists (module materials, lesson plans): upload, list, open and delete through api/files.php.
   TeacherFiles.mount(element, {kind, moduleId, context}) draws the upload form and the list into element. Needs app.js, and pdf-viewer.js to open PDFs.
   context labels the full-screen viewer (default "Lesson plans" or "Materials").
   TeacherFiles.mount(panel, {kind, moduleId, compact: true, title, context, onChange}) is the side-panel version for the module workspace:
   a panel header with the count and Upload (which opens a small form), rows with a first-page thumbnail, a more menu with Delete,
   and dropping files anywhere on the panel uploads them. onChange(files) runs after every load. Compact needs content-studio.js (Studio). */
const TeacherFiles = (() => {
    const MAX_BYTES = 100 * 1024 * 1024;
    const TYPES = ['pdf', 'ppt', 'pptx', 'doc', 'docx'];
    const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    const icon = name => `<svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261111-icons4#${name}"/></svg>`;
    const extOf = name => String(name).split('.').pop().toLowerCase();
    const fileUrl = id => `${API_BASE}/files.php?id=${id}`;
    const contextFor = (kind, context) => context || (kind === 'lesson_plan' ? 'Lesson plans' : 'Materials');
    const view = (file, context) => PdfViewer.open({url: fileUrl(file.file_id), title: file.title, context});
    let uid = 0;

    function rows(files) {
        if (!files.length) return '<p class="tf-empty">No files yet.</p>';
        return `<ul class="tf-list">${files.map(f => {
            const isPdf = f.original_name.toLowerCase().endsWith('.pdf');
            return `<li class="tf-item">
              <span class="tf-icon">${icon(isPdf ? 'file-pdf' : 'file-text')}</span>
              <span class="tf-copy"><span class="tf-title">${escHtml(f.title)}</span>
                <span class="tf-meta">${escHtml(f.original_name)} · ${size(Number(f.size_bytes))} · ${fmtDate(f.created_at)}</span></span>
              ${isPdf
                ? `<button type="button" class="btn btn-secondary btn-sm" data-open="${f.file_id}">${icon('eye')} Open</button>`
                : `<a class="btn btn-secondary btn-sm" href="${fileUrl(f.file_id)}" download>${icon('download-simple')} Download</a>`}
              <button type="button" class="btn btn-secondary btn-sm" data-delete="${f.file_id}" aria-label="Delete ${escHtml(f.title)}">${icon('trash')}</button>
            </li>`;
        }).join('')}</ul>`;
    }

    // ── Compact rows: thumbnail, title, "PDF · 3 pages · 88 KB", open or download, more ──
    const KIND_LABELS = {pdf: 'PDF', ppt: 'PowerPoint', pptx: 'PowerPoint', doc: 'Word', docx: 'Word'};
    function compactMeta(f, pages) {
        const ext = extOf(f.original_name);
        return [KIND_LABELS[ext] || ext.toUpperCase(), pages ? `${pages} page${pages === 1 ? '' : 's'}` : '', size(Number(f.size_bytes)), ext === 'pdf' ? '' : 'downloads']
            .filter(Boolean).join(' · ');
    }
    function compactRows(files) {
        if (!files.length) return '<p class="tf-empty">No materials yet. Upload a PDF, PowerPoint or Word file, or drop one here.</p>';
        return files.map(f => {
            const ext = extOf(f.original_name), isPdf = ext === 'pdf', title = escHtml(f.title);
            const thumb = isPdf
                ? `<span class="cs-thumb"><canvas data-thumb="${f.file_id}" width="44" height="56"></canvas></span>`
                : `<span class="cs-thumb cs-thumb--doc${ext.startsWith('ppt') ? ' cs-thumb--ppt' : ''}" aria-hidden="true">${escHtml(ext.toUpperCase())}</span>`;
            return `<div class="cs-file" data-file="${f.file_id}">${thumb}
              <span class="cs-row-copy"><span class="cs-row-title" title="${title}">${title}</span><span class="cs-meta" data-file-meta>${escHtml(compactMeta(f))}</span></span>
              ${isPdf
                ? `<button type="button" class="cs-icon-btn" data-open="${f.file_id}" aria-label="Open ${title}">${Studio.icon('eye')}</button>`
                : `<a class="cs-icon-btn" href="${fileUrl(f.file_id)}" download aria-label="Download ${title}">${Studio.icon('download-simple')}</a>`}
              <button type="button" class="cs-icon-btn" data-file-more="${f.file_id}" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${title}">${Studio.icon('dots-three')}</button>
            </div>`;
        }).join('');
    }

    async function send(kind, moduleId, file, title = '') {
        if (!TYPES.includes(extOf(file.name))) return {success: false, message: 'Upload a PDF, PowerPoint (.ppt, .pptx) or Word (.doc, .docx) file.'};
        if (file.size > MAX_BYTES) return {success: false, message: 'File too large. Maximum size is 100 MB.'};
        const data = new FormData();
        data.append('file', file);
        data.append('title', title);
        data.append('kind', kind);
        if (moduleId) data.append('module_id', moduleId);
        return fetch(`${API_BASE}/files.php`, {method: 'POST', credentials: 'same-origin', body: data}).then(r => r.json())
            .catch(() => ({success: false, message: 'Upload failed. Make sure XAMPP is running.'}));
    }
    const remove = id => fetch(`${API_BASE}/files.php?id=${id}`, {method: 'DELETE', credentials: 'same-origin'}).then(r => r.json()).catch(() => null);
    const confirmDelete = () => confirmToast({title: 'Delete this file?', message: 'It is removed for good.', confirmText: 'Delete', cancelText: 'Keep'});

    function mountCompact(root, {kind, moduleId = null, title = 'Materials', context, onChange}) {
        context = contextFor(kind, context);
        const query = `kind=${kind}` + (moduleId ? `&module_id=${moduleId}` : '');
        const n = ++uid;
        root.classList.add('tf-panel');
        root.dataset.materials = '';
        root.setAttribute('aria-labelledby', `tfHead-${n}`);
        root.innerHTML = `
          <div class="cs-panel-head"><h3 class="cs-h2" id="tfHead-${n}">${escHtml(title)}</h3><span class="cs-meta cs-num" data-count></span>
            <button type="button" class="cs-btn cs-btn--sm cs-btn--ghost" data-upload aria-expanded="false" aria-controls="tfForm-${n}">${Studio.icon('upload-simple', 'cs-ico--sm')}Upload</button></div>
          <form class="tf-mini" id="tfForm-${n}" hidden>
            <div class="cs-field"><label for="tfFile-${n}">File</label>
              <input type="file" id="tfFile-${n}" name="file" accept=".pdf,.ppt,.pptx,.doc,.docx" required/></div>
            <div class="cs-field"><label for="tfName-${n}">Title <span class="cs-meta">(optional)</span></label>
              <input class="cs-input" type="text" id="tfName-${n}" name="title" maxlength="200" placeholder="Defaults to the file name" autocomplete="off"/></div>
            <p class="cs-hint">PDFs open in the viewer; PowerPoint and Word files download. Max 100 MB. You can also drop files on this panel.</p>
            <p class="tf-error" role="alert" hidden></p>
            <div class="tf-mini-actions"><button type="button" class="cs-btn cs-btn--sm" data-cancel>Cancel</button><button type="submit" class="cs-btn cs-btn--sm cs-btn--primary">Upload</button></div>
          </form>
          <div class="tf-files" aria-live="polite"><p class="tf-empty">Loading files…</p></div>
          <p class="tf-drop" aria-hidden="true">${Studio.icon('cloud-arrow-up')}Drop to upload</p>`;
        const form = root.querySelector('form'), list = root.querySelector('.tf-files'), error = root.querySelector('.tf-error');
        const toggle = root.querySelector('[data-upload]'), counter = root.querySelector('[data-count]');
        const pages = new Map();   // file_id -> page count, so a reload does not count again
        let files = [];

        async function refresh() {
            const result = await fetch(`${API_BASE}/files.php?${query}`, {credentials: 'same-origin'}).then(r => r.json()).catch(() => null);
            if (!root.isConnected) return;
            files = result?.success ? result.data : [];
            counter.textContent = result?.success ? files.length : '';
            list.innerHTML = result?.success ? compactRows(files) : '<p class="tf-empty">Files could not be loaded. Please try again.</p>';
            list.querySelectorAll('canvas[data-thumb]').forEach(canvas => {
                const file = files.find(f => String(f.file_id) === canvas.dataset.thumb);
                const meta = canvas.closest('.cs-file').querySelector('[data-file-meta]');
                if (pages.has(file.file_id)) meta.textContent = compactMeta(file, pages.get(file.file_id));
                PdfViewer.thumbnail(canvas, fileUrl(file.file_id)).then(count => {
                    pages.set(file.file_id, count);
                    meta.textContent = compactMeta(file, count);
                }).catch(() => { if (canvas.isConnected) canvas.outerHTML = Studio.icon('file-pdf'); });
            });
            onChange?.(files);
        }

        function setForm(open) {
            form.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            if (open) form.elements.file.focus();
            else { form.reset(); error.hidden = true; }
        }
        toggle.addEventListener('click', () => setForm(form.hidden));
        form.querySelector('[data-cancel]').addEventListener('click', () => { setForm(false); toggle.focus(); });
        form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); setForm(false); toggle.focus(); } });
        form.addEventListener('submit', async e => {
            e.preventDefault();
            const button = form.querySelector('[type=submit]'), file = form.elements.file.files[0];
            if (!file) { error.textContent = 'Choose a file to upload.'; error.hidden = false; return; }
            error.hidden = true;
            button.disabled = true;
            const result = await send(kind, moduleId, file, form.elements.title.value.trim());
            button.disabled = false;
            if (!result?.success) { error.textContent = result?.message || 'Upload failed. Make sure XAMPP is running.'; error.hidden = false; return; }
            setForm(false);
            toggle.focus();
            showToast('File uploaded.', 'success');
            refresh();
        });

        // Dropping files anywhere on the panel uploads them, one after another. Lesson rows dragged
        // past the panel carry no files, so they are ignored.
        const carriesFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
        let depth = 0;
        root.addEventListener('dragenter', e => { if (!carriesFiles(e)) return; e.preventDefault(); depth++; root.classList.add('is-drop'); });
        root.addEventListener('dragover', e => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; root.classList.add('is-drop'); });
        root.addEventListener('dragleave', e => { if (!carriesFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) root.classList.remove('is-drop'); });
        root.addEventListener('drop', async e => {
            if (!carriesFiles(e)) return;
            e.preventDefault();
            depth = 0;
            root.classList.remove('is-drop');
            const dropped = [...e.dataTransfer.files];
            let uploaded = 0;
            for (const file of dropped) {
                const result = await send(kind, moduleId, file);
                if (result?.success) uploaded++;
                else showToast(`${file.name}: ${result?.message || 'Upload failed.'}`, 'error');
            }
            if (uploaded) showToast(uploaded === 1 ? 'File uploaded.' : `${uploaded} files uploaded.`, 'success');
            if (uploaded) refresh();
        });

        list.addEventListener('click', e => {
            const open = e.target.closest('[data-open]')?.dataset.open;
            const file = files.find(f => String(f.file_id) === (open || e.target.closest('[data-file-more]')?.dataset.fileMore));
            if (!file) return;
            if (open) { view(file, context); return; }
            const isPdf = extOf(file.original_name) === 'pdf';
            Studio.menu(e.target.closest('[data-file-more]'), [
                isPdf ? {label: 'Open', onSelect: () => view(file, context)}
                    : {label: 'Download', onSelect: () => Object.assign(document.createElement('a'), {href: fileUrl(file.file_id), download: ''}).click()},
                {label: 'Delete', danger: true, onSelect: async () => {
                    if (!await confirmDelete()) return;
                    const result = await remove(file.file_id);
                    showToast(result?.success ? 'File deleted.' : result?.message || 'Delete failed.', result?.success ? 'success' : 'error');
                    refresh();
                }},
            ]);
        });

        refresh();
    }

    function mount(root, options) {
        if (options.compact) return mountCompact(root, options);
        const {kind, moduleId = null} = options;
        const context = contextFor(kind, options.context);
        const query = `kind=${kind}` + (moduleId ? `&module_id=${moduleId}` : '');
        root.innerHTML = `
          <form class="tf-form">
            <div class="form-group"><label for="tfTitle-${kind}">Title (optional)</label>
              <div class="input-wrapper"><input type="text" id="tfTitle-${kind}" name="title" maxlength="200" placeholder="Defaults to the file name"/></div></div>
            <div class="form-group"><label for="tfFile-${kind}">File</label>
              <input type="file" id="tfFile-${kind}" name="file" accept=".pdf,.ppt,.pptx,.doc,.docx" required/>
              <div class="tf-hint">PDF opens in the viewer. PowerPoint and Word files download. Max 100 MB.</div></div>
            <p class="tf-error" role="alert" hidden></p>
            <button type="submit" class="btn btn-primary btn-sm">${icon('upload-simple')} Upload</button>
          </form>
          <div class="tf-files" aria-live="polite"><p class="tf-empty">Loading files…</p></div>`;
        const form = root.querySelector('form'), list = root.querySelector('.tf-files'), error = root.querySelector('.tf-error');

        let files = [];
        async function refresh() {
            const result = await fetch(`${API_BASE}/files.php?${query}`, {credentials: 'same-origin'}).then(r => r.json()).catch(() => null);
            files = result?.success ? result.data : [];
            list.innerHTML = result?.success ? rows(result.data) : '<p class="tf-empty">Files could not be loaded. Please try again.</p>';
        }

        form.addEventListener('submit', async e => {
            e.preventDefault();
            const button = form.querySelector('[type=submit]'), file = form.file.files[0];
            error.hidden = true;
            if (file?.size > MAX_BYTES) { error.textContent = 'File too large. Maximum size is 100 MB.'; error.hidden = false; return; }
            const data = new FormData(form);
            data.append('kind', kind);
            if (moduleId) data.append('module_id', moduleId);
            button.disabled = true;
            const result = await fetch(`${API_BASE}/files.php`, {method: 'POST', credentials: 'same-origin', body: data}).then(r => r.json()).catch(() => null);
            button.disabled = false;
            if (!result?.success) { error.textContent = result?.message || 'Upload failed. Make sure XAMPP is running.'; error.hidden = false; return; }
            form.reset();
            showToast('File uploaded.', 'success');
            refresh();
        });

        list.addEventListener('click', async e => {
            const open = e.target.closest('[data-open]')?.dataset.open;
            if (open) {
                const file = files.find(f => String(f.file_id) === open);
                if (file) view(file, context);
                return;
            }
            const id = e.target.closest('[data-delete]')?.dataset.delete;
            if (!id || !await confirmDelete()) return;
            const result = await remove(id);
            showToast(result?.success ? 'File deleted.' : result?.message || 'Delete failed.', result?.success ? 'success' : 'error');
            refresh();
        });

        refresh();
    }

    return {mount};
})();
