// File-first lesson mockups (2026-11-12): student lesson list as file cards, a PDF opened with the
// teacher's note, and the file-first lesson editor. Real pages from a worktree server, content injected.
//   node docs/superpowers/specs/assets/2026-11-11-content-redesign/mockup/capture-files.mjs
import { chromium } from 'file:///C:/xampp/htdocs/Anthropotomy/landing-src/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../', import.meta.url));
const BASE = 'http://127.0.0.1:8092';
const acct = readFileSync('C:/xampp/htdocs/Anthropotomy/demo users account.txt', 'utf8');
const cred = role => { const b = acct.split(/\r?\n\r?\n/).find(x => x.trim().startsWith(role)); return { user: b.match(/Username:\s*(\S+)/)[1], pass: b.match(/Password:\s*(\S+)/)[1] }; };
const server = spawn('C:/xampp/php/php.exe', ['-S', '127.0.0.1:8092', 'tests/router.php'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const SPRITE = '../assets/icons/interface.svg?v=20261111-icons4';
const i = (name, cls = '') => `<svg class="fl-ico ${cls}" viewBox="0 0 256 256" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;
const PDF_A = '../uploads/lessons/demo-skeletal-handout.pdf', PDF_B = '../uploads/lessons/demo-cardiac-cycle.pdf';
const ci = name => `<svg class="cs-ico" viewBox="0 0 256 256" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;

const STUDENT_CSS = `
.fl-ico{width:1.1rem;height:1.1rem;fill:currentColor;flex:none}
.fl-list{display:flex;flex-direction:column;gap:.5rem;margin-top:.25rem}
.fl-card{display:flex;align-items:center;gap:1rem;padding:.75rem .875rem .75rem .75rem;border-radius:1rem;background:#1f1f1f;color:#f5f5f5;text-align:left;border:0;width:100%;font:inherit;cursor:pointer}
.fl-card:hover{background:#262626}
.fl-num{width:1.5rem;font-size:.8125rem;font-weight:700;color:#8c8c8c;text-align:center;flex:none}
.fl-thumb{width:3.25rem;height:4.25rem;border-radius:.375rem;flex:none;overflow:hidden;display:grid;place-items:center;box-shadow:0 8px 18px -8px rgba(0,0,0,.7)}
.fl-thumb canvas{width:100%;height:100%;object-fit:cover;background:#fff}
.fl-thumb--ppt{background:#c4462b;color:#fff;font:800 .625rem/1 system-ui}
.fl-thumb--doc{background:#2b5797;color:#fff;font:800 .625rem/1 system-ui}
.fl-thumb span{display:flex;flex-direction:column;align-items:center;gap:.3rem}
.fl-thumb .fl-ico{width:1.35rem;height:1.35rem}
.fl-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:.25rem}
.fl-title{font-size:.9375rem;font-weight:650;line-height:1.3}
.fl-meta{font-size:.8125rem;color:#a3a3a3;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.fl-meta b{color:#d4d4d4;font-weight:600}
.fl-go{display:inline-flex;align-items:center;gap:.4rem;padding:.5rem .875rem;border-radius:999px;background:#2b2b2b;font-size:.8125rem;font-weight:700;color:#f5f5f5;flex:none}
.fl-go--file{background:transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.16)}
.fl-hint{margin:.75rem 0 0;font-size:.8125rem;color:#8c8c8c;display:flex;gap:.5rem;align-items:center}
.pv-note{display:flex;gap:.75rem;align-items:flex-start;padding:.75rem 1rem;background:#1b1f1e;box-shadow:0 1px 0 rgba(255,255,255,.07);color:#d9d9d9;font-size:.875rem;line-height:1.5}
.pv-note .fl-ico{color:#36e2c0;margin-top:.15rem}
.pv-note b{color:#f5f5f5}
.pv-note button{margin-left:auto;background:none;border:0;color:#8c8c8c;font:inherit;font-size:.8125rem;cursor:pointer}`;

const card = (n, kind, title, meta, url) => {
  const thumb = kind === 'pdf' ? `<span class="fl-thumb"><canvas data-pdf="${url}"></canvas></span>`
    : `<span class="fl-thumb fl-thumb--${kind}"><span>${i(kind === 'ppt' ? 'presentation-chart' : 'file-text')}${kind === 'ppt' ? 'PPTX' : 'DOCX'}</span></span>`;
  const go = kind === 'pdf' ? `<span class="fl-go">Read${i('arrow-right', 'fl-ico--sm')}</span>`
    : `<span class="fl-go fl-go--file">${i('download-simple')}Download</span>`;
  return `<button class="fl-card"><span class="fl-num">${n}</span>${thumb}<span class="fl-copy"><span class="fl-title">${title}</span><span class="fl-meta">${meta}</span></span>${go}</button>`;
};
const LIST = `<div class="fl-list">
  ${card(1, 'pdf', 'What the skeleton does', '<b>PDF</b> · 6 pages · 8 min', PDF_B)}
  ${card(2, 'ppt', 'Parts of a long bone', '<b>PowerPoint</b> · opens in PowerPoint · 6 min')}
  ${card(3, 'pdf', 'Axial and appendicular skeleton', '<b>PDF</b> · 2 pages · 12 min', PDF_A)}
  ${card(4, 'doc', 'Bone labeling worksheet', '<b>Word</b> · opens in Word · 10 min')}
  ${card(5, 'pdf', 'Review: key bone terms', '<b>PDF</b> · 3 pages · 5 min', PDF_A)}
</div>
<p class="fl-hint">${i('info')}PDFs open here. PowerPoint and Word files download and open in the app on your device.</p>`;

const EDITOR = `<div class="cs-scrim"></div><aside class="cs-sheet" role="dialog" style="font-family:var(--font-body)">
  <div class="cs-sheet-head"><div><span class="cs-eyebrow">Bones of the Body · Lesson 3</span><h3>Add lesson</h3></div><button class="cs-icon-btn">${ci('x')}</button></div>
  <div class="cs-sheet-body">
    <div class="cs-field"><span class="cs-label">Lesson file</span>
      <div class="cs-attach" style="padding:1rem"><span class="cs-thumb" style="width:4rem;height:5.25rem"><canvas data-pdf="${PDF_A}"></canvas></span>
        <div><div class="cs-row-title" style="font-size:.9375rem">axial-and-appendicular-skeleton.pdf</div><div class="cs-meta">PDF · 2 pages · 294 KB</div><div class="cs-meta" style="margin-top:.35rem;color:#36e2c0">Students read it here in the viewer</div></div>
        <button class="cs-btn cs-btn--sm">Replace</button><button class="cs-icon-btn" aria-label="Remove">${ci('trash')}</button></div>
      <span class="cs-meta">PDF, PowerPoint (.ppt, .pptx) or Word (.doc, .docx), up to 500 MB. Drop a file on this panel to replace it.</span></div>
    <div class="cs-field"><label>Title</label><div class="cs-input">Axial and appendicular skeleton</div><span class="cs-meta">Filled in from the file name. Change it if you like.</span></div>
    <div class="cs-field"><label>Note for students <span class="cs-meta">(optional)</span></label><div class="cs-input cs-input--area" style="min-height:5rem">Read pages 1 and 2, then answer the Check yourself questions at the end.</div><span class="cs-meta">Shown above the file when a student opens it.</span></div>
    <div class="cs-two"><div class="cs-field"><label>Time to study</label><div class="cs-input">12 <span class="cs-meta">minutes</span></div></div>
      <div class="cs-field"><span class="cs-label">Visible to students</span><div class="cs-input" style="background:none;box-shadow:none;padding-left:0"><span class="cs-switch"><i></i>Published</span></div></div></div>
  </div>
  <div class="cs-sheet-foot"><span class="cs-meta"></span><button class="cs-btn">Cancel</button><button class="cs-btn cs-btn--primary">Add lesson</button></div>
</aside>`;

async function thumbs(page) {
  await page.evaluate(async () => {
    for (const c of document.querySelectorAll('canvas[data-pdf]')) await PdfViewer.thumbnail(c, c.dataset.pdf);
  });
  await page.waitForTimeout(500);
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
async function session(role) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss());
  const { user, pass } = cred(role);
  await page.goto(`${BASE}/login.html`);
  await page.fill('#username', user); await page.fill('#password', pass);
  await page.evaluate(() => handleLogin());
  await page.waitForURL(/\/(teacher|student)\//, { timeout: 15000 });
  return { ctx, page };
}
try {
  {
    const { ctx, page } = await session('Student');
    await page.goto(`${BASE}/student/lessons.html`); await page.waitForTimeout(1500);
    const mid = await page.evaluate(() => allModules.find(m => m.title === 'Bones of the Body').module_id);
    await page.evaluate(id => viewModule(id), mid); await page.waitForTimeout(1500);
    await page.evaluate(([css, html]) => {
      const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
      document.querySelector('#lessonModalBody .sd-lessons').outerHTML = html;
      document.querySelector('.sd-materials-title')?.remove();
      document.querySelectorAll('#lessonModalBody .sd-lessons').forEach(e => e.remove());
    }, [STUDENT_CSS, LIST]);
    await thumbs(page);
    await page.screenshot({ path: `${DIR}/files-01-student-lesson-list.png` });
    await page.evaluate(() => closeModal('lessonModal'));
    await page.evaluate(([url, css]) => {
      PdfViewer.open({ url, title: 'Axial and appendicular skeleton', context: 'Bones of the Body · Lesson 3' });
    }, [PDF_A, STUDENT_CSS]);
    await page.waitForTimeout(2500);
    await page.evaluate(svg => {
      const bar = document.querySelector('.pv-overlay .pv-bar') || document.querySelector('.pv-bar');
      bar.insertAdjacentHTML('afterend', `<div class="pv-note">${svg}<span><b>Note from your teacher:</b> Read pages 1 and 2, then answer the Check yourself questions at the end.</span><button>Hide</button></div>`);
    }, i('chat-text').replace('chat-text', 'info'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}/files-02-student-pdf-with-note.png` });
    await ctx.close();
  }
  {
    const { ctx, page } = await session('Admin');
    await page.goto(`${BASE}/teacher/modules.html`); await page.waitForTimeout(1500);
    const mid = await page.evaluate(() => allModules.find(m => m.title === 'Bones of the Body').module_id);
    await page.goto(`${BASE}/teacher/modules.html?module=${mid}`); await page.waitForTimeout(2000);
    await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), EDITOR);
    await thumbs(page);
    await page.screenshot({ path: `${DIR}/files-03-teacher-file-first-editor.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('ok');
