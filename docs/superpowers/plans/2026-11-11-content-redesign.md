# Teacher Content Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the teacher Modules and Assessments pages with one visual hierarchy and real editors, and replace every raw PDF tab and iframe with one in-app PDF viewer.

**Architecture:** Plain HTML pages with inline scripts, as today. Shared behaviour moves into small classic scripts with one global each (`ContentFormat`, `Studio`, `PdfViewer`, `LessonReader`); shared styles into `content-studio.css` and `pdf-viewer.css`. The PHP APIs gain a few fields and endpoints; one migration fixes the hotspot type.

**Tech Stack:** PHP 8.1 + MariaDB (XAMPP), vanilla JS, pdf.js 4.10.38 vendored, Node `node --test` for unit tests, the existing CDP-driven `tests/integration.mjs` and `tests/browser.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-11-content-redesign-design.md`. Mockups and before/after images: `docs/superpowers/specs/assets/2026-11-11-content-redesign/` (`after.css` in `mockup/` is the reference for every style value).

## Global Constraints

- Stage palette only: page `#121212`, card `#191919`, inset `#202020`, raised `#282828`, hover `#313131`, mint `#36e2c0`, amber `#f5b544`, hairline `rgba(255,255,255,.07)`. No new colours, no light theme, no blur or glow.
- Page titles stay Bungee; everything else Geist (already loaded by `minimal-portal.css`).
- One mint primary button per region. Archive, delete, pause, close and duplicate live in a "more" menu and confirm with `confirmToast` from `app.js`.
- Phosphor icons from `assets/icons/interface.svg` only; after Task 6 every reference uses `?v=20261111-icons4`.
- No CDN at runtime: pdf.js is served from `assets/vendor/pdfjs/`.
- Pages must work at 390 px wide with no horizontal scroll.
- Assessments have no type. Never read, write, filter on or show `assessment_type`; every label, icon and filter for an assessment comes from its questions (`question_types`).
- Copy: sentence case, plain words, no exclamation marks ("Lesson saved.", not "Lesson added successfully!").
- Every commit title ends with the date in parentheses, e.g. `Modules: workspace view (2026-11-12)`, then the Co-Authored-By line. Push fast-forward to `main` at the end of each task.

## Review Focus

1. **A long PDF (60 pages, 40 MB).** Expect the first page within a second or two and no frozen tab: pages render only as they near the viewport. Test in Task 4.
2. **Reorder against a stale list** (another tab added or deleted a lesson). Expect 422 and the workspace reloads the list, never a half-applied order. Test in Task 3.
3. **A failed attachment replace** (wrong file type, upload error). Expect the lesson to keep its old file and URL. Test in Task 3.
4. **Closing an editor with unsaved changes** (Escape, scrim click, Close). Expect a confirm before anything is lost. Test in Task 8.
5. **Demo content shipped to hosting.** Expect the hosting export scripts to stop while `app_settings.demo_seed` exists. Done in Task 12.

---

### Task 1: Content format helpers

**Files:**
- Create: `assets/js/content-format.js`
- Create: `tests/unit/content-format.test.mjs`
- Modify: `assets/js/student-portal.js:9-19` (delete `CARD_COLOURS`, `SYSTEM_LOOKS`, `systemLook`; they move here)
- Modify: every page that loads `student-portal.js` (`student/anatomy, dashboard, games, lessons, notifications, progress, quiz, settings .html`): add `<script src="../assets/js/content-format.js?v=20261111-cf1"></script>` before it

**Interfaces:**
- Produces (global `ContentFormat`, also `module.exports` when `module` exists, so Node can `require` it):
  - `SYSTEM_LOOKS`: same entries as today except `circulatory: ['coral', 'circulatory']`
  - `systemLook(code: string) → {tone, colour, art}`; unknown code → sky, `art: null`
  - `KINDS`: ordered `{reading, video, pdf, image, 3d, interactive, prep}` each `{label, icon}`: Reading/`book-open`, Video/`video-camera`, PDF/`file-pdf`, Image/`image`, 3D model/`cube`, Interactive/`game-controller`, Quiz prep/`list-checks`
  - `lessonKind({lesson_type, media_url}) → keyof KINDS`
  - `kindCounts(lessons) → [{kind, label, icon, count}]` in `KINDS` order, zero counts left out
  - `assessmentKind(questionTypes: {[type]: number}) → {label, icon, tone}`: one type → that type's label and icon, `tone` = the type key; several → `{label: 'Mixed questions', icon: 'stack', tone: 'mixed'}`; none → `{label: 'No questions yet', icon: 'exam', tone: 'empty'}`
  - `QUESTION_TYPES`: ordered `{multiple_choice: Multiple choice/list-checks, true_false: True or false/toggle-left, identification: Identification/textbox, hotspot: Hotspot/crosshair}`
  - `questionMix(counts: {[type]: number}) → {total, parts: [{type, label, icon, count}]}`
  - `dueLabel(due: string|null, now: Date) → {label, tone: 'none'|'soon'|'later'|'past'}`

- [ ] **Step 1: Write the failing tests** in `tests/unit/content-format.test.mjs` (load with `createRequire(import.meta.url)('../../assets/js/content-format.js')`):

```js
test('lessonKind reads the attachment before the type', () => {
  assert.equal(lessonKind({lesson_type: 'reading', media_url: null}), 'reading');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../uploads/lessons/a.PDF?v=2'}), 'pdf');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: '../assets/img/hero/skeletal.webp'}), 'image');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: 'x.mp4'}), 'video');
  assert.equal(lessonKind({lesson_type: 'video', media_url: null}), 'video');
  assert.equal(lessonKind({lesson_type: 'reading', media_url: 'skeletal.glb'}), '3d');
  assert.equal(lessonKind({lesson_type: '3d_model', media_url: null}), '3d');
  assert.equal(lessonKind({lesson_type: 'interactive', media_url: null}), 'interactive');
  assert.equal(lessonKind({lesson_type: 'quiz_prep', media_url: null}), 'prep');
});
test('kindCounts keeps KINDS order and drops zeros', () => {
  const lessons = [{lesson_type: 'quiz_prep'}, {lesson_type: 'reading'}, {lesson_type: 'reading', media_url: 'a.pdf'}, {lesson_type: 'reading'}];
  assert.deepEqual(kindCounts(lessons).map(k => [k.kind, k.count]), [['reading', 2], ['pdf', 1], ['prep', 1]]);
});
test('assessmentKind comes from the questions, not a type', () => {
  assert.deepEqual(assessmentKind({identification: 4}), {label: 'Identification', icon: 'textbox', tone: 'identification'});
  assert.deepEqual(assessmentKind({hotspot: 3, true_false: 0}), {label: 'Hotspot', icon: 'crosshair', tone: 'hotspot'});
  assert.deepEqual(assessmentKind({multiple_choice: 4, true_false: 2}), {label: 'Mixed questions', icon: 'stack', tone: 'mixed'});
  assert.deepEqual(assessmentKind({}), {label: 'No questions yet', icon: 'exam', tone: 'empty'});
});
test('questionMix totals and orders parts', () => {
  const mix = questionMix({hotspot: 1, multiple_choice: 4, true_false: 2});
  assert.equal(mix.total, 7);
  assert.deepEqual(mix.parts.map(p => [p.type, p.count]), [['multiple_choice', 4], ['true_false', 2], ['hotspot', 1]]);
});
test('dueLabel counts calendar days in local time', () => {
  const now = new Date(2026, 10, 11, 10, 0);            // Wed, Nov 11 2026, 10:00
  assert.deepEqual(dueLabel(null, now), {label: 'No due date', tone: 'none'});
  assert.deepEqual(dueLabel('2026-11-11 23:59:00', now), {label: 'Wed, Nov 11 · today', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-12 23:59:00', now), {label: 'Thu, Nov 12 · tomorrow', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-13 23:59:00', now), {label: 'Fri, Nov 13 · in 2 days', tone: 'soon'});
  assert.deepEqual(dueLabel('2026-11-14 23:59:00', now), {label: 'Sat, Nov 14', tone: 'later'});
  assert.deepEqual(dueLabel('2026-11-11 08:00:00', now), {label: 'Wed, Nov 11', tone: 'past'});
  assert.deepEqual(dueLabel('2026-11-08 23:59:00', now), {label: 'Sun, Nov 8', tone: 'past'});
});
test('circulatory no longer shares the skeletal colour', () => {
  assert.notEqual(systemLook('circulatory').colour, systemLook('skeletal').colour);
  assert.deepEqual(systemLook('nope'), {tone: 'sky', colour: '#3fb8f5', art: null});
});
```

- [ ] **Step 2: Run** `node --test tests/unit/content-format.test.mjs`. Expected: FAIL, cannot find module.
- [ ] **Step 3: Implement `assets/js/content-format.js`.** Extension is the last `.`-part of the URL path before `?`, lower-cased. Dates format with `toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})`; MySQL `YYYY-MM-DD HH:MM:SS` parses as local time (replace the space with `T`). A due time earlier than `now` is `past` even when it is today.
- [ ] **Step 4: Run** `node --test "tests/unit/*.test.mjs"`. Expected: all pass. Open `student/lessons.html` and `student/dashboard.html` signed in as student01: module cards still show their art; circulatory cards are now coral.
- [ ] **Step 5: Commit** `Content format helpers shared by both portals; circulatory turns coral (<date>)`.

### Task 2: Assessment API: type retired, question mix, module filter, duplicate

**Files:**
- Modify: `api/assessments.php` (GET select and filters, POST, PUT, new duplicate branch)
- Test: `tests/integration.mjs`
- Already done: `database/seed_demo.php` no longer sets a type (2026-11-11).

**Interfaces:**
- Produces: GET items lose `assessment_type` and gain `module_id` (int|null) and `question_types` (`{[question_type]: count}`, `{}` when none), for teachers and students. GET accepts `?module_id=`; the `?type=` filter is removed. POST and PUT ignore `assessment_type` (the column keeps its default). `POST assessments.php?duplicate=<id>` → 201 `{assessment_id}`.

- [ ] **Step 1: Write the failing integration checks** after the existing assessment block (`aid` exists there, with questions added by the suite):

```js
const typed=await teacher('assessments.php','POST',{title:'Typed',assessment_type:'identification',system_id:sid,module_id:mid});
check(typed.success,'A type sent by an old client is ignored, not an error');
const listed=(await teacher('assessments.php?module_id='+mid)).data;
check(listed.every(a=>a.module_id===mid&&!('assessment_type' in a))&&listed.some(a=>a.assessment_id===aid),'module_id filter; rows carry no type');
check(listed.find(a=>a.assessment_id===aid).question_types.multiple_choice>=1,'question_types counts per type');
check((await teacher('assessments.php?type=identification')).data.some(a=>a.assessment_id===aid),'The type filter is gone');
check((await student('assessments.php')).data.every(a=>typeof a.question_types==='object'),'Students get the question mix too');
const copy=await teacher('assessments.php?duplicate='+aid,'POST',{});
check(copy.status===201||copy.success,'Duplicate created');
const copyRow=(await teacher('assessments.php?module_id='+mid)).data.find(a=>a.assessment_id===copy.data.assessment_id);
check(copyRow.status==='draft'&&copyRow.title.endsWith('(copy)')&&copyRow.question_count===listed.find(a=>a.assessment_id===aid).question_count,'Duplicate is a draft with every question');
check((await student('assessments.php?duplicate='+aid,'POST',{})).status===403,'Students cannot duplicate');
```

  Also compare the first copied question's options and `hotspot_data` with the original through `questions.php?assessment_id=`.
- [ ] **Step 2: Run** the integration suite (README "isolated database" steps). Expected: FAIL at "module_id filter; rows carry no type".
- [ ] **Step 3: Implement.** `question_types` comes from one grouped query (`SELECT assessment_id, question_type, COUNT(*) … GROUP BY 1, 2`) over the listed ids, merged in PHP. Duplicate runs in one transaction and copies `questions` and `answer_options` with their sort orders. No migration: the column stays with its default.
- [ ] **Step 4: Run** the integration suite. Expected: all pass. Run `php database/seed_demo.php` on the local database; it still seeds five assessments.
- [ ] **Step 5: Commit** `Assessments API: type retired, question mix, module filter, duplicate (<date>)`.

### Task 3: Module summary and lesson editing API

**Files:**
- Modify: `api/modules.php:66-96` (teacher fields)
- Modify: `api/lessons.php` (type whitelist in POST and PUT, `PUT ?reorder=1`, multipart `POST ?id=`)
- Test: `tests/integration.mjs`, fixture `tests/fixtures/sample.pdf` (copy of `database/demo/skeletal-reviewer.pdf`)

**Interfaces:**
- Produces: teacher GET `modules.php` items gain `lessons` (`[{lesson_id, title, lesson_type, media_url, duration_mins, status, sort_order}]` in order, drafts included), `material_count` (int), `updated_at`. Student responses are unchanged.
- Produces: `PUT lessons.php?reorder=1` body `{module_id, order: number[]}` → `{success}`; 422 "The lesson list changed. Reload and try again." unless `order` is exactly the module's lesson ids.
- Produces: `POST lessons.php?id=<id>` multipart with any of `title, lesson_type, content_text, duration_mins, status`, optional `lesson_file`, optional `remove_media=1` → `{success, data: {media_url}}`.
- Produces: lesson type outside `reading, video, 3d_model, interactive, quiz_prep` → 422.

- [ ] **Step 1: Write the failing integration checks** (`mid`, `lid` from the existing lesson block; create a second lesson `lid2`):

```js
const mods=(await teacher('modules.php')).data, mine=mods.find(m=>m.module_id===mid);
check(mine.lessons.some(l=>l.status==='draft')&&typeof mine.material_count==='number','Teacher module list carries lessons and materials');
check(!('lessons' in (await student('modules.php')).data[0]),'Students get the old shape');
check((await teacher('lessons.php?reorder=1','PUT',{module_id:mid,order:[lid]})).status===422,'Stale order rejected');
check((await teacher('lessons.php?reorder=1','PUT',{module_id:mid,order:mine.lessons.map(l=>l.lesson_id).reverse()})).success,'Reorder');
check((await teacher('modules.php')).data.find(m=>m.module_id===mid).lessons[0].lesson_id===mine.lessons.at(-1).lesson_id,'New order is kept');
check((await student('lessons.php?reorder=1','PUT',{module_id:mid,order:[]})).status===403,'Students cannot reorder');
const pdf=new FormData();pdf.append('lesson_file',new Blob([fs.readFileSync('tests/fixtures/sample.pdf')],{type:'application/pdf'}),'sample.pdf');pdf.append('title','Renamed');
const up=await teacher('lessons.php?id='+lid,'POST',pdf);check(up.success&&up.data.media_url.endsWith('.pdf'),'Multipart update attaches a PDF');
const bad=new FormData();bad.append('lesson_file',new Blob(['not a pdf'],{type:'text/plain'}),'x.txt');
check((await teacher('lessons.php?id='+lid,'POST',bad)).status===422,'Bad replacement rejected');
check((await teacher('lessons.php?id='+lid)).data.media_url===up.data.media_url,'Failed replace keeps the old file');
const rm=new FormData();rm.append('remove_media','1');
check((await teacher('lessons.php?id='+lid,'POST',rm)).data.media_url===null,'Attachment removed');
check(!fs.existsSync('uploads/lessons/'+up.data.media_url.split('/').pop()),'Removed file is deleted from disk');
check((await teacher('lessons.php?id='+lid,'PUT',{lesson_type:'podcast'})).status===422,'Unknown lesson type rejected');
```

- [ ] **Step 2: Run** the integration suite. Expected: FAIL at "Teacher module list carries lessons and materials".
- [ ] **Step 3: Implement.** Lessons for all listed modules come from one query grouped in PHP. Reorder updates `sort_order = index + 1` in a transaction. The multipart update reuses the existing upload validation; the old file is deleted only after the new one is saved and only when `realpath` of the old file is inside `uploads/lessons/`.
- [ ] **Step 4: Run** the integration suite. Expected: all pass.
- [ ] **Step 5: Commit** `Lessons API: reorder, edit with attachment replace, type check; module list summary for teachers (<date>)`.

### Task 4: PDF viewer

**Files:**
- Create: `assets/vendor/pdfjs/pdf.min.mjs`, `assets/vendor/pdfjs/pdf.worker.min.mjs`, `assets/vendor/pdfjs/LICENSE` (pdfjs-dist 4.10.38, `build/`)
- Create: `assets/js/pdf-viewer.js`, `assets/css/pdf-viewer.css` (values from `.pv*` in `mockup/after.css`)
- Modify: `assets/js/teacher-files.js:16` (PDF rows open `PdfViewer.open`; Word and PowerPoint still download)
- Modify: `student/lessons.html:228-235` (materials open `PdfViewer.open`), `teacher/lesson-plans.html` (load the viewer)
- Test: `tests/browser.mjs`, fixture `tests/fixtures/long.pdf` (60 pages, made once with Chrome `--print-to-pdf`)

**Interfaces:**
- Produces (global `PdfViewer`):
  - `PdfViewer.mount(container: HTMLElement, {url, title, downloadUrl = url}) → Promise<{destroy(): void}>` inline viewer
  - `PdfViewer.open({url, title, downloadUrl = url}) → {close(): void}` full-screen viewer; thumbnail rail at ≥ 900 px; Escape closes
  - `PdfViewer.thumbnail(canvas: HTMLCanvasElement, url: string) → Promise<void>` draws page 1
- The script finds pdf.js at `new URL('../vendor/pdfjs/', document.currentScript.src)`, so it works from any page.

- [ ] **Step 1: Write the failing browser checks** (teacher session, then student session). Upload `long.pdf` as a material on the test module through the page's `fetch` + `FormData`, then:

```js
await evaluate(`PdfViewer.open({url:API_BASE+'/files.php?id=${fileId}',title:'Long'})`);
check(await waitFor(`document.querySelectorAll('.pv-stage [data-page]').length===60`),'Every page gets a placeholder');
check(await evaluate(`document.querySelectorAll('.pv-stage canvas[data-rendered]').length<=3`),'Only pages near the view render');
check(await evaluate(`document.querySelector('.pv-pages').textContent.includes('of 60')`),'Page count shows');
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});
check(await waitFor(`!document.querySelector('.pv-overlay')`),'Escape closes the viewer');
// Student: PDF lesson in the reader
check(await waitFor(`document.querySelector('.sd-reader .pv canvas[data-rendered]')`),'Lesson PDF renders inline');
check(await evaluate(`!document.querySelector('.sd-reader iframe')`),'No iframe left in the reader');
```

  Also a broken URL (`files.php?id=999999`) shows `.pv-fallback` with a Download link.
- [ ] **Step 2: Run** the browser suite. Expected: FAIL, `PdfViewer is not defined`.
- [ ] **Step 3: Implement.** Pages are `div[data-page]` placeholders sized from page 1's aspect ratio; an `IntersectionObserver` with `rootMargin: '600px 0px'` renders a page into a canvas at `devicePixelRatio` and marks it `data-rendered`. Zoom steps: Fit width, 50, 75, 100, 125, 150, 200 %. Toolbar buttons have `aria-label`s; the page box is `aria-live="polite"`. `open()` and `mount()` call `StudyClock.reading()` when `typeof StudyClock !== 'undefined'` (StudyClock is a top-level `const` in `app.js`, not a `window` property).
- [ ] **Step 4: Run** the browser suite. Expected: pass. Check by hand on a phone-sized window (390 px): toolbar wraps to two rows, no rail, no horizontal scroll.
- [ ] **Step 5: Commit** `One PDF viewer for lessons, materials and lesson plans (pdf.js, no browser tabs) (<date>)`.

### Task 5: Shared lesson reader

**Files:**
- Create: `assets/js/lesson-reader.js` (moved from `student/lessons.html:241-316`)
- Modify: `student/lessons.html` (use it)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `PdfViewer.mount` (Task 4), `ContentFormat.systemLook` (Task 1)
- Produces (global `LessonReader`): `LessonReader.show(root: HTMLElement, lesson, {exploreHref?: string|null, onClose?: () => void})` and `LessonReader.close(root)`. With `exploreHref: null` the "View in 3D" and "Practice in 3D" parts are left out (teacher preview).

- [ ] **Step 1: Write the failing browser check:** on `teacher/modules.html`, `typeof LessonReader.show === 'function'` after the page loads.
- [ ] **Step 2: Run** the browser suite. Expected: FAIL.
- [ ] **Step 3: Move the reader** into `lesson-reader.js`; PDF media mounts `PdfViewer` instead of the iframe; load the script on `student/lessons.html` and `teacher/modules.html`.
- [ ] **Step 4: Run** the browser suite. Expected: pass, including the existing student lesson checks.
- [ ] **Step 5: Commit** `Lesson reader shared so teachers can preview lessons (<date>)`.

### Task 6: Studio kit and the Modules grid

**Files:**
- Create: `assets/css/content-studio.css` (from `mockup/after.css`: tokens, type scale, buttons, summary, toolbar, status, module card, kind tiles, panels, rows, sheet, fields; leave out the `.pv*` and assessment rules, which go to Tasks 4 and 9)
- Create: `assets/js/content-studio.js`
- Modify: `assets/icons/interface.svg` (add Phosphor regular `dots-three`, `dots-six-vertical`, `copy`), then replace `?v=20261012-icons3` with `?v=20261111-icons4` in every file that has it
- Modify: `teacher/modules.html` (header, summary, toolbar, grid; delete `addModuleModal`, the page-level Add Lesson button, `viewLessons` with its `alert()`, and `editModule` with its `prompt()`)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `ContentFormat.kindCounts`, `systemLook` (Task 1); teacher `modules.php` fields (Task 3)
- Produces (global `Studio`):
  - `Studio.icon(name: string, cls = '') → string`
  - `Studio.status(status: string) → string` (`published|active` mint, `draft` amber, `closed|archived` grey)
  - `Studio.menu(anchor: HTMLElement, items: [{label, icon?, danger?, onSelect}]) → void` (arrow keys, Escape, outside click close it; focus returns to `anchor`)
  - `Studio.sheet({eyebrow, title, body: HTMLElement, footer: HTMLElement, size: 'side'|'center'}) → {root, close(): Promise<boolean>, setDirty(dirty: boolean)}`; full screen below 640 px; Escape, scrim and Close call `close()`, which asks `confirmToast({title: 'Discard changes?', confirmText: 'Discard', cancelText: 'Keep editing'})` when dirty
  - `openModuleSheet(module|null)` in `teacher/modules.html`: title, body system, description, status; creates with POST, edits with PUT

- [ ] **Step 1: Write the failing browser checks** on `teacher/modules.html` (test DB has the integration suite's module with a draft lesson):

```js
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0`),'Module cards render');
check(await evaluate(`[...document.querySelectorAll('.cs-mod')].every(c=>c.querySelector('.cs-eyebrow')&&c.querySelector('.cs-status'))`),'Every card has a system eyebrow and a status');
check(await evaluate(`[...document.querySelectorAll('.cs-mod-foot')].every(f=>f.scrollWidth<=f.clientWidth)`),'Card actions are never clipped');
check(await evaluate(`!document.getElementById('addModuleModal')&&!/alert\\(|prompt\\(/.test(document.body.innerHTML)`),'Popups are gone');
// More menu → Edit details opens the sheet; typing marks it dirty; Escape asks before closing
```

  Plus: searching a lesson title shows its module only; the Draft filter shows draft modules only; at 390 px `document.documentElement.scrollWidth <= 390`.
- [ ] **Step 2: Run** the browser suite. Expected: FAIL at "Module cards render".
- [ ] **Step 3: Implement** the grid and `Studio`. Cards sort by body-system order, then module `sort_order` (the API already returns that order). A published module with no published lesson shows the amber note and **Add lesson**. Archive asks `confirmToast({title: 'Archive this module?', message: 'Students will no longer see it.', confirmText: 'Archive'})`.
- [ ] **Step 4: Run** the browser suite. Expected: pass. Compare with `after-01-teacher-modules.png` and `after-08-teacher-modules-phone.png`.
- [ ] **Step 5: Commit** `Modules page: system-coded cards, search and filters, module sheet replaces the prompt (<date>)`.

### Task 7: Module workspace

**Files:**
- Modify: `teacher/modules.html` (`?module=<id>` view; replace `materialsModal`)
- Modify: `assets/js/teacher-files.js` (a `compact: true` option for the side panel: thumbnail rows, Upload in the header, drop onto the panel to upload)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `Studio.*` (Task 6), `PUT lessons.php?reorder=1` (Task 3), `assessments.php?module_id=` (Task 2), `PdfViewer.open/thumbnail` (Task 4), `LessonReader.show` (Task 5)
- Produces: `showWorkspace(moduleId: number)` and `showGrid()` in `teacher/modules.html`, driven by `history.pushState` and `popstate`; `TeacherFiles.mount(el, {kind, moduleId, compact})`.

- [ ] **Step 1: Write the failing browser checks:**

```js
await navigate('/teacher/modules.html?module='+mid);
check(await waitFor(`document.querySelector('.cs-hero h2')?.textContent==='Test module'`),'Workspace opens from the URL');
check(await evaluate(`document.querySelectorAll('.cs-row').length===${lessonCount}`),'Every lesson is listed, drafts included');
// Move the last lesson up with its menu, reload, and check it stayed there
check(await evaluate(`document.querySelector('.cs-side').textContent.includes('Test quiz')`),'Linked quizzes show');
await evaluate(`history.back()`);
check(await waitFor(`document.querySelectorAll('.cs-mod').length>0`),'Back returns to the grid');
```

  Plus at 390 px: panels stack and `scrollWidth <= 390`; the Preview button opens `.sd-reader` without "View in 3D".
- [ ] **Step 2: Run** the browser suite. Expected: FAIL at "Workspace opens from the URL".
- [ ] **Step 3: Implement.** Rows use native drag and drop plus Move up/Move down in the more menu; any reorder failure shows a toast and reloads the list. Lesson meta reads "<kind label>[, N pages] · N min" ("Reading · no time set" without a duration). Delete lesson confirms with `confirmText: 'Delete'`.
- [ ] **Step 4: Run** the browser suite. Expected: pass. Compare with `after-02-module-workspace.png`.
- [ ] **Step 5: Commit** `Module workspace: ordered lessons, materials with previews, linked quizzes (<date>)`.

### Task 8: Lesson editor

**Files:**
- Modify: `teacher/modules.html` (delete `addLessonModal`; add `openLessonSheet`)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `Studio.sheet` (Task 6), `POST lessons.php` and `POST lessons.php?id=` (Task 3), `PdfViewer.thumbnail` (Task 4)
- Produces: `openLessonSheet(moduleId: number, lesson: object|null)`.

- [ ] **Step 1: Write the failing browser checks:** open the sheet from **Add lesson**; the five type tiles are visible with computed text colour contrast ≥ 4.5:1 against their background; fill title and text, attach `tests/fixtures/sample.pdf` through the hidden file input, save; the new row shows kind PDF. Reopen it, change the title, press Escape: a "Discard changes?" toast appears; choose **Keep editing**: the sheet is still open.
- [ ] **Step 2: Run** the browser suite. Expected: FAIL.
- [ ] **Step 3: Implement.** New lessons POST multipart to `lessons.php`; edits POST to `lessons.php?id=`. The attachment card shows a PDF thumbnail, name, page count and size; Remove sends `remove_media=1`. Files over 500 MB are refused before upload with "File too large. Maximum size is 500 MB.". The footer shows "Saved" with the time after a save.
- [ ] **Step 4: Run** the browser suite. Expected: pass. Compare with `after-03-lesson-editor.png`.
- [ ] **Step 5: Commit** `Lesson editor sheet for new and existing lessons, with attachment replace (<date>)`.

### Task 9: Assessments list and assessment sheet

**Files:**
- Modify: `assets/css/content-studio.css` (assessment row rules from `mockup/after.css`)
- Modify: `teacher/assessments.html` (summary, toolbar, grouped rows, more menu, sheet replaces `createAssessModal`)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `ContentFormat.assessmentKind/questionMix/dueLabel/systemLook` (Task 1), `Studio.*` (Task 6), `question_types`, `module_id`, duplicate (Task 2)
- Produces: `openAssessmentSheet(assessment|null)`: title, body system, optional module, instructions, time limit, pass mark, tries, due date, and the "Any mix of question types" note; no type field. On create the button reads **Create and add questions**, saves a draft and calls `openQuestionBuilder(newId)`.

- [ ] **Step 1: Write the failing browser checks:**

```js
check(await waitFor(`document.querySelectorAll('.cs-arow').length>0`),'Assessment rows render');
const heads=await evaluate(`[...document.querySelectorAll('.cs-alist .cs-h2')].map(h=>h.textContent)`);
check(heads.join()===['Open now','Drafts','Closed'].filter(h=>heads.includes(h)).join(),'Groups keep the order Open now, Drafts, Closed');
check(await evaluate(`!/multiple_choice|diagram|submissions\\b/.test(document.querySelector('.cs-alist').textContent)`),'No raw enum names or "submissions"');
check(await evaluate(`[...document.querySelectorAll('.cs-arow .cs-btn--primary')].length===0`),'No mint buttons inside rows');
check(await evaluate(`!document.querySelector('input[name="assessType"],[data-assessment-type]')`),'No assessment type anywhere on the page');
// The body-system select narrows the rows; Pause lives in the more menu and confirms;
// New assessment → fill title → Create and add questions → the builder opens on a draft with 0 questions
```

- [ ] **Step 2: Run** the browser suite. Expected: FAIL.
- [ ] **Step 3: Implement.** Row tile icon and tint come from `assessmentKind(question_types)` (tint class `q-<tone>`); the eyebrow is the body system only ("All body systems" when none). Summary strip: open (`active`), draft, closed, and total attempts (sum of `submission_count`). Open rows sort by due date (no due date last), drafts and closed by newest. Results read "N attempt(s) · avg N%" with an amber bar below the pass mark, or "No attempts yet"; drafts read "Not published". The row action is always **Questions**.
- [ ] **Step 4: Run** the browser suite. Expected: pass. Compare with `after-06-teacher-assessments.png` and `after-09-new-assessment.png`.
- [ ] **Step 5: Commit** `Assessments page: no assessment type, grouped rows with due dates and results (<date>)`.

### Task 10: Question builder

**Files:**
- Modify: `teacher/assessments.html` (`questionBuilderModal`, `addQuestionModal`)
- Modify: `assets/css/content-studio.css` (question rules from `mockup/after.css`)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `ContentFormat.QUESTION_TYPES` (Task 1), `Studio.*` (Task 6), `PUT questions.php?id=` (exists), duplicate (Task 2)
- Produces: `openQuestionBuilder(assessmentId)` (same name as today), `openQuestionForm(assessmentId, question|null)`.

- [ ] **Step 1: Write the failing browser checks:** for the test quiz without attempts: each `.cs-q` shows its type label and the correct option has `.ok`; **Edit** on question 1 opens the form prefilled; changing its text and saving updates the card. For an assessment with an attempt: `.cs-lock` is shown, no Edit or Delete items exist in the question menus, and **Duplicate to edit** opens the builder of a new draft named "(copy)".
- [ ] **Step 2: Run** the browser suite. Expected: FAIL.
- [ ] **Step 3: Implement.** Hotspot cards draw the target ring at `x`, `y` with diameter `radius × 2` of the picture width and say "Tolerance N% of the picture". Identification cards show "Answer: <term>". Delete question confirms with `confirmText: 'Delete'`.
- [ ] **Step 4: Run** the browser suite. Expected: pass. Compare with `after-07-question-builder.png`.
- [ ] **Step 5: Commit** `Question builder: readable answers, edit, locked quizzes duplicate to edit (<date>)`.

### Task 11: Student side of the retired type

**Files:**
- Modify: `student/quiz.html:73-79` (chips), `:198-300` (filter and counts), `:320` (`formatLook`)
- Modify: `student/dashboard.html:291` (remove the type chip cell and its header)
- Modify: `student/progress.html:207` (search drops `assessment_type`)
- Test: `tests/browser.mjs`

**Interfaces:**
- Consumes: `question_types` on student assessment rows (Task 2), `ContentFormat.QUESTION_TYPES` and `assessmentKind` (Task 1)
- Produces: chips with `data-qtype` = `all | multiple_choice | true_false | identification | hotspot`; `setQuestionTypeFilter(qtype)` replaces `setAssessmentTypeFilter`.

- [ ] **Step 1: Write the failing browser checks** (student session; the suite's quiz has multiple choice questions, add one with a hotspot question through the teacher API first):

```js
await navigate('/student/quiz.html');
check(await evaluate(`[...document.querySelectorAll('#typeFilterChips [data-qtype]')].map(b=>b.dataset.qtype).join()==='all,multiple_choice,true_false,identification,hotspot'`),'Chips name question types');
await evaluate(`setQuestionTypeFilter('hotspot')`);
check(await evaluate(`[...document.querySelectorAll('#availableAssessmentsGrid article')].every(c=>c.dataset.qtypes.split(' ').includes('hotspot'))`),'Hotspot chip shows every assessment that holds a hotspot question');
check(await evaluate(`!/assessment_type|Chapter quizzes/.test(document.body.innerHTML)`),'No trace of the old type');
```

- [ ] **Step 2: Run** the browser suite. Expected: FAIL at "Chips name question types".
- [ ] **Step 3: Implement.** Each card carries `data-qtypes` (the types with a count above zero, space-separated); a chip's count is the number of assessments whose `question_types[qtype] > 0`. `formatLook(kind)` takes `assessmentKind(a.question_types)` and keeps today's card tones: `hotspot` → violet, `identification` → teal, `multiple_choice` and `true_false` → coral, `mixed` and `empty` → sky; label and glyph come from the kind.
- [ ] **Step 4: Run** the browser suite and the existing `tests/student-dashboard-states.js`. Expected: pass; delete the `assessment_type` field from that test's fixture if its check still references it.
- [ ] **Step 5: Commit** `Student quizzes filter by the question types inside, not a fixed type (<date>)`.

### Task 12: Demo guard, docs and final check

**Files:**
- Modify: `deploy/package-infinityfree.ps1`, `deploy/export-local.ps1` (stop with "Demo content is still in the database. Run php database/seed_demo.php --remove first." when `SELECT 1 FROM app_settings WHERE setting_key='demo_seed'` returns a row)
- Modify: `README.md` (Modules and Assessments sections, PDF viewer, `seed_demo.php`, pdf.js credit and licence)
- Modify: `docs/superpowers/specs/assets/2026-11-11-content-redesign/mockup/capture-after.mjs` (a `--real` flag that skips injection and shoots the real pages)

- [ ] **Step 1:** Run `php database/seed_demo.php`, then `node docs/superpowers/specs/assets/2026-11-11-content-redesign/mockup/capture-after.mjs --real`. Compare each new `after-*.png` with the mockup of the same name; fix any differences in spacing, hierarchy or copy.
- [ ] **Step 2:** Run `node --test "tests/unit/*.test.mjs"`, the integration suite and the browser suite. Expected: all pass.
- [ ] **Step 3:** Run `deploy/package-infinityfree.ps1` with the demo present. Expected: it stops with the message above. Run `php database/seed_demo.php --remove`, run it again: it proceeds.
- [ ] **Step 4: Commit** `Content redesign: demo guard for hosting exports, README, real-page screenshots (<date>)` and push to `main`.
