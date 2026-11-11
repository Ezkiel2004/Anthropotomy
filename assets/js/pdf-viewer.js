/* One PDF viewer for lessons, materials and lesson plans. Renders with the vendored pdf.js (assets/vendor/pdfjs/), no browser tab, no iframe.
   PdfViewer.mount(container, {url, title, downloadUrl}) → Promise<{destroy()}>   inline viewer
   PdfViewer.open({url, title, downloadUrl}) → {close()}                          full-screen viewer with a thumbnail rail
   PdfViewer.thumbnail(canvas, url) → Promise<void>                               draws page 1 into a canvas
   Pages are empty placeholders; only the ones near the viewport are drawn, and they are released again when they scroll far away.
   Needs pdf-viewer.css. pdf.js is loaded the first time a document is opened. */
const PdfViewer = (() => {
    const SCRIPT_SRC = document.currentScript?.src || document.querySelector('script[src*="pdf-viewer.js"]')?.src || location.href;
    const LIB_BASE = new URL('../vendor/pdfjs/', SCRIPT_SRC).href;
    const ICONS = new URL('../icons/interface.svg?v=20261012-icons3', SCRIPT_SRC).href;
    const FIT_MAX = 896;                       // 56rem: the widest a "fit width" page gets
    const PERCENTS = [50, 75, 100, 125, 150, 200];
    const PX_PER_PT = 96 / 72;
    const NEAR = '600px 0px';                  // how far outside the view a page is still drawn
    let libPromise = null, active = null;

    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    const icon = name => `<svg class="ui-icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${ICONS}#${name}"/></svg>`;
    const button = (name, label, extra = '') => `<button type="button" class="pv-btn" aria-label="${label}" ${extra}>${icon(name)}</button>`;

    function lib() {
        libPromise = libPromise || import(LIB_BASE + 'pdf.min.mjs').then(pdfjs => {
            pdfjs.GlobalWorkerOptions.workerSrc = LIB_BASE + 'pdf.worker.min.mjs';
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
        } finally { task.destroy(); }
    }

    /* Builds the viewer into root and returns {destroy()}. full: draw the thumbnail rail and answer keys anywhere (Escape included). */
    function build(root, {url, title = 'Document', downloadUrl = url}, {full, onClose, onFullScreen}) {
        const name = esc(title), cleanups = [];
        let pdf = null, task = null, dead = false, zoom = 'fit', current = 1, natural = null, stageWidth = 0;
        root.innerHTML = `
          <div class="pv-bar">
            <span class="pv-name">${icon('file-pdf')}<b>${name}</b><span class="pv-meta">PDF</span></span>
            ${button('arrow-left', 'Previous page', 'data-prev')}
            <span class="pv-pages" aria-live="polite"><input type="text" inputmode="numeric" aria-label="Page number" value="1" size="3" disabled/><span class="pv-of"></span></span>
            ${button('arrow-right', 'Next page', 'data-next')}
            <span class="pv-sep"></span>
            ${button('magnifying-glass-minus', 'Zoom out', 'data-zoom-out')}
            <span class="pv-zoom">Fit width</span>
            ${button('magnifying-glass-plus', 'Zoom in', 'data-zoom-in')}
            <span class="pv-sep"></span>
            <a class="pv-btn" href="${esc(downloadUrl)}" download aria-label="Download">${icon('download-simple')}</a>
            ${full ? '' : button('corners-out', 'Full screen', 'data-full')}
          </div>
          <div class="pv-body">
            ${full ? '<div class="pv-rail" aria-hidden="true"></div>' : ''}
            <div class="pv-stage" tabindex="0" role="document" aria-label="${name} pages"><p class="pv-loading">Loading document…</p></div>
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
            delete el.dataset.rendered;
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
            setCurrent(n);
            const el = stage.querySelector(`[data-page="${n}"]`);
            if (el) stage.scrollTo({top: el.offsetTop - padding()});
        }
        function applyZoom() {
            stage.style.setProperty('--pv-w', widthFor() + 'px');
            $('.pv-zoom').textContent = zoom === 'fit' ? 'Fit width' : zoom + '%';
            stageWidth = stage.clientWidth;
        }
        function stepZoom(direction) {
            if (!pdf) return;
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
            const control = e.target.closest('button, .pv-rail figure');
            if (!control || !root.contains(control)) return;
            if (control.dataset.prev !== undefined) goTo(current - 1);
            else if (control.dataset.next !== undefined) goTo(current + 1);
            else if (control.dataset.zoomIn !== undefined) stepZoom(1);
            else if (control.dataset.zoomOut !== undefined) stepZoom(-1);
            else if (control.dataset.full !== undefined) onFullScreen?.();
            else if (control.dataset.rail) goTo(control.dataset.rail);
        });
        listen(input, 'keydown', e => { if (e.key === 'Enter') { goTo(input.value); stage.focus(); } });
        listen(input, 'blur', () => { input.value = current; });
        listen(stage, 'scroll', onScroll, {passive: true});
        function onKey(e) {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Escape') { if (full) { e.preventDefault(); e.stopPropagation(); onClose?.(); } return; }
            if (e.target.closest?.('input, textarea, select')) return;
            const handled = {ArrowRight: () => goTo(current + 1), ArrowLeft: () => goTo(current - 1), '+': () => stepZoom(1), '=': () => stepZoom(1), '-': () => stepZoom(-1), '_': () => stepZoom(-1)}[e.key];
            if (!handled) return;
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
              <a class="pv-download" href="${esc(downloadUrl)}" download>${icon('download-simple')} Download</a></div>`;
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
            $('.pv-meta').textContent = `PDF · ${count()} page${count() === 1 ? '' : 's'}`;
            $('.pv-of').textContent = `of ${count()}`;
            input.disabled = false;
            stage.innerHTML = Array.from({length: count()}, (_, i) => `<div class="pv-page" data-page="${i + 1}" style="aspect-ratio:1 / ${natural.ratio}"></div>`).join('');
            if (rail) rail.innerHTML = Array.from({length: count()}, (_, i) => `<figure data-rail="${i + 1}" role="presentation"><div class="pv-thumb" data-page="${i + 1}" style="aspect-ratio:1 / ${natural.ratio}"></div><figcaption>${i + 1}</figcaption></figure>`).join('');
            applyZoom();
            stageObserver = watch(stage, 'stage');
            if (rail) watch(rail, 'rail');
            if (typeof ResizeObserver === 'function') {
                const resize = new ResizeObserver(() => {
                    if (stage.clientWidth === stageWidth) return;
                    applyZoom();
                    if (zoom === 'fit') redrawAll();
                });
                resize.observe(stage);
                cleanups.push(() => resize.disconnect());
            }
            setCurrent(1);
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
        overlay.innerHTML = `<div class="pv-top"><button type="button" class="pv-close" aria-label="Close">${icon('x')}Close</button></div><div class="pv pv--full"></div>`;
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

    return {mount, open, thumbnail};
})();
