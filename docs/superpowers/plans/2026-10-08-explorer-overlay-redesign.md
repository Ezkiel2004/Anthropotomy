# 3D Anatomy Explorer Overlay Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the student and teacher 3D Anatomy Explorer content areas into a full-bleed navy viewer with an in-viewer icon toolbar, a top chip bar of body systems, a collapsible info overlay panel and fullscreen.

**Architecture:** New ES modules in `assets/js/explorer/` drive the page and use the existing classic-script globals (`THREE` r128, `AnatomyViewer`, `AnatomyLayersCore`, `AnatomyData`, `API_BASE`, `Auth`). The layered engine in `assets/js/model-viewer.js` stays and only gains additive members. Pure helpers live in `format.js` and `data.js` so Node can unit test them; DOM behavior is proven by the existing headless browser suite.

**Tech Stack:** Vanilla HTML5/CSS3/ES modules, Three.js r128 (vendored, classic scripts), PHP/MySQL APIs (unchanged), `node:test`, Chrome DevTools Protocol browser suite.

**Spec:** `docs/superpowers/specs/2026-10-08-explorer-overlay-redesign-design.md`

## Global Constraints

- No git repository: there are no commit steps. Each task ends with its checks passing instead.
- Do not change `api/*`, `database/*`, `system_model/*`, `assets/js/anatomy.js`, sidebar or top bar markup and code.
- `model-viewer.js` changes are additive; existing members keep their behavior.
- New code: ES modules, `'use strict'` implied, four-space indentation like `assets/js/anatomy-layers-core.js`, no build step, no new dependencies.
- User or database text goes into the DOM only through `textContent`/`createElement`. `innerHTML` is allowed only for static strings from `icons.js`.
- Links are created only for `http:`/`https:` URLs, with `target="_blank" rel="noopener noreferrer"`.
- Icons: Lucide-style inline SVG, `viewBox="0 0 24 24"`, `width="20" height="20"`, `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`, `aria-hidden="true" focusable="false"`.
- Tokens: `--navy: #101c2e`, `--accent: var(--brand, #1a6b4a)`, `--accent-ring: #4fd197`, `--glass: rgba(15, 27, 45, .7)`, `--text: #e6edf5`, `--text-muted: #a9b6c7`, `--radius: 14px`, `--topbar-h: var(--topbar-height, 56px)`.
- `localStorage` key `anatomy.panelOpen`, values `"1"`/`"0"`.
- Save file name: `anatomy-<system code>-<YYYYMMDD>.png` (local date).
- Exact user-facing copy:
  - Empty: `No 3D model has been added for this system. You can read the available content alongside the viewer.`
  - Idle: `Switch on a body system to begin.`
  - Loading: `Loading model: 45%` / `Loading model…`
  - Error: `The model couldn't be loaded.` with a `Retry` button
  - Unavailable: `3D viewing is unavailable on this device. You can still read the anatomy content.`
  - API failure: `Unable to load anatomy content. Reload the page to try again.`
  - No systems: `No anatomy content has been published yet.` and panel title `Anatomy content is coming soon`
  - Save failure: `Image could not be saved.`
  - No structures: `No structures added yet.`
- Spec refinements decided while planning:
  - Pure helpers go in a new `assets/js/explorer/format.js`.
  - The overlay state is computed by the pure `stageState()` in `format.js` and rendered by `main.js`, in place of a subscription in `viewer.js`.
  - Save image is done in `viewer.js` with `canvas.toBlob`, so the engine's `screenshot()` stays untouched.

## Test Environment (used by Tasks 4–7)

Run once per session from the project root in PowerShell, then reuse:

```powershell
$env:ANATOMIQ_DB_NAME='anatomiq_test_explorer'
C:/xampp/php/php.exe tests/database.php setup
Start-Process C:/xampp/php/php.exe -ArgumentList '-S','127.0.0.1:8091','tests/router.php'
Start-Process 'C:/Program Files/Google/Chrome/Application/chrome.exe' -ArgumentList '--headless=new','--remote-debugging-port=9225','--user-data-dir=.runtime/chrome-explorer','about:blank'
node tests/integration.mjs
node tests/browser.mjs
```

The browser suite depends on fixtures that the integration suite creates. Re-run `tests/database.php cleanup` then `setup` and the integration suite before each browser run. Tear down at the end (Task 7).

## Review Focus

- Switching a system off while its model is still downloading: the late result must not be added to the scene or leak GPU memory (browser check `A model switched off mid-download never joins the scene` in Task 4).
- Holding a shortcut key (auto-repeat): zoom may repeat, but reset, rotate, fullscreen, info and save must fire once per press (unit test in Task 1).
- Database credit text with a URL inside parentheses followed by a comma, such as `(https://github.com/LluisV/Z-Anatomy), licensed`: the link must exclude the `)` and `,` (unit test in Task 1).
- A garbage stored panel value (`"true"`, `""`, `null`) falls back to the responsive default instead of forcing a state (unit test in Task 1).
- Resizing across 768px while the explorer is open: the toolbar's `aria-orientation` and arrow keys follow the new layout (browser check in Task 4).

---

### Task 1: Pure helpers (`format.js`)

**Files:**
- Create: `assets/js/explorer/format.js`
- Create: `tests/unit/explorer.test.mjs`
- Modify: `tests/check-syntax.mjs:13` (add `'assets/js/explorer'` to the scanned directory list)

**Interfaces:**
- Produces (all named exports, no DOM or global access at import time):
  - `firstSentence(text: string): string` — text up to and including the first `.`, `!` or `?` followed by whitespace or end; the whole trimmed text when none; `''` for empty input.
  - `splitLinks(text: string): Array<{text: string, href?: string}>` — splits on `https?://` URLs; trailing `.,;:!?)` characters are not part of the URL; adjacent plain segments keep their exact text.
  - `safeUrl(url: unknown): string | null` — the URL when it parses with protocol `http:` or `https:`, else `null`.
  - `saveFileName(systemCode: string | null | undefined, date: Date): string` — `anatomy-<code>-<YYYYMMDD>.png`; code falls back to `view`.
  - `shortcutAction(event: {key: string, repeat?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, target?: {tagName?: string, isContentEditable?: boolean}}): 'zoom-in' | 'zoom-out' | 'reset' | 'rotate' | 'fullscreen' | 'info' | 'save' | null`
  - `panelDefault(stored: string | null, wide: boolean): boolean` — `"1"` → true, `"0"` → false, anything else → `wide`.
  - `stageState(input: {viewerReady: boolean, hasVisible: boolean, loading: {progress: number | null} | null, contextHasModel: boolean, failedId: string | null}): {kind: 'unavailable' | 'ready' | 'loading' | 'empty' | 'error' | 'idle', message: string, retryId?: string}` — checked in that order; `ready` has `message: ''`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/explorer.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {firstSentence, splitLinks, safeUrl, saveFileName, shortcutAction, panelDefault, stageState} from '../../assets/js/explorer/format.js';

test('firstSentence stops at the first sentence end', () => {
    assert.equal(firstSentence('Bones support the body. They also store minerals.'), 'Bones support the body.');
    assert.equal(firstSentence('No full stop here'), 'No full stop here');
    assert.equal(firstSentence(''), '');
});

test('splitLinks keeps punctuation and parentheses out of URLs', () => {
    const text = '3D model: Z-Anatomy (https://github.com/LluisV/Z-Anatomy), licensed CC BY-SA 4.0.';
    assert.deepEqual(splitLinks(text), [
        {text: '3D model: Z-Anatomy ('},
        {text: 'https://github.com/LluisV/Z-Anatomy', href: 'https://github.com/LluisV/Z-Anatomy'},
        {text: '), licensed CC BY-SA 4.0.'}
    ]);
    assert.deepEqual(splitLinks('See https://openstax.org/books.'), [{text: 'See '}, {text: 'https://openstax.org/books', href: 'https://openstax.org/books'}, {text: '.'}]);
    assert.deepEqual(splitLinks('No links'), [{text: 'No links'}]);
    assert.deepEqual(splitLinks(''), []);
});

test('safeUrl accepts only http and https', () => {
    assert.equal(safeUrl('https://openstax.org/x'), 'https://openstax.org/x');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('not a url'), null);
    assert.equal(safeUrl(undefined), null);
});

test('saveFileName uses the system code and local date', () => {
    assert.equal(saveFileName('nervous', new Date(2026, 9, 8)), 'anatomy-nervous-20261008.png');
    assert.equal(saveFileName('', new Date(2026, 0, 5)), 'anatomy-view-20260105.png');
});

test('shortcutAction maps keys and ignores typing, modifiers and toggle repeats', () => {
    const key = (k, extra = {}) => shortcutAction({key: k, target: {tagName: 'BODY'}, ...extra});
    assert.equal(key('+'), 'zoom-in');
    assert.equal(key('='), 'zoom-in');
    assert.equal(key('-'), 'zoom-out');
    assert.deepEqual(['r', 'R', 'a', 'f', 'i', 's'].map(k => key(k)), ['reset', 'reset', 'rotate', 'fullscreen', 'info', 'save']);
    assert.equal(key('+', {repeat: true}), 'zoom-in');
    assert.equal(key('f', {repeat: true}), null);
    assert.equal(key('r', {ctrlKey: true}), null);
    assert.equal(key('s', {metaKey: true}), null);
    assert.equal(key('i', {altKey: true}), null);
    assert.equal(key('r', {target: {tagName: 'INPUT'}}), null);
    assert.equal(key('r', {target: {tagName: 'TEXTAREA'}}), null);
    assert.equal(key('r', {target: {tagName: 'SELECT'}}), null);
    assert.equal(key('r', {target: {tagName: 'DIV', isContentEditable: true}}), null);
    assert.equal(key('x'), null);
});

test('panelDefault trusts only "1" and "0"', () => {
    assert.equal(panelDefault('1', false), true);
    assert.equal(panelDefault('0', true), false);
    for (const value of [null, '', 'true', 'open']) {
        assert.equal(panelDefault(value, true), true);
        assert.equal(panelDefault(value, false), false);
    }
});

test('stageState picks the overlay in priority order', () => {
    const base = {viewerReady: true, hasVisible: false, loading: null, contextHasModel: true, failedId: null};
    assert.equal(stageState({...base, viewerReady: false}).kind, 'unavailable');
    assert.deepEqual(stageState({...base, hasVisible: true}), {kind: 'ready', message: ''});
    assert.equal(stageState({...base, loading: {progress: 45}}).message, 'Loading model: 45%');
    assert.equal(stageState({...base, loading: {progress: null}}).message, 'Loading model…');
    assert.equal(stageState({...base, contextHasModel: false}).message, 'No 3D model has been added for this system. You can read the available content alongside the viewer.');
    assert.deepEqual(stageState({...base, failedId: 'muscular'}), {kind: 'error', message: "The model couldn't be loaded.", retryId: 'muscular'});
    assert.deepEqual(stageState(base), {kind: 'idle', message: 'Switch on a body system to begin.'});
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/unit/explorer.test.mjs`
Expected: FAIL with `Cannot find module` for `format.js`.

- [ ] **Step 3: Implement every export listed under Interfaces in `assets/js/explorer/format.js`** with a header comment saying the module is pure and unit tested. In `shortcutAction`, only `zoom-in`/`zoom-out` survive `repeat: true`.

- [ ] **Step 4: Add `'assets/js/explorer'` to the `for(const dir of [...])` list in `tests/check-syntax.mjs`.**

- [ ] **Step 5: Run the checks**

Run: `node --test "tests/unit/*.test.mjs"` then `node tests/check-syntax.mjs`
Expected: all tests pass (existing `anatomy-layers-core` tests included); the syntax check reports one more ES module than before and `Passed:`.

---

### Task 2: Panel content data (`data.js`)

**Files:**
- Create: `assets/js/explorer/data.js`
- Modify: `tests/unit/explorer.test.mjs` (append tests)

**Interfaces:**
- Consumes: `firstSentence` from `format.js` (Task 1).
- Produces:
  - `systems: Array<{id: string, summary: string, description: string, functions: string[], trivia: string[], sources: Array<{title: string, url: string}>}>` — exactly the ids `skeletal`, `muscular`, `circulatory`, `respiratory`, `digestive`, `urinary`, `nervous`, `reproductive`, `endocrine`, `lymphatic`.
  - `mergeSystem(db: AnatomyDataSystem): ExplorerSystem` where `AnatomyDataSystem` is the object built by `assets/js/anatomy.js` (`{id, system_id, name, isActive, icon, color, description, keyFacts, structures: [{name, desc, mesh_name}], modelUrl, source}`) and
    `ExplorerSystem = {id, system_id, name, isActive, color, summary, description, functions: string[], structures: Array<{id: string, name: string, meshName: string, description: string}>, trivia: string[], sources: Array<{title, url}>, sourceNote: string, modelUrl: string | null}`.
  - Merge rules: database wins for `description` (when non-empty after trim), `structures`, `modelUrl`; `summary` from `data.js`, else `firstSentence(description)`; `trivia` = static trivia then `"Label: value"` for each `keyFacts` entry; `sources` static only; `sourceNote` = `db.source || ''`; structure `id` = `mesh_name` when present, else `structure-<index>`; missing fields become `''`/`[]`/`null`. A system id missing from `systems` merges with empty static fields.

- [ ] **Step 1: Append the failing tests**

```js
import {systems, mergeSystem} from '../../assets/js/explorer/data.js';

const db = (over = {}) => ({id: 'skeletal', system_id: 1, name: 'Skeletal System', isActive: true, color: '#f59e0b', description: '', keyFacts: {}, structures: [], modelUrl: '../system_model/layers/skeletal.glb', source: 'Credit (https://example.org).', ...over});

test('data.js covers the ten database systems with complete entries', () => {
    assert.deepEqual(systems.map(s => s.id).sort(), ['circulatory', 'digestive', 'endocrine', 'lymphatic', 'muscular', 'nervous', 'reproductive', 'respiratory', 'skeletal', 'urinary']);
    for (const s of systems) {
        assert.ok(s.summary && s.description, s.id + ' has text');
        assert.ok(s.functions.length >= 3, s.id + ' functions');
        assert.ok(s.trivia.length >= 3, s.id + ' trivia');
        assert.ok(s.sources.length >= 1 && s.sources.every(x => x.title && /^https:\/\/openstax\.org\//.test(x.url)), s.id + ' sources');
    }
});

test('mergeSystem lets the database win and maps structures', () => {
    const merged = mergeSystem(db({description: 'Teacher text. More.', keyFacts: {Bones: '206'}, structures: [{name: 'Femur', desc: 'Thigh bone.', mesh_name: 'anatomy_00848'}, {name: 'Skull', desc: ''}]}));
    assert.equal(merged.description, 'Teacher text. More.');
    assert.deepEqual(merged.structures, [{id: 'anatomy_00848', name: 'Femur', meshName: 'anatomy_00848', description: 'Thigh bone.'}, {id: 'structure-1', name: 'Skull', meshName: '', description: ''}]);
    assert.equal(merged.trivia.at(-1), 'Bones: 206');
    assert.equal(merged.sourceNote, 'Credit (https://example.org).');
    assert.equal(merged.modelUrl, '../system_model/layers/skeletal.glb');
    assert.ok(merged.functions.length >= 3);
});

test('mergeSystem falls back to static text and tolerates unknown systems', () => {
    const skeletal = systems.find(s => s.id === 'skeletal');
    assert.equal(mergeSystem(db({description: '  '})).description, skeletal.description);
    const unknown = mergeSystem(db({id: 'test-system', description: 'Database description. Second.', modelUrl: null, source: ''}));
    assert.equal(unknown.summary, 'Database description.');
    assert.deepEqual([unknown.functions, unknown.trivia, unknown.sources, unknown.modelUrl], [[], [], [], null]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/unit/explorer.test.mjs`
Expected: FAIL with `Cannot find module` for `data.js`.

- [ ] **Step 3: Write `assets/js/explorer/data.js`.**
  - Implement `mergeSystem` per the rules above.
  - Write the ten content entries for students: a one-sentence `summary`, a 2–3 sentence `description`, 3–5 `functions`, 3–5 `trivia`, and 1–2 `sources`.
  - Sources point at the OpenStax *Anatomy and Physiology 2e* chapter pages (`https://openstax.org/books/anatomy-and-physiology-2e/pages/<chapter>-introduction`): skeletal 6, muscular 11, nervous 12, endocrine 17, circulatory 19, lymphatic 21, respiratory 22, digestive 23, urinary 25, reproductive 27.
  - Every fact must be stated in the cited chapter.
  - Nervous trivia includes "The brain contains about 86 billion neurons."

- [ ] **Step 4: Check every source URL resolves**

Run (PowerShell): `node -e "import('./assets/js/explorer/data.js').then(async m=>{for(const s of m.systems)for(const x of s.sources){const r=await fetch(x.url,{method:'HEAD',redirect:'follow'});console.log(r.status,x.url)}})"`
Expected: every line starts with `200`. If a server answers HEAD with 403/405, retry that URL with GET before treating it as broken. Fix any URL that is really broken.

- [ ] **Step 5: Run the checks**

Run: `node --test "tests/unit/*.test.mjs"` then `node tests/check-syntax.mjs`
Expected: all pass.

---

### Task 3: Engine additions (`model-viewer.js`)

**Files:**
- Modify: `assets/js/anatomy-layers-core.js` (add `distanceLimits` and export it)
- Modify: `assets/js/model-viewer.js`
- Modify: `tests/unit/anatomy-layers-core.test.mjs` (append test)

**Interfaces:**
- Produces on `AnatomyLayersCore`: `distanceLimits(diagonal: number): {min: number, max: number}` — `min = diagonal * 0.02`, `max = diagonal * 4`; non-finite or ≤0 diagonal treated as 1.
- Produces on `AnatomyViewer` (existing callers unaffected):
  - `disposeLayer(id: string): void` — removes the layer from `layers`, marks it `disposed = true`, removes its root from `world`, disposes geometries, base materials, their `materialCache` variants (and deletes those cache entries), and every texture referenced by those materials (any material property whose value `isTexture`). Clears hover and focus that belong to the layer.
  - `adoptLayer` — when `layer.disposed` is true, disposes the incoming root with the same routine and does not add it to `world`.
  - `moveCamera(position, target, duration = 800)` — new optional `duration`.
  - `zoom(factor, anchor = target, animate = false)` — when `animate`, glides to the clamped result with `moveCamera(…, 200)` instead of jumping.
  - `resetView(animate = false)` — also sets `controls.minDistance`/`maxDistance` from `distanceLimits(diagonal)` and `panBounds` = visible box expanded by 25% of its size on each side (50% overall). With `animate`, glides with `moveCamera(position, center)`; near/far are set immediately either way.
  - `panBounds: THREE.Box3 | null` — on every controls `change` event the orbit target is clamped into it with `panBounds.clampPoint(target, target)`.
  - Render loop: on `visibilitychange` the engine cancels `requestAnimationFrame` while hidden and restarts `animate` when visible (only one loop ever runs).

- [ ] **Step 1: Append the failing unit test** to `tests/unit/anatomy-layers-core.test.mjs`

```js
test('distanceLimits scales with the model diagonal', () => {
    assert.deepEqual(core.distanceLimits(2), {min: 0.04, max: 8});
    assert.deepEqual(core.distanceLimits(0), {min: 0.02, max: 4});
    assert.deepEqual(core.distanceLimits(NaN), {min: 0.02, max: 4});
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test tests/unit/anatomy-layers-core.test.mjs`
Expected: FAIL, `core.distanceLimits is not a function`.

- [ ] **Step 3: Implement `distanceLimits` in `anatomy-layers-core.js`** and add it to the returned object.

- [ ] **Step 4: Implement the `AnatomyViewer` additions listed under Interfaces** in `model-viewer.js`, keeping the file's one-object style and comment density.

- [ ] **Step 5: Run the checks**

Run: `node --test "tests/unit/*.test.mjs"` then `node tests/check-syntax.mjs`
Expected: all pass.

- [ ] **Step 6: Smoke-check the unchanged pages still work**

Open `http://localhost/Anthropotomy/student/anatomy.html` in the in-app browser (XAMPP running, signed in as any account the user provides; skip this step if none is available and rely on Task 4's browser run). Toggle the skeleton off and on, use Zoom in, Reset. Expected: model reappears after re-enabling, zoom and reset still work, no console errors. The old page never calls `disposeLayer`, so switching off only hides.

---

### Task 4: Explorer shell on the student page

**Files:**
- Create: `assets/js/explorer/icons.js`, `assets/js/explorer/viewer.js`, `assets/js/explorer/panel.js` (shell only: open/close/persistence/header), `assets/js/explorer/main.js`, `assets/css/explorer.css`
- Modify: `student/anatomy.html` (replace `.page-content` block lines 60–123; swap scripts lines 129–133)
- Modify: `tests/browser.mjs` (student anatomy block, lines 129–139)

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 `mergeSystem`, Task 3 engine members, globals `AnatomyData`, `AnatomyLayersCore`, `AnatomyViewer`, `API_BASE`, `Auth`.
- Produces:
  - `icons.js`: `icon(name: 'zoom-in' | 'zoom-out' | 'reset' | 'rotate' | 'save' | 'maximize' | 'minimize' | 'info' | 'x' | 'chevron-right'): string` (Lucide shapes: `zoom-in`, `zoom-out`, `rotate-ccw`, `refresh-cw`, `download`, `maximize`, `minimize`, `info`, `x`, `chevron-right`).
  - `viewer.js`:
    - `init(canvas: HTMLCanvasElement, {onPartClick, labelFor}): boolean` (false when WebGL fails)
    - `ready(): boolean`
    - `setLayer(raw: AnatomyDataSystem, on: boolean, onProgress?: (layer) => void): Promise<layer | null>` (off calls `setLayerVisible(raw, false)` then `disposeLayer(raw.id)`)
    - `layerState(id)`, `hasVisibleLayer()`
    - `zoomStep(direction: 1 | -1)` (factor `.85` for 1, `1.15` for −1, animated)
    - `reset()` (animated `resetView(true)`)
    - `toggleRotate(): boolean`, which pauses on controls `start` and resumes 3000 ms after `end` while still wanted
    - `saveImage(systemCode: string): Promise<boolean>`
    - `toggleFullscreen(el: HTMLElement): Promise<void>`: when already fullscreen, exit (`document.exitFullscreen` / `webkitExitFullscreen`, or remove the pseudo class). Otherwise call `el.requestFullscreen` when it is a function, then `el.webkitRequestFullscreen`, and add `is-pseudo-fullscreen` when neither exists or the request rejects.
    - `isFullscreen(el): boolean`, `onFullscreenChange(el, cb: (on: boolean) => void)` (listens to `fullscreenchange`, `webkitfullscreenchange` and pseudo toggles), `exitPseudoFullscreen(el): boolean` (true when it exited)
    - `highlightStructure(meshName: string): Object3D | null`, `focusPart(part)`, `clearHighlight()`, `focusedPart(): Object3D | null`
  - `panel.js` (shell): `initPanel({panel: HTMLElement, toggle: HTMLButtonElement, explorer: HTMLElement, onBack: () => void}): void`, `setOpen(open: boolean, {persist = true, returnFocus = false} = {}): void`, `togglePanel(): void`, `isOpen(): boolean`, `renderHeader(name: string, summary: string): void`.
    - The initial state is `panelDefault(stored, matchMedia('(min-width: 768px)').matches)`. Every `localStorage` read and write is wrapped in try/catch.
    - `setOpen` toggles `.is-open` on the panel, `.is-panel-open` on the explorer and the toggle's `aria-expanded`.
    - The header X button calls `setOpen(false, {returnFocus: true})`, which focuses the toolbar Info button. `initPanel` builds the body skeleton with these ids, all `hidden` until filled: `teacherTools`, `selectedPart` (children `selectedPartTitle`, `selectedPartSystem`, `selectedPartBadge`, `selectedPartDescription`, `selectedPartFunction`, `selectedPartAlso`, `selectedPartReference`, `exitFocus`), `sysDescription`, `sysFunctions`, `sysStructures`, `sysTrivia`, `practice`, `relatedContent` (child `relatedModules`), `sysSources`.
  - `main.js`: `window.AnatomyExplorer = {get contextSystem(): ExplorerSystem | null, set activeSeconds(value: number), flushExploration(): Promise<void>}` (test and debugging hook).

Behavior `main.js` owns (port from `assets/js/anatomy-page.js`, keep its version counters and stale-load guards):
- Auth gate (`Auth.requireAuth(role)`), `AnatomyData.load()`, student-preview filter, `?lesson_id=` override, starting system (`?system=` → first with model → first), chips, context system, focus, exploration analytics (students only; 45 s flush, `pagehide`, hidden tab).
- A failed `AnatomyData.load()` or an empty system list shows the API-failure or no-systems copy from Global Constraints in the overlay, with tools disabled. The no-systems case also sets the panel title.
- Chips are `button.system-chip[role=switch][aria-checked][data-system]` with `.system-chip__dot` (`--system-color`), `.system-chip__name`, `.system-chip__status` (text from `AnatomyLayersCore.toggleStatus`).
- Switching off disposes the layer. A non-layered GLB switches the other layers off and resets.
- Overlay from `stageState`: track `failedId` as the last system whose load ended in `error` and clear it on any successful load. Retry calls the chip toggle for `failedId`. Tools `zoom-in`, `zoom-out`, `reset`, `rotate`, `save` get `disabled` and `aria-disabled="true"` unless `kind === 'ready'`.
- Toolbar: roving tabindex (one enabled button has `tabindex="0"`). Arrow keys move between enabled buttons, using ArrowUp/ArrowDown when `aria-orientation="vertical"` and ArrowLeft/ArrowRight when horizontal, with Home/End. `matchMedia('(max-width: 767.98px)')` flips `aria-orientation`.
- Shortcuts via `shortcutAction` on `document` keydown, skipped for disabled tools. A capture-phase Escape exits part focus first, then a bubbling Escape calls `exitPseudoFullscreen`.
- The fullscreen button swaps the `maximize`/`minimize` icon, its `aria-label` between `Fullscreen` and `Exit fullscreen`, and its `data-tip` between `Fullscreen (F)` and `Exit fullscreen (F)`.
- Save announces `Image could not be saved.` in `#explorerLive` on failure.
- Clicking a part calls `setOpen(true, {persist: false})` when the panel is closed.

`explorer.css` implements spec section 2 exactly (layout, toolbar, buttons, tooltips, chip bar, panel, state overlay with spinner, breakpoints 1024/768, fullscreen and pseudo-fullscreen, reduced motion). It also adds:
- `.visually-hidden`
- `.explorer [hidden] { display: none !important; }`
- `body.explorer-page { overflow: hidden; }`
- `.explorer.is-panel-open` rules (chip bar right edge; mobile toolbar above the sheet)

- [ ] **Step 1: Replace the student anatomy block in `tests/browser.mjs`** (inside `if(page==='anatomy'){` of the student loop) with:

```js
for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
assert.equal(await evaluate('AnatomyData.systems[0].description'),'Database description');
assert.ok(await evaluate('AnatomyViewer.hasVisibleLayer()'),'Real GLB model loaded');
assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight+1'),'Explorer page does not scroll');
assert.ok(await evaluate(`(()=>{const r=document.getElementById('explorer').getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<=1&&Math.abs(r.top-document.querySelector('.topbar').getBoundingClientRect().bottom)<=1;})()`),'Viewer fills the content area');
assert.equal(await evaluate(`document.querySelectorAll('.model-tools, #zoomIn, #exportModel, .page-content').length`),0,'No text buttons below the viewer');
assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),false,'Tools enabled with a model');
await evaluate(`localStorage.removeItem('anatomy.panelOpen')`);
await navigate('/student/anatomy.html');
assert.equal(await evaluate(`document.querySelector('[data-action="info"]').getAttribute('aria-expanded')`),'true','Panel opens by default on desktop');
const canvasWidth=await evaluate(`document.getElementById('anatomyCanvas').clientWidth`);
await evaluate(`document.querySelector('[data-action="info"]').click()`);
assert.equal(await evaluate(`document.querySelector('[data-action="info"]').getAttribute('aria-expanded')`),'false');
assert.equal(await evaluate(`document.getElementById('anatomyCanvas').clientWidth`),canvasWidth,'Panel does not resize the canvas');
await navigate('/student/anatomy.html');
assert.equal(await evaluate(`document.getElementById('infoPanel').classList.contains('is-open')`),false,'Panel state persists after reload');
await evaluate(`document.querySelector('[data-action="info"]').click()`);
assert.equal(await evaluate(`localStorage.getItem('anatomy.panelOpen')`),'1');
for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
// Force the fallback path so the check is deterministic; native fullscreen is verified manually in Task 7.
await evaluate(`(()=>{const e=document.getElementById('explorer');e.requestFullscreen=undefined;e.webkitRequestFullscreen=undefined;document.querySelector('[data-action="fullscreen"]').click();})()`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.ok(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),'Fullscreen fallback is active');
assert.ok(await evaluate(`getComputedStyle(document.querySelector('.toolbar')).visibility==='visible'&&getComputedStyle(document.getElementById('infoPanel')).visibility==='visible'`),'Toolbar and panel stay visible in fullscreen');
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),false,'Escape leaves fullscreen');
const chip=await evaluate(`document.querySelector('.system-chip[aria-checked="true"]').dataset.system`);
const before=await evaluate('AnatomyViewer.renderer.info.memory.geometries');
await evaluate(`document.querySelector('.system-chip[aria-checked="true"]').click()`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await evaluate(`AnatomyViewer.layerState(${JSON.stringify(chip)})`),null,'Switching off disposes the layer');
assert.ok(await evaluate('AnatomyViewer.renderer.info.memory.geometries')<before,'Geometries are released');
assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),true,'Tools disabled without a visible model');
assert.equal(await evaluate(`document.querySelector('[data-action="fullscreen"]').disabled`),false,'Fullscreen stays enabled');
await evaluate(`(()=>{const c=document.querySelector('.system-chip[data-system=${JSON.stringify(chip)}]');c.click();c.click();})()`);
await new Promise(resolve=>setTimeout(resolve,4000));
assert.equal(await evaluate('AnatomyViewer.world.children.length'),0,'A model switched off mid-download never joins the scene');
await evaluate(`document.querySelector('.system-chip[data-system=${JSON.stringify(chip)}]').click()`);
for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.runtime/student-anatomy.png',Buffer.from(shot.data,'base64'));
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await new Promise(resolve=>setTimeout(resolve,300));
assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'Mobile anatomy page fits viewport');
assert.equal(await evaluate(`document.querySelector('.toolbar').getAttribute('aria-orientation')`),'horizontal','Mobile toolbar is horizontal');
await call('Emulation.clearDeviceMetricsOverride');
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await evaluate(`document.querySelector('.toolbar').getAttribute('aria-orientation')`),'vertical','Desktop toolbar is vertical again');
```

- [ ] **Step 2: Run the browser suite and confirm failure** (Test Environment above)

Run: `node tests/browser.mjs`
Expected: FAIL at `Explorer page does not scroll` or `Viewer fills the content area`.

- [ ] **Step 3: Write `icons.js`, `viewer.js`, the `panel.js` shell and `main.js`** per Interfaces. Each file opens with a short comment explaining the module's role.

- [ ] **Step 4: Write `assets/css/explorer.css`** per spec section 2 and the additions above.

- [ ] **Step 5: Update `student/anatomy.html`.**
  - Add `class="explorer-page"` to `body`, keeping the existing classes.
  - Add `<link rel="stylesheet" href="../assets/css/explorer.css">` after `student-portal.css`.
  - Replace the `<div class="page-content">…</div>` block with the spec section 1 markup.
  - Replace `<script src="../assets/js/anatomy-page.js…">` with `<script type="module" src="../assets/js/explorer/main.js"></script>`.
  - Keep the other script tags and their order.

- [ ] **Step 6: Run the checks**

Run: `node --test "tests/unit/*.test.mjs"`, `node tests/check-syntax.mjs`, then re-create the test database, run `node tests/integration.mjs` and `node tests/browser.mjs`.
Expected: unit and syntax pass; integration passes; browser suite passes through the student anatomy block. The teacher anatomy block still runs against the old teacher page and passes too, because `anatomy-page.js` still exists.

---

### Task 5: Panel content

**Files:**
- Modify: `assets/js/explorer/panel.js`, `assets/js/explorer/main.js`, `assets/css/explorer.css`
- Modify: `tests/browser.mjs` (student anatomy block)

**Interfaces:**
- Consumes: Task 4 panel skeleton ids, `splitLinks`/`safeUrl` (Task 1), `ExplorerSystem` (Task 2).
- Produces in `panel.js`:
  - `renderPanel(system: ExplorerSystem, {onStructure: (structure) => void}): void` fills the header and every section in spec order. Sections hide when empty, except `sysStructures`, which shows `No structures added yet.`. Practice is reset on each render.
  - `renderSelection(info: {title, systemName, description, func, alsoPartOf: string[], reference, unidentified: boolean, focused: boolean} | null): void`. `null` hides `selectedPart` and clears the pressed structure chip. `exitFocus` is visible only when `focused`. `selectedPartReference` is shown only for a `safeUrl` reference.
  - `setPressedStructure(id: string | null): void`.
  - Structure chips are `button.structure-chip[aria-pressed][data-structure]`.
  - Trivia: `#triviaText` starts at a random index. `#triviaNext` ("Next fact") cycles and is hidden for a single fact.
  - Sources: `ul` of links, then a `p.source-note` built from `splitLinks(sourceNote)` with anchors only for `safeUrl` parts.
  - Practice keeps today's behavior from `anatomy-page.js` lines 138–146: `#practiceButton` "Practice a structure", `#practicePrompt`, `#practiceChoices`, and `#practiceResult` reading "Correct. <desc>" or "Try again. Read the description carefully." It uses structures that have a `description` and is hidden when fewer than 2.
- `main.js` wiring:
  - `onStructure` calls `viewer.highlightStructure(meshName)`. On a hit it runs the existing focus flow; otherwise it calls `renderSelection({title: name, description: description || 'No description provided.', systemName, func: '', alsoPartOf: [], reference: '', unidentified: false, focused: false})`. Either way it calls `setPressedStructure(id)` and records the view.
  - Part clicks render `AnatomyLayersCore.partInfo(...)` with `focused: true`. `exitFocus`, Escape and empty-space clicks call `renderSelection(null)`.

- [ ] **Step 1: Append to the student anatomy block in `tests/browser.mjs`** (after the model has reloaded, before the screenshot):

```js
await evaluate(`document.querySelector('.structure-chip').click()`);
assert.equal(await evaluate(`document.getElementById('selectedPartDescription').textContent`),'Database structure');
assert.equal(await evaluate(`document.querySelector('.structure-chip').getAttribute('aria-pressed')`),'true');
assert.equal(await evaluate(`document.getElementById('sysDescription').hidden`),false,'Description shows');
assert.ok(await evaluate(`[...document.querySelectorAll('#sysSources a')].every(a=>a.target==='_blank'&&a.rel==='noopener noreferrer'&&/^https?:/.test(a.href))`),'Source links are safe');
assert.ok(await evaluate(`document.getElementById('sysTrivia').hidden||document.getElementById('triviaText').textContent.length>0`),'Trivia renders when present');
assert.equal(await evaluate(`document.getElementById('sysStructures').hidden`),false,'Structures section never hides');
// test-system has no data.js entry; its only trivia is the fixture key fact {Fact: 'Database fact'}.
assert.equal(await evaluate(`document.getElementById('sysFunctions').hidden`),true,'Empty functions section hides');
assert.equal(await evaluate(`document.getElementById('triviaText').textContent`),'Fact: Database fact');
assert.equal(await evaluate(`document.getElementById('triviaNext').hidden`),true,'Single fact hides Next');
```

- [ ] **Step 2: Run and confirm failure**

Run: re-create the test database, `node tests/integration.mjs`, `node tests/browser.mjs`
Expected: FAIL with `Cannot read properties of null (reading 'click')` on `.structure-chip`.

- [ ] **Step 3: Implement `renderPanel`, `renderSelection` and `setPressedStructure` in `panel.js`, wire them in `main.js`, and add panel section styles** (section headings, bullet list, chips with `aria-pressed` outline plus a check icon, trivia card, badge, links in `--accent-ring`) to `explorer.css`.

- [ ] **Step 4: Run the checks**

Run: unit, syntax, integration, browser (as in Task 4 Step 6).
Expected: all pass.

---

### Task 6: Teacher portal

**Files:**
- Create: `assets/js/explorer/teacher.js`
- Modify: `assets/js/explorer/main.js` (dynamic `import('./teacher.js')` when `document.body.dataset.anatomyRole === 'teacher'`)
- Modify: `teacher/anatomy.html` (same changes as Task 4 Step 5, applied to its `.page-content` block lines 58–139 and script tags 143–149; `body` keeps `teacher-dashboard`)
- Modify: `assets/css/content.css` (delete lines 3–10, the `.anatomy-presenting` rules)
- Delete: `assets/js/anatomy-page.js`, `assets/js/teacher-anatomy.js`
- Modify: `tests/browser.mjs` (teacher anatomy block, lines 44–77)

**Interfaces:**
- Consumes: panel ids `teacherTools`, `relatedContent`, `relatedModules` (Task 4), `ExplorerSystem` (Task 2).
- Produces: `initTeacher({preview: boolean}): {onContext(system: ExplorerSystem): void}`.
  - It fills `#teacherTools` (unhidden) with `p#previewStatus` (today's two strings from `teacher-anatomy.js` lines 11–13), `a#previewToggle` ("Student preview" / "Return to teacher view") and `a#editAnatomy` ("Edit content", hidden in preview).
  - `onContext` updates both links and `?system=` with `history.replaceState`, as today. Outside preview it loads related modules into `#relatedModules` (unhiding `#relatedContent`) with today's copy and request-version guard.
  - `main.js` calls `onContext` whenever the context system changes. Hidden systems show `(hidden)` on their chip outside preview. Teacher exploration never posts analytics.

- [ ] **Step 1: Update the teacher anatomy block in `tests/browser.mjs`.**
  - Replace `#systemToggles .system-toggle` with `#systemChips .system-chip`.
  - Replace `.structure-button` with `.structure-chip`.
  - Replace `structureDescription` with `selectedPartDescription`.
  - Replace `activeSeconds=10;flushExploration()` with `AnatomyExplorer.activeSeconds=10;AnatomyExplorer.flushExploration()`.
  - Replace `selectedSystem.id` with `AnatomyExplorer.contextSystem.id`.
  - Replace the presentation-mode assertions (lines 63–67) with:

```js
assert.equal(await evaluate(`document.querySelector('[data-action="zoom-in"]').disabled`),false);
await evaluate(`(()=>{const e=document.getElementById('explorer');e.requestFullscreen=undefined;e.webkitRequestFullscreen=undefined;document.querySelector('[data-action="fullscreen"]').click();})()`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.ok(await evaluate(`(()=>{const r=document.getElementById('explorer').getBoundingClientRect();return r.top===0&&Math.abs(r.width-innerWidth)<=1&&Math.abs(r.height-innerHeight)<=1;})()`),'Fullscreen covers navigation');
assert.equal(await evaluate(`document.querySelector('[data-action="fullscreen"]').getAttribute('aria-label')`),'Exit fullscreen');
await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await evaluate(`document.getElementById('explorer').classList.contains('is-pseudo-fullscreen')`),false,'Escape exits fullscreen');
```

  - Before the model is assigned (right after the existing empty-state assertion), add: `assert.equal(await evaluate(\`document.querySelector('[data-action="zoom-in"]').disabled\`),true,'Tools disabled without a model');`

- [ ] **Step 2: Run and confirm failure**

Run: re-create the test database, `node tests/integration.mjs`, `node tests/browser.mjs`
Expected: FAIL at `Teacher sees hidden systems` (no `#systemChips` yet).

- [ ] **Step 3: Write `teacher.js`, wire it in `main.js`, update `teacher/anatomy.html`, delete the presentation CSS and the two old scripts.**

- [ ] **Step 4: Confirm nothing references the deleted files**

Run: `node tests/check-syntax.mjs` and search for `anatomy-page.js|teacher-anatomy.js|presentationToggle|anatomy-presenting` across `*.html`, `*.js`, `*.css`.
Expected: syntax check passes; the search finds nothing outside `docs/`.

- [ ] **Step 5: Run the checks**

Run: unit, syntax, integration, browser.
Expected: all pass, including `Teacher viewing never posts student exploration progress` and `Student preview excludes hidden systems`.

---

### Task 7: README and full verification

**Files:**
- Modify: `README.md` (new `## 3D Anatomy Explorer` section after the layered-models paragraph; update the Verification paragraph's "presentation controls" wording to "fullscreen controls")

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the README section.** Cover:
  - **Layout:** the toolbar, chips and panel.
  - **Keyboard shortcuts:** the shortcut table.
  - **Running locally:** XAMPP Apache + MySQL, open `http://localhost/Anthropotomy/login.html`. Pages must be served over HTTP because `file://` blocks GLB loading.
  - **Adding a system and model:**
    1. Export or upload the GLB.
    2. Create the system in Teacher › Content, or connect a layer with `database/integrate_layers.php`.
    3. Add an entry keyed by `system_code` to `assets/js/explorer/data.js`.
  - **Where to edit the data:** teacher-edited fields versus `data.js` fields.

- [ ] **Step 2: Run the full automated suite**

Run, from a fresh test database: `node --test "tests/unit/*.test.mjs"`, `node tests/check-syntax.mjs`, `node tests/integration.mjs`, `node tests/browser.mjs`, then recreate the database and run `node tests/navigation.mjs`.
Expected: every suite passes; record the pass counts.

- [ ] **Step 3: Manual acceptance pass in the in-app browser** against `http://127.0.0.1:8091` signed in with `.runtime/test-access.json` credentials.
  - In the browser console, point `test-system` at `../system_model/layers/skeletal.glb` through `PUT /api/anatomy-content.php`.
  - Check at 1920×1080, 768×1024 and 375×812:
    - no scroll or gaps
    - icon tooltips on hover and focus
    - panel slide and persistence
    - all panel sections
    - fullscreen and Escape
    - Save image downloads `anatomy-test-system-<today>.png`
    - empty, loading and error states (error: point the model at a missing `.glb`, then Retry)
    - keyboard-only operation: Tab to the toolbar, arrow keys, shortcuts
    - `AnatomyViewer.renderer.info.memory` drops after a chip is switched off
    - console free of errors
  - Note any failure and fix it before continuing.

- [ ] **Step 4: Tear down the test environment**

Run: stop the PHP server and headless Chrome processes started in the Test Environment, then `C:/xampp/php/php.exe tests/database.php cleanup` with the same `ANATOMIQ_DB_NAME`.
Expected: cleanup reports the test database removed.
