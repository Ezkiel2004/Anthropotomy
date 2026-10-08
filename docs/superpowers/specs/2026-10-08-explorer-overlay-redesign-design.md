# 3D Anatomy Explorer Overlay Redesign — Design

Date: 2026-10-08
Status: Approved in brainstorming, awaiting spec review

## Goal

Restructure the content area of the 3D Anatomy Explorer on both portals (`student/anatomy.html` and `teacher/anatomy.html`):

1. The navy 3D viewer fills the whole content area, edge to edge, with no page scroll.
2. All viewer controls move inside the viewer as icon-only buttons with tooltips.
3. The right-hand content becomes a collapsible overlay panel with summary, description, functions, structures, trivia and sources.
4. The viewer supports fullscreen.

The sidebar, top bar, routing, authentication, APIs, database schema and 3D models do not change.

## Decisions

| Topic | Decision |
|---|---|
| Engine | Keep the layered engine in `assets/js/model-viewer.js` (global `AnatomyViewer`, vendored Three.js r128 classic scripts, Draco). Changes to it are additive only. No CDN importmap. |
| New code | ES modules in `assets/js/explorer/`. They use the `THREE` and `AnatomyViewer` globals. |
| Scope | Both portals. `assets/js/anatomy-page.js` is deleted; `assets/js/teacher-anatomy.js` becomes `assets/js/explorer/teacher.js`. |
| Panel content | Static `assets/js/explorer/data.js` supplement keyed by `system_code`, merged over the database row. No schema change. Teachers cannot edit the new fields. |
| System selection | Glass chip bar along the top edge of the viewer. Multi-select layer toggles, as today. |
| Part info and practice | Inside the panel. |
| Presentation mode | Merged into Fullscreen. The separate button is removed. |
| Icons | Lucide-style inline SVG strings (24×24, `stroke="currentColor"`, `stroke-width="2"`) in `icons.js`. The existing Phosphor sprite stays for the sidebar and top bar. |
| Auto rotate | Off by default for everyone, as today. It never auto-starts. |

## Files

New:

- `assets/css/explorer.css` — all explorer layout. Loaded by both explorer pages only.
- `assets/js/explorer/main.js` — module entry. Auth gate, data load and merge, chip bar, tool wiring, keyboard shortcuts, context system, exploration analytics (students only), and loading `teacher.js` when `body[data-anatomy-role="teacher"]`.
- `assets/js/explorer/viewer.js` — thin wrapper over `AnatomyViewer`. Exports `init`, `setLayer`, `zoomStep`, `reset`, `toggleRotate`, `saveImage`, `toggleFullscreen`, `highlightStructure`, `clearHighlight`, and a state-change subscription (`empty`, `loading`, `error`, `ready`, `unavailable`).
- `assets/js/explorer/panel.js` — panel rendering, show and hide, persistence, trivia cycling, structure chips, selected-part card, quick practice.
- `assets/js/explorer/data.js` — static content for the 10 database systems and the pure `mergeSystem(dbSystem)` helper.
- `assets/js/explorer/icons.js` — SVG icon strings.
- `assets/js/explorer/teacher.js` — teacher tools strip, student preview, edit link, related lessons, `?system=` URL sync.
- `tests/unit/explorer.test.mjs` — unit tests for pure helpers.

Changed:

- `student/anatomy.html`, `teacher/anatomy.html` — `.page-content` is replaced with the explorer markup below. Sidebar and top bar markup stay byte-identical. `anatomy-page.js` and `teacher-anatomy.js` script tags are replaced by one `<script type="module" src="../assets/js/explorer/main.js">`. The classic scripts `app.js`, `student-portal.js` (student only), `anatomy.js`, `anatomy-layers-core.js`, `model-viewer.js` and `site-config.js` stay.
- `assets/js/model-viewer.js` — additive: `disposeLayer(id)`, animated zoom, animated reset, distance limits, pan clamp, pausing the render loop while the tab is hidden, and a filename argument for the screenshot.
- `assets/css/content.css` — remove the `.anatomy-presenting` rules (no longer used).
- `tests/check-syntax.mjs` — also scan `assets/js/explorer`.
- `tests/browser.mjs` — update student and teacher anatomy checks.
- `README.md` — new "3D Anatomy Explorer" section.

Deleted:

- `assets/js/anatomy-page.js`
- `assets/js/teacher-anatomy.js`

Unchanged: `api/*`, `database/*`, `system_model/*`, `assets/js/anatomy.js`, `assets/js/anatomy-layers-core.js`, sidebar and top bar code.

## 1. Markup

The page wrapper `<main class="main-content">` already exists, so the explorer is a `<section>`, not a nested `<main>`. The `body` gets the class `explorer-page`.

```html
<section class="explorer" id="explorer" aria-labelledby="explorerTitle">
  <h1 id="explorerTitle" class="visually-hidden">3D Anatomy Explorer</h1>
  <canvas id="anatomyCanvas" class="viewer__canvas" tabindex="0" aria-label="Interactive anatomy model. Scroll to zoom at the pointer. Drag to rotate; right-drag or use arrow keys to pan. On touch screens, pinch and move two fingers to zoom and pan."></canvas>

  <div class="system-chips" id="systemChips" role="group" aria-label="Body systems"></div>

  <div class="viewer__state" id="viewerState" role="status" hidden>
    <!-- empty / loading (spinner + %) / error (message + Retry) / unavailable -->
  </div>

  <div class="toolbar" role="toolbar" aria-label="3D viewer controls" aria-orientation="vertical">
    <button class="tool-btn" data-action="zoom-in"  aria-label="Zoom in"     data-tip="Zoom in (+)"></button>
    <button class="tool-btn" data-action="zoom-out" aria-label="Zoom out"    data-tip="Zoom out (-)"></button>
    <button class="tool-btn" data-action="reset"    aria-label="Reset view"  data-tip="Reset view (R)"></button>
    <button class="tool-btn" data-action="rotate"   aria-label="Auto rotate" aria-pressed="false" data-tip="Auto rotate (A)"></button>
    <button class="tool-btn" data-action="save"     aria-label="Save image"  data-tip="Save image (S)"></button>
    <span class="toolbar__divider" aria-hidden="true"></span>
    <button class="tool-btn" data-action="fullscreen" aria-label="Fullscreen" data-tip="Fullscreen (F)"></button>
    <button class="tool-btn" data-action="info" aria-label="Toggle info panel" aria-expanded="true" aria-controls="infoPanel" data-tip="Info (I)"></button>
  </div>

  <aside class="info-panel" id="infoPanel" aria-label="System information">
    <header class="info-panel__header">
      <div><h2 id="sysName"></h2><p id="sysSummary"></p></div>
      <button class="tool-btn tool-btn--sm" data-action="info-close" aria-label="Close info panel"></button>
    </header>
    <div class="info-panel__body" id="infoBody"></div>
  </aside>

  <p class="visually-hidden" id="explorerLive" aria-live="polite"></p>
</section>
```

Icons are injected from `icons.js` with `aria-hidden="true" focusable="false"`. The `<aside>` element already carries the complementary role, so no explicit `role` is added. The canvas keeps today's `aria-label` but drops `aria-describedby="viewerGestures"`, which points to an element that does not exist.

## 2. Layout and CSS (`explorer.css`)

Tokens on `.explorer`:

- `--topbar-h: var(--topbar-height, 56px)`
- `--navy: #101c2e` (the current scene background)
- `--accent: var(--brand, #1a6b4a)` for active fills
- `--accent-ring: #4fd197`, a lighter brand green for focus rings and active outlines, because `#1a6b4a` is below 3:1 against navy
- `--glass: rgba(15, 27, 45, .7)`
- `--text: #e6edf5`, `--text-muted: #a9b6c7` (both above 4.5:1 on the glass over navy)
- `--radius: 14px`

Rules:

- `body.explorer-page` sets `overflow: hidden` so the page never scrolls.
- `.explorer`: `position: relative; margin-top: var(--topbar-h); width: 100%; height: calc(100dvh - var(--topbar-h)); overflow: hidden; background: var(--navy)`. The top bar is `position: fixed`, so the explorer starts below it.
- `.viewer__canvas`: `position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none`. The canvas never resizes when the panel opens or closes, because every overlay is absolutely positioned.
- Toolbar: `position: absolute; left: 16px; top: 50%; transform: translateY(-50%)`, vertical flex, `gap: 8px`, glass background with `backdrop-filter: blur(10px)`, `border-radius: 14px`, `padding: 8px`, `z-index: 10`.
- Buttons: 40×40px, icon only, transparent. Hover: `rgba(255,255,255,.12)` overlay. `[aria-pressed="true"]`: accent fill plus a 2px inset `--accent-ring` outline, so the active state does not rely on color alone. `:focus-visible`: 2px `--accent-ring` outline with 2px offset. `:disabled`: 40% opacity, `cursor: not-allowed`, no hover.
- Tooltips: CSS-only `::after { content: attr(data-tip) }`, shown on `:hover` and `:focus-visible`, to the right of the button; above the button in the horizontal toolbar. Hidden on disabled buttons' hover.
- Chip bar: `position: absolute; top: 16px; left: 16px; right: 16px`, one row, `overflow-x: auto`, glass chips. While the panel is open at ≥768px, its right edge is `panel width + 32px`. Each chip: color dot, name, status text. Chips keep `role="switch"` and `aria-checked`. Checked chips get the accent outline and a filled dot.
- Info panel: `position: absolute; top: 16px; right: 16px; bottom: 16px; width: 360px; max-width: calc(100% - 32px)`, glass surface, `--text` color, `overflow-y: auto`, `z-index: 20`. Closed: `transform: translateX(calc(100% + 24px)); visibility: hidden; transition: transform 250ms ease, visibility 0s linear 250ms`. Open (`.is-open`): `transform: translateX(0); visibility: visible; transition: transform 250ms ease, visibility 0s`.
- State overlay: centered over the canvas, `pointer-events: none` except on its Retry button.
- Hover label (`.part-hover-label`, created by the engine) keeps its current styling.

Breakpoints:

- ≥1024px: 360px panel.
- 768–1023px: 300px panel.
- <768px: the panel becomes a bottom sheet (`left: 0; right: 0; bottom: 0; top: auto; width: auto; max-width: none; height: 55dvh; border-radius: 16px 16px 0 0`), closed with `translateY(calc(100% + 24px))`. The toolbar becomes a horizontal bar at bottom center (`left: 50%; top: auto; bottom: 16px; transform: translateX(-50%)`, `gap: 4px`) so 7 buttons fit in 343px. When the sheet is open, the toolbar sits above it (`bottom: calc(55dvh + 12px)`). The chip bar spans the full width.

Fullscreen:

- `.explorer:fullscreen` and `.explorer.is-pseudo-fullscreen` set `margin-top: 0; height: 100dvh`. Overlays stay visible.
- `.explorer.is-pseudo-fullscreen` also sets `position: fixed; inset: 0; z-index: 1000`.
- The spec's `:fullscreen .explorer` selector cannot match because `.explorer` is itself the fullscreen element, so the selectors above are used.

Reduced motion: `@media (prefers-reduced-motion: reduce)` sets all explorer transitions to 0ms. Camera moves already jump instead of gliding in the engine.

## 3. Viewer behavior

`viewer.js` wraps `AnatomyViewer`; `main.js` holds page state (enabled systems, context system).

Systems and layers:

- Clicking a chip toggles that system's layer, with today's `toggleSystem` logic: load on first use, any combination on, non-layered (legacy) GLBs shown alone.
- A system without `modelUrl` never switches on; clicking it only makes it the context system so its panel content shows.
- With no visible layer, the state overlay shows "No 3D model has been added for this system. You can read the available content alongside the viewer." when the context system has no model, otherwise "Switch on a body system to begin." Zoom, reset, rotate and save get `disabled` and `aria-disabled="true"`. Fullscreen and Info stay enabled.
- If WebGL initialisation fails, the overlay shows "3D viewing is unavailable on this device. You can still read the anatomy content." and the same tools are disabled.
- Loading: spinner and "Loading model: 45%" (or "Loading model…" without a total) from the engine's progress callback. The chip shows the same percentage.
- Error: "The model couldn't be loaded." with a Retry button that re-requests that layer. The chip shows "Couldn't load — select to retry". Other layers keep working.

Disposal:

- New `AnatomyViewer.disposeLayer(id)` removes the layer root from the scene, disposes every geometry, every base material, every cached hover, focus and ghost variant for those materials, and every texture on those materials, then deletes the layer from `layers`.
- It runs whenever a chip switches a layer off and when a legacy GLB forces other layers off.
- Re-enabling a disposed system reloads it. The browser HTTP cache serves the file; Draco decoding runs again.

Camera:

- Zoom in and out: one step is 15% (`factor` .85 or 1.15) along the view direction, eased over 200ms through the engine's existing tween. Wheel zoom stays instant and pointer-anchored.
- On reset the engine sets `controls.minDistance` to 2% and `controls.maxDistance` to 400% of the visible model's bounding-box diagonal.
- Pan limit: on each controls `change`, the orbit target is clamped to the visible models' bounding box expanded by 50%.
- Reset view: the camera position and target animate (800ms, ease-in-out) back to the fitted default view. The first fit after a load still snaps.

Auto rotate:

- The toolbar button toggles `controls.autoRotate` and `aria-pressed`.
- The controls `start` event pauses rotation; 3 seconds after the `end` event it resumes if the toggle is still on.

Save image:

- Render once, `canvas.toBlob()`, download through a temporary `<a download>` element, then revoke the object URL.
- File name: `anatomy-<context system code>-<YYYYMMDD>.png` using the local date.
- If `toBlob` yields `null`, announce "Image could not be saved." in the live region and `console.warn`.

Fullscreen:

- `toggleFullscreen()` calls `explorer.requestFullscreen()`, then `explorer.webkitRequestFullscreen()`, and falls back to the pseudo-fullscreen class when neither exists or the promise rejects.
- On `fullscreenchange` (and `webkitfullscreenchange`) the button swaps between maximize and minimize icons, and its `aria-label` and `data-tip` switch between "Fullscreen (F)" and "Exit fullscreen (F)".
- Native fullscreen exits with Esc through the browser. In pseudo-fullscreen a keydown handler exits on Esc.
- Fullscreen hides the sidebar and top bar but keeps the toolbar, chips and panel, which replaces the teacher's presentation mode.

Highlight:

- `highlightStructure(meshName)` resolves the part with `AnatomyViewer.findPart(meshName)` and calls `focusPart`: gold emissive highlight, every other visible part fades to the ghost material, and the camera glides to frame the part.
- `clearHighlight()` calls `clearFocus`, which restores the original materials and the saved view.
- If no loaded part matches, nothing in 3D changes; the panel card still shows the structure.
- Clicking a part in the canvas, clicking empty space and Esc keep today's behavior.

Render loop:

- The engine cancels its `requestAnimationFrame` loop on `visibilitychange` when the document is hidden and restarts it when visible.
- The engine's `ResizeObserver` stays on the canvas parent, which is `.explorer`.

## 4. Panel and data

`data.js`:

- `export const systems` is an array of entries keyed by `id` (the `system_code`) for `skeletal`, `muscular`, `circulatory`, `respiratory`, `digestive`, `urinary`, `nervous`, `reproductive`, `endocrine` and `lymphatic`. Each has `summary`, `description`, `functions[]`, `trivia[]` and `sources[{title, url}]`. Content is written for students and cites OpenStax *Anatomy and Physiology 2e* chapters.
- `export function mergeSystem(dbSystem)` takes an `AnatomyData` system and returns the spec's data model:
  - `id`, `name`, `color`, `isActive`, `system_id` from the database.
  - `summary` from `data.js`, otherwise the first sentence of the database description.
  - `description`: database description when non-empty, otherwise `data.js`.
  - `functions` from `data.js`.
  - `structures`: database `{name, desc, mesh_name}` mapped to `{id, name, meshName, description}`.
  - `trivia`: `data.js` trivia followed by database `key_facts` as `"Label: value"`.
  - `sources`: `data.js` links.
  - `sourceNote`: database `source_text`, rendered with its `http(s)` URLs turned into links. This keeps the Z-Anatomy CC BY-SA 4.0 credit.
  - `modelUrl` from the database (or the lesson override).
- A system missing from `data.js` still works with only its database fields.

Panel order (each section is hidden when it has no data, except Structures):

1. Header: system name, one-line summary, close (X) button.
2. Teacher tools (teacher page only): preview status text; "Student preview" or "Return to teacher view" link; "Edit content" link (hidden in preview).
3. Selected part card (only while a part or structure is selected): name, system, "Awaiting identification" badge for unidentified parts, description, function, "Also part of", reference link, and "Back to full body".
4. Description.
5. Functions: bulleted list.
6. Structures: chips with `aria-pressed`. A click calls `highlightStructure` and fills the selected part card. With none: "No structures added yet."
7. Did you know?: trivia card starting at a random index; "Next fact" cycles through `trivia[]` and is hidden when there is only one fact.
8. Quick practice: today's ungraded practice, hidden when fewer than 2 structures have descriptions.
9. Related lessons (teacher page only, hidden in student preview): today's related modules list.
10. Sources: links with `target="_blank" rel="noopener noreferrer"`, then the source note.

Safety: all text is inserted with `textContent` and `createElement`. Links are only created for `http:` and `https:` URLs.

Show and hide:

- Toggled by the toolbar Info button, the panel's X button and the `I` key. The toolbar button's `aria-expanded` follows the state.
- The state is stored in `localStorage` as `anatomy.panelOpen` (`"1"` or `"0"`), with every access wrapped in try/catch. Without a stored value the panel opens at ≥768px and stays closed below.
- Clicking a part in 3D opens the panel if it is closed, without changing the stored preference.
- Closing with the X button moves focus to the toolbar Info button.

Context system: the panel shows the system of the last clicked part, otherwise the last system switched on, as today. Analytics (students only) attribute time, interactions and viewed structures to the context system and flush when it changes, every 45 seconds, on `pagehide` and when the tab is hidden, as today.

Teacher page:

- Hidden systems show "(hidden)" on their chip. `?preview=student` lists only active systems.
- The URL keeps `?system=<code>` in sync with the context system, and the preview and edit links include it.
- Teacher exploration sends no analytics.
- `?lesson_id=` keeps overriding a system's model with the lesson's GLB, as today (student page).

## 5. Keyboard and accessibility

Shortcuts (document `keydown`):

| Key | Action |
|---|---|
| `+`, `=`, NumpadAdd | Zoom in |
| `-`, NumpadSubtract | Zoom out |
| `R` | Reset view |
| `A` | Auto rotate |
| `F` | Fullscreen |
| `I` | Info panel |
| `S` | Save image |

- Letters are case-insensitive.
- Ignored when focus is in an `input`, `textarea`, `select` or contenteditable element, and when Ctrl, Meta or Alt is held, so browser shortcuts like Ctrl+R and Ctrl+S keep working.
- A disabled tool ignores its shortcut.
- Esc exits part focus first (existing capture-phase handler), then pseudo-fullscreen.

Toolbar:

- ARIA toolbar pattern with a roving tabindex: one Tab stop, arrow keys move between buttons (Up and Down when vertical, Left and Right when horizontal), Home and End jump to the ends.
- `aria-orientation` switches to `horizontal` below 768px through `matchMedia`.

Other:

- Every icon button has an `aria-label`. Toggle buttons use `aria-pressed` (rotate, structure chips) or `aria-expanded` (info). Chips use `role="switch"` and `aria-checked`.
- Text contrast on the glass panel is at least 4.5:1. Focus rings and active outlines use `--accent-ring` for at least 3:1 against navy.
- The state overlay is `role="status"`; the visually hidden live region announces save failures.

## 6. Error handling

| Case | Behavior |
|---|---|
| Content API fails | Overlay: "Unable to load anatomy content. Reload the page to try again." Tools disabled. |
| No systems published | Overlay: "No anatomy content has been published yet." Panel shows "Anatomy content is coming soon". |
| One layer fails to load | Overlay message with Retry; chip shows the retry state; other layers keep working. |
| Rapid toggling or clicking | Existing stale-load guards plus the focus and context version counters. |
| No WebGL | Unavailable message; content stays readable in the panel. |
| `localStorage` blocked | Responsive default; nothing throws. |
| Fullscreen missing or rejected | Pseudo-fullscreen. |
| `toBlob` returns `null` | Live-region message and `console.warn`. |

## 7. Testing

- `node tests/check-syntax.mjs`, extended to scan `assets/js/explorer`.
- `node --test "tests/unit/*.test.mjs"`, with the new `tests/unit/explorer.test.mjs` covering `mergeSystem`, source linkification, the save file name and the shortcut key mapping.
- `tests/browser.mjs`, updated for both portals:
  - chip counts and hidden-system filtering on the teacher page and in student preview
  - the system with a model starts switched on
  - clicking a structure chip fills the selected part card with its description
  - no page scroll (`scrollHeight <= innerHeight`) and the mobile layout fits the viewport
  - the panel toggles and its state survives a reload
  - tools are disabled when no model is visible
  - fullscreen falls back to pseudo-fullscreen in headless Chrome and Esc exits it
- Manual pass in the in-app browser on XAMPP localhost at 1920×1080, 768×1024 and 375×812 against every acceptance criterion below, with a clean console and `renderer.info.memory` checked before and after switching a layer off.

## 8. Acceptance criteria

- The navy viewer fills the whole content area with no gaps or page scroll.
- No text buttons below the viewer; all controls are icon-only inside the viewer, with tooltips.
- The info panel slides in and out without resizing the canvas, and its state persists after refresh.
- The panel shows description, functions, structures, trivia (with Next fact) and sources.
- Fullscreen works with the toolbar and panel still visible, and exits cleanly with Esc.
- Save image downloads a PNG of the current view.
- Empty, loading and error states all work.
- The layout works at 1920×1080, tablet and mobile widths.
- No console errors; resources are disposed when systems are switched off.
- Teacher extras (student preview, edit content, related lessons, hidden-system marking) keep working.

## Out of scope

- Teacher editing of summary, functions, trivia and source links (needs a schema change).
- Migrating Three.js from r128 or to ES-module builds.
- Content for parts beyond what the database and the layered GLBs already hold.
