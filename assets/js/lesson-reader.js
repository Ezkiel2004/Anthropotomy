/* Lesson reader: the full-screen lesson view students read in and teachers preview.
   LessonReader.show(root, lesson, {exploreHref, onClose}) fills `root` (a .sd-reader element) and opens it;
   LessonReader.close(root) closes it. exploreHref null leaves out the 3D links (teacher preview).
   Needs app.js (escHtml, StudyClock), content-format.js and pdf-viewer.js loaded first. */
'use strict';
const LessonReader = (() => {
  const ICON_SPRITE = '../assets/icons/interface.svg?v=20261112-icons5';
  const icon = name => `<svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><use href="${ICON_SPRITE}#${name}"/></svg>`;
  const state = new WeakMap();   // root -> { pdf, onClose }

  function media(lesson, exploreHref) {
    if (!lesson.media_url) return '';
    const url = escHtml(lesson.media_url);
    const ext = lesson.media_url.split('?')[0].split('.').pop().toLowerCase();
    if (['mp4', 'webm'].includes(ext)) return `<video controls preload="metadata" src="${url}">Video playback is unavailable.</video>`;
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return `<img src="${url}" alt="${escHtml(lesson.title)}"/>`;
    if (ext === 'pdf') return `<div class="sd-pdf" data-pdf="${url}" data-title="${escHtml(lesson.title)}"></div>`;
    if (ext === 'glb') {
      return exploreHref === null ? '<p>This lesson has a 3D model attached.</p>'
        : `<a class="sd-go sd-go--light" href="anatomy.html?system=${encodeURIComponent(lesson.system_code)}&lesson_id=${Number(lesson.lesson_id)}">Open the lesson model in 3D<span class="sd-go-disc">${icon('arrow-right')}</span></a>`;
    }
    if (['ppt', 'pptx'].includes(ext)) return `<p><a href="${url}" download data-reading>Download the slides</a></p>`;
    return `<p><a href="${url}" target="_blank" rel="noopener" data-reading>Open the lesson attachment</a></p>`;
  }

  function show(root, lesson, options = {}) {
    const exploreHref = options.exploreHref === undefined
      ? `anatomy.html?system=${encodeURIComponent(lesson.system_code || '')}` : options.exploreHref;
    const look = ContentFormat.systemLook(lesson.system_code);
    const system = String(lesson.system_name || '').replace(/\s+System$/i, '') || 'Anatomy';
    const kicker = [lesson.module_title, lesson.duration_mins ? lesson.duration_mins + ' min read' : 'Self-paced'].filter(Boolean).map(escHtml).join(' · ');
    const isPdf = /\.pdf$/i.test(String(lesson.media_url || '').split('?')[0]);   // a PDF lesson reads on a wider page (pdf-viewer.css)

    root.innerHTML = `
    <div class="sd-reader-bar">
      <button type="button" class="sd-ghost" data-reader-close>${icon('arrow-left')}Lessons</button>
      <span class="sd-reader-bar-title" aria-hidden="true">${escHtml(lesson.title)}</span>
      ${exploreHref ? `<a class="sd-ghost" href="${escHtml(exploreHref)}">${icon('cube')}View in 3D</a>` : ''}
    </div>
    <div class="sd-reader-scroll">
      <article class="sd-reader-doc${isPdf ? ' sd-reader-doc--pdf' : ''}" style="--card:${look.colour}">
        <header>
          <p class="sd-reader-kicker"><b>${escHtml(system)}</b> · ${kicker}</p>
          <h2 class="sd-reader-title" id="readerTitle">${escHtml(lesson.title)}</h2>
        </header>
        ${lesson.media_url ? `<div class="sd-reader-media">${media(lesson, exploreHref)}</div>` : ''}
        <div class="sd-reader-text">${lesson.content_text ? escHtml(lesson.content_text) : 'No lesson text has been provided.'}</div>
        ${exploreHref ? `<section class="sd-next sd-callout" data-tone="${look.tone}" style="--card:${look.colour}" aria-labelledby="practiceTitle">
          ${look.art ? `<img class="sd-next-art" src="${look.art}" alt="">` : ''}
          <div class="sd-next-copy">
            <p class="sd-next-kicker">Practice in 3D</p>
            <h3 class="sd-next-title" id="practiceTitle">See it on the body</h3>
            <p class="sd-next-detail">Open the ${escHtml(system.toLowerCase())} model and click any part to learn its name.</p>
          </div>
          <div class="sd-next-actions"><a class="sd-go" href="${escHtml(exploreHref)}">Open 3D explorer<span class="sd-go-disc">${icon('arrow-right')}</span></a></div>
        </section>` : ''}
      </article>
    </div>
    <div class="sd-reader-foot">
      <button type="button" class="sd-ghost" data-reader-close>Close</button>
    </div>`;

    let entry = state.get(root);
    if (!entry) {
      entry = { pdf: null, onClose: null };
      state.set(root, entry);
      root.addEventListener('keydown', e => { if (e.key === 'Escape') close(root); });
      root.addEventListener('click', e => {
        if (e.target.closest('[data-reader-close]')) close(root);
        else if (e.target.closest('[data-reading]') && typeof StudyClock !== 'undefined') StudyClock.reading();
      });
    }
    entry.pdf?.destroy();
    entry.pdf = null;
    entry.onClose = options.onClose || null;
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    const pdfHost = root.querySelector('.sd-pdf');
    if (pdfHost) {
      PdfViewer.mount(pdfHost, { url: pdfHost.dataset.pdf, title: pdfHost.dataset.title }).then(v => {
        // The reader may have closed or moved to another lesson while the PDF loaded.
        if (state.get(root) === entry && !root.hidden && root.contains(pdfHost)) entry.pdf = v; else v.destroy();
      });
    }
    root.querySelector('.sd-reader-bar button').focus();
  }

  function close(root) {
    const entry = state.get(root);
    if (!entry || root.hidden) return;
    root.hidden = true;
    entry.pdf?.destroy();
    entry.pdf = null;
    document.body.style.overflow = '';
    const done = entry.onClose;
    entry.onClose = null;
    if (done) done();
  }

  return { show, close };
})();
