# View-only PowerPoint and Word files inside the system: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student opens a PowerPoint or Word lesson or material inside the system with view-only access; a per-file teacher switch decides whether the original can also be downloaded.

**Architecture:** Uploading a `.ppt/.pptx/.doc/.docx` file also makes a PDF copy (`<file>.preview.pdf`) with LibreOffice, kept next to the original. PHP serves the copy and the original through access checks (`allow_download` decides who may get the original); the existing `PdfViewer` shows the copy. Direct links to Office files and previews are denied in `uploads/.htaccess`.

**Tech Stack:** PHP 8.3 (XAMPP, no frameworks), MySQL/MariaDB, plain browser JavaScript, pdf.js (already vendored), LibreOffice (headless converter), Node 18+ test suites (`tests/*.mjs`) and one plain PHP test.

**Spec:** `docs/superpowers/specs/2026-11-12-in-app-slide-preview-design.md` (read it first; this plan only decides what the spec leaves open).

## Global Constraints

- Preview file name: the original's full file name plus `.preview.pdf` (for example `lesson_2_..._ab12.pptx.preview.pdf`).
- Preview formats: `ppt`, `pptx`, `doc`, `docx`. PDFs, images, video and GLB files are never converted and keep today's behaviour.
- Converter: LibreOffice run with `--headless --norestore --convert-to pdf --outdir <dir>` and `-env:UserInstallation=<own profile>`; killed after 90 seconds; result accepted only if it starts with `%PDF`.
- Converter lookup: `ANTHROPOTOMY_SOFFICE`, then `soffice=` in `storage/db.ini`, then `C:\Program Files\LibreOffice\program\soffice.exe`, `C:\Program Files (x86)\LibreOffice\program\soffice.exe`, `/usr/bin/soffice`, `/usr/bin/libreoffice`. No converter, or `proc_open` disabled: previews are skipped and nothing else changes.
- Columns: `allow_download TINYINT(1) NOT NULL DEFAULT 0` on `lessons` and on `teacher_files`, added by `database/migrate.php`.
- Access rule for a student: view the preview if the module (and lesson) is published; get the original only if `allow_download = 1` **or** the file has no preview. Teachers and admins get both. Refusal text: `This file is view-only.` (HTTP 403).
- Lesson endpoints: `lessons.php?id=N&file=preview|original`. Material endpoints: `files.php?id=N&preview=1` (preview) and `files.php?id=N` (original).
- Direct-link deny rule in `uploads/.htaccess` covers `*.ppt`, `*.pptx`, `*.doc`, `*.docx` and `*.preview.pdf`.
- UI copy (exact): switch label `Let students download this file`; menu items `Allow student downloads` and `Make view-only`; progress `Preparing slides for viewing…` (Word: `Preparing document for viewing…`); success `Saved. Students can view it in the app.`; fallback `Saved, but no preview could be made, so students will download this file instead.`; student hint `PDFs open here. PowerPoint and Word files download and open in the app on your device.` shown only when some row still downloads.
- Cache-busting: whenever a JS or CSS file changes, bump its `?v=` string in every HTML page that loads it (this project's convention).
- There is no git repository in this folder, so tasks end with a **Checkpoint** (run the named checks) instead of a commit.
- Tests that need a converter use the stub in Task 1, never LibreOffice; real LibreOffice is exercised only in Task 10.

## Review Focus

1. **Existing PowerPoint lessons with no preview** (uploaded before this feature, or when no converter exists) must still download for a student after direct links are denied. The student's Download link must use the API, not `media_url`. Tested in Task 5.
2. **A "pptx" that is not a real deck** (starts with the zip signature but cannot be converted): the upload must succeed with `preview: false` and the original must remain downloadable. Tested in Tasks 4 and 5.
3. **A converter that hangs:** the upload must return within the timeout, kill the process and leave no temp folder or partial preview. Tested in Task 1 (and with a short timeout in Task 4).
4. **Two teachers uploading decks at the same moment:** both previews must be made (no shared LibreOffice profile or output folder). Tested in Tasks 1 and 4.
5. **Replacing a PowerPoint lesson file with a PDF, and file names with spaces, accents or `&`:** the old preview is deleted, the flags reset, and the preview still streams with a sane download name. Tested in Tasks 4 and 5.

---

## Task 0: Test environment (needs the user's OK before installing)

**Files:** none changed.

- [ ] **Step 1: Ask the user before installing anything.** Two installs are needed, both free: Node.js LTS (runs the existing `tests/*.mjs` suites; not installed on this PC) and LibreOffice (about 350 MB; only Task 10 needs it). Planned commands: `winget install OpenJS.NodeJS.LTS` and `winget install TheDocumentFoundation.LibreOffice`. Do not install without a yes.
- [ ] **Step 2: Verify the baseline.** Run `node tests/check-syntax.mjs`. Expected: it ends without errors.
- [ ] **Step 3: Verify the integration setup from README ("Fresh installation" and the test paragraph).** Create the isolated database, start `php -S 127.0.0.1:8091 tests/router.php`, run `node tests/integration.mjs`. Expected: all existing checks pass. Note that the README names headless Chrome on port 9225; Chrome is not installed here, but Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) takes the same `--headless --remote-debugging-port=9225` flags for the browser suites.
- [ ] **Step 4: Record the working commands** (database name, server and browser start lines) at the top of `.runtime/test-notes.txt` for the later tasks.

## Task 1: Converter library and test stub

**Files:**
- Create: `database/preview.php`, `tests/preview.php`, `tests/fixtures/fake-soffice.cmd`, `tests/fixtures/fake-soffice.sh`

**Interfaces:**
- Produces (all in `database/preview.php`, loaded with `require_once`):
  - `previewFormats(): array` returns `['ppt','pptx','doc','docx']`
  - `previewPath(string $original): string`
  - `previewSupported(string $path): bool` (extension check, case-insensitive)
  - `previewConverter(): ?string` (lookup order in Global Constraints; if `ANTHROPOTOMY_SOFFICE` is set and non-empty it is used exclusively: an existing file is returned, anything else gives `null`)
  - `makePreview(string $original, ?int $timeoutSeconds = null): bool` (default timeout is `(int) getenv('ANTHROPOTOMY_PREVIEW_TIMEOUT')` when set, else 90; never throws)
  - `removePreview(string $original): void`
  - `previewOriginalAllowed(bool $isTeacher, bool $hasPreview, bool $allowDownload): bool` (the access rule: `$isTeacher || !$hasPreview || $allowDownload`)
- Stub behaviour (both scripts take the same arguments as LibreOffice: `... --outdir <dir> <input>`): if the input file contains `FAIL-CONVERT`, exit 1 with no output; if it contains `HANG-CONVERT`, sleep 300 seconds; otherwise copy `tests/fixtures/sample.pdf` to `<dir>/<input base name>.pdf`.

- [ ] **Step 1: Write `tests/preview.php`** (plain CLI script: exit non-zero with a message on the first failed assert; run as `C:/xampp/php/php.exe tests/preview.php`). Assertions, each with its name as the message:
  - `previewPath('/x/a.pptx') === '/x/a.pptx.preview.pdf'`; `previewFormats() === ['ppt','pptx','doc','docx']`.
  - `previewConverter()` returns the stub path when `ANTHROPOTOMY_SOFFICE` points at it and `null` when it points at a missing file.
  - With the stub: `makePreview($copyOfSamplePptx)` is `true`, the preview exists and starts with `%PDF`, and the work folder under `storage/` is gone afterwards.
  - Input containing `FAIL-CONVERT`: `false`, and no `.preview.pdf` left. A `.txt` file: `false`.
  - Input containing `HANG-CONVERT` with timeout `2`: returns `false` in under 6 seconds and the stub process is no longer running.
  - Two PHP processes started together (`proc_open` of this same script with an argument naming a different copy each) both finish with `true`.
  - `removePreview` deletes the preview and is harmless when there is none.
  - `previewOriginalAllowed`: teacher always true; student with preview and `allowDownload=false` is false; student with no preview is true; student with preview and `allowDownload=true` is true.
- [ ] **Step 2: Run it.** Expected: FAIL (`database/preview.php` missing).
- [ ] **Step 3: Implement `database/preview.php` and the two stubs.** Approach: `proc_open` with an argument array; per run a unique work folder `storage/preview-work/<random>/` holding `profile/` and `out/`, deleted in a `finally`; poll `proc_get_status` against the deadline and `proc_terminate` (on Windows also `taskkill /T /F /PID`) when it expires; validate the first four bytes of the output before moving it to `previewPath()`; treat a missing `proc_open` (function absent or listed in `disable_functions`) as no converter; log one line with `error_log` on failure.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 2: Schema columns and the direct-link deny rule

**Files:**
- Modify: `database/migrate.php`, `uploads/.htaccess`
- Create: `tests/uploads-access.ps1`

**Interfaces:**
- Produces: columns `lessons.allow_download` and `teacher_files.allow_download` (Global Constraints); a deny rule matching the five patterns there.

- [ ] **Step 1: Write `tests/uploads-access.ps1`.** It creates throwaway files `zz-access-check.pptx`, `.docx`, `.pptx.preview.pdf`, `zz-access-check.pdf`, `zz-access-check.png` in `uploads/lessons/`, requests each through `http://localhost/Anthropotomy/uploads/lessons/<name>` (the XAMPP Apache site: the PHP test server ignores `.htaccess`), prints one line per file, removes the files, and exits 1 on any mismatch. Expected: the first three answer 403; the `.pdf` and `.png` answer 200.
- [ ] **Step 2: Run it.** Expected: FAIL (the Office files answer 200).
- [ ] **Step 3: Add the rule to `uploads/.htaccess`** as a second `FilesMatch` block using `Require all denied`, matching `\.(pptx?|docx?)$` and `\.preview\.pdf$`.
- [ ] **Step 4: Add the two `addColumnIfMissing` lines to `database/migrate.php`** (definition `TINYINT(1) NOT NULL DEFAULT 0`), then run `C:/xampp/php/php.exe database/migrate.php` twice. Expected: no error the second time.
- [ ] **Step 5: Verify.** Run `tests/uploads-access.ps1` (Expected: PASS) and `C:\xampp\mysql\bin\mysql.exe -u root anthropotomy_db -e "SHOW COLUMNS FROM lessons LIKE 'allow_download'; SHOW COLUMNS FROM teacher_files LIKE 'allow_download'"` (Expected: both rows show `tinyint(1)`, default `0`).
- [ ] **Step 6: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 3: One shared file-streaming function

**Files:**
- Modify: `api/helpers.php`, `api/files.php` (the `GET ?id=` block)
- Modify: `tests/integration.mjs` (add the raw-request helper and range checks)

**Interfaces:**
- Produces: `streamFile(string $path, string $contentType, bool $inline, string $downloadName): never` in `api/helpers.php`. It does what the current `files.php` block does: single byte-range support (206/416), `Accept-Ranges`, `Content-Length`, `Content-Disposition` (`inline` or `attachment`, ASCII fallback name plus `filename*`), `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `session_write_close()`, chunked output, then `exit`.
- Produces (test helper): the function returned by `client()` in `tests/integration.mjs` gains a `.raw(path, {headers})` method that returns the fetch `Response` with the same cookie.

- [ ] **Step 1: Write the regression checks** in `tests/integration.mjs` next to the existing files checks: upload `tests/fixtures/sample.pdf` as a material, then with `teacher.raw('files.php?id='+fid)` assert `status===200`, `content-type` is `application/pdf`, `content-disposition` starts with `inline`; with header `Range: bytes=0-9` assert `status===206`, `content-range` starts with `bytes 0-9/`, body length 10; with `Range: bytes=999999999-` assert `status===416`.
- [ ] **Step 2: Run `node tests/integration.mjs`.** Expected: FAIL only because `.raw` does not exist yet; after adding `.raw` the checks pass against the unrefactored code (this proves they describe today's behaviour).
- [ ] **Step 3: Move the block into `streamFile` and call it from `files.php`** (content type from `FILE_TYPES`, `inline` only for `pdf`, name `original_name`).
- [ ] **Step 4: Run `node tests/integration.mjs`.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 4: Materials API (`api/files.php`)

**Files:**
- Modify: `api/files.php`, `tests/integration.mjs`
- Test server: start it for this task with `ANTHROPOTOMY_SOFFICE` pointing at `tests/fixtures/fake-soffice.cmd` and `ANTHROPOTOMY_PREVIEW_TIMEOUT=5`.

**Interfaces:**
- Consumes: `makePreview`, `previewPath`, `previewSupported`, `removePreview`, `previewOriginalAllowed` (Task 1); `streamFile` (Task 3); the column (Task 2).
- Produces:
  - `POST files.php` (multipart) accepts `allow_download` (`'1'`/`'0'`) and returns the file row plus `preview: bool`.
  - `GET files.php?id=N&preview=1` streams the preview (`application/pdf`, inline, filename `<original name without extension>.pdf`), 404 when none; same `canOpenFile` check as the original.
  - `GET files.php?id=N` (original) answers 403 `This file is view-only.` when `!previewOriginalAllowed(...)`.
  - `PUT files.php?id=N` with JSON `{allow_download: bool}`: owner only (404 otherwise, as `DELETE` does); returns the updated flags.
  - List rows add `has_preview`, `allow_download`, `can_download` (booleans).
  - `DELETE` also calls `removePreview`.

- [ ] **Step 1: Write the failing checks** (names are the check messages):
  - `Material upload makes a preview`: upload `sample.pptx` as material in module `mid` → `up.data.preview===true`; list row has `has_preview===true`, `allow_download===false`.
  - `Preview streams inline as PDF`: `teacher.raw('files.php?id='+fid+'&preview=1')` is 200, `application/pdf`, body starts `%PDF`; a `Range: bytes=0-3` request is 206.
  - `Student gets the preview, not the original`: published module → student preview 200; student original `status===403` with message `This file is view-only.`; student list row has `can_download===false`.
  - `Teacher switch opens the original`: `teacher('files.php?id='+fid,'PUT',{allow_download:true})` succeeds; student original is now 200 with `attachment`; student row `can_download===true`; switching back restores 403.
  - `Unpublished module hides the preview`: set the module to draft → student preview and original both 404.
  - `Another teacher cannot change the switch`: a second teacher fixture gets 404 from `PUT`.
  - `Lesson plan previews stay private`: a `lesson_plan` upload of `sample.pptx` → the owner gets the preview; a student and a second teacher get 404.
  - `Fake deck uploads with no preview`: upload a file named `bad.pptx` whose bytes are `PK\x03\x04` followed by `FAIL-CONVERT` → `success`, `preview===false`; student original is 200 (no preview, so it downloads).
  - `Hung converter returns in time`: bytes `PK\x03\x04HANG-CONVERT` → response in under 15 s with `preview===false`; the work folder `storage/preview-work/` is empty afterwards.
  - `Two simultaneous uploads both get previews`: `Promise.all` of two `sample.pptx` uploads → both `preview===true`.
  - `Unusual name streams`: upload `sample.docx` as `Ligaments & Joints - réview.docx` → preview 200 and the `content-disposition` header contains `filename*=UTF-8''`.
  - `Delete removes the preview`: count the files matching `storage/files/*.preview.pdf` before and after `DELETE files.php?id=N` of a deck material; the count drops by exactly one.
  - `PDF materials are unchanged`: `sample.pdf` upload → `preview===false`; student original is 200 even with `allow_download` off.
- [ ] **Step 2: Run `node tests/integration.mjs`.** Expected: the new checks FAIL.
- [ ] **Step 3: Implement the changes in `api/files.php`.** Compute `has_preview` with `is_file(previewPath(FILE_STORE . $stored_name))`; reuse one helper `fileFlags(array $file, bool $isTeacher): array` for list rows and the single-file gate; make the preview in the upload branch after `move_uploaded_file` and never fail the upload because of it.
- [ ] **Step 4: Run `node tests/integration.mjs`.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 5: Lessons API (`api/lessons.php`)

**Files:**
- Modify: `api/lessons.php`, `tests/integration.mjs`
- Same test-server settings as Task 4.

**Interfaces:**
- Consumes: Task 1 and Task 3 functions; the column.
- Produces:
  - `_lessonFilePath(?string $mediaUrl): ?string` (the resolve-inside-`UPLOAD_DIR` logic now inside `_deleteLessonFile`, extracted so streaming and deleting share it); `_deleteLessonFile` also removes the preview.
  - Create (`POST`) and update (`POST ?id=`, `PUT`) accept `allow_download`; create and multipart-update responses add `preview: bool`.
  - `GET ?id=N` adds `has_preview`, `allow_download`, `can_download`, `view_url`, `download_url` (the two URLs are `<api folder>/lessons.php?id=N&file=preview|original`, or `null` when none or not allowed).
  - `GET ?module_id=N` rows add `has_preview` and `can_download`.
  - `GET ?id=N&file=preview|original` streams after the existing student checks (published lesson in a published module); `original` follows the access rule; 404 when no such file.

- [ ] **Step 1: Write the failing checks:**
  - `Lesson deck gets a preview`: create a lesson with `sample.pptx` → `data.preview===true`; `GET ?id` has `has_preview`, `view_url` set, `allow_download===false`.
  - `Student views, cannot download`: student `file=preview` is 200 `application/pdf`; `file=original` is 403 `This file is view-only.`; student `can_download===false` and `download_url===null`; the module list row has `has_preview===true`, `can_download===false`.
  - `Switch on lets students download`: `PUT ?id` with `{allow_download:true}` → student `file=original` 200 attachment; `download_url` non-null.
  - `Draft lesson files are denied`: set the lesson to draft → student `file=preview` and `file=original` are 403.
  - `Legacy deck without a preview still downloads`: delete `<file>.preview.pdf` from disk with `fs.unlinkSync` → `has_preview===false`, student `can_download===true`, student `file=original` is 200 (Review Focus 1).
  - `Fake deck uploads with no preview`: `PK\x03\x04FAIL-CONVERT` as `bad.pptx` → success, `preview===false`, student can download (Review Focus 2).
  - `Replacing a deck with a PDF removes the preview`: multipart update with `sample.pdf` → the old `.pptx` and its `.preview.pdf` are gone from `uploads/lessons/`, `has_preview===false`, student `file=original` is 200 (Review Focus 5).
  - `Removing the file removes the preview` (`remove_media=1`), and `Archiving keeps the preview` (`DELETE` then `fs.existsSync` true).
  - `Spaced and accented title streams`: lesson titled `Joints & ligaments — révision` → `file=preview` 200 with a `filename*=UTF-8''` disposition.
  - `Two simultaneous lesson uploads both get previews`.
  - `PDF lessons are unchanged`: `sample.pdf` lesson → `has_preview===false`, student `can_download===true`.
- [ ] **Step 2: Run `node tests/integration.mjs`.** Expected: new checks FAIL.
- [ ] **Step 3: Implement in `api/lessons.php`.** Reuse one `lessonFlags(array $lesson, bool $isTeacher): array` for single and list responses; make the preview right after the file is stored in both create and replace paths and never fail the save because of it.
- [ ] **Step 4: Run `node tests/integration.mjs`.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 6: `PdfViewer` can hide Download

**Files:**
- Modify: `assets/js/pdf-viewer.js`, `tests/content-browser.mjs`; bump `pdf-viewer.js` `?v=` in every page that loads it.

**Interfaces:**
- Consumes/Produces: the options object of `PdfViewer.mount` and `PdfViewer.open` already has `downloadUrl` (defaults to `url`). New rule: `downloadUrl: null` (or `''`) removes the toolbar Download button and the Download link of the "can't be shown" fallback; the fallback then shows only its message. `undefined` keeps today's default.

- [ ] **Step 1: Write the failing browser check** in `tests/content-browser.mjs`: open the viewer on the PDF fixture with `downloadUrl: null` and assert there is no `.pv-bar a[download]` and no `.pv-download`; open it with no `downloadUrl` and assert the button exists and its `href` is the PDF URL.
- [ ] **Step 2: Run `node tests/content-browser.mjs`** (server and browser as README describes). Expected: the null case FAILS.
- [ ] **Step 3: Implement** the two conditional renders in `build()` (the toolbar anchor around line 90 and the `failed` fallback around line 242).
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs`; `node --test "tests/unit/*.test.mjs"` still passes.

## Task 7: Student pages open the preview

**Files:**
- Modify: `student/lessons.html` (script block: `lessonCard`, `readLesson`, the materials rows in `viewModule`, the click handler), `assets/js/lesson-reader.js` (`media()` and `show()`), `tests/content-browser.mjs`; bump `lesson-reader.js` `?v=` everywhere it loads.

**Interfaces:**
- Consumes: list rows `has_preview`, `can_download`; single lesson `view_url`, `download_url`, `can_download` (Task 5); material rows `has_preview`, `can_download` (Task 4); `PdfViewer` null `downloadUrl` (Task 6).
- Produces: rendering rules:
  - Lesson row, kind `slides` or `document`: if `has_preview` an `Open` button (`.sd-file-go`, row marked `data-preview="1"`) that fetches the lesson and calls `PdfViewer.open({url: lesson.view_url, title, context, note, downloadUrl: lesson.can_download ? lesson.download_url : null})`; otherwise a Download link to `${API_BASE}/lessons.php?id=<id>&file=original` (never `media_url`).
  - Material row, Office file: if `has_preview` an `Open` button opening `files.php?id=N&preview=1` with `downloadUrl` set to `files.php?id=N` only when `can_download`; otherwise a Download link as today.
  - The hint appears only when at least one rendered row is a Download link for an Office file.
  - `lesson-reader.js` `media()` for `ppt/pptx/doc/docx` mounts `PdfViewer` on `view_url` (wide reader page) when present, else shows the API download link.

- [ ] **Step 1: Write the failing browser checks** (student session, module with: a published deck lesson with preview, a deck lesson without preview, a deck material with preview, a PDF lesson): the deck-with-preview row says `Open` and has no `a[download]`; clicking it shows `.pv-overlay` with no download button; after the teacher turns `allow_download` on, reopening shows the button and its `href` contains `file=original`; the no-preview row is a Download link whose `href` contains `lessons.php?id=` and not `uploads/`; the hint is visible only while a Download row exists; the PDF lesson still opens as before.
- [ ] **Step 2: Run `node tests/content-browser.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement** the rules above; keep the PDF branches untouched.
- [ ] **Step 4: Run it again.** Expected: PASS. Also open `student/lessons.html` in the browser pane and look at it.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 8: Teacher pages (open the preview, the switch, upload feedback)

**Files:**
- Modify: `assets/js/teacher-files.js`, `assets/js/module-workspace.js` (`download`, `preview`), `assets/js/lesson-sheet.js`, `tests/content-browser.mjs`; bump the three scripts' `?v=` in every page that loads them.

**Interfaces:**
- Consumes: Task 4 and 5 fields and endpoints; Task 6 option.
- Produces:
  - `teacher-files.js` (both modes): rows with `has_preview` get an `Open` action (viewer on `files.php?id=N&preview=1`, `downloadUrl: files.php?id=N`) and keep Download in the more menu; the meta text says `downloads` only when there is no preview; the upload form (materials only) gets a checkbox `Let students download this file`, unchecked, sent as `allow_download`; the more menu gets `Allow student downloads` / `Make view-only` calling `PUT files.php?id=N`; while uploading an Office file the submit control reads `Preparing slides for viewing…` (Word: `Preparing document for viewing…`); the success toast uses the exact success or fallback text from Global Constraints according to `data.preview`; the hints (`PDFs open in the viewer; PowerPoint and Word files download…`) are rewritten to match.
  - `module-workspace.js` `preview(lesson)` for `slides`/`document`: fetch the lesson, open the viewer on `view_url` with `downloadUrl: download_url` when `has_preview`, otherwise download `download_url`; the `download(lesson)` helper uses `lessons.php?id=N&file=original`.
  - `lesson-sheet.js`: a switch `Let students download this file` (name `allow_download`, initial value from the lesson) shown only while the chosen or saved file is `slides` or `document`; `STUDENTS_GET.slides` and `.document` become `Students read it here in the viewer`; while saving an Office file the note shows the progress text; after save the toast reflects `result.data.preview` as above. The file-size lookup in `drawAttach()` (a `HEAD` request on the saved file) must use the lesson's `download_url` for `slides` and `document` files, because their direct `media_url` now answers 403.

- [ ] **Step 1: Write the failing browser checks** (teacher session): no request the lesson sheet makes for a saved deck gets a 403 (check the network log while editing it); the materials upload form has the checkbox, unchecked; uploading `sample.pptx` shows the progress text and then the success toast; the new row's Open action opens the viewer; the more menu offers `Allow student downloads`, and choosing it flips to `Make view-only` and the list row's `can_download` for a student becomes true (checked through the API); the lesson sheet shows the switch for a deck and hides it for a PDF; a fake deck (`FAIL-CONVERT`) shows the fallback toast; the module workspace Preview on a deck opens the viewer.
- [ ] **Step 2: Run `node tests/content-browser.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement** the three scripts as specified (the test server for this task keeps the stub converter).
- [ ] **Step 4: Run it again.** Expected: PASS. Then open `teacher/modules.html?module=<id>` in the browser pane and look at the workspace, the sheet and the upload form.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs`; `node tests/navigation.mjs` still passes.

## Task 9: Backfill script for existing files

**Files:**
- Create: `database/convert_previews.php`; extend `tests/preview.php`.

**Interfaces:**
- Consumes: `makePreview`, `previewPath`, `previewSupported` (Task 1).
- Produces: `php database/convert_previews.php [--dry-run]` walks `uploads/lessons/` and `storage/files/`, skips files that already have a preview or are not supported, converts the rest, and prints `made N, skipped N, failed N`. CLI only (same guard as the other scripts). Exit code 0 even when some files fail; 1 when no converter is found.

- [ ] **Step 1: Extend `tests/preview.php`:** point `ANTHROPOTOMY_SOFFICE` at the stub; in a temp copy of the folder layout place `a.pptx`, `b.docx`, `c.pdf`, `d.pptx` containing `FAIL-CONVERT`; run the script with `--dry-run` (expected output `made 0`, `skipped` counting `c.pdf`, no files created) and then for real (expected `made 2, skipped 1, failed 1`), then again (expected `made 0, skipped 3, failed 1`). With the env var pointing at nothing: exit code 1. (Give the script an optional `ANTHROPOTOMY_PREVIEW_ROOT` environment variable that replaces the project root, so the test never touches real files.)
- [ ] **Step 2: Run `C:/xampp/php/php.exe tests/preview.php`.** Expected: FAIL.
- [ ] **Step 3: Implement the script.**
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Checkpoint:** `node tests/check-syntax.mjs` passes.

## Task 10: Real LibreOffice, documentation and deploy notes

**Files:**
- Modify: `README.md`, `docs/deploy-infinityfree.md`, `docs/deploy-oracle.md`

- [ ] **Step 1: With the user's OK, install LibreOffice** (Task 0 Step 1). Confirm `C:\Program Files\LibreOffice\program\soffice.exe` exists, then clear `ANTHROPOTOMY_SOFFICE` in the shell.
- [ ] **Step 2: Real conversion check.** Run `C:/xampp/php/php.exe -r "require 'database/preview.php'; copy('tests/fixtures/sample.pptx','storage/zz.pptx'); var_dump(makePreview('storage/zz.pptx')); echo filesize('storage/zz.pptx.preview.pdf');"` and the same for `sample.docx`. Expected: `bool(true)` and a non-zero size; then delete the temporary files. (The first run can take 10 to 20 seconds.)
- [ ] **Step 3: End-to-end in the live site** (XAMPP Apache, `http://localhost/Anthropotomy`): as `demoteacher` upload a real deck as a lesson and as a material; as `demostudent` confirm both open in the viewer with no Download button; turn the switch on and confirm the button appears and returns the `.pptx`; run `tests/uploads-access.ps1` (Expected: PASS). Run `php database/convert_previews.php` once (Expected: `failed 0`).
- [ ] **Step 4: Documentation.** In `README.md` replace every statement that PowerPoint and Word files download, describe the preview, the `allow_download` switch, the view-only limit (screenshots and saved pages are not prevented), `convert_previews.php`, and the `ANTHROPOTOMY_SOFFICE` / `soffice=` settings. In `docs/deploy-infinityfree.md` add: previews made on this PC travel with `uploads/` and `storage/`; there is no converter on that host so new uploads there fall back to download; after the first deploy open the direct address of a `.pptx` in `uploads/lessons/` and confirm it answers 403. In `docs/deploy-oracle.md` add `sudo apt install libreoffice-impress libreoffice-writer` and then `php database/convert_previews.php`.
- [ ] **Step 5: Final checkpoint.** Run, in order: `C:/xampp/php/php.exe tests/preview.php`, `node tests/check-syntax.mjs`, `node --test "tests/unit/*.test.mjs"`, the integration suite, `node tests/content-browser.mjs`, `node tests/navigation.mjs`, `tests/uploads-access.ps1`. Expected: all pass. Remove the isolated test database as README describes and delete `storage/preview-work/` if it exists.
