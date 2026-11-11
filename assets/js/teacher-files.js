/* Teacher file lists (module materials, lesson plans): upload, list, open and delete through api/files.php.
   TeacherFiles.mount(element, {kind, moduleId}) draws the upload form and the list into element. Needs app.js, and pdf-viewer.js to open PDFs. */
const TeacherFiles = (() => {
    const MAX_BYTES = 100 * 1024 * 1024;
    const size = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
    const icon = name => `<svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="../assets/icons/interface.svg?v=20261012-icons3#${name}"/></svg>`;

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
                : `<a class="btn btn-secondary btn-sm" href="${API_BASE}/files.php?id=${f.file_id}" download>${icon('download-simple')} Download</a>`}
              <button type="button" class="btn btn-secondary btn-sm" data-delete="${f.file_id}" aria-label="Delete ${escHtml(f.title).replace(/"/g, '&quot;')}">${icon('trash')}</button>
            </li>`;
        }).join('')}</ul>`;
    }

    function mount(root, {kind, moduleId = null}) {
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
                if (file) PdfViewer.open({url: `${API_BASE}/files.php?id=${file.file_id}`, title: file.title});
                return;
            }
            const id = e.target.closest('[data-delete]')?.dataset.delete;
            if (!id || !await confirmToast({title: 'Delete this file?', message: 'It is removed for good.', confirmText: 'Delete', cancelText: 'Keep'})) return;
            const result = await fetch(`${API_BASE}/files.php?id=${id}`, {method: 'DELETE', credentials: 'same-origin'}).then(r => r.json()).catch(() => null);
            showToast(result?.success ? 'File deleted.' : result?.message || 'Delete failed.', result?.success ? 'success' : 'error');
            refresh();
        });

        refresh();
    }

    return {mount};
})();
