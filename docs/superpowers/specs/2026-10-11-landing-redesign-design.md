# Landing Page Redesign, Part 1: Design

Date: 2026-10-11
Status: Approved in brainstorming, awaiting spec review

## Goal

Redesign the public pages around what the system does now, and make the landing page the home page for signed-in users.

1. A new visual direction for `index.html` and `login.html`: one dark theme, a sans-serif display face, one accent, real visuals from the system.
2. Content that shows students why the system helps them, using only real features: the layered 3D explorer (11 systems, named parts you can click), lessons, quizzes, progress.
3. A live 3D demo in the hero built on the explorer's own layer models: switch systems on, click a part, read its real name and definition.
4. After signing in, every user (student, teacher, admin) lands on the landing page, which shows their name and an **Open dashboard** button. The dashboards stay separate pages.

Part 2 (its own spec, after this one ships) restyles the shared portal frame (sidebar and top bar) and redesigns both dashboards with the design system defined here.

## Decisions

| Topic | Decision |
|---|---|
| Direction | "Interactive atlas" (option A of three: atlas, light study companion, scroll story). |
| Theme | One dark theme on both public pages. No light sections. |
| Palette | Navy-slate base: page `#0A111C`, surfaces in the explorer viewer's family (`#101C2E`). Near-white text, softer grey secondary text. One accent: the brand green `#3DDC97`, kept because the logo is green. Final values are fixed by the contrast script. |
| Type | Plus Jakarta Sans only (the portal's font), self-hosted: 400, 600, 800 and 800 italic. Instrument Serif and JetBrains Mono are removed. |
| Shapes | Pill buttons, toggles and chips; 16 px cards and panels; 12 px inputs; 4 px spacing grid; two shadow levels tinted to the background. |
| Icons | Existing Phosphor sprite, regular weight. |
| Hero 3D | A dedicated landing viewer. It reuses the vendored Three.js r128, GLTFLoader, DRACOLoader and Draco decoder, the layer GLBs in `system_model/layers/`, `AnatomyLayersCore`, and `AnatomyViewer.applySystemLooks` and `AnatomyViewer.studioEnvironment` (called without initialising `AnatomyViewer`), so colours, lighting and part data match the explorer. It does not use the `AnatomyViewer` engine itself, because that captures the mouse wheel and blocks touch scrolling. |
| Demo systems | Skeletal on by default. Muscular and Circulatory load the first time they are switched on. |
| Load policy | Automatic on screens 768 px and wider once the hero is visible and the page is idle, when WebGL works and neither reduced motion nor Save-Data is on. Everywhere else a **Try it in 3D (about 3.5 MB)** button loads it on request. |
| Visual assets | Build-time renders of all 11 layer GLBs (poster, systems gallery, share image) and one real screenshot of the explorer cropped to the 3D viewer. No drawn mock screens. |
| Numbers | Part counts come from `system_model/layers/manifest.json` at runtime and hide if it cannot be read. The school name comes from `api/config.php` and hides when empty or unreachable. |
| Signed in | Everyone lands on `index.html` after sign-in. Header and calls to action change; page content stays the same; links are role-aware. |
| Copy | Taste Skill rules: hero has at most 4 text elements and a subline of at most 20 words; at most 3 small labels above section titles on the page; one label per intent; no em or en dashes anywhere visible. |
| Delivery | Branch `claude/bold-wozniak-pwuizu`, restarted from `main` (the previous PR is merged). One pull request for part 1. |

## Out of scope

- Restyling the portal frame and both dashboards (part 2). Part 1 only makes the portal logo link to the landing page and switches the sidebar wordmark from Instrument Serif to Plus Jakarta Sans, because the serif font files are removed.
- Any change to the 3D Anatomy Explorer pages.
- Where signing out inside the portal goes (stays `login.html`).
- Returning to the page a user came from after signing in (`next=`).

## Files

New:

- `assets/js/landing-core.js`: pure ES module helpers, unit tested (role links, first name, session state, part totals).
- `tests/unit/landing-core.test.mjs`.
- `assets/img/systems/<system>-<width>.avif|webp`: renders of the 11 systems; `assets/img/hero-skeletal-<width>.avif|webp|png`: hero poster; `assets/img/explorer-part-<width>.avif|webp`: explorer screenshot.
- `landing-src/scripts/render-systems.mjs`: renders the layer GLBs in headless Chromium through a local HTTP server.
- `landing-src/scripts/capture-explorer.mjs`: screenshots the real explorer from a running test server with a part selected, cropped to the viewer.
- `landing-src/render/render.html`: the render harness page used by `render-systems.mjs`.

Changed:

- `index.html`: rebuilt.
- `login.html`: restyled in the new theme; behaviour and element IDs unchanged.
- `landing-src/src/public.css` and the compiled `assets/css/public.css`: new tokens and components.
- `assets/js/landing.js`: menu, signed-in state, part counts, reveals, quiz demo, 3D gate.
- `assets/js/landing-hero-3d.js`: rewritten as the layered demo viewer.
- `assets/js/login.js`: after sign-in, and when already signed in, go to the landing page; page titles without dashes.
- `assets/js/sidebar.js` (logo links to `../index.html`) and `assets/css/sidebar.css` (wordmark font), with new `?v=` values on the portal pages.
- `landing-src/scripts/contrast.mjs`, `landing-src/scripts/build-assets.mjs` (the poster step moves to the render script), `landing-src/og/og-image.html` and `assets/brand/og-image.jpg`.
- `tests/browser.mjs`, `tests/navigation.mjs`, `tests/authentication.ps1`: sign-in lands on the landing page; landing checks for both states.
- `README.md`: Public pages, Building the public pages, Supplied skeletal model.

Removed:

- `assets/fonts/instrument-serif-*`, `assets/fonts/jetbrains-mono-*` and their licence files.
- `assets/img/hero-skeleton-*` (the old poster cropped from `uploads/images/sidebar_bg.png`).

Unchanged: `api/*`, `database/*`, `system_model/*`, the explorer pages and modules, `assets/js/model-viewer.js`, `assets/js/anatomy-layers-core.js`.

## 1. Page structure and content

The promise is "see it, click it, know it". Every claim maps to a real feature. Copy below is the draft; final wording may be tightened but not extended.

1. **Header** (64 px, one line on desktop). Logo and wordmark; **Explorer** (scrolls to the systems gallery) and **How it works** (scrolls to the three steps); **Sign in** and **Create account**. Signed in: "Hi, ‹first name›", **Open dashboard**, **Sign out**. Below 768 px the links move into the existing keyboard-operable menu panel.
2. **Hero** (split; copy left, demo right; fits the first viewport).
   - Headline: "Click any part of the human body."
   - Subline: "Switch body systems on in 3D, tap a part to see its real name, then test yourself." (17 words)
   - Buttons: **Create account** (primary), **Sign in** (secondary).
   - Right: the live demo (section 3) over its poster.
3. **Systems gallery.** "One body. Every system." (no count in the headline, so it cannot go stale when a layer is added) with one line: "Bones, muscles, vessels, nerves and organs, each with its own named parts. Turn them on alone or together." A horizontal scroll-snap row of 11 cards, each a real render with the system name and its part count from the manifest (for example "Skeletal · 686 parts").
4. **Click a part.** "Every part tells you what it is." A real explorer screenshot with a part selected, and three short notes: its name and definition; "Did you know?" facts with their sources; quick practice that is never graded.
5. **Lessons and quizzes.** "Lessons and quizzes in one place." An asymmetric pair:
   - Lessons: what one lesson can hold (reading, images, PDFs, videos, 3D models), shown as a real component, with one line about modules your teacher publishes.
   - Quizzes: the interactive practice demo of the four question types (identification, multiple choice, true or false, image hotspot). "Answers save as you go. Refresh and you are back in the same attempt with the time you had left." Labelled as practice; nothing is graded or sent.
6. **Progress.** "See how you are doing." A compact progress card in the empty state a new student sees. Empty values read "Not yet" (the page avoids dash characters, where the portal shows "—"). Notes: scores come from graded attempts; you mark lessons complete yourself, and assessments show what you understand; achievement goals come from your teacher.
7. **Three steps.** "Three steps to your first lesson." Create an account with your student ID; explore and learn; take quizzes and track your progress.
8. **Closing call.** "Bring your student ID and take a closer look." The same two buttons, and: "Forgot your password? Your teacher resets it; there is no email reset."
9. **Footer.** Logo, tagline "Explore. Learn. Understand.", school name (when configured), links (Create account, Sign in, Terms and Conditions via `login.html#terms`), "Teachers and administrators sign in here too", and credits: Z-Anatomy 3D models (CC BY-SA 4.0); NIH 3D Human Reference Atlas organs (CC BY 4.0); part definitions from Wikipedia via Z-Anatomy (CC BY-SA); "Did you know?" facts from OpenStax Anatomy and Physiology 2e (CC BY 4.0).

Layout families: split hero, scroll-snap gallery, full-width screenshot with notes, asymmetric two-cell grid, card with notes, numbered steps, closing band. No more than two image-and-text splits in a row. At most three small labels above section titles on the whole page.

Page title: "Anthropotomy · Explore the human body in 3D". Login titles: "Sign in · Anthropotomy" and "Create your student account · Anthropotomy".

## 2. Design system

Tokens live in the `@theme` block of `landing-src/src/public.css`; Tailwind's defaults stay cleared so only these exist.

- **Colour roles:** page, surface, raised surface, decorative rule, UI border (at least 3:1), text, secondary text (at least 4.5:1 on every surface), accent, text on accent, focus ring (accent), error. Starting values: page `#0A111C`, surface `#101C2E`, text `#E8EEF5`, accent `#3DDC97`, text on accent `#0A111C`. The contrast script lists every pair and fails the build if one is below its minimum.
- **Type scale:** 14 / 16 / 18 / 20 / 24 / 32 / 40 / 56 px. Hero headline 40 px on phones and 56 px from 1024 px; weight 800, tracking about -0.02em, line height at least 1.1 (italic descenders need room). Body 16 to 18 px, line height 1.5 to 1.7, at most 65 characters per line. Numbers use tabular figures where the font provides them.
- **Shapes and depth:** pills for buttons, toggles and chips; 16 px for cards, panels and image frames; 12 px for inputs. Two shadow levels, tinted to the page colour.
- **Motion:** hero copy eases in on load (at most 400 ms); section visuals reveal once as they scroll in (opacity and transform only, staggered 40 ms); buttons press to 0.98 within 100 ms; the 3D crossfades from its poster in 400 ms. Under `prefers-reduced-motion` all of these are instant and auto-rotation stays off.
- **Focus and targets:** 3 px accent focus ring on every interactive element; every target at least 44 by 44 px.
- **Fonts:** self-hosted woff2 with `font-display: swap`; regular and extrabold are preloaded.

Part 2 adds a light content surface for the portal pages using the same type, accent, shapes and motion.

## 3. Live 3D demo

`landing.js` decides whether to start it; `landing-hero-3d.js` does the work.

- **Start:** loads `three.min.js`, `OrbitControls.js`, `GLTFLoader.js`, `DRACOLoader.js`, `anatomy-layers-core.js` and `model-viewer.js` in order (classic scripts), then sets the Draco decoder path to `assets/vendor/three/draco/`.
- **Scene:** sRGB output, ACES filmic tone mapping at exposure 0.6 and `AnatomyViewer.studioEnvironment` lighting, matching the explorer. Each loaded layer goes through `AnatomyViewer.applySystemLooks`. Pixel ratio is capped at 2.
- **Toggles:** Skeletal, Muscular, Circulatory, as buttons with `aria-pressed`. A system downloads the first time it is switched on and shows loading progress; a failed load shows "Couldn't load, try again" on that toggle.
- **Controls:** mouse and pen drag rotates through OrbitControls with zoom and pan off, so the mouse wheel scrolls the page. Touch: a sideways drag rotates; vertical swipes scroll the page (`touch-action: pan-y`). Arrow keys rotate when the canvas has focus; Tab always moves on.
- **Picking:** a click or tap that did not drag raycasts the visible layers and resolves the part with `AnatomyLayersCore.resolvePart`. The part is tinted with the accent and a card shows the part name, its system name and the definition from the model ("This part has no definition in the model yet." when empty). The card links to the explorer (signed in) or to **Create account** (signed out). Esc or a click on empty space clears it. The card is an `aria-live="polite"` region.
- **"Show me a part":** a button that selects the left femur (`za_femur_l`), or the first described part if that ID is missing, so a part can be chosen without a pointer.
- **Poster:** `hero-skeletal` render taken from the demo's starting camera, so the crossfade does not jump. It is the hero image on phones and whenever the demo is not running.
- **Lifecycle:** renders only while the hero is on screen and the tab is visible; frees GPU memory on `pagehide`, on WebGL context loss, and when a phone-sized viewport is reached after an automatic start.
- **Failure:** any error in loading or rendering removes the canvas and toggles, keeps the poster and logs one console message. No error is shown on the page.
- **Renders:** `render-systems.mjs` serves the repository over a local HTTP server, opens `landing-src/render/render.html` in headless Chromium with the same scene settings, renders each of the 11 layers from a fixed front three-quarter camera on the page colour, and writes AVIF and WebP at 480, 800 and 1200 px with sharp. The skeletal render doubles as the hero poster (plus a PNG fallback).

## 4. Signed-in behaviour

- `login.js`: after a successful sign-in, go to `${APP_BASE}/index.html` for every role; if `api/auth/session.php` reports a session when the login page opens, also go to `index.html`.
- `landing-core.js`:
  - `dashboardFor(role)` returns `teacher/dashboard.html` for teacher and admin, otherwise `student/dashboard.html`.
  - `explorerFor(role)` does the same for `anatomy.html`.
  - `firstName(fullName)`.
  - `sessionState(cached, check)` returns `signed-in` or `signed-out`. A network failure keeps the cached state; a definite "no session" answer gives `signed-out`.
- `landing.js` on load:
  1. reads `sessionStorage.anatomiq_user` (written by sign-in) and applies the signed-in state at once if present;
  2. calls `api/auth/session.php`; success applies or refreshes the signed-in state and updates the cache; a definite failure applies the signed-out state and clears the cache.
- The markup holds both variants (`data-auth="signed-out"` and `data-auth="signed-in"`); the body carries the current state, and CSS shows one. Without JavaScript the signed-out variant shows.
- Signed in: the header shows "Hi, ‹first name›", **Open dashboard** (primary) and **Sign out**. The hero and closing call show **Open dashboard** (primary) and **Open 3D explorer** (secondary). The demo card links to the explorer.
- **Sign out** on the landing page: POST `api/auth/logout.php`, clear `anatomiq_user`, apply the signed-out state. The user stays on the landing page.
- `sidebar.js`: the logo becomes a link to `../index.html`.
- Unchanged: protected pages still send signed-out visitors to `login.html`, and signing out in the portal still goes to `login.html`.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| API unreachable | Signed-out page; a cached signed-in state stays until the server says otherwise; school name hidden. |
| Session ended (password change, expiry) | Signed-out state, cache cleared. |
| `manifest.json` unreadable | Part counts hidden; renders and names still show. |
| No WebGL, script or GLB failure, context loss | Poster stays; toggles, card and "Show me a part" hidden; one console message. |
| Part without a definition | Card says so instead of inventing one. |
| Login and registration errors | Unchanged from today. |

Honesty rules: no invented statistics, testimonials, logos or outcome promises. Numbers only from the manifest and school settings. Part names and definitions only from the model files, with credit. Screenshots are of the real explorer, cropped to the viewer, with no personal data. The quiz demo and progress card are labelled practice or shown in their real empty state.

## 6. Testing

- `node tests/check-syntax.mjs`, `node --test "tests/unit/*.test.mjs"` (new `landing-core` tests), `node landing-src/scripts/contrast.mjs`, `node tests/layers-asset.mjs`.
- Integration, browser and navigation suites against an isolated `anatomiq_test_*` database:
  - sign-in lands on `index.html` for teacher and student, then each dashboard opens from it;
  - landing checks run signed out (one h1, sequential headings, routes, no outdated name) and signed in (name shown, Open dashboard role-aware, Create account hidden).
- Playwright verification with screenshots at 320, 375, 768, 1024 and 1440 px:
  - reduced motion, 3D blocked, API offline, signed in;
  - clicking the demo shows a real part name; "Show me a part" works by keyboard;
  - layout shift under 0.1; under 400 KB before the 3D, excluding fonts; no horizontal scroll; 44 px targets; focus rings on every control; no em or en dash in visible text.
- The Taste Skill pre-flight checklist before opening the pull request.

## 7. Delivery

Commits on `claude/bold-wozniak-pwuizu` (restarted from `main`): this spec, the plan, then the implementation. One pull request for part 1. Part 2 starts with its own brainstorming and spec once part 1 is merged.
