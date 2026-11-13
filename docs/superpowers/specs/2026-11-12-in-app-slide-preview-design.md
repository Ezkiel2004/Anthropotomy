# View-only PowerPoint and Word files inside the system

Date: 2026-11-12. Status: draft for review.

## Why

Students must download a PowerPoint (.ppt, .pptx) or Word (.doc, .docx) lesson before they can read it. PDFs already open
inside the app in the PDF viewer. The goal: a student clicks a PowerPoint or Word lesson and reads it inside the system
with view-only access. Downloading is optional, and the teacher decides per file whether students may download.

This is the first of three pieces of work. The second (PPTX and PDF lessons for each body system, with images from the
3D models) and the third (quizzes of at least 10 questions linked to those lessons) each get their own spec after this
one ships.

## What exists today

- `assets/js/lesson-reader.js` shows a "Download the slides" link for `.ppt` and `.pptx`, and a plain "Open the lesson
  attachment" link for Word. `student/lessons.html` builds its own rows: a PowerPoint or Word lesson or material is a plain
  `Download` link. Only `.pdf` opens in `PdfViewer`.
- `api/files.php` serves module materials and lesson plans from `storage/files/` with access checks, and sends
  `Content-Disposition: attachment` for everything except PDF.
- Lesson files (`api/lessons.php`) live in `uploads/lessons/`, which Apache serves directly, and clients link to them
  through `media_url`. Anyone with the link can fetch them.
- `deploy/package-infinityfree.ps1` and `deploy/export-local.ps1` copy `uploads/` and `storage/` as whole folders.
- This PC has PowerPoint but no LibreOffice. PHP here has `proc_open` enabled. InfinityFree cannot run programs.
- The `lessons` and `teacher_files` tables have no download setting.

## Decision

Convert on upload and keep a PDF copy ("preview") next to the original. Students read the preview in the existing PDF
viewer. A per-file setting, `allow_download`, decides whether students may also get the original file. It is off by
default, so students are view-only unless the teacher turns it on. LibreOffice is the converter. The system runs on this
PC first and on InfinityFree after it is finished, so previews are made on a machine with a converter and travel with the
files.

Rejected: attaching a PDF by hand for every deck (two uploads, copies drift apart); drawing PPTX in the browser with a
JavaScript library (slides look different from PowerPoint, and every student's browser does the work).

## Scope

In: .ppt, .pptx, .doc, .docx lesson files and module materials; students and teachers viewing them; the per-file download
setting; a command-line script to make previews for files uploaded earlier.

Out: PDF files keep today's behaviour (open in the viewer, with a download button). Lesson plans keep their owner-only
access. Attaching a PDF by hand for hosts without a converter (a later add-on). The lesson content and the quizzes
(separate specs).

## Access rules

For a PowerPoint or Word file that has a preview:

| Who | View in the app | Get the original file |
|---|---|---|
| Student, file's module published (lesson also published) | yes | only if `allow_download` is on |
| Teacher or admin | yes | yes |

If a file has no preview (no converter, or the file could not be converted), students can get the original even when
`allow_download` is off, because otherwise they could not open it at all. The teacher is told when this happens (see
section 4).

This is view-only, not copy protection. The viewer shows no Download button and students are never sent the original, so
nobody gets the editable file. A student can still screenshot the slides or save what the browser displays.

## Design

### 1. Converter (`database/preview.php`)

A library file, not an endpoint. It sits in `database/`, which Apache already blocks, and is loaded with `require_once`
like `connection.php`.

- `previewPath(string $original): string` returns `$original . '.preview.pdf'`. The suffix is appended to the full file
  name, so it never collides with a real PDF.
- `previewFormats(): array` is `['ppt', 'pptx', 'doc', 'docx']`.
- `makePreview(string $original): bool` converts one file and returns whether a valid preview now exists. It never
  throws.
  1. Returns false if the extension is not a preview format or no converter is found.
  2. Runs LibreOffice with `proc_open`: `--headless --norestore --convert-to pdf --outdir <temp folder>` and
     `-env:UserInstallation=<own profile folder under storage/>`, so a running copy of LibreOffice and a failed run never
     block each other. Macros stay off (the headless default).
  3. Kills the process after 90 seconds.
  4. Accepts the result only if the output file exists and starts with `%PDF`, then moves it to `previewPath()`.
  5. Removes any partial output on failure and writes one line to the PHP error log.
- `removePreview(string $original): void` deletes the preview if present.
- Finding LibreOffice: environment variable `ANTHROPOTOMY_SOFFICE`, then a `soffice=` line in `storage/db.ini`
  (the file `connection.php` already reads), then the usual locations
  (`C:\Program Files\LibreOffice\program\soffice.exe`, its x86 twin, `/usr/bin/soffice`, `/usr/bin/libreoffice`). If
  `proc_open` is disabled by the host, the converter counts as missing.

### 2. Storage and the download setting

- Lesson file `uploads/lessons/<name>.pptx` gets `uploads/lessons/<name>.pptx.preview.pdf`. Material
  `storage/files/<stored>.pptx` gets `storage/files/<stored>.pptx.preview.pdf`. A preview exists when its file exists, so
  there is no column for it.
- `database/migrate.php` adds `allow_download TINYINT(1) NOT NULL DEFAULT 0` to `lessons` and to `teacher_files`
  (repeatable, like the other migrations). Existing rows get 0, so existing PowerPoint and Word files become view-only as
  soon as they have a preview.
- Replacing or removing a lesson file, or deleting a material, removes its old preview with it. Archiving a lesson keeps
  its file and preview, as it keeps the file today.
- Lesson files and their previews must stop being fetchable by direct link, or view-only would mean nothing.
  `uploads/.htaccess` adds a rule that denies direct requests for `*.ppt`, `*.pptx`, `*.doc`, `*.docx` and
  `*.preview.pdf`, the same way it already denies `*.php`. Everything else under `uploads/` (photos, PDFs, video, models)
  is served as now. Materials already sit in `storage/`, which is never served directly.

### 3. API

All access checks run in PHP, so they are the same on this PC and on InfinityFree.

- `api/lessons.php`
  - After saving an uploaded lesson file (create and update), call `makePreview` and return `preview: true|false`. The
    save never fails because a preview could not be made. Create and update accept `allow_download`.
  - `GET ?id=N&file=preview` and `GET ?id=N&file=original` stream the preview (inline) or the original (attachment) with
    byte-range support, after the existing published-lesson check for students. `original` follows the access rules above
    and answers 403 "This file is view-only." otherwise.
  - `GET ?id=N` adds `has_preview`, `allow_download` and `can_download` (what this user may get), plus `view_url` and
    `download_url` (API URLs, or null). `GET ?module_id=` rows add `has_preview` and `can_download`, because the student
    lesson list chooses between "Open" and "Download" from the list rows. `media_url` stays in the data, but clients no
    longer link to it for these file types.
- `api/files.php`
  - After `move_uploaded_file`, call `makePreview` and return `preview: true|false`. Upload accepts `allow_download`.
  - `GET ?id=N&preview=1` serves the preview inline as `application/pdf`, using the existing `canOpenFile` check. `GET ?id=N`
    for the original answers 403 "This file is view-only." to a student when the rules above say so. The byte-range code
    moves into one function used by both paths.
  - `PUT ?id=N` with `allow_download` lets the owning teacher switch a material between view-only and downloadable.
  - List responses add `has_preview`, `allow_download` and `can_download`. `DELETE` removes the preview.

### 4. What people see

- Student lesson list (`student/lessons.html`): a PowerPoint or Word lesson or material with a preview is an `Open` button
  that opens the viewer (a lesson through `PdfViewer.open` on its `view_url`, a material through `files.php?id=N&preview=1`).
  Inside the viewer there is no Download button, unless `can_download` is true, in which case the button points to the
  original. A row with no preview stays a Download link. The hint "PDFs open here. PowerPoint and Word files download and
  open in the app on your device." is shown only when some row still downloads.
- Student lesson reader (`lesson-reader.js`): a PowerPoint or Word lesson with a preview mounts `PdfViewer` on `view_url`,
  on the wide page used for PDFs, with the Download button only when `can_download` is true.
- `PdfViewer` (`pdf-viewer.js`): a missing or null `downloadUrl` hides the toolbar Download button and the Download link
  shown when a document fails to load. PDFs keep passing their own URL as now.
- Teachers (`module-workspace.js`, `teacher-files.js`, `lesson-sheet.js`): open the preview in the viewer, and keep a
  Download action for the original. The lesson sheet and the materials upload form show a switch, "Let students download
  this file", for PowerPoint and Word files, off by default. A material's row menu gets "Allow student downloads" or
  "Make view-only". A row without a preview still says "downloads".
- Upload feedback: while the file uploads the button reads "Preparing slides for viewing…" ("Preparing document for
  viewing…" for Word files). On success: "Saved. Students can view it in the app." If no preview could be made: "Saved, but
  no preview could be made, so students will download this file instead." The old hints ("Students download it and open it
  in PowerPoint" and "PDFs open in the viewer; PowerPoint and Word files download") change to match.
- Cache versions on the changed scripts and pages are bumped, as usual in this project.

### 5. Existing files

`php database/convert_previews.php` walks `uploads/lessons/` and `storage/files/`, makes a preview for each supported file
that has none, and prints a count of made, skipped and failed. It is safe to run repeatedly.

## Errors and limits

- Conversion runs inside the upload request. PHP's `max_execution_time` here is 120 seconds, the converter's own limit is
  90, and the first LibreOffice start can take 10 to 20 seconds.
- A corrupt or password-protected file produces no preview, so students download it (see the access rules).
- Only teachers can upload, so only teacher-supplied files are ever converted.
- On InfinityFree there is no converter. Decks converted on this PC arrive with their previews and their setting (both
  deploy scripts copy `uploads/` and `storage/`, and the database export includes the new columns). A new upload there
  falls back to download until a preview exists.
- The deny rule in `uploads/.htaccess` relies on Apache. InfinityFree runs Apache, but after the first deploy the direct
  address of a PowerPoint file must be checked and must answer 403.

## Testing

- Unit: `previewPath`; converter discovery order; a missing converter and a disabled `proc_open` both return false; a
  fake converter that writes a non-PDF is rejected.
- Integration (`tests/`, using `tests/fixtures/sample.pptx` and `sample.docx`):
  - uploading creates a preview, and the preview is served inline as `application/pdf`;
  - a student of a published module gets the preview and gets 403 for the original while `allow_download` is off;
  - after a teacher turns `allow_download` on, the student gets the original;
  - a student cannot reach an unpublished module's preview, and a teacher cannot reach another teacher's lesson-plan
    preview;
  - the direct address `uploads/lessons/<name>.pptx` and its `.preview.pdf` answer 403;
  - deleting the file deletes the preview;
  - with the converter path pointed at nothing, the upload still succeeds with `preview: false` and the student can
    still download the original.
- Browser: a PowerPoint lesson opens in the viewer for a student with no Download button; with the switch on, the button
  appears and returns the original.

## Prerequisite

LibreOffice must be installed on this PC (about 350 MB, free). Nothing is installed until you say so; the planned command
is `winget install TheDocumentFoundation.LibreOffice`.
