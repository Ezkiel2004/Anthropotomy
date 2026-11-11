# Teacher content redesign: Modules, Assessments and one PDF viewer

Date: 2026-11-11. Status: design for review.

## Goal

Make the teacher's content pages read as one product with a clear visual hierarchy, and replace the browser popups and raw PDF tabs with real interfaces. The scope agreed on 2026-11-11:

- **Teacher Modules and Lessons** (`teacher/modules.html`): the module list, a module workspace, lesson and module editors.
- **Teacher Assessments** (`teacher/assessments.html`): the list, the question builder and the assessment editor.
- **No assessment types** (decided 2026-11-11, after the first review). Teachers no longer choose Quiz, Identification, Hotspot activity or Mixed when they create an assessment. Any assessment can hold any mix of multiple choice, true or false, identification and hotspot questions, and every label, icon and filter comes from the questions it contains. A fixed type only restricted teachers who mix question types.
- **One in-app PDF viewer** used everywhere a PDF opens: lesson attachments in the student lesson reader, module materials (teacher and student) and lesson plans.
- **Look:** keep the Stage palette (black, mint `#36e2c0`, body-system colours, Bungee page titles, Geist body). Add depth with surface steps, one type scale and one card language. No new palette, no light theme.
- **Demo content** for reviewing the work: `database/seed_demo.php`, removable with `--remove`.

Out of scope: the student Lessons grid, the student quiz runner and results, the explorer, games, dashboards. Two changes reach the student side: the PDF viewer, and the places that showed the retired assessment type (the quiz list's filter chips and card look, the dashboard's score table chip, the progress page search).

## What is wrong today

Seen with the demo content (`docs/superpowers/specs/assets/2026-11-11-content-redesign/before-*.png`):

1. **Modules page.** Every card looks the same: no system colour or art, four equal buttons per card, and "Archive" is clipped at the card edge. The stat strip outweighs the content. "Lessons" opens a browser `alert()` listing lessons as plain text; "Edit" opens a `prompt()` asking for a status word. There is no way to edit a lesson, reorder lessons, or see a module's lessons, materials and quizzes together.
2. **Add Lesson dialog.** The lesson-type radio chips use `var(--bg-elevated)`, which the Stage theme does not define, so they render as white boxes with near-invisible light text. "Add Lesson" lives at page level, so the teacher picks the module from a long select.
3. **Materials.** A native "Choose File" control sits above the list; PDFs open in a new browser tab with the browser's own grey viewer.
4. **PDF lessons.** The student reader embeds the browser's PDF viewer in an iframe: grey toolbar, 52% zoom, a thumbnail panel the student did not ask for, and a bare "Open the document in a new tab" link. Phones are worse: iOS Safari shows only the first page in an iframe and Android Chrome downloads the file instead.
5. **Assessments page.** A centred type label row ("QUIZ", "DIAGRAM") wastes the top of every card; raw enum names show ("diagram", "mixed"); "1 submissions"; "Due: No due date"; "Pause" is the mint primary button, so the riskiest action is the most prominent. Filter chips do not match the data ("Hotspot Activity" and "Labeled Diagram" are both shown).
6. **Question builder.** Correct answers are marked with the text "[Correct]", types show as `multiple_choice`, every question has a red "Delete", and there is no edit.
7. **Bug.** The create form sends `assessment_type: 'interactive'` for hotspot activities, but the column is `enum('quiz','identification','diagram','exploration','mixed')`. MariaDB runs without strict mode here, so the row is saved with an empty type and never matches a filter on either portal. Retiring the type removes this bug instead of patching it.

## Design

Mockups are the real signed-in pages with new content injected (`mockup/capture-after.mjs`, `mockup/after.css`). Side-by-side images: `compare-1` to `compare-8`, plus `after-05-materials-pdf-viewer.png`.

### Visual system (shared by both pages)

- **Surfaces:** page `#121212`, card `#191919`, inset `#202020`, raised control `#282828`, hover `#313131`. Cards keep the soft shadow from `minimal-portal.css` and gain a 1px top light (`inset 0 1px 0 rgba(255,255,255,.05)`). No borders on cards; hairlines (`rgba(255,255,255,.07)`) only between rows.
- **Type scale:** page title stays Bungee. Eyebrow 11px/600 uppercase, tracking .12em, muted or the system colour. Section title 18px/700. Card title 17px/650. Body 14px. Meta 13px muted. Numbers tabular.
- **Status:** a coloured dot and a word (mint Published/Active, amber Draft, grey Closed/Archived), never a filled badge.
- **Buttons:** one mint primary per region (page header, panel header, dialog footer). Everything else is a neutral pill, a ghost pill or an icon button. Rare and destructive actions (archive, delete, pause, duplicate) move into a "more" menu with a confirm step.
- **System identity:** each module shows its system's colour and hero render (`assets/img/hero/<system>.webp`). One shared `SYSTEM_LOOKS` map moves from `student-portal.js` into `app.js` so both portals agree; circulatory changes from sky to coral so it stops matching skeletal.
- **Lesson kinds** (what students get, derived from type plus attachment): Reading, Video, PDF, Image, 3D model, Interactive, Quiz prep, each with a Phosphor icon and a tint.
- **Icons:** Phosphor only, from the one sprite. Add `dots-three`, `dots-six-vertical` and `copy`.

### Modules page (`compare-1`)

- Header: title, one-line purpose, one primary **New module**. Page-level "Add Lesson" goes away; lessons are added inside a module.
- A slim summary strip: modules, lessons (drafts included), published, draft.
- Toolbar: search (module titles, descriptions and lesson titles), Published/Draft segmented filter with counts, body-system select.
- One grid ordered by body system, then module order. Each card: system art panel with the status dot, system eyebrow, title, two-line description, lesson-kind chips with counts, footer with "6 lessons · 2 materials", **Open** and a more menu (Edit details, Publish or Unpublish, Archive).
- A published module with no published lessons shows an amber note: students cannot see it yet, with **Add lesson** in place of Open. Drafts show their art in greyscale.

### Module workspace (`compare-2`)

`modules.html?module=<id>` swaps the grid for the workspace (history entry, so Back returns to the grid). No new page in the sidebar.

- Hero: system eyebrow, title, description, status and "6 lessons · 51 min · 2 materials", actions **Edit details**, **Preview** (first lesson in the reader), **Publish/Unpublish**.
- **Lessons panel:** numbered rows with a drag handle, kind tile, title, meta ("PDF handout, 2 pages · 12 min"), status, and on hover or focus Preview, Edit and more (Move up, Move down, Publish/Unpublish, Delete). Drag to reorder; Move up/down is the keyboard path. **Add lesson** in the panel header and as a dashed row at the end.
- **Materials panel:** the module's files with a first-page thumbnail for PDFs; PDFs open in the viewer, Word and PowerPoint download. Upload sits in the panel header and opens a small form; drag-and-drop onto the panel also uploads.
- **Quizzes panel:** assessments linked to this module (`assessments.module_id`) with question count, attempts and average, linking to the Assessments page.

### Lesson editor (`compare-3`)

A right-side sheet (full screen on phones) for both new and existing lessons, replacing `addLessonModal`.

- Title; **What students get** as five tiles (Reading, Video, 3D model, Interactive, Quiz prep) that actually render in the Stage theme; Attachment as a file card (PDF thumbnail, name, pages, size, Replace, Remove) with a drop zone; lesson text; time to study; a Published switch.
- Footer: Cancel and **Save lesson**. Leaving with unsaved changes asks first.
- **Module details** uses the same sheet: title, body system, description, status. This replaces both `addModuleModal` and the `prompt()`.

### PDF viewer (`compare-4`, `after-05`)

`assets/js/pdf-viewer.js` with pdf.js vendored in `assets/vendor/pdfjs/` (no CDN, like three.js). Two uses, one component:

- **Inline** in the student lesson reader: dark toolbar with the file name and page count, previous/next with "1 of 2", zoom out, Fit width, zoom in, download, full screen. Pages render as white sheets on a dark stage, lazily as they scroll into view.
- **Full screen** for materials and lesson plans: the same toolbar plus a thumbnail rail on wide screens, Close in the corner, Escape closes, arrow keys change page, `+`/`-` zoom.
- Opening a PDF counts as study time (`StudyClock.reading()`), as the old link did.
- If pdf.js fails to load or the file is not a PDF, the viewer shows the file name with **Download** instead of a broken frame.

### Assessments page (`compare-5`)

- Header with one primary **New assessment**; summary strip: open, draft, closed, total attempts (the mockup's "attempts this week" needs submission dates the list API does not return, so it counts all attempts).
- Toolbar: search and the body-system select used on the Modules page. There is no type filter, because assessments have no type.
- Rows grouped **Open now** (soonest due first), **Drafts**, **Closed**. Each row: a tile drawn from the question mix (one question type shows that type's icon and tint, several show the mint stack icon, none shows "No questions yet"), the body-system eyebrow, title, "15 min · pass 75% · 3 tries", question count with per-type chips, due date (amber within 3 days, "No due date" in muted text), results ("1 attempt · avg 83%" with a bar, or "No attempts yet"), status, one neutral action (**Questions**; the mockup's "Results" button is dropped because the results already sit in the row and the Monitoring page has no per-assessment link) and a more menu (Open/Pause/Close, Edit settings, Duplicate, Delete).
- Phones stack each row into a card.

### Question builder (`compare-6`)

- Header: body-system eyebrow, title, then Questions, Points, Time, Pass mark, Status.
- When the assessment has attempts, a blue note explains the questions are locked to keep past results fair, with **Duplicate to edit** (a draft copy with all questions).
- Each question: number, type with icon ("Multiple choice", "True or false", "Identification", "Hotspot"), points, more menu (Edit, Duplicate, Delete). Options in a two-column grid; the correct one has a mint outline, a check and "Correct". Identification shows "Answer: Femur". Hotspot shows the picture with the target ring and its tolerance.
- **Edit question** reuses the add-question form, prefilled; the API already supports `PUT questions.php?id=`.
- The create/edit assessment form becomes a sheet with no type to pick (`after-09-new-assessment.png`, `compare-8`): title, body system, optional module, instructions, time limit, pass mark, tries per student, due date. A note lists the four question types that can be mixed. **Create and add questions** saves a draft and opens the builder.
- Each question still picks its own type in the add/edit question form, as today.

### Student side of the retired type

- **Quiz list** (`student/quiz.html`): the chips become All, Multiple choice, True or false, Identification, Hotspot. Each counts and shows the assessments that contain at least one question of that type, so a mixed assessment appears under every type it holds. Card colour and icon come from the question mix, as on the teacher list.
- **Dashboard** (`student/dashboard.html`): the score table's type chip is removed.
- **Progress** (`student/progress.html`): search matches title and body system, not type.

## Data and API changes

- **Assessment type retired.** `assessments.php` stops reading `assessment_type` on POST and PUT, drops it from its GET rows and drops the `?type=` filter. The column stays in the table (old rows, default `quiz`) so nothing is destroyed, but no page reads or writes it. No migration is needed.
- `api/modules.php` GET for teachers adds per module: `lessons` (every lesson, drafts included, with type, attachment URL, minutes, status and order), `material_count` and `updated_at`. Kind counts and total minutes are worked out in the browser with `content-format.js`, so the kind rules live in one place. Students get the old shape.
- `api/lessons.php`: `PUT ?reorder=1` with `{module_id, order: [lesson_id, ...]}`; `POST ?id=<id>` as multipart to update a lesson including replacing or removing its attachment (PHP does not parse multipart PUT). A replaced or removed file under `uploads/lessons/` is deleted.
- `api/assessments.php`: GET adds `question_types` (counts per question type, for teachers and students; it reveals no answers) and `module_id`, and accepts `?module_id=`; `POST ?duplicate=<id>` copies the assessment, questions and options as a draft titled "<title> (copy)".
- `assets/js/content-format.js` (new, plain script, unit tested): `lessonKind(lesson)`, `assessmentKind(questionTypes)`, `questionMix(questionTypes)`, `dueLabel(date, now)` and the shared system looks, used by both portals. `assessmentKind` returns the single question type's label and icon when there is one type, "Mixed questions" with the stack icon for several, and "No questions yet" for none.
- `database/seed_demo.php` stops setting a type.

## Files

New: `assets/css/content-studio.css`, `assets/css/pdf-viewer.css`, `assets/js/pdf-viewer.js`, `assets/js/content-format.js`, `assets/js/lesson-reader.js` (the reader moved out of `student/lessons.html` so teachers can preview), `assets/vendor/pdfjs/`, `tests/unit/content-format.test.mjs`.

Changed: `teacher/modules.html`, `teacher/assessments.html`, `teacher/lesson-plans.html` (viewer), `student/lessons.html` (viewer and shared reader), `assets/js/teacher-files.js`, `assets/js/app.js` (system looks), `assets/js/student-portal.js`, `assets/icons/interface.svg`, `api/modules.php`, `api/lessons.php`, `api/assessments.php`, `database/seed_demo.php`, `student/quiz.html`, `student/dashboard.html`, `student/progress.html`, `tests/integration.mjs`, `tests/browser.mjs`, `README.md`.

## Testing

- Unit: `node --test "tests/unit/*.test.mjs"` covers the content-format helpers (every lesson kind from type and extension, labels, due wording around midnight and the 3-day threshold, question mix).
- Integration (`tests/integration.mjs`): lesson reorder keeps other modules untouched; multipart lesson update replaces and deletes the old file; a student cannot reorder or update; assessment rows carry `question_types` and no `assessment_type`, and a type sent on create is ignored; duplicate copies questions and options and is a draft.
- Browser (`tests/browser.mjs`): the modules grid renders cards with kind chips; `?module=` opens the workspace; the lesson editor saves; the PDF viewer draws a canvas for a lesson PDF and for a material; Escape closes the full-screen viewer; no page errors.
- Visual: re-run `mockup/capture-after.mjs` against the finished pages instead of injected markup, at 1440 px and 390 px, and compare with the mockups.

## Demo content

`php database/seed_demo.php` adds four modules (skeletal, circulatory, respiratory as a draft, nervous with no lessons), twelve lessons covering every kind, three materials (two PDFs and a Word file), five assessments covering every question type and status, and one graded attempt by student01. Every row and file is recorded in `app_settings.demo_seed`; `--remove` deletes exactly those. Remove it before exporting the database for hosting.
