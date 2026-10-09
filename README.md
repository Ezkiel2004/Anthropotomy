# Anthropotomy

*Explore. Learn. Understand.*

An interactive anatomy learning system with teacher and student portals. Application data is read from PHP APIs backed by MySQL/MariaDB. Student records, lessons, assessment results, school settings, anatomy descriptions, model URLs, achievement goals, and report grading thresholds are stored in the database.

## Start using this installation

1. Start Apache and MySQL in XAMPP, then open http://localhost/Prototype2/. That is the public landing page; choose **Sign in**, or go straight to http://localhost/Prototype2/login.html.
2. Sign in with your existing teacher account. Teacher accounts and their passwords were preserved.
3. Open **School & Anatomy Content**. Set the school name, school year, subject, default grade, recovery contact, and report grading thresholds. Blank settings are shown as unconfigured, not replaced by sample school details.
4. Use **Students → Add Student** to enter real student information. Each student needs an explicit password, grade level and school year. No shared default student password is supplied.
5. Use **Modules** to create or edit modules and add lessons. Publish both the module and lesson to make them available to students. Reading text, uploaded images, PDFs, videos and GLB attachments are supported.
6. Use **Assessments** to create questions, set attempt limits and passing scores, then publish the assessment. Teachers can configure identification, multiple-choice, true/false and image hotspot questions.

## Anatomy content

Teachers can open **Explore 3D Anatomy** from the dashboard or **3D Anatomy Explorer** in the sidebar. Teacher view includes hidden systems and links to edit the selected system or open its related module lessons. **Student preview** shows only systems visible to students, using the same viewer and descriptions. Neither teacher mode records student exploration progress. For class demonstrations, use the viewer's **Fullscreen** button: it hides portal navigation while keeping the controls and info panel; press Escape or the button again to return.

The explorer shows a layered whole body. Each body system is a toggle; any combination can be switched on, and a system downloads the first time it is switched on. Selecting a part glides the camera to it, fades everything else and shows the part's name, system, description and function. Esc, **Back to full body** or a click on empty space returns to the full view. Every part carries its anatomical name (for example "Femur (left)") and, where Z-Anatomy provides one, a short definition. A part without a name would shoThe layered models are in `system_model/layers/`, one GLB per system: skeletal (bones plus joints and ligaments), muscular, circulatory (heart, arteries and veins), nervous (brain, spinal cord, nerves and sense organs), lymphatic, respiratory (with the pleura), digestive (with the peritoneum), urinary, reproductive and endocrine. They are exported from `Z-Anatomy.blend` with `tools/blender/export_layers.py`, which copies each structure's finished geometry (modifiers applied, vessel and nerve curves turned into meshes), leaves out text labels, helper objects, muscle-attachment overlays and anatomical variants, welds and reduces each part to about 30% of its triangles, compresses with Draco and embeds each part's ID (`za_` plus its Z-Anatomy name, e.g. `za_femur_l`), name, definition and system. The script never changes or saves the .blend file. `node tests/layers-asset.mjs` checks the exported files against `system_model/layers/manifest.json`. After exporting, run `C:/xampp/php/php.exe database/integrate_layers.php` to connect every exported system (pass system codes to connect only some). The source model is Z-Anatomy (CC BY-SA 4.0), with definitions from Wikipedia (CC BY-SA); the reduced files are shared under the same licence and credited in each system's sources. shared under the same licence and credited in each system's sources.

A teacher can still upload a GLB in the Media Library and choose its URL in School & Anatomy Content, along with the system description, key facts, structure descriptions and source/attribution information. A model that was not made by the layered export is shown on its own. A structure's optional model part name maps its description to a named mesh or parent group in the GLB file, or to a part ID such as `za_femur_l` in the layered models.

The explorer loads the configured real model. Systems without models still display their database content with an explicit model-unavailable state. No procedural substitute model is displayed, and the static panel content described below cites its sources. Quick practice uses the structure descriptions configured by the teacher and does not award assessment grades.

## 3D Anatomy Explorer

`student/anatomy.html` and `teacher/anatomy.html` share one explorer. The navy viewer fills the content area below the top bar:

- **Body systems panel** (top-left, beside the toolbar): one card listing every system with an on/off switch; each row shows loading progress, "No 3D model yet" or a retry state. Its header shows how many systems are on and collapses or expands the list; the choice is remembered (open by default on desktop, closed on phones).
- **Toolbar** (left edge; a bottom bar on phones): zoom in, zoom out, reset view, auto rotate, save image, fullscreen and the info panel toggle. Every button has a tooltip.
- **Info panel** (right overlay; a bottom sheet on phones): the system's summary, the selected part or structure, description, functions, structures, "Did you know?" facts, quick practice, related lessons (teachers) and sources. Its open or closed state is remembered in the browser (`anatomy.panelOpen`).

| Key | Action |
|---|---|
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `R` | Reset view |
| `A` | Auto rotate |
| `F` | Fullscreen |
| `I` | Info panel |
| `S` | Save image (`anatomy-<system>-<YYYYMMDD>.png`) |
| `Esc` | Leave the selected part, then fullscreen |

Shortcuts are ignored while typing in a form field or when Ctrl, Alt or Cmd is held. The toolbar is one Tab stop; the arrow keys move between its buttons.

**Running it locally.** Start Apache and MySQL in XAMPP and open `http://localhost/Anthropotomy/login.html`. The pages must be served over HTTP: opening them as `file://` blocks the GLB model downloads. Three.js r128 is vendored in `assets/vendor/three/`, so no build step or internet access is needed for the viewer.

**Code layout.** `assets/js/model-viewer.js` is the layered Three.js engine (global `AnatomyViewer`). The explorer page itself is ES modules in `assets/js/explorer/`: `main.js` (start-up, chips, toolbar, shortcuts, analytics), `viewer.js` (engine wrapper: zoom, reset, rotate, save, fullscreen, highlight), `panel.js` (info panel), `data.js` (static panel content), `format.js` (pure helpers, unit tested), `icons.js` (inline SVG icons) and `teacher.js` (teacher-only tools). Styles are in `assets/css/explorer.css`.

**Adding a system and model.**

1. Put the GLB in place: export a layer with `tools/blender/export_layers.py` into `system_model/layers/`, or upload a GLB in the Media Library.
2. Connect it: run `C:/xampp/php/php.exe database/integrate_layers.php <system_code>` for an exported layer, or create or edit the system in **School & Anatomy Content** and choose the model URL. A system without a model still appears, with its content and an empty-state message in the viewer.
3. Add the panel content: add an entry to `systems` in `assets/js/explorer/data.js` whose `id` is the system's `system_code`, with `summary`, `description`, `functions`, `trivia` and `sources` (links to the pages the facts come from).

Teachers edit the description, key facts (shown as extra "Did you know?" facts), structures, model and source note in **School & Anatomy Content**; the database description replaces the `data.js` one when it is filled in. The summary, functions, trivia and source links live only in `data.js`.

## Database behavior

- The requested cleanup removed 10 sample student accounts and 36 lessons, with dependent student progress and submissions removed by foreign keys. Both teacher accounts were preserved.
- Existing database-managed body systems, modules, assessments, announcements and media were preserved. They are editable content, not frontend fixtures. Review and publish only the content intended for the new students.
- The installer SQL now contains structure only. It creates no demo teachers, students, lessons, scores, announcements or default school identity.
- The live database migration added app_settings, anatomy_content, achievement_rules, notification_receipts and quiz deadline/draft fields without replacing the existing teacher accounts. Announcement audiences now support actual student section names rather than a fixed section list.
- A complete pre-cleanup backup and the original supplied SQL export are kept outside the web directory, in a private backups folder on the development machine (never in this repository). The live backup is before-cleanup-20260912-183309.sql; the original export is original-export-1789230304747.sql.
- To restore, import a backup into a separate recovery database using phpMyAdmin, verify it, then deliberately switch the application database if needed. The backup contains account hashes and school records and should not be served publicly.

## Quiz and reporting rules

Quiz answers are graded on the server. Identification keys and hotspot answer coordinates are omitted from student question responses. Hotspot questions use a teacher-selected image, target location and tolerance; they do not use a fixed heart diagram.

Answers are saved during an attempt. Refreshing resumes the same attempt with its saved answers and remaining server time. When the deadline has passed, the server grades only answers saved before that deadline. Repeated submission requests return the existing grade. Editing/deleting questions and changing grading rules are blocked after the first attempt to preserve historical results.

Average quiz score is the mean of a student's graded attempts. The class average is the mean of those student averages. Participation counts distinct student/assessment pairs for active assessments. Trend charts use actual submission dates. Achievement goals and report grade thresholds are configurable; no goals or report grading policy are invented for a fresh installation.

Lesson completion is a student's self-reported progress marker, not proof of mastery. Active reading time is measured separately and bounded on the server. Use assessment results when evaluating understanding.

## Fresh installation

Requires PHP 8.1 or newer, PDO MySQL, fileinfo, mbstring, Apache and MySQL/MariaDB. The included XAMPP PHP was used for validation.

1. Create an empty database named anatomiq_db in phpMyAdmin.
2. Configure ANATOMIQ_DB_HOST, ANATOMIQ_DB_NAME, ANATOMIQ_DB_USER and ANATOMIQ_DB_PASS in the server environment as needed. Local XAMPP defaults are used when absent.
3. From the project directory run:

~~~powershell
& C:/xampp/php/php.exe database/schema.php
~~~

4. For a new installation only, set ANATOMIQ_BOOTSTRAP_USERNAME, ANATOMIQ_BOOTSTRAP_NAME, ANATOMIQ_BOOTSTRAP_TEACHER_ID and ANATOMIQ_BOOTSTRAP_PASSWORD in the process environment, then run database/create_teacher.php with PHP. Remove the password variable afterward. Existing installations do not need a new teacher account.
5. For future non-destructive schema upgrades run database/migrate.php with PHP.

Maintenance scripts are CLI-only and database/, tests/ and .runtime/ are denied web access by Apache rules. Do not run reset or cleanup scripts as routine setup. Never use a production database for integration tests.

Password recovery is teacher-managed. The public recovery form shows the configured contact, and a signed-in teacher can reset a student's password from the student profile. No email delivery is claimed and reset tokens are never exposed. Password changes invalidate existing sessions; HTTPS enables the secure cookie flag automatically.

## Public pages

`index.html` is the public landing page and `login.html` holds sign-in, registration, the teacher-managed password recovery dialog and the terms (`login.html#login`, `#register` and `#terms` link straight to each). Signing out from either portal returns to `login.html`. Both pages use `assets/css/public.css`; the portals keep their own styles.

The landing page shows only real information. The school name and the number of active body systems come from `api/config.php` and stay hidden when the API returns nothing or is unreachable. The feature figures are simplified drawings of the real student pages with generic labels.

On tablets and larger screens the hero loads the vendored Three.js build and the skeleton model from `system_model/` after the static poster is visible, unless the visitor prefers reduced motion or has Save-Data on. If WebGL, the scripts or the model are unavailable, the poster simply stays. The model is credited in the footer (CC BY 4.0, Ruslan Gadzhiev).

### Building the public pages

Nothing here is needed to run the site: the compiled CSS, fonts and images are committed, so XAMPP serves the files as they are. To change the public pages' styles or regenerate their images, install Node.js 20 or newer and run, from `landing-src/`:

~~~powershell
npm install
npm run build:css        # Tailwind CLI: src/public.css -> assets/css/public.css (minified)
npm run watch:css        # rebuild on save while editing index.html or login.html
npm run check:contrast   # checks every colour pair in the design tokens
npm run build:assets     # hero poster (AVIF/WebP/PNG), brand mark and favicons from uploads/images/
npm run build:og         # assets/brand/og-image.jpg, rendered in Chromium
~~~

Design tokens live in the `@theme` block of `landing-src/src/public.css`; Tailwind's default palette, radii, shadows and type sizes are cleared so only those tokens exist. Fonts (Instrument Serif, Plus Jakarta Sans, JetBrains Mono) are self-hosted in `assets/fonts/` under the SIL Open Font License. `landing-src/node_modules/` is ignored by Git. Advance the `?v=20261005-landing1` query on the public pages' assets when you change them.

## Shared navigation

All teacher and student pages load their portal sidebar from assets/js/sidebar.js. Update navigation there so links, labels, icons and section headings stay consistent across pages. The shared toggle supports desktop collapse, mobile drawers, overlay dismissal and Escape.

Apache revalidates HTML and shared navigation assets through the root .htaccess. Sidebar page links and asset URLs carry a release version so old cached page copies do not reappear when changing sections. After this update, open http://localhost/Prototype2/teacher/dashboard.html?nav=20261005-brand1 once to load the current navigation. Advance the navigation version in sidebar.js and the shared asset versions in portal pages when releasing future navigation changes.

## Verification

The completed validation passed 72 integration checks and browser checks across 19 portal pages, including student registration, quiz refresh/resume, real GLB rendering, teacher/student anatomy layouts, hidden-system preview filtering, the explorer's full-bleed layout, panel persistence, fullscreen fallback and layer disposal. Syntax checks passed for 30 JavaScript files/blocks, 8 ES modules and 42 PHP files, with static local file references also checked; 23 unit tests passed. Teacher exploration was verified to send no student progress records. The temporary test database and credentials were removed afterward.

~~~powershell
node tests/check-syntax.mjs
~~~

Unit tests for the layered viewer's helpers run with `node --test "tests/unit/*.test.mjs"`. `node tests/layers-asset.mjs` validates the exported layer files.

The syntax check also compiles the public pages' ES modules. Outside XAMPP on Windows, set PHP_BINARY (or have `php` on PATH); the integration suite uses the same setting.

The integration suite uses an isolated database whose name must begin with anatomiq_test_. tests/database.php refuses to create, expire attempts or remove a database outside that prefix. Set ANATOMIQ_DB_NAME to a unique test name, run tests/database.php setup, and launch a separate PHP development server on 127.0.0.1:8091 using tests/router.php. Then run tests/integration.mjs. The browser suite uses a separate headless Chrome profile with a desktop-sized window (for example --window-size=1366,900; the default 764×485 window triggers the mobile layouts) and debugging port 9225 and runs after the integration suite. It first checks the public landing page (one h1, sequential headings, real sign-in and registration links, no outdated product name), then signs in through login.html and checks the real student creation form, quiz refresh/resume, all portal pages, a real GLB load and mobile anatomy layout.

The focused sidebar regression suite, node tests/navigation.mjs, covers the 11 teacher pages and 7 student pages (scores.html redirects to My Progress & Scores). It verifies complete and consistent menus, active links, icons, profile links, desktop collapse and mobile controls. The student sidebar has five links; notifications and settings open from the top bar. Run it against a fresh isolated test database and the same server/browser setup; it creates its own student fixture and does not require the integration suite.

Finish by stopping the temporary server/browser and running tests/database.php cleanup with the same test database name. Test credentials and screenshots are stored only under .runtime/, excluded from source control and denied web access.

## Interface icons

Teacher and student portals use a shared, locally served Phosphor SVG icon set selected through Supericons. The public pages use the same sprite; their additional regular-weight icons (x, pause, play, hand-grabbing, file-pdf, textbox, list-checks, toggle-left, crosshair) come from the same Phosphor set (`@phosphor-icons/core`). Navigation, dashboard cards, notifications, media types, modal controls, and common actions share the same family. See assets/icons/README.md for usage and assets/icons/LICENSE for attribution. Branding and database-configured anatomy symbols remain separate.

## Supplied skeletal model

The bundled `system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb` is used by the landing page hero. The anatomy explorers use the layered models in `system_model/layers/` instead (see Anatomy content). `database/integrate_skeleton.php` remains for installations that want the single-mesh skeleton connected to the Skeletal System.
