// After mockups: the real signed-in pages with the redesigned content injected, rendered to PNG.
// Run from the repo root with XAMPP up and the demo seeded (php database/seed_demo.php):
//   node docs/superpowers/specs/assets/2026-11-11-content-redesign/mockup/capture-after.mjs
import { chromium } from 'file:///C:/xampp/htdocs/Anthropotomy/landing-src/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost/Anthropotomy';
const DIR = 'C:/xampp/htdocs/Anthropotomy/docs/superpowers/specs/assets/2026-11-11-content-redesign';
const CSS = readFileSync(`${DIR}/mockup/after.css`, 'utf8');
const acct = readFileSync('C:/xampp/htdocs/Anthropotomy/demo users account.txt', 'utf8');
const cred = role => { const b = acct.split(/\r?\n\r?\n/).find(x => x.trim().startsWith(role)); return { user: b.match(/Username:\s*(\S+)/)[1], pass: b.match(/Password:\s*(\S+)/)[1] }; };

// ── Markup helpers ──────────────────────────────────────────────
const SPRITE = '../assets/icons/interface.svg?v=20261012-icons3';
const i = (name, cls = '') => `<svg class="cs-ico ${cls}" viewBox="0 0 256 256" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;
// Not in the sprite yet; the plan adds Phosphor dots-three and dots-six-vertical.
const more = `<svg class="cs-ico" viewBox="0 0 256 256"><circle cx="64" cy="128" r="14"/><circle cx="128" cy="128" r="14"/><circle cx="192" cy="128" r="14"/></svg>`;
const grip = `<svg class="cs-ico cs-ico--sm" viewBox="0 0 256 256"><circle cx="92" cy="60" r="16"/><circle cx="164" cy="60" r="16"/><circle cx="92" cy="128" r="16"/><circle cx="164" cy="128" r="16"/><circle cx="92" cy="196" r="16"/><circle cx="164" cy="196" r="16"/></svg>`;
const SYS = { skeletal: ['#3fb8f5', 'skeletal', 'Skeletal system'], circulatory: ['#f2545b', 'circulatory', 'Circulatory system'], respiratory: ['#2ccf9a', 'respiratory', 'Respiratory system'], nervous: ['#8b7cff', 'nervous', 'Nervous system'] };
const KIND = { reading: ['t-reading', 'book-open', 'Reading'], video: ['t-video', 'video-camera', 'Video'], pdf: ['t-pdf', 'file-pdf', 'PDF'], image: ['t-image', 'image', 'Image'], '3d': ['t-3d', 'cube', '3D model'], interactive: ['t-interactive', 'game-controller', 'Interactive'], prep: ['t-prep', 'list-checks', 'Quiz prep'] };
const mix = kinds => `<div class="cs-mix">${Object.entries(kinds).map(([k, n]) => `<span class="${KIND[k][0]}">${i(KIND[k][1])}${n > 1 ? n + ' ' : ''}${KIND[k][2]}</span>`).join('')}</div>`;
const status = s => `<span class="cs-status cs-status--${s}">${s[0].toUpperCase() + s.slice(1)}</span>`;

function moduleCard({ sys, title, desc, st, kinds, lessons, materials, updated, empty }) {
  const [c, art, name] = SYS[sys];
  return `<article class="cs-mod ${st === 'draft' ? 'cs-mod--draft' : ''}" style="--sys:${c}">
    <div class="cs-mod-art"><img src="../assets/img/hero/${art}.webp" alt="">${status(st)}</div>
    <div class="cs-mod-body"><span class="cs-eyebrow">${name}</span><h3 class="cs-h3">${title}</h3>
      ${desc ? `<p class="cs-body cs-clamp">${desc}</p>` : '<p class="cs-body" style="color:var(--cs-faint)">No description yet</p>'}
      ${empty ? `<div class="cs-warn">${i('warning-circle', 'cs-ico--sm')}<span>No lessons yet. Students can’t see this module until it has one published lesson.</span></div>` : mix(kinds)}
    </div>
    <div class="cs-mod-foot"><span class="cs-meta">${lessons} lesson${lessons === 1 ? '' : 's'}${materials ? ` · ${materials} material${materials === 1 ? '' : 's'}` : ''}</span>
      ${empty ? `<button class="cs-btn cs-btn--sm">${i('plus', 'cs-ico--sm')}Add lesson</button>` : `<button class="cs-btn cs-btn--sm">Open${i('arrow-right', 'cs-ico--sm')}</button>`}
      <button class="cs-icon-btn" aria-label="More">${more}</button></div>
  </article>`;
}
const group = (sys, cards) => `<section class="cs-group"><div class="cs-group-head" style="--sys:${SYS[sys][0]}"><span class="cs-sw"></span><h2 class="cs-h2">${SYS[sys][2].replace(' system', '')}</h2><span class="cs-meta">${cards.length} module${cards.length === 1 ? '' : 's'}</span></div><div class="cs-grid">${cards.map(moduleCard).join('')}</div></section>`;

const MODULES_PAGE = `<div class="cs">
  <header class="cs-head page-header" style="margin:0"><div class="page-header-left"><h1>Modules and lessons</h1><p>Build each body system’s lessons, attach handouts and publish when they’re ready.</p></div>
    <div class="cs-actions"><button class="cs-btn cs-btn--primary">${i('plus')}New module</button></div></header>
  <div class="cs-summary"><div><b class="cs-num">5</b><span>modules</span></div><div><b class="cs-num">13</b><span>lessons</span></div><div><i style="background:var(--cs-mint)"></i><b class="cs-num">4</b><span>published</span></div><div><i style="background:var(--cs-amber)"></i><b class="cs-num">1</b><span>draft</span></div></div>
  <div class="cs-toolbar"><label class="cs-search">${i('magnifying-glass')}Search modules and lessons</label>
    <div class="cs-seg"><span class="on">All <em>5</em></span><span>Published <em>4</em></span><span>Draft <em>1</em></span></div>
    <span class="cs-select">All body systems ${i('caret-down', 'cs-ico--sm')}</span></div>
  <div class="cs-grid">${[
    { sys: 'skeletal', title: 'Bones of the Body', desc: 'How the 206 bones of the adult skeleton are grouped, shaped and built, from the skull to the toes.', st: 'published', kinds: { reading: 2, pdf: 1, image: 1, '3d': 1, prep: 1 }, lessons: 6, materials: 2 },
    { sys: 'circulatory', title: 'The Heart and Blood Vessels', desc: 'The four-chambered heart, the vessels that carry blood and the two circuits blood travels every minute.', st: 'published', kinds: { video: 1, reading: 1, pdf: 1, interactive: 1 }, lessons: 4, materials: 1 },
    { sys: 'circulatory', title: 'Introduction to Sample', desc: 'Module Sample', st: 'published', kinds: { pdf: 1 }, lessons: 1, materials: 1 },
    { sys: 'respiratory', title: 'Breathing and the Lungs', desc: 'From the nose to the alveoli: how air reaches the blood.', st: 'draft', kinds: { reading: 2 }, lessons: 2, materials: 0 },
    { sys: 'nervous', title: 'The Brain and Nerves', desc: '', st: 'published', lessons: 0, materials: 0, empty: true },
  ].map(moduleCard).join('')}</div>
</div>`;

const lessonRow = (n, kind, title, meta, st, hover = false) => `<li class="cs-row ${hover ? 'hover' : ''}"><span class="cs-grip">${grip}</span><span class="cs-idx">${n}</span>
  <span class="cs-tile ${KIND[kind][0]}">${i(KIND[kind][1])}</span>
  <span class="cs-row-copy"><span class="cs-row-title">${title}</span><span class="cs-meta">${meta}</span></span>
  <span class="cs-row-actions"><button class="cs-icon-btn" aria-label="Preview">${i('eye')}</button><button class="cs-icon-btn" aria-label="Edit">${i('pencil-simple')}</button><button class="cs-icon-btn" aria-label="More">${more}</button></span>
  ${status(st).replace('cs-status ', 'cs-status cs-status--plain ')}</li>`;

const WORKSPACE = `<div class="cs">
  <a class="cs-crumb" href="#">${i('arrow-left', 'cs-ico--sm')}All modules</a>
  <section class="cs-hero" style="--sys:#3fb8f5"><img src="../assets/img/hero/skeletal.webp" alt="">
    <span class="cs-eyebrow">Skeletal system · Module</span><h2>Bones of the Body</h2>
    <p>How the 206 bones of the adult skeleton are grouped, shaped and built, from the skull to the toes.</p>
    <div class="cs-hero-row">${status('published')}<span class="cs-meta">6 lessons · 51 min · 2 materials · Updated today</span></div>
    <div class="cs-hero-row"><button class="cs-btn cs-btn--sm">${i('pencil-simple', 'cs-ico--sm')}Edit details</button><button class="cs-btn cs-btn--sm cs-btn--ghost">${i('eye', 'cs-ico--sm')}Preview as student</button><button class="cs-btn cs-btn--sm cs-btn--ghost">${i('eye-slash', 'cs-ico--sm')}Unpublish</button></div>
  </section>
  <div class="cs-split">
    <section class="cs-panel"><div class="cs-panel-head"><h2 class="cs-h2">Lessons</h2><span class="cs-meta">Drag to reorder · students see them in this order</span><button class="cs-btn cs-btn--primary cs-btn--sm">${i('plus', 'cs-ico--sm')}Add lesson</button></div>
      <ol class="cs-rows">
        ${lessonRow(1, 'reading', 'What the skeleton does', 'Reading · 8 min', 'published')}
        ${lessonRow(2, 'image', 'Parts of a long bone', 'Reading with image · 6 min', 'published')}
        ${lessonRow(3, 'pdf', 'Axial and appendicular skeleton', 'PDF handout, 2 pages · 12 min', 'published', true)}
        ${lessonRow(4, '3d', 'Explore the skeleton in 3D', '3D model: skeletal layer · 10 min', 'published')}
        ${lessonRow(5, 'prep', 'Review: key bone terms', 'Quiz prep · 5 min', 'published')}
        ${lessonRow(6, 'reading', 'Joints and ligaments', 'Reading · no time set', 'draft')}
      </ol>
      <button class="cs-add-row">${i('plus', 'cs-ico--sm')}Add a lesson</button></section>
    <aside class="cs-side">
      <section class="cs-panel"><div class="cs-panel-head"><h2 class="cs-h2">Materials</h2><span class="cs-meta">2</span><button class="cs-btn cs-btn--sm cs-btn--ghost">${i('upload-simple', 'cs-ico--sm')}Upload</button></div>
        <div style="padding:.375rem">
          <div class="cs-file"><span class="cs-thumb"><canvas data-pdf="../api/files.php?id=6"></canvas></span><span class="cs-row-copy"><span class="cs-row-title" style="font-size:.875rem">Skeletal system reviewer</span><span class="cs-meta">PDF · 3 pages · 88 KB</span></span><button class="cs-icon-btn">${i('eye')}</button></div>
          <div class="cs-file"><span class="cs-thumb cs-thumb--doc">DOCX</span><span class="cs-row-copy"><span class="cs-row-title" style="font-size:.875rem">Bone labeling worksheet</span><span class="cs-meta">Word · 1 KB · downloads</span></span><button class="cs-icon-btn">${i('download-simple')}</button></div>
        </div></section>
      <section class="cs-panel"><div class="cs-panel-head"><h2 class="cs-h2">Quizzes</h2><span class="cs-meta">2 linked</span><button class="cs-icon-btn">${i('plus')}</button></div>
        <div style="padding:.375rem">
          <div class="cs-quiz"><span class="cs-tile q-mc">${i('list-checks')}</span><span class="cs-row-copy"><span class="cs-row-title" style="font-size:.875rem">Skeletal System Basics</span><span class="cs-meta">6 questions · 1 attempt · avg 83%</span></span></div>
          <div class="cs-quiz" style="box-shadow:0 -1px 0 var(--cs-line)"><span class="cs-tile q-id">${i('textbox')}</span><span class="cs-row-copy"><span class="cs-row-title" style="font-size:.875rem">Name That Bone</span><span class="cs-meta">4 questions · due Mon, Nov 16</span></span></div>
        </div></section>
    </aside>
  </div>
</div>`;

const EDITOR = `<div class="cs-scrim"></div><aside class="cs-sheet" style="font-family:var(--font-body)">
  <div class="cs-sheet-head"><div><span class="cs-eyebrow">Bones of the Body · Lesson 3</span><h3>Edit lesson</h3></div><button class="cs-icon-btn">${i('x')}</button></div>
  <div class="cs-sheet-body">
    <div class="cs-field"><label>Title</label><div class="cs-input">Axial and appendicular skeleton</div></div>
    <div class="cs-field"><span class="cs-label">What students get</span>
      <div class="cs-types">
        <div class="cs-type on t-reading">${i('book-open')}Reading</div><div class="cs-type t-video">${i('video-camera')}Video</div>
        <div class="cs-type t-3d">${i('cube')}3D model</div><div class="cs-type t-interactive">${i('game-controller')}Interactive</div><div class="cs-type t-prep">${i('list-checks')}Quiz prep</div>
      </div></div>
    <div class="cs-field"><span class="cs-label">Attachment</span>
      <div class="cs-attach"><span class="cs-thumb" style="width:3.25rem;height:4.25rem"><canvas data-pdf="../uploads/lessons/demo-skeletal-handout.pdf"></canvas></span>
        <div><div class="cs-row-title" style="font-size:.875rem">skeletal-handout.pdf</div><div class="cs-meta">PDF · 2 pages · 294 KB · opens in the lesson viewer</div></div>
        <button class="cs-btn cs-btn--sm">Replace</button><button class="cs-icon-btn" aria-label="Remove">${i('trash')}</button></div>
      <div class="cs-drop">${i('cloud-arrow-up')}<span>Or drop a PDF, video (MP4, WebM), image or GLB model here. Max 500 MB.</span></div></div>
    <div class="cs-field"><label>Lesson text</label><div class="cs-input cs-input--area">Read the handout, then answer the three Check yourself questions on its last page.</div></div>
    <div class="cs-two"><div class="cs-field"><label>Time to study</label><div class="cs-input">12 <span class="cs-meta">minutes</span></div></div>
      <div class="cs-field"><span class="cs-label">Visible to students</span><div class="cs-input" style="background:none;box-shadow:none;padding-left:0"><span class="cs-switch"><i></i>Published</span></div></div></div>
  </div>
  <div class="cs-sheet-foot"><span class="cs-meta">Saved 2 min ago</span><button class="cs-btn">Cancel</button><button class="cs-btn cs-btn--primary">Save lesson</button></div>
</aside>`;

const viewer = (url, title, pages, rail = true) => `<div class="pv">
  <div class="pv-bar"><span class="pv-name">${i('file-pdf')}<b>${title}</b><span class="cs-meta">PDF · ${pages} pages</span></span>
    <span class="pv-pages"><button class="cs-icon-btn">${i('arrow-left', 'cs-ico--sm')}</button><b>1</b>of ${pages}<button class="cs-icon-btn">${i('arrow-right', 'cs-ico--sm')}</button></span><span class="pv-sep"></span>
    <button class="cs-icon-btn">${i('magnifying-glass-minus')}</button><span class="pv-zoom">Fit width</span><button class="cs-icon-btn">${i('magnifying-glass-plus')}</button><span class="pv-sep"></span>
    <button class="cs-icon-btn">${i('download-simple')}</button><button class="cs-icon-btn">${i('corners-out')}</button></div>
  <div class="pv-body" style="${rail ? '' : 'grid-template-columns:1fr'}">${rail ? `<div class="pv-rail">${Array.from({ length: pages }, (_, n) => `<figure class="${n ? '' : 'on'}"><canvas data-pdf="${url}" data-page="${n + 1}" data-w="180"></canvas>${n + 1}</figure>`).join('')}</div>` : ''}
    <div class="pv-stage"><canvas data-pdf="${url}" data-page="1" data-w="1300"></canvas></div></div>
</div>`;

const QT = { 'Multiple choice': ['list-checks', 'q-mc'], 'True/false': ['toggle-left', 'q-tf'], Identification: ['textbox', 'q-id'], Hotspot: ['crosshair', 'q-hs'] };
const qmix = mixes => {
  const parts = mixes.map(m => { const [, n, label] = m.match(/^(\d+) (.+)$/); return [Number(n), label]; });
  const total = parts.reduce((s, [n]) => s + n, 0);
  return `<span class="cs-qtotal"><b>${total}</b> question${total === 1 ? '' : 's'}</span>${parts.map(([n, label]) => `<span class="cs-qchip ${QT[label][1]}" title="${label}">${i(QT[label][0], 'cs-ico--sm')}${n}</span>`).join('')}`;
};
// No assessment type: the label and tile come from the questions inside (one type → that type, several → Mixed).
const kindOf = mixes => {
  const labels = mixes.map(m => m.replace(/^\d+ /, ''));
  if (labels.length > 1) return ['q-mixed', 'stack', 'Mixed questions'];
  const [ico, q] = QT[labels[0]];
  return [q, ico, { 'True/false': 'True or false' }[labels[0]] || labels[0]];
};
const arow = ({ sys, title, mixes, meta, due, dueCls, result, st, primary }) => { const [q, ico, type] = kindOf(mixes); return `<article class="cs-arow" style="--sys:${sys ? SYS[sys][0] : '#8f8f8f'}">
  <span class="cs-tile ${q}">${i(ico)}</span>
  <div class="cs-acopy"><span class="cs-eyebrow">${sys ? '<i></i>' + SYS[sys][2] : 'All body systems'}</span><h3 class="cs-h3">${title}</h3><span class="cs-meta">${meta}</span></div>
  <div class="cs-qmix">${qmix(mixes)}</div>
  <div class="cs-due ${dueCls || ''}"><span class="cs-meta">${due[0]}</span><b>${due[1]}</b></div>
  <div class="cs-result">${result}</div>
  <div class="cs-aend">${status(st).replace('cs-status ', 'cs-status cs-status--plain ')}<button class="cs-btn cs-btn--sm">${primary}</button><button class="cs-icon-btn">${more}</button></div>
</article>`; };
const res = (n, avg) => n ? `<span class="cs-meta">${n} attempt${n === 1 ? '' : 's'} · avg <b style="color:var(--cs-ink)">${avg}%</b></span><span class="bar ${avg < 75 ? 'low' : ''}"><i style="width:${avg}%"></i></span>` : '<span class="cs-meta">No attempts yet</span>';
const sectionHead = (t, n) => `<div class="cs-group-head" style="margin-top:.5rem"><h2 class="cs-h2">${t}</h2><span class="cs-meta" style="margin-left:0">${n}</span></div>`;

const ASSESS_PAGE = `<div class="cs">
  <header class="cs-head page-header" style="margin:0"><div class="page-header-left"><h1>Assessments</h1><p>Mix any question types in one assessment. Students see only the ones that are open.</p></div>
    <div class="cs-actions"><button class="cs-btn cs-btn--primary">${i('plus')}New assessment</button></div></header>
  <div class="cs-summary"><div><i style="background:var(--cs-mint)"></i><b class="cs-num">4</b><span>open</span></div><div><i style="background:var(--cs-amber)"></i><b class="cs-num">1</b><span>draft</span></div><div><i style="background:var(--cs-faint)"></i><b class="cs-num">1</b><span>closed</span></div><div><b class="cs-num">3</b><span>attempts</span></div></div>
  <div class="cs-toolbar"><label class="cs-search">${i('magnifying-glass')}Search assessments</label>
    <span class="cs-select">All body systems ${i('caret-down', 'cs-ico--sm')}</span></div>
  <div class="cs-alist">
    ${sectionHead('Open now', '4')}
    ${arow({ sys: null, title: 'Find the Structure', mixes: ['3 Hotspot'], meta: '8 min · pass 67% · 3 tries', due: ['Due', 'Fri, Nov 13 · in 2 days'], dueCls: 'cs-due--soon', result: res(0), st: 'active', primary: 'Questions' })}
    ${arow({ sys: 'skeletal', title: 'Name That Bone', mixes: ['4 Identification'], meta: '10 min · pass 70% · 2 tries', due: ['Due', 'Mon, Nov 16'], result: res(0), st: 'active', primary: 'Questions' })}
    ${arow({ sys: 'skeletal', title: 'Skeletal System Basics', mixes: ['4 Multiple choice', '2 True/false'], meta: '15 min · pass 75% · 3 tries', due: ['Due', 'No due date'], dueCls: 'cs-due--past', result: res(1, 83), st: 'active', primary: 'Questions' })}
    ${arow({ sys: 'circulatory', title: 'Labeled', mixes: ['2 True/false'], meta: '30 min · pass 75% · 3 tries', due: ['Due', 'No due date'], dueCls: 'cs-due--past', result: res(2, 100), st: 'active', primary: 'Questions' })}
    ${sectionHead('Drafts', '1')}
    ${arow({ sys: 'circulatory', title: 'Heart and Vessels Check', mixes: ['1 Multiple choice', '1 True/false', '1 Identification', '1 Hotspot'], meta: '20 min · pass 75% · 2 tries', due: ['Due', 'Sat, Nov 21'], result: '<span class="cs-meta">Not published</span>', st: 'draft', primary: 'Questions' })}
    ${sectionHead('Closed', '1')}
    ${arow({ sys: 'respiratory', title: 'Breathing Review', mixes: ['2 Multiple choice', '1 True/false'], meta: '10 min · pass 75% · 1 try', due: ['Closed', 'Sun, Nov 8'], dueCls: 'cs-due--past', result: res(0), st: 'closed', primary: 'Questions' })}
  </div>
</div>`;

// New assessment: no type to pick; question types are chosen per question afterwards.
const NEW_ASSESSMENT = `<div class="cs-scrim"></div><aside class="cs-sheet" style="font-family:var(--font-body)">
  <div class="cs-sheet-head"><div><span class="cs-eyebrow">Assessments</span><h3>New assessment</h3></div><button class="cs-icon-btn">${i('x')}</button></div>
  <div class="cs-sheet-body">
    <div class="cs-field"><label>Title</label><div class="cs-input">Heart and Vessels Check</div></div>
    <div class="cs-two"><div class="cs-field"><label>Body system</label><div class="cs-input">Circulatory system <span class="cs-meta">${i('caret-down', 'cs-ico--sm')}</span></div></div>
      <div class="cs-field"><label>Module <span class="cs-meta">(optional)</span></label><div class="cs-input">The Heart and Blood Vessels <span class="cs-meta">${i('caret-down', 'cs-ico--sm')}</span></div></div></div>
    <div class="cs-field"><label>Instructions for students</label><div class="cs-input cs-input--area" style="min-height:5rem">Answer every question. You can go back before you submit.</div></div>
    <div class="cs-two"><div class="cs-field"><label>Time limit</label><div class="cs-input">20 <span class="cs-meta">minutes</span></div></div>
      <div class="cs-field"><label>Pass mark</label><div class="cs-input">75 <span class="cs-meta">%</span></div></div></div>
    <div class="cs-two"><div class="cs-field"><label>Tries per student</label><div class="cs-input">2</div></div>
      <div class="cs-field"><label>Due</label><div class="cs-input">Sat, Nov 21 · 11:59 PM <span class="cs-meta">${i('calendar', 'cs-ico--sm')}</span></div></div></div>
    <div class="cs-field"><span class="cs-label">Questions</span>
      <div class="cs-attach" style="align-items:flex-start"><span class="cs-tile q-mixed">${i('stack')}</span><div><div class="cs-row-title" style="font-size:.875rem">Any mix of question types</div>
        <div class="cs-meta" style="margin-top:.25rem">After you create it, add multiple choice, true or false, identification and hotspot questions in any order.</div>
        <div class="cs-qmix" style="margin-top:.625rem"><span class="cs-qchip q-mc">${i('list-checks', 'cs-ico--sm')}Multiple choice</span><span class="cs-qchip q-tf">${i('toggle-left', 'cs-ico--sm')}True or false</span><span class="cs-qchip q-id">${i('textbox', 'cs-ico--sm')}Identification</span><span class="cs-qchip q-hs">${i('crosshair', 'cs-ico--sm')}Hotspot</span></div></div></div></div>
  </div>
  <div class="cs-sheet-foot"><span class="cs-meta">Saved as a draft</span><button class="cs-btn">Cancel</button><button class="cs-btn cs-btn--primary">Create and add questions</button></div>
</aside>`;

const opt = (t, ok) => `<div class="cs-opt ${ok ? 'ok' : ''}">${ok ? i('check-circle') : '<i></i>'}${t}${ok ? '<em>Correct</em>' : ''}</div>`;
const qcard = (n, cls, ico, type, text, body) => `<article class="cs-q"><div class="cs-q-top"><span class="cs-q-n">${n}</span><span class="cs-qtype ${cls}">${i(ico, 'cs-ico--sm')}${type}</span><span class="cs-meta">1 point</span>
  <button class="cs-icon-btn" aria-label="More">${more}</button></div><p class="cs-q-text">${text}</p>${body}</article>`;
const BUILDER = `<div class="cs-scrim"></div><div class="cs-modal" style="font-family:var(--font-body)">
  <div class="cs-sheet-head"><div><span class="cs-eyebrow">Skeletal system</span><h3>Skeletal System Basics</h3></div><button class="cs-icon-btn">${i('x')}</button></div>
  <div class="cs-sheet-body">
    <div class="cs-qhead"><div><span class="cs-meta">Questions</span><b>6</b></div><div><span class="cs-meta">Points</span><b>6</b></div><div><span class="cs-meta">Time</span><b>15 min</b></div><div><span class="cs-meta">Pass mark</span><b>75%</b></div><div><span class="cs-meta">Status</span><b style="color:var(--cs-mint)">Open</b></div></div>
    <div class="cs-lock">${i('lock-key')}<span>1 student has taken this assessment, so its questions are locked to keep past results fair.</span><a href="#">Duplicate to edit</a></div>
    ${qcard(1, 'q-mc', 'list-checks', 'Multiple choice', 'How many bones are in the adult human skeleton?', `<div class="cs-opts">${opt('106')}${opt('206', 1)}${opt('256')}${opt('306')}</div>`)}
    ${qcard(2, 'q-mc', 'list-checks', 'Multiple choice', 'Which bone protects the brain?', `<div class="cs-opts">${opt('Sternum')}${opt('Pelvis')}${opt('Skull', 1)}${opt('Scapula')}</div>`)}
    ${qcard(5, 'q-tf', 'toggle-left', 'True or false', 'The sternum is part of the appendicular skeleton.', `<div class="cs-opts">${opt('True')}${opt('False', 1)}</div>`)}
    ${qcard('·', 'q-hs', 'crosshair', 'Hotspot', 'Click the sternum (breastbone). <span class="cs-meta">· example from Find the Structure</span>', `<div class="cs-hs"><figure><img src="../assets/img/hero/skeletal.webp" alt=""><b style="left:46%;top:58%;width:1.25rem;height:1.25rem"></b></figure><div class="cs-row-copy"><span class="cs-answer">${i('crosshair', 'cs-ico--sm')}Target: Sternum</span><span class="cs-meta">Tolerance 7% of the picture · students see only the picture and the question</span></div></div>`)}
    ${qcard('·', 'q-id', 'textbox', 'Identification', 'The thigh bone, the longest bone in the body <span class="cs-meta">· example from Name That Bone</span>', `<span class="cs-answer">${i('check-circle', 'cs-ico--sm')}Answer: Femur <span class="cs-meta">· capital letters ignored</span></span>`)}
  </div>
  <div class="cs-sheet-foot"><span class="cs-meta">Showing 3 of 6, plus 2 examples of the other types</span><button class="cs-btn">Close</button><button class="cs-btn cs-btn--primary" disabled style="opacity:.45">${i('plus', 'cs-ico--sm')}Add question</button></div>
</div>`;

// ── Browser work ────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
async function session(role, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss());
  page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => m.text().startsWith('pages') && console.log(m.text()));
  const { user, pass } = cred(role);
  await page.goto(`${BASE}/login.html`);
  await page.fill('#username', user); await page.fill('#password', pass);
  await page.evaluate(() => handleLogin());
  await page.waitForURL(/\/(teacher|student)\//, { timeout: 15000 });
  return { ctx, page };
}
async function inject(page, path, html, overlay = '') {
  await page.goto(`${BASE}/${path}`); await page.waitForTimeout(1200);
  await page.evaluate(([css, html, overlay]) => {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    document.querySelector('.page-content').innerHTML = html;
    if (overlay) document.body.insertAdjacentHTML('beforeend', overlay);
  }, [CSS, html, overlay]);
  await renderPdfs(page);
}
async function renderPdfs(page) {
  await page.evaluate(async () => {
    const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const docs = {};
    for (const c of document.querySelectorAll('canvas[data-pdf]')) {
      const url = c.dataset.pdf; docs[url] ??= lib.getDocument(url).promise;
      const pdf = await docs[url], n = Number(c.dataset.page || 1);
      console.log(`pages ${url} ${pdf.numPages}`);
      if (n > pdf.numPages) { c.closest('figure')?.remove(); continue; }
      const pg = await pdf.getPage(n);
      const base = pg.getViewport({ scale: 1 }), w = Number(c.dataset.w || 160), vp = pg.getViewport({ scale: w / base.width });
      c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  });
  await page.waitForTimeout(400);
}
// Full-page shots grow the viewport instead, so the fixed sheet frame wraps the whole page.
async function shot(page, name, full = false) {
  const vp = page.viewportSize();
  if (full) await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, await page.evaluate(() => document.documentElement.scrollHeight)) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/after-${name}.png` });
  if (full) await page.setViewportSize(vp);
}

{
  const { ctx, page } = await session('Admin');
  await inject(page, 'teacher/modules.html', MODULES_PAGE); await shot(page, '01-teacher-modules', true);
  await inject(page, 'teacher/modules.html', WORKSPACE); await shot(page, '02-module-workspace', true);
  await inject(page, 'teacher/modules.html', WORKSPACE, EDITOR); await shot(page, '03-lesson-editor');
  await inject(page, 'teacher/modules.html', WORKSPACE, `<div style="position:fixed;inset:0;padding:1rem 1.25rem 1.25rem;background:#0b0b0b;z-index:2001;display:flex;flex-direction:column;font-family:var(--font-body)"><div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem;color:#f5f5f5"><span class="cs-eyebrow" style="margin-right:auto">Bones of the Body · Materials</span><button class="cs-btn cs-btn--sm">${i('x', 'cs-ico--sm')}Close</button></div><div style="flex:1;min-height:0;display:flex">${viewer('../api/files.php?id=6', 'Skeletal system reviewer', 3).replace('class="pv"', 'class="pv" style="flex:1"')}</div></div>`);
  await shot(page, '05-materials-pdf-viewer');
  await inject(page, 'teacher/assessments.html', ASSESS_PAGE); await shot(page, '06-teacher-assessments', true);
  await inject(page, 'teacher/assessments.html', ASSESS_PAGE, BUILDER); await shot(page, '07-question-builder');
  await inject(page, 'teacher/assessments.html', ASSESS_PAGE, NEW_ASSESSMENT); await shot(page, '09-new-assessment');
  await ctx.close();
}
{
  const { ctx, page } = await session('Student');
  await page.goto(`${BASE}/student/lessons.html`); await page.waitForTimeout(1200);
  const mid = await page.evaluate(() => allModules.find(m => m.title === 'Bones of the Body').module_id);
  await page.evaluate(id => viewModule(id), mid); await page.waitForTimeout(1200);
  await page.click('.sd-lesson >> text=Axial and appendicular skeleton'); await page.waitForTimeout(1500);
  await page.evaluate(([css, html]) => {
    const s = document.createElement('style'); s.textContent = css + '.sd-reader-doc{max-width:60rem}.sd-reader-media{margin:1.5rem 0}.pv-stage{max-height:none}';
    document.head.appendChild(s);
    document.querySelector('.sd-reader-media').innerHTML = html;
  }, [CSS, viewer('../uploads/lessons/demo-skeletal-handout.pdf', 'Axial and appendicular skeleton', 2, false)]);
  await renderPdfs(page);
  await shot(page, '04-student-pdf-lesson');
  await ctx.close();
}
{
  const { ctx, page } = await session('Admin', { width: 390, height: 844 });
  await inject(page, 'teacher/modules.html', MODULES_PAGE); await shot(page, '08-teacher-modules-phone', true);
  await ctx.close();
}
await browser.close();
console.log('ok');
