# Landing Page Redesign, Part 1: Implementation Plan

**Goal:** Rebuild `index.html` as a dark "interactive atlas" landing page with a live demo on the explorer's layer models, restyle `login.html` to match, and make the landing page the home page for signed-in users of every role.

**Architecture:** Static HTML pages styled by one compiled Tailwind v4 stylesheet (`assets/css/public.css`, built from `landing-src/`). Small ES modules: `landing-core.js` (pure, unit tested), `landing.js` (page behaviour), `landing-stage.js` (shared 3D scene: engine loading, renderer, lighting, layer loading, framing), `landing-hero-3d.js` (demo interaction). The stage reuses the vendored Three.js r128 classic scripts and the explorer's `AnatomyLayersCore`, `AnatomyViewer.applySystemLooks` and `AnatomyViewer.studioEnvironment` without initialising `AnatomyViewer`. Build-time scripts render the 11 layer GLBs and capture the real explorer through that same stage, so the poster, gallery and live demo look identical.

**Tech stack:** Vanilla HTML, CSS (Tailwind v4 CLI), ES modules, Three.js r128 (vendored), PHP/MySQL APIs (unchanged), `node:test`, Playwright (`playwright-core`, dev only) and sharp (dev only).

**Spec:** `docs/superpowers/specs/2026-10-11-landing-redesign-design.md`

## Global constraints

- Branch `claude/bold-wozniak-pwuizu`, restarted from `main`. Commit per task group; push at the end; one pull request.
- Do not change `api/*`, `database/*`, `system_model/*`, `assets/js/model-viewer.js`, `assets/js/anatomy-layers-core.js` or the explorer pages and modules.
- No visible em dash or en dash anywhere on `index.html` or `login.html`, including titles and `alt` text.
- No invented numbers, quotes, logos or outcome claims. Numbers only from `system_model/layers/manifest.json` (runtime) and `api/config.php`.
- User or API text enters the DOM only through `textContent`; `innerHTML` is used only for static markup strings.
- Phosphor sprite icons (`assets/icons/interface.svg`), regular weight. Pill buttons, toggles and chips; 16 px cards; 12 px inputs.
- Every interactive target at least 44 by 44 px; 3 px accent focus ring; `prefers-reduced-motion` makes every animation instant and skips the 3D intro turn.
- Asset URLs on the public pages carry `?v=20261011-atlas1`.
- `localStorage`/`sessionStorage` access is wrapped in `try`/`catch`.

## Exact copy

| Place | Text |
|---|---|
| Title | `Anthropotomy · Explore the human body in 3D` |
| Hero headline | `Click any part of the human body.` |
| Hero subline | `Switch body systems on in 3D, tap a part to see its real name, then test yourself.` |
| Signed-out CTAs | `Create account` (primary), `Sign in` |
| Signed-in CTAs | `Open dashboard` (primary), `Open 3D explorer`; header `Hi, <first name>`, `Sign out` |
| Demo hint | `Click any part to see its name.` and button `Show me a part` |
| Demo, no definition | `This part has no definition in the model yet.` |
| Demo, on request | `Try it in 3D (about 3.5 MB)` |
| Demo toggle error | `Couldn't load, try again` |
| Gallery | `One body. Every system.` / `Bones, muscles, vessels, nerves and organs, each with its own named parts. Turn them on alone or together.` |
| Click a part | `Every part tells you what it is.` |
| Lessons and quizzes | `Lessons and quizzes in one place.` |
| Quiz demo note | `Answers save as you go. Refresh and you are back in the same attempt with the time you had left.` and `Practice only. Nothing here is graded or sent anywhere.` |
| Progress | `See how you are doing.`; empty values `Not yet` |
| Steps | `Three steps to your first lesson.` |
| Closing | `Bring your student ID and take a closer look.` / `Forgot your password? Your teacher resets it; there is no email reset.` |
| Login titles | `Sign in · Anthropotomy`, `Create your student account · Anthropotomy` |

## Test environment (used by Tasks 7 to 10)

Linux container used for this run:

```bash
service mariadb start
mysql -uroot -e "CREATE USER IF NOT EXISTS 'anthro_test'@'127.0.0.1' IDENTIFIED BY 'local-test-only'; GRANT ALL ON \`anatomiq\_test\_%\`.* TO 'anthro_test'@'127.0.0.1';"
export ANATOMIQ_DB_NAME=anatomiq_test_atlas ANATOMIQ_DB_USER=anthro_test ANATOMIQ_DB_PASS=local-test-only
php tests/database.php setup
php -S 127.0.0.1:8091 tests/router.php &          # serves the repo with the test database
/opt/pw-browsers/chromium --headless=new --no-sandbox --remote-debugging-port=9225 --user-data-dir=.runtime/chrome --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader about:blank &
```

On Windows/XAMPP use the equivalent commands from the README. Tear down with `php tests/database.php cleanup`.

## Review focus

- A cached signed-in state must not survive a definite "no session" answer, and must survive a network failure (unit test, Task 1).
- Switching a demo system off while it downloads must not add it to the scene later (browser check, Task 5).
- The demo must never block page scrolling: wheel over the canvas scrolls; vertical touch swipes scroll (Playwright check, Task 10).
- No em or en dash in visible text, `title` or `alt` (Playwright check, Task 10).

### Task 1: Pure helpers and unit tests

Files: `assets/js/landing-core.js`, `tests/unit/landing-core.test.mjs`.

- [ ] `dashboardFor(role)`, `explorerFor(role)`: `teacher` and `admin` go to `teacher/...`, anything else to `student/...`.
- [ ] `firstName(fullName)`: first word, trimmed; empty string gives `''`.
- [ ] `sessionState(cached, check)`: `check` is `{status: 'ok', user}`, `{status: 'none'}` or `{status: 'error'}`; returns `{state, user}`; `ok` signs in with the fresh user, `none` signs out, `error` keeps the cached user if there is one.
- [ ] `partTotals(manifest)`: per system `{id, parts}` and the overall total; ignores entries without a numeric `parts`.
- [ ] `node --test "tests/unit/*.test.mjs"` passes.

### Task 2: Design system and fonts

Files: `landing-src/src/public.css`, `landing-src/scripts/contrast.mjs`, `assets/fonts/*`, `landing-src/package.json`.

- [ ] Copy Plus Jakarta Sans latin 400, 600, 800 and 800 italic woff2 and its licence into `assets/fonts/`; delete the Instrument Serif and JetBrains Mono files and licences.
- [ ] Replace the `@theme` tokens: colour roles from the spec, type scale 14 to 56, radii, shadows, breakpoints, easing.
- [ ] Components: header, buttons (primary, secondary, quiet), chips and toggles, cards, gallery, notes, steps, quiz demo, progress card, demo card, footer, login form, dialogs, auth-state visibility rules, reveal and reduced-motion rules.
- [ ] Update the contrast pairs for the dark theme and run `node scripts/contrast.mjs`.

### Task 3: Shared 3D stage and renders

Files: `assets/js/landing-stage.js`, `landing-src/render/render.html`, `landing-src/scripts/render-systems.mjs`, `assets/img/systems/*`, `assets/img/hero-skeletal-*`.

- [ ] `loadEngine()`: loads the six classic scripts in order once; resolves the Draco path from the module URL.
- [ ] `createStage(canvas, {background})`: renderer (sRGB, ACES, exposure 0.6, pixel ratio up to 2), `studioEnvironment`, the explorer's hemisphere and key lights, camera, model group; `render()`, `resize()`, `dispose()`.
- [ ] `loadLayer(stage, id, onProgress)`: loads `system_model/layers/<file>`, runs `applySystemLooks`, adds it; supports cancellation.
- [ ] `frameBody(stage)` and `frameObject(stage, object)`: front three-quarter camera that fits the body or one system.
- [ ] Render harness renders each system with a faint skeleton for context (the skeletal card alone), on the page colour, 3:4; and the hero poster from the demo's starting camera at 4:5. AVIF and WebP at 480, 800, 1200 px; PNG fallback for the poster.
- [ ] Look at every render before continuing.

### Task 4: Landing markup

File: `index.html`.

- [ ] Head: title, description, canonical, Open Graph and Twitter tags, icons, manifest, theme colour, two font preloads, stylesheet, `js` class script, module script.
- [ ] Sections 1 to 9 from the spec with the exact copy, both auth variants (`data-auth`), one `h1`, sequential headings, all images with dimensions and `alt`.
- [ ] Gallery cards with `data-system` and a hidden count slot; explorer screenshot `picture`; quiz demo markup; progress card; steps; closing band; footer credits.

### Task 5: Landing behaviour and live demo

Files: `assets/js/landing.js`, `assets/js/landing-hero-3d.js`.

- [ ] `landing.js`: menu, header CTA state (one primary per viewport), auth state (cache then `session.php`), sign out, part counts from the manifest, reveals, quiz demo, school name, 3D gate (automatic or on request).
- [ ] `landing-hero-3d.js`: toggles with progress and error states, drag rotation (mouse through OrbitControls without zoom or pan; touch sideways only), arrow keys, picking with drag threshold, accent tint and restore, card with name, system and definition, "Show me a part", Esc and empty-click clear, intro turn (skipped with reduced motion), visibility pause, `pagehide` and context-loss teardown, silent fallback to the poster.

### Task 6: Login page and portal link

Files: `login.html`, `assets/js/login.js`, `assets/js/sidebar.js`, `assets/css/sidebar.css`, portal pages (`?v=`).

- [ ] Restyle `login.html` in the dark theme; keep every element ID, class and behaviour `login.js` and the tests rely on.
- [ ] `login.js`: sign-in and an existing session both go to `index.html`; titles use `·`.
- [ ] Sidebar logo links to `../index.html`; sidebar wordmark uses Plus Jakarta Sans; bump the `sidebar.js` and `sidebar.css` versions on the portal pages.

### Task 7: Explorer screenshot and share image

Files: `landing-src/scripts/capture-explorer.mjs`, `assets/img/explorer-part-*`, `landing-src/og/og-image.html`, `assets/brand/og-image.jpg`, `landing-src/scripts/build-assets.mjs`.

- [ ] With the test environment running and `php database/integrate_layers.php` applied: sign in a fixture student, open `student/anatomy.html`, select the left femur, open the info panel and capture only the `.explorer` element. AVIF and WebP at 800 and 1200 px.
- [ ] New share image template in the dark theme with the poster render; regenerate `og-image.jpg`.
- [ ] Remove the poster step from `build-assets.mjs` and delete the old `assets/img/hero-skeleton-*` files.

### Task 8: Tests

Files: `tests/browser.mjs`, `tests/navigation.mjs`, `tests/authentication.ps1`.

- [ ] After sign-in, expect `/index.html`; then navigate to the dashboards.
- [ ] Browser suite landing checks: signed out (one h1, sequential headings, CTA routes, no outdated name, images have alt) and signed in (first name shown, Open dashboard points at the role's dashboard, Create account hidden).

### Task 9: README

- [ ] Public pages: signed-in landing, demo behaviour and load policy, credits.
- [ ] Building the public pages: `render-systems.mjs`, `capture-explorer.mjs`, `build-og.mjs`.
- [ ] Supplied skeletal model: no longer used by the landing page.

### Task 10: Verification and delivery

- [ ] `node tests/check-syntax.mjs`, unit tests, contrast, `node tests/layers-asset.mjs`.
- [ ] Integration, browser and navigation suites on fresh test databases.
- [ ] Playwright pass with screenshots: 320, 375, 768, 1024 and 1440 px; reduced motion; GLB blocked; API offline; signed in as student and as teacher; demo click shows a real part name; keyboard "Show me a part"; wheel and touch scrolling over the canvas; layout shift; page weight; tap targets; focus rings; no dashes.
- [ ] Taste Skill pre-flight checklist.
- [ ] Commit, push, open the pull request; clean up the test environment.
