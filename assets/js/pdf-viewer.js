/* One PDF viewer for lessons, materials and lesson plans. Renders with the vendored pdf.js (assets/vendor/pdfjs/), no browser tab, no iframe.
   PdfViewer.mount(container, {url, title, downloadUrl, note}) → Promise<{destroy()}>   inline viewer
   PdfViewer.open({url, title, downloadUrl, context, note}) → {close()}                 full-screen viewer with a thumbnail rail; context labels where it came from
   note (optional): the teacher's note, shown as plain text in a strip under the toolbar that the reader can hide.
   slides: true (PowerPoint files, read from their PDF copy) shows one slide at a time, fitted to the window, with a Present button
   (browser full screen), instead of a scrolling page list and zoom. Keys: arrows, Page Up/Down, Space, Home, End, F.
   PdfViewer.thumbnail(canvas, url) → Promise<number>                             draws page 1 into a canvas, resolves to the page count
   PdfViewer.pageCount(url) → Promise<number>                                     reads the page count without drawing
   Pages are empty placeholders; only the ones near the viewport are drawn, and they are released again when they scroll far away.
   Needs pdf-viewer.css. pdf.js is loaded the first time a document is opened. */
const PdfViewer = (() => {
    const SCRIPT_SRC = document.currentScript?.src || document.querySelector('script[src*="pdf-viewer.js"]')?.src || location.href;
    const LIB_BASE = new URL('../vendor/pdfjs/', SCRIPT_SRC).href;
    const LIB_VERSION = '?v=4.10.38-legacy';  // pdf.js legacy build: runs on browsers without Promise.withResolvers
    const ICONS = new URL('../icons/interface.svg?v=20261112-icons5', SCRIPT_SRC).href;
    const FIT_MAX = 896;                       // 56rem: the widest a "fit width" page gets
    const PERCENTS = [50, 75, 100, 125, 150, 200];
    const PX_PER_PT = 96 / 72;
    const NEAR = '600px 0px';                  // how far outside the view a page is still drawn
    let libPromise = null, active = null, notes = 0;

    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const icon = name => `<svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${ICONS}#${name}"/></svg>`;
    const button = (name, label, extra = '') => `<button type="button" class="pv-btn" aria-label="${label}" ${extra}>${icon(name)}</button>`;

    function lib() {
        libPromise = libPromise || import(LIB_BASE + 'pdf.min.mjs' + LIB_VERSION).then(pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = LIB_BASE + 'pdf.worker.min.mjs' + LIB_VERSION;
            return pdfjs;
        }).catch(error => { libPromise = null; throw error; });
        return libPromise;
    }

    async function load(url) {
        const pdfjs = await lib();
        const task = pdfjs.getDocument({url, withCredentials: true});
        return {task, pdf: await task.promise};
    }

    // Draws one page into a canvas at the canvas's CSS width. Returns the render task so the caller can cancel it.
    function paint(page, canvas, cssWidth) {
        const natural = page.getViewport({scale: 1});
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = cssWidth / natural.width * dpr;
        scale = Math.min(scale, Math.sqrt(16e6 / (natural.width * natural.height)));   // keep one canvas under ~16 megapixels
        const viewport = page.getViewport({scale});
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        return page.render({canvasContext: canvas.getContext('2d'), viewport});
    }

    async function thumbnail(canvas, url) {
        const {task, pdf} = await load(url);
        try {
            const page = await pdf.getPage(1);
            await paint(page, canvas, canvas.clientWidth || canvas.width || 160).promise;
            canvas.dataset.rendered = '1';
            return pdf.numPages;
        } finally { task.destroy(); }
    }

    async function pageCount(url) {
        const {task, pdf} = await load(url);
        try { return pdf.numPages; } finally { task.destroy(); }
    }

    // The teacher's note under the toolbar: escaped text that keeps its line breaks, with a Hide / Show note toggle.
    // One line, no stray whitespace: the body keeps line breaks (white-space: pre-line).
    function noteStrip(note) {
        const text = String(note ?? '').trim();
        if (!text) return '';
        const id = 'pv-note-' + ++notes;
        return `<div class="pv-note">${icon('info')}<p class="pv-note-body"><b>Note from your teacher<span class="pv-note-colon">:</span></b> <span class="pv-note-text" id="${id}">${esc(text)}</span></p>`
            + `<button type="button" class="pv-note-toggle" data-note-toggle aria-expanded="true" aria-controls="${id}">Hide</button></div>`;
    }

    /* Builds the viewer into root and returns {destroy()}. full: draw the thumbnail rail and answer keys anywhere (Escape included). */
    // downloadUrl: left out it is the PDF's own address; null (or '') makes the viewer view-only, with no Download button or link anywhere.
    function build(root, {url, title = 'Document', downloadUrl = url, note = '', slides = false}, {full, onClose, onFullScreen}) {
        const name = esc(title), cleanups = [];
        let pdf = null, task = null, dead = false, zoom = 'fit', current = 1, natural = null, stageKey = '';
        // slides: a PowerPoint file read from its PDF copy. One slide at a time, fitted to the window, with a Present button;
        // no zoom and no scrolling. Everything else about loading and drawing is shared with the PDF reader.
        const unit = slides ? 'slide' : 'page';
        const canPresent = slides && full && Boolean(document.fullscreenEnabled);
        root.classList.toggle('pv--slides', slides);
        root.innerHTML = `
          <div class="pv-bar">
            <span class="pv-name">${icon(slides ? 'file-ppt' : 'file-pdf')}<b>${name}</b><span class="pv-meta">${slides ? 'PowerPoint' : 'PDF'}</span></span>
            ${button('arrow-left', `Previous ${unit}`, 'data-prev')}
            <span class="pv-pages" aria-live="polite">${slides ? '<span class="pv-of">Slide</span>' : ''}<input type="text" inputmode="numeric" aria-label="${slides ? 'Slide' : 'Page'} number" value="1" size="3" disabled/><span class="pv-of pv-total"></span></span>
            ${button('arrow-right', `Next ${unit}`, 'data-next')}
            ${slides ? '' : `<span class="pv-sep"></span>
            ${button('magnifying-glass-minus', 'Zoom out', 'data-zoom-out')}
            <span class="pv-zoom">Fit width</span>
            ${button('magnifying-glass-plus', 'Zoom in', 'data-zoom-in')}`}
            ${downloadUrl || !full || canPresent ? '<span class="pv-sep"></span>' : ''}
            ${canPresent ? `<button type="button" class="pv-present" data-present>${icon('corners-out')}Present</button>` : ''}
            ${downloadUrl ? `<a class="pv-btn" href="${esc(downloadUrl)}" download aria-label="Download">${icon('download-simple')}</a>` : ''}
            ${full ? '' : button('corners-out', 'Full screen', 'data-full')}
          </div>
          ${noteStrip(note)}
          <div class="pv-body">
            ${full ? '<div class="pv-rail" aria-hidden="true"></div>' : ''}
            <div class="pv-stage" tabindex="0" role="document" aria-label="${name} ${unit}s"><p class="pv-loading">Loading ${slides ? 'slides' : 'document'}…</p></div>
          </div>`;
        const $ = selector => root.querySelector(selector);
        const stage = $('.pv-stage'), rail = $('.pv-rail'), input = $('.pv-pages input');
        const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); cleanups.push(() => target.removeEventListener(type, handler, options)); };

        const pages = () => [...stage.querySelectorAll('[data-page]')];
        const count = () => pdf ? pdf.numPages : 0;
        const padding = () => parseFloat(getComputedStyle(stage).paddingLeft) || 0;
        const fitPx = () => Math.max(120, Math.min(stage.clientWidth - 2 * padding(), FIT_MAX));
        // Zoom steps in order of width, with "Fit width" slotted in where it falls for this screen.
        const steps = () => [{key: 'fit', label: 'Fit width', px: fitPx()}, ...PERCENTS.map(p => ({key: p, label: p + '%', px: natural.width * p / 100}))].sort((a, b) => a.px - b.px);
        const widthFor = () => zoom === 'fit' ? fitPx() : natural.width * zoom / 100;

        // ── Lazy page drawing ───────────────────────────────────
        const state = new WeakMap();   // placeholder → {render, token}
        function release(el) {
            const s = state.get(el);
            if (!s) return;
            s.token++;
            s.render?.cancel();
            s.render = null;
            el.querySelector('canvas')?.remove();
            el.querySelectorAll('.pv-link').forEach(a => a.remove());
            delete el.dataset.rendered;
        }
        // Web links in the document (a PowerPoint slide's hyperlinks, a PDF's links) are drawn as clickable boxes over the page,
        // in percentages of the page so they follow every zoom. Only http(s) addresses; they open in a new tab.
        async function addLinks(page, el) {
            let notes = [];
            try { notes = await page.getAnnotations({intent: 'display'}); } catch { return; }
            const view = page.getViewport({scale: 1});
            for (const note of notes) {
                if (note.subtype !== 'Link' || !/^https?:\/\//i.test(note.url || '') || !note.rect) continue;
                const [x1, y1, x2, y2] = view.convertToViewportRectangle(note.rect);
                const link = document.createElement('a');
                link.className = 'pv-link';
                link.href = note.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.title = note.url;
                link.setAttribute('aria-label', 'Open link: ' + note.url);
                link.style.cssText = `left:${Math.min(x1, x2) / view.width * 100}%;top:${Math.min(y1, y2) / view.height * 100}%;width:${Math.abs(x2 - x1) / view.width * 100}%;height:${Math.abs(y2 - y1) / view.height * 100}%`;
                el.append(link);
            }
        }
        async function draw(el, host) {
            const s = state.get(el) || {token: 0, render: null};
            state.set(el, s);
            if (el.dataset.rendered || s.render) return;
            const token = ++s.token;
            try {
                const page = await pdf.getPage(Number(el.dataset.page));
                if (dead || token !== s.token) return;
                const canvas = document.createElement('canvas');
                const view = page.getViewport({scale: 1});
                el.style.aspectRatio = `${view.width} / ${view.height}`;
                s.render = paint(page, canvas, el.clientWidth || (host === 'rail' ? 96 : widthFor()));
                await s.render.promise;
                if (dead || token !== s.token) return;
                s.render = null;
                el.append(canvas);
                canvas.dataset.rendered = '1';
                el.dataset.rendered = '1';
                if (host !== 'rail') await addLinks(page, el);
                if (dead || token !== s.token) el.querySelectorAll('.pv-link').forEach(a => a.remove());
            } catch (error) {
                if (error?.name !== 'RenderingCancelledException') s.render = null;
            }
        }
        function watch(container, host) {
            const observer = new IntersectionObserver(entries => {
                for (const entry of entries) entry.isIntersecting ? draw(entry.target, host) : release(entry.target);
            }, {root: container, rootMargin: NEAR});
            container.querySelectorAll('[data-page]').forEach(el => observer.observe(el));
            cleanups.push(() => observer.disconnect());
            return observer;
        }
        let stageObserver = null;
        function redrawAll() {
            if (slides) { showSlide(current); return; }
            // Re-observing makes the observer report every placeholder again, so the visible ones draw at the new size.
            pages().forEach(release);
            stageObserver.disconnect();
            pages().forEach(el => stageObserver.observe(el));
        }

        // ── Page and zoom state ─────────────────────────────────
        function setCurrent(n) {
            current = Math.max(1, Math.min(count(), n));
            input.value = current;
            rail?.querySelectorAll('figure').forEach(f => {
                const on = Number(f.dataset.rail) === current;
                f.classList.toggle('on', on);
                if (on && !rail.matches(':hover')) f.scrollIntoView({block: 'nearest'});
            });
        }
        function goTo(n) {
            n = Math.max(1, Math.min(count(), Number(n) || 1));
            if (slides) { showSlide(n); return; }
            setCurrent(n);
            const el = stage.querySelector(`[data-page="${n}"]`);
            if (el) stage.scrollTo({top: el.offsetTop - padding()});
        }
        // Slides: the one slide on the stage is redrawn for the chosen number.
        function showSlide(n) {
            setCurrent(n);
            const el = stage.querySelector('.pv-page');
            if (!el) return;
            release(el);
            el.dataset.page = String(current);
            draw(el, 'stage');
        }
        // A slide is as large as fits the stage both ways, so the whole slide is always in view.
        function fitSlide() {
            const pad = padding();
            const width = Math.max(160, Math.min(stage.clientWidth - 2 * pad, (stage.clientHeight - 2 * pad) / natural.ratio));
            stage.style.setProperty('--pv-w', width + 'px');
            stageKey = stage.clientWidth + 'x' + stage.clientHeight;
        }
        function applyZoom() {
            if (slides) { fitSlide(); return; }
            stage.style.setProperty('--pv-w', widthFor() + 'px');
            $('.pv-zoom').textContent = zoom === 'fit' ? 'Fit width' : zoom + '%';
            stageKey = stage.clientWidth + 'x' + stage.clientHeight;
        }
        function present() {
            if (document.fullscreenElement) document.exitFullscreen?.();
            else root.requestFullscreen?.().catch(() => {});
        }
        function stepZoom(direction) {
            if (!pdf || slides) return;
            const list = steps(), index = list.findIndex(s => s.key === zoom);
            const chosen = list[Math.max(0, Math.min(list.length - 1, index + direction))];
            if (chosen.key === zoom) return;
            const anchor = current;
            zoom = chosen.key;
            applyZoom();
            redrawAll();
            goTo(anchor);
        }
        let frame = 0;
        function onScroll() {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const line = stage.scrollTop + stage.clientHeight / 3;
                let found = 1;
                for (const el of pages()) { if (el.offsetTop - padding() <= line) found = Number(el.dataset.page); else break; }
                if (found !== current) setCurrent(found);
            });
        }
        cleanups.push(() => frame && cancelAnimationFrame(frame));

        // ── Controls ────────────────────────────────────────────
        listen(root, 'click', e => {
            if (e.target.closest('.pv-link')) return;   // a link on the page: let the browser open it, do not turn the slide
            const control = e.target.closest('button, .pv-rail figure');
            if (!control && slides && pdf && e.target.closest('.pv-page')) { goTo(current + 1); return; }   // click the slide: next slide
            if (!control || !root.contains(control)) return;
            if (control.dataset.present !== undefined) present();
            else if (control.dataset.prev !== undefined) goTo(current - 1);
            else if (control.dataset.next !== undefined) goTo(current + 1);
            else if (control.dataset.zoomIn !== undefined) stepZoom(1);
            else if (control.dataset.zoomOut !== undefined) stepZoom(-1);
            else if (control.dataset.full !== undefined) onFullScreen?.();
            else if (control.dataset.rail) goTo(control.dataset.rail);
            else if (control.dataset.noteToggle !== undefined) {
                const open = control.getAttribute('aria-expanded') !== 'true';
                control.setAttribute('aria-expanded', String(open));
                control.textContent = open ? 'Hide' : 'Show note';
                $('.pv-note-text').hidden = !open;
                $('.pv-note-colon').hidden = !open;
            }
        });
        listen(input, 'keydown', e => { if (e.key === 'Enter') { goTo(input.value); stage.focus(); } });
        listen(input, 'blur', () => { input.value = current; });
        listen(stage, 'scroll', onScroll, {passive: true});
        function onKey(e) {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Escape') { if (full) { e.preventDefault(); e.stopPropagation(); onClose?.(); } return; }
            if (e.target.closest?.('input, textarea, select')) return;
            const onControl = Boolean(e.target.closest?.('button, a[href]'));
            const slideKeys = !slides ? {} : {
                PageDown: () => goTo(current + 1), PageUp: () => goTo(current - 1), ArrowDown: () => goTo(current + 1), ArrowUp: () => goTo(current - 1),
                Home: () => goTo(1), End: () => goTo(count()), ' ': () => { if (!onControl) goTo(current + 1); },
                f: () => canPresent && present(), F: () => canPresent && present(),
            };
            const handled = {ArrowRight: () => goTo(current + 1), ArrowLeft: () => goTo(current - 1), '+': () => stepZoom(1), '=': () => stepZoom(1), '-': () => stepZoom(-1), '_': () => stepZoom(-1), ...slideKeys}[e.key];
            if (!handled) return;
            if (e.key === ' ' && onControl) return;   // Space presses a focused button
            e.preventDefault();
            e.stopPropagation();
            handled();
        }
        // The full-screen viewer answers anywhere on the page (capture, so a page behind it does not also react); the inline one only while focus is inside it.
        if (full) listen(document, 'keydown', onKey, true); else listen(root, 'keydown', onKey);

        // ── Start ───────────────────────────────────────────────
        const failed = () => {
            if (dead) return;
            root.innerHTML = `<div class="pv-fallback" role="alert"><p>This document can’t be shown here.</p>
              ${downloadUrl ? `<a class="pv-download" href="${esc(downloadUrl)}" download>${icon('download-simple')} Download</a>` : ''}</div>`;
        };
        if (typeof StudyClock !== 'undefined') StudyClock.reading();
        load(url).then(async loaded => {
            task = loaded.task;
            pdf = loaded.pdf;
            if (dead) { task.destroy(); return; }
            const first = await pdf.getPage(1);
            if (dead) return;
            const view = first.getViewport({scale: 1});
            natural = {width: view.width * PX_PER_PT, ratio: view.height / view.width};
            $('.pv-meta').textContent = `${slides ? 'PowerPoint' : 'PDF'} · ${count()} ${unit}${count() === 1 ? '' : 's'}`;
            $('.pv-total').textContent = `of ${count()}`;
            input.disabled = false;
            stage.innerHTML = slides
                ? `<div class="pv-page" data-page="1" style="aspect-ratio:1 / ${natural.ratio}"></div>`
                : Array.from({length: count()}, (_, i) => `<div class="pv-page" data-page="${i + 1}" style="aspect-ratio:1 / ${natural.ratio}"></div>`).join('');
            if (rail) rail.innerHTML = Array.from({length: count()}, (_, i) => `<figure data-rail="${i + 1}" role="presentation"><div class="pv-thumb" data-page="${i + 1}" style="aspect-ratio:1 / ${natural.ratio}"></div><figcaption>${i + 1}</figcaption></figure>`).join('');
            applyZoom();
            if (!slides) stageObserver = watch(stage, 'stage');
            if (rail) watch(rail, 'rail');
            if (typeof ResizeObserver === 'function') {
                const resize = new ResizeObserver(() => {
                    if (stage.clientWidth + 'x' + stage.clientHeight === stageKey) return;
                    applyZoom();
                    if (zoom === 'fit') redrawAll();
                });
                resize.observe(stage);
                cleanups.push(() => resize.disconnect());
            }
            setCurrent(1);
            if (slides) showSlide(1);
            if (full) stage.focus({preventScroll: true});
        }).catch(failed);

        return {
            destroy() {
                if (dead) return;
                dead = true;
                cleanups.splice(0).forEach(fn => fn());
                try { task?.destroy(); } catch { /* already gone */ }
                root.textContent = '';
            },
        };
    }

    function mount(container, options) {
        const root = document.createElement('div');
        root.className = 'pv';
        container.append(root);
        const viewer = build(root, options, {full: false, onFullScreen: () => open(options)});
        return Promise.resolve({destroy() { viewer.destroy(); root.remove(); }});
    }

    function open(options) {
        active?.close();
        const previous = document.activeElement, overflow = document.body.style.overflow;
        const overlay = document.createElement('div');
        overlay.className = 'pv-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', options.title || 'Document');
        overlay.innerHTML = `<div class="pv-top">${options.context ? `<span class="pv-context">${esc(options.context)}</span>` : ''}<button type="button" class="pv-close" aria-label="Close">${icon('x')}Close</button></div><div class="pv pv--full"></div>`;
        document.body.append(overlay);
        document.body.style.overflow = 'hidden';
        let closed = false;
        const handle = {
            close() {
                if (closed) return;
                closed = true;
                viewer.destroy();
                overlay.remove();
                document.body.style.overflow = overflow;
                if (active === handle) active = null;
                if (previous?.isConnected) previous.focus({preventScroll: true});
            },
        };
        const viewer = build(overlay.querySelector('.pv'), options, {full: true, onClose: () => handle.close()});
        overlay.querySelector('.pv-close').addEventListener('click', handle.close);
        // Keep Tab inside the viewer.
        overlay.addEventListener('keydown', e => {
            if (e.key !== 'Tab') return;
            const items = [...overlay.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')];
            if (!items.length) return;
            const first = items[0], last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        overlay.querySelector('.pv-close').focus({preventScroll: true});
        active = handle;
        return handle;
    }

    return {mount, open, thumbnail, pageCount};
})();
