# Entertainment Games (Sub-project 1: Shell + Germ Smash) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-screen game page with a shared shell (loading, menu, settings, how to play, high scores, countdown, pause, game over), the first game Germ Smash, server scoring for arcade scores, and the quiz games removed.

**Architecture:**
- `student/play.html` boots `assets/js/games/shell.js`, which imports one game module from a fixed map and owns every screen, the settings, sound, the frame loop and saving.
- `germ-smash.js` holds the pure round logic (unit-tested) and the canvas rendering.
- The server accepts `{game_key, difficulty, score, duration_sec, stats}` against per-game limits and keeps the existing points, weekly leaderboard and badges.

**Tech Stack:** plain ES modules and Canvas 2D, PHP 8 and MySQL (XAMPP), `node --test`, and the existing integration, browser (CDP) and navigation suites. Characters are rendered in Blender (Blender MCP) and sounds come from Kenney.nl (CC0).

**Spec:** `docs/superpowers/specs/2026-10-25-entertainment-games-design.md`
**Approved menu look:** `docs/superpowers/specs/assets/2026-10-25-germ-smash-menu-mockup.html`. Open it in a browser and match it:
- the panel sits on the left on desktop and as a bottom sheet on phones;
- the title is in Bungee, with "Smash" in yellow and offset;
- New game is the one yellow button; the other buttons are dark pills;
- the panel footer shows the best score and stars;
- sub-screens swap inside the panel;
- live germs move behind the menu.

## Global Constraints

- **Entertainment only:** no quiz mechanics. Nothing writes to the assessment, quiz or lesson tables.
- **Icons:** only from the Phosphor sprite `assets/icons/interface.svg`; no emoji; no pastel icon tiles. The mockup's Phosphor web font is for the mockup only.
- **Fonts:** Bungee for titles and numbers, Plus Jakarta Sans for the UI, loaded from `assets/fonts` as `stage-portal.css` does.
- **Colors:** the Stage palette: `#121212` panel, `#1f1f1f` and `#2a2a2a` raised, yellow `#f7c948`, coral `#f2545b`, sky `#3fb8f5`, teal `#2ccf9a`.
- **User text** (names) is rendered with `textContent` only.
- **Settings key:** `anthropotomy_game_settings`. Every `localStorage` access is wrapped in try/catch.
- **Difficulty:** `easy | medium | hard`. Points = `round(score × {1, 1.5, 2})`, worked out on the server.
- **Germ Smash server limits:** `max_score` 20000, `min_sec` 55, `max_sec` 75.
- **Skin tones:** exactly `#F6D9C5 #EAC2A5 #D9A47F #C68A63 #A86F4C #8A5A3C #6B442B #4A2F20`.
- **Database:** schema changes go only in `database/migrate.php`, and must be repeatable and non-destructive. No tables or rows are dropped.
- **Downloads:** Kenney sound files and any new Phosphor icon SVGs need the user's OK first. The controller asks, naming each file, its source and its size.
- **Commits:** titles end with the date, e.g. `(2026-10-25)`. Every commit is pushed to `main` with a fast-forward, never a force-push.

## Review Focus

1. **A tab switch or minimize mid-round** auto-pauses, and paused time does not count, so `duration_sec` stays within 55–75 and the save is accepted. Tests in Tasks 3 and 5.
2. **A resize or phone rotation mid-round** re-lays out the board without losing round state, and a tap on a germ's new position still hits it. Test in Task 3.
3. **Blocked or corrupt `localStorage`** (private mode, or bad JSON) falls back to the default settings, and the game still plays. Test in Task 2.
4. **Rapid double taps on one germ** score once; a tap on a pore that was just cleared is `empty`. Test in Task 1.
5. **A score is never saved twice.** Retry appears only after a failed save, and Play Again during "Saving…" does not post twice. Test in Task 5.

---

### Task 1: Germ Smash round logic (pure)

**Files:**
- Create: `assets/js/games/germ-smash.js` (pure exports only in this task; there must be no DOM access at module top level)
- Test: `tests/unit/germ-smash.test.mjs`

**Interfaces:**
- Produces:
  - `LEVELS`, keyed `easy | medium | hard`, each `{cols, rows, upTime, spawnEvery, friendly, tough}`, with values from spec section 2:
    - easy: `{3, 3, 1.4, 0.9, .10, 0}`
    - medium: `{4, 3, 1.0, 0.7, .15, .10}`
    - hard: `{4, 4, .75, .5, .20, .20}`
  - `SKIN_TONES`: the 8 hex values.
  - `STARS = [300, 700, 1200]`, `ROUND_SECONDS = 60`.
  - `comboMultiplier(streak) → 1|2|3|4`: 1 below 5, 2 for 5–9, 3 for 10–19, 4 from 20.
  - `ramp(base, t) → base × (1 − 0.3 × min(t / 60, 1))`.
  - `keyToPore(code, cols, rows) → index | null`. It takes a `KeyboardEvent.code`:
    - for a 3×3 grid, `Numpad7/Digit7` maps to 0 through `Numpad3/Digit3` to 8, in phone-keypad layout, top row first;
    - for 4-wide grids, `KeyQ KeyW KeyE KeyR / KeyA… / KeyZ…` map row-major, and a 4×3 grid uses the first 3 rows.
  - `pickSkinTone(rng) → SKIN_TONES[floor(rng() × 8)]`.
  - `createRound(level, rng)` returns `{state, tick(dt) → events[], tap(index) → result}`, where:
    - `state = {score, streak, bestCombo, hits, misses, friendlyHits, time, over, pores: [{kind: 'germ'|'tough'|'friendly'|null, variant, cracked, age, upFor}]}`
    - an event is `{type: 'spawn'|'escape'|'end', pore}`
    - a result is `{type: 'hit'|'crack'|'kill'|'friendly'|'empty', value, multiplier}`

**Round rules** (the code must follow these exactly):
- **Spawning:** every `ramp(spawnEvery, time)` seconds, pick a random empty pore (skip if none). Draw `r = rng()`:
  - `r < friendly` → friendly;
  - `r < friendly + tough` → tough;
  - otherwise a germ with `variant = floor(rng() × 3)`.

  Each character's `upFor = ramp(upTime, time)`.
- **Escaping:** when `age ≥ upFor` the pore clears. A germ or tough germ escaping does `misses++` and sets `streak = 0`. A friendly bacterium leaving does nothing.
- **Germ tap:** `streak++`, `hits++`, `value = 10 × comboMultiplier(streak)` (the hit counts toward its own multiplier), and the pore clears.
- **Tough germ, first tap:** `crack`, with no score or streak change.
- **Tough germ, second tap:** `kill`, scored like a hit with base 25.
- **Friendly tap:** `friendlyHits++`, `score = max(0, score − 15)`, `streak = 0`, and the pore clears.
- `bestCombo = max(bestCombo, streak)`.
- When `time ≥ 60`, emit `end` once and set `over = true`. After that, `tick` and `tap` do nothing (`tap` returns `empty`).

- [ ] **Step 1: Write the failing tests** (`node:test`, following the style of `tests/unit/explorer.test.mjs`):

```js
test('comboMultiplier thresholds', () => { assert.deepEqual([0,4,5,9,10,19,20,50].map(comboMultiplier), [1,1,2,2,3,3,4,4]); });
test('ramp shrinks to 70% at 60 s', () => { assert.equal(ramp(1, 0), 1); assert.equal(ramp(1, 30), 0.85); assert.equal(ramp(1, 60), 0.7); assert.equal(ramp(1, 90), 0.7); });
test('keyToPore keypad and QWER layouts', () => { assert.equal(keyToPore('Numpad7',3,3),0); assert.equal(keyToPore('Digit3',3,3),8); assert.equal(keyToPore('KeyR',4,3),3); assert.equal(keyToPore('KeyZ',4,3),8); assert.equal(keyToPore('KeyZ',4,4),12); assert.equal(keyToPore('KeyV',4,4),15); assert.equal(keyToPore('KeyQ',3,3),null); });
test('skin tone is always one of the 8', () => { for (const v of [0, .124, .5, .999]) assert.ok(SKIN_TONES.includes(pickSkinTone(() => v))); });
```

  Also add round tests, using a scripted rng and forcing pore contents through `state.pores` where needed:
  - 5 hits in a row → the 5th hit's value is 20.
  - A tough germ: `crack`, then `kill` for 25 × the multiplier.
  - A friendly tap at score 5 → score 0 and streak 0.
  - An escape → `misses` 1 and streak 0.
  - **Review Focus 4:** tapping the same pore twice right after a kill → the second result is `empty`, and the score has changed once.
  - Ticking past 60 s emits exactly one `end`, then taps return `empty`.
  - A full easy round with `rng = () => 0.5` is deterministic: the same `state.score` on two runs.
- [ ] **Step 2: Run** `node --test tests/unit/germ-smash.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement the exports above** in `assets/js/games/germ-smash.js`.
- [ ] **Step 4: Run** the test again, then `node --test "tests/unit/*.test.mjs"` and `node tests/check-syntax.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `Germ Smash: round logic (2026-10-25)` and push.

### Task 2: Shell core (pure)

**Files:**
- Create: `assets/js/games/shell.js` (pure exports, plus an exported `boot()` that does nothing until Task 3)
- Test: `tests/unit/game-shell.test.mjs`

**Interfaces:**
- Produces:
  - `GAMES = {'germ-smash': {title: 'Germ Smash', tagline: 'Smash the germs, spare the good bacteria.', card: '../assets/games/germ-smash/card.webp', load: () => import('./germ-smash.js')}}`. This is the single client-side list of finished games, used by the gallery and the teacher page.
  - `DEFAULT_SETTINGS = {sfx: true, sfxVolume: 80, music: true, musicVolume: 50, reduceMotion: false, vibration: true}`.
  - `loadSettings(storage, prefersReducedMotion) → settings`:
    - merges the stored JSON over the defaults;
    - `reduceMotion` defaults to `prefersReducedMotion` when it isn't stored;
    - volumes are clamped to 0–100 integers;
    - non-boolean flags fall back to the default;
    - a throwing storage or invalid JSON returns the defaults.
  - `saveSettings(storage, settings) → boolean`, which swallows errors and returns false.
  - `makeRng(seed) → () => number`, using mulberry32 over `seed >>> 0`.
  - `starsFor(score, thresholds) → 0..3`.
  - `boot()`.

- [ ] **Step 1: Write the failing tests:**
  - defaults when storage is empty;
  - merging a partial stored object;
  - volume `250` → 100 and `-5` → 0;
  - `sfx: 'yes'` → `true`, the default;
  - **Review Focus 3:** a storage object whose `getItem` throws, and one returning `'{bad json'` → `DEFAULT_SETTINGS`;
  - `saveSettings` with a throwing `setItem` → `false`;
  - `makeRng(1)` gives the same first 3 values on two calls, all in [0, 1);
  - `starsFor(299, STARS) === 0`, `starsFor(300, STARS) === 1`, `starsFor(1200, STARS) === 3`;
  - `GAMES['germ-smash'].title === 'Germ Smash'`.
- [ ] **Step 2: Run** `node --test tests/unit/game-shell.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the exports.
- [ ] **Step 4: Run** the unit suite and the syntax check. Expected: PASS.
- [ ] **Step 5: Commit** `Game shell: settings, seeded random and stars (2026-10-25)` and push.

### Task 3: Play page, shell screens and Germ Smash on canvas

**Files:**
- Create: `student/play.html`, `assets/css/play.css`
- Modify: `assets/js/games/shell.js` (`boot()`, the screens and the frame loop), `assets/js/games/germ-smash.js` (default export plus rendering)
- Modify, only with the user's OK relayed by the controller: `assets/icons/interface.svg`, adding the Phosphor regular symbols `speaker-slash`, `music-notes` and `smiley` from `@phosphor-icons/core@2.1.1/assets/regular/`. Without the OK, the mute button uses `speaker-high` with `aria-pressed` and a CSS strike line, and How to Play uses `circle` instead of `smiley`.
- Test: `tests/browser.mjs` (a new Germ Smash section)

**Interfaces:**
- Consumes:
  - Task 1: `createRound`, `LEVELS`, `SKIN_TONES`, `pickSkinTone`, `keyToPore`, `STARS`, `ROUND_SECONDS`.
  - Task 2: `GAMES`, `loadSettings`, `saveSettings`, `makeRng`, `starsFor`.
- Produces:
  - The game module contract from spec section 1 (the `default export {key, title, tagline, theme, howToPlay, assets, stars, roundSeconds, settings, drawBackdrop, create}`).
  - `api` as listed in spec section 1.
  - The shell posts `{game_key, difficulty, score, duration_sec, stats}` to `API_BASE + '/games/plays.php'`. The server accepts this body from Task 4 onward, so until then only preview mode and the screens are tested.
  - `duration_sec = Math.round(playing seconds)`, which excludes paused time and the countdown.

**Page:**
- `student/play.html` loads `app.js`, calls `Auth.requireAuthSync()` (no role), then runs `import {boot} from '../assets/js/games/shell.js'; boot();`.
- A teacher or admin gets preview mode.
- An unknown `?game=` shows "That game doesn't exist" with a Games page button.
- Exit goes to `student/games.html`, or `teacher/games.html` for teachers.

**Screens:** build every screen and behavior in spec section 1, in the approved mockup's look:
- Loading → "Tap to start" → menu.
- Menu buttons: New game, How to play, Settings, High scores, Exit to Games.
- New game opens the difficulty cards, showing ×1 / ×1.5 / ×2.
- Countdown: 3-2-1-Go.
- HUD: score, combo badge, time left and a Pause button.
- Pause: opened by Esc, P, the Pause button or `visibilitychange`. Options: Resume, Restart, Settings, Quit to Menu.
- Game over: score, best, stars and the save status, with Play again, Main menu and Exit.
- In this task, High Scores shows "Scores appear after your first saved game". Task 5 wires it to `leaderboard.php?game=`.

**Assets until Tasks 6 and 7:**
- Germ Smash draws placeholder characters in code, as the mockup does.
- `api.images` holds whatever images loaded; the renderer falls back to code-drawn shapes when an image is missing.
- `api.sound(name)` is a no-op for sounds that haven't loaded.

**Renderer** (`create()` in `germ-smash.js`):
- **Board:** the grid is centered and sized to fit both landscape and portrait.
- **Backdrop:** a skin backdrop in `pickSkinTone(api.rng)` with pores, grain and a vignette, as in spec section 2. Characters get an outline and a glow.
- **Movement:** characters rise and sink.
- **Feedback:**
  - particles: 8–14, or 2–4 with reduce motion;
  - a floating "+N ×M";
  - a 4 px, 120 ms shake on a kill, none with reduce motion;
  - a red edge flash and `api.vibrate(80)` on a friendly tap;
  - a pulsing timer and `api.sound('tick')` in the last 10 seconds.
- **Input:** `pointer()` hit-tests against the current layout; `key()` uses `keyToPore`.
- **Resizing:** re-layout recomputes pore positions from `state.pores` indexes.

- [ ] **Step 1: Write the failing browser checks** in `tests/browser.mjs`. Sign in as the fixture student, open `/student/play.html?game=germ-smash&seed=1`, and check:
  - the loading screen gives way to "Tap to start", then the menu shows the 5 buttons;
  - in Settings, turning Music off survives a reload (localStorage);
  - How to play opens and Back returns;
  - New game → Easy → the countdown ends and the HUD shows `0` and `1:00`;
  - dispatching a pointer event at a germ's projected position raises the score (expose `window.__gameDebug = {state, poreCenter(i)}` only when `?seed=` is set);
  - **Review Focus 1:** pause by dispatching `visibilitychange` (hidden), wait 3 s, resume, and the HUD time left has changed by under 1 s;
  - **Review Focus 2:** set the viewport to 375×812 mid-round, then dispatch a pointer at the new `poreCenter(i)` of a live germ, and the score rises;
  - `/student/play.html?game=nope` shows "That game doesn't exist";
  - as the fixture teacher, the "Preview: scores aren't saved" tag is visible.
- [ ] **Step 2: Run** the browser suite (see testing in README and `.superpowers` testing-howto). Expected: the new checks FAIL.
- [ ] **Step 3: Implement** `play.html`, `play.css`, `boot()` and the screens, plus the Germ Smash default export and renderer.
- [ ] **Step 4: Run** `node tests/check-syntax.mjs`, the unit suite and the browser suite. Take screenshots at 1366×900 and 375×812 of the menu, a round in progress and the game-over screen into `.runtime/games-shots/gs-*`, and compare them with the mockup.
- [ ] **Step 5: Commit** `Game shell and Germ Smash on its own page (2026-10-25)` and push.

### Task 4: Server: arcade scores, game leaderboard, badges, removed card APIs

> Run Tasks 4 and 5 back to back. Between them, the old Games page still posts the quiz body and gets a 422.

**Files:**
- Modify:
  - `api/helpers.php`: `GAMES`; remove `scoreRound`; add `gamePoints(int $score, string $difficulty): int`; update `BADGE_METRICS` and `gameMetrics()`.
  - `api/games/plays.php`: the new body.
  - `api/games/leaderboard.php`: `?game=`.
  - `api/achievements.php`: validates against the updated `BADGE_METRICS`.
  - `database/migrate.php`: the `score` column, new seeds, and a once-only deactivation.
  - `api/anatomy-content.php`: remove the `?games` guard.
- Delete: `api/games/sets.php`, `api/games/mastery.php`
- Test: `tests/integration.mjs`. Replace the set, mastery, card-stat and quiz-round checks with the checks below. Keep the leaderboard ranking checks, adapted to post arcade rounds.

**Interfaces:**
- Produces:
  - **`POST games/plays.php`**
    - Body: `{game_key, difficulty, score, duration_sec, stats: {hits, misses, friendly_hits, best_combo}}`.
    - Response: `{score, points, new_badges: [{title, icon}]}`.
    - 422 rules from spec section 4.
    - Stores `correct = hits`, `total = hits + misses + friendly_hits`, `best_streak = best_combo`, `points`, `score`.
  - **`GET games/leaderboard.php?game=<key>[&section=]`**
    - Response: `{section, week_start, game, top: [{rank, user_id, full_name, score}], me: {rank, score} | null, best: {all_time, week} | null}`.
    - Ranking: weekly `MAX(score)` per student. Ties go to whoever reached their best first, using the earliest `played_at` among that student's rows at their best score.
    - An unknown game returns 422.
    - Without `game`, the behavior is unchanged.
  - **`BADGE_METRICS`** = the 7 learning metrics plus `games_played`, `best_game_streak`, `total_points` and `games_variety`.
  - **`gameMetrics()`** returns `games_played`, `best_game_streak`, `total_points` and `games_variety` (`COUNT(DISTINCT game_key)`).
  - **Seeds** (`INSERT IGNORE`): `combo-20` "On a Roll" (`best_game_streak` 20, `target`), `combo-40` "Unstoppable" (40, `target`), `all-rounder` "All-Rounder" (`games_variety` 3, `flag`).
  - **Once only**, guarded by `app_settings` `games_v2_badges = 1`: `UPDATE achievement_rules SET is_active = 0 WHERE badge_key IN ('perfect-1','explorer-3','explorer-6','streak-10','streak-25') OR metric IN ('perfect_rounds','game_systems_played')`.

- [ ] **Step 1: Write the failing integration checks:**

```js
const round=(over={})=>({game_key:'germ-smash',difficulty:'hard',score:800,duration_sec:60,stats:{hits:60,misses:4,friendly_hits:1,best_combo:22},...over});
const saved=await student('games/plays.php','POST',round());
check(saved.data.score===800&&saved.data.points===1600,'Arcade score saved with the hard multiplier');
check(saved.data.new_badges.some(b=>b.title==='On a Roll'),'A 22 combo earns On a Roll');
for(const bad of [{game_key:'match-pairs'},{difficulty:'insane'},{score:20001},{score:-1},{score:1.5},{duration_sec:54},{duration_sec:76},{stats:{hits:1,misses:0,friendly_hits:0,best_combo:2}},{stats:{hits:-1,misses:0,friendly_hits:0,best_combo:0}}])
  check((await student('games/plays.php','POST',round(bad))).status===422,'Rejected: '+JSON.stringify(bad));
check((await teacher('games/plays.php','POST',round())).status===403,'Teachers cannot save scores');
```

  Also check:
  - `leaderboard.php?game=germ-smash`: the student sees their own section, `best.all_time === 800`, and a second, lower round doesn't lower `best`;
  - a teacher without a section → 422; `?game=nope` → 422;
  - the old leaderboard without `game` still totals points;
  - after migrating, `achievements.php` lists `combo-20`, `combo-40` and `all-rounder` as active, and `perfect-1`, `explorer-3`, `explorer-6`, `streak-10` and `streak-25` as inactive;
  - after a teacher turns `streak-10` back on (`PUT`) and `migrate.php` runs again (`execFileSync`, as the suite does for `tests/database.php`), it is still active;
  - `games/sets.php` and `games/mastery.php` return 404;
  - creating a badge with metric `perfect_rounds` → 422, and with `games_variety` → success.
- [ ] **Step 2: Run** the integration suite on a fresh isolated test database. Expected: the new checks FAIL.
- [ ] **Step 3: Implement** the server changes listed above.
- [ ] **Step 4: Run** the syntax check, unit tests, and the integration suite on a fresh database. Then run `C:/xampp/php/php.exe database/migrate.php` twice against the test database: there should be no error, and no badge should be turned off again. Expected: PASS.
- [ ] **Step 5: Commit** `Games server: arcade scores, game leaderboard, new badges; card APIs removed (2026-10-25)` and push.

### Task 5: Gallery, teacher page, high scores wiring, quiz games removed

**Files:**
- Modify:
  - `student/games.html`, `assets/js/games/student-page.js`: the gallery, the weekly total points, badges, and no three.js scripts.
  - `teacher/games.html`, `assets/js/games/teacher-page.js`: the Leaderboard and Badges tabs only, plus a game filter and "Try Germ Smash" links.
  - `assets/js/games/shell.js`: High Scores uses `leaderboard.php?game=`; game over shows points, badges and rank from the save response.
  - `assets/css/games.css`: drop the quiz-game styles.
  - `README.md`: drop the `parts.json` and `build-part-index` sentences; describe Games in one paragraph.
- Delete:
  - `assets/js/games/{match-pairs,sort-it,beat-the-clock,unscramble,hunt-3d,cards,runner-core,runner,play-kit,registry}.js`
  - `system_model/layers/parts.json`, `tools/build-part-index.mjs`
  - `tests/unit/games.test.mjs`, `tests/unit/teacher-page.test.mjs`
- Test: `tests/browser.mjs`, `tests/navigation.mjs`

**Interfaces:**
- Consumes: `GAMES` (Task 2), the endpoints from Task 4.
- Produces:
  - **Gallery card for each `GAMES` entry:** card image, title, tagline, the student's `best.all_time` from `leaderboard.php?game=`, and a Play button linking to `play.html?game=<key>`.
  - **Teacher Leaderboard:**
    - a section select and a game select ("All games" plus each `GAMES` entry);
    - "All games" shows the existing points board;
    - a single game shows weekly best scores.
  - **Teacher Badges:**
    - the metric dropdown lists the updated `BADGE_METRICS`, with "Different games played" for `games_variety`;
    - rules whose metric has been removed are hidden from the list.

- [ ] **Step 1: Write the failing checks:**
  - **Browser:** the gallery shows exactly one card, "Germ Smash", whose Play button links to `play.html?game=germ-smash`; no element mentions Match Pairs, Sort It, Beat the Clock, Unscramble or 3D Hunt.
  - **Full round:** a full 60 s Easy round (`?seed=1`, clicking germs through `__gameDebug`) reaches game over, shows the points and "Saved", and the gallery then shows that best.
  - **Review Focus 5:**
    - after a successful save there is no Retry button;
    - with `plays.php` blocked through CDP `Fetch.enable` and a failed request, Retry appears;
    - unblocking and pressing Retry once sends exactly one more POST with an identical body;
    - pressing Play again twice quickly during "Saving…" posts once.
  - **Review Focus 1 (end to end):** a round with a 5 s hidden-tab pause still saves (the response is 2xx).
  - **Teacher:** two tabs only; the game filter shows weekly bests; "Try Germ Smash" opens `play.html?game=germ-smash` in preview.
  - **Navigation:** the Games links and the six-tab phone bar still pass.
- [ ] **Step 2: Run** the browser and navigation suites on a fresh database. Expected: the new checks FAIL.
- [ ] **Step 3: Implement** the changes and deletions. Run `git grep -n "parts.json\|runner-core\|play-kit\|sets.php\|mastery.php"`, which must find nothing outside `docs/`.
- [ ] **Step 4: Run** every suite: syntax, unit, integration, browser, navigation. Expected: PASS. Screenshot the gallery and the teacher page at 1366×900 and 375×812.
- [ ] **Step 5: Commit** `Games: Germ Smash gallery and teacher boards; quiz games removed (2026-10-25)` and push.

### Task 6: Blender characters

The controller confirms with the user that Blender is open with the MCP add-on connected before dispatching.

**Files:**
- Create: `assets/games/germ-smash/germ-1.webp`, `germ-2.webp`, `germ-3.webp`, `tough.webp`, `tough-cracked.webp`, `friendly.webp` (each 256×256 with a transparent background), and `card.webp` (1280×720).
- Modify: `assets/js/games/germ-smash.js` (`assets.images`)

**What to build:**
- **Germs:** spiky virus spheres in green, violet and orange.
- **Tough germ:** bigger, with armor plates; the cracked version adds a visible fracture.
- **Friendly bacterium:** a smooth, rounded blue capsule with a friendly face, clearly a different shape from the germs.
- **Card:** a group shot of the germs and a friendly bacterium.

**How:**
- Use the Blender MCP tools.
- Use the same three-point lighting as the landing renders in `assets/img/hero/`.
- Render with a transparent film, then convert to `.webp` (quality 85).
- Keep each character file under 40 KB and the card under 150 KB.
- Never modify or save any existing `.blend` file. Work in a new scene and leave the user's files untouched.

- [ ] **Step 1:** Render the 7 images. Check that each file exists, has the right size and an alpha channel, and is within its byte limit (a small node or PHP script is fine).
- [ ] **Step 2:** Point `assets.images` at the files. The code-drawn fallback stays for missing images.
- [ ] **Step 3:** Run the browser suite. Screenshot the menu and a round on 3 skin tones (light, mid, deep) and check that every character reads clearly on each.
- [ ] **Step 4: Commit** `Germ Smash: Blender characters (2026-10-25)` and push.

### Task 7: Sounds and music

Before dispatching, the controller lists the exact Kenney (CC0) files, with pack name, file name and size, and gets the user's OK.

**Files:**
- Create: `assets/games/germ-smash/{pop,thud,buzz,chime,beep,tick,gameover}.ogg` and `music.ogg`, each mono, under 60 KB, with music under 600 KB.
- Modify: `assets/js/games/germ-smash.js` (`assets.sounds`, `assets.music`), and `README.md` (one "Credits: Kenney.nl, CC0" line).

**Rules:**
- Sound effects follow the settings for on/off and volume.
- Music loops on the menu and during play, and pauses while the game is paused.
- If no CC0 music loop fits, `assets.music` is omitted and the Music setting is hidden, as in spec section 2.

- [ ] **Step 1:** Add the files and wire them up. In the browser suite, check that each sound name decodes (expose `__gameDebug.sounds` with `?seed=`), and that Music off stops the loop.
- [ ] **Step 2:** Run the browser suite. Expected: PASS.
- [ ] **Step 3: Commit** `Germ Smash: sounds and music (2026-10-25)` and push.

### Task 8: Final check

- [ ] **Step 1:** Run every suite on a fresh isolated database: syntax, unit, integration, browser, navigation. Expected: PASS.
- [ ] **Step 2:** Screenshot the following at 1366×900 and 375×812 and send them to the user:
  - the menu, settings, high scores;
  - a round on Easy and on Hard;
  - pause and game over;
  - the gallery and the teacher page.
- [ ] **Step 3:** Hand over to the user for their check: play each difficulty on phone and desktop, then tune the section 2 numbers. Clean up the test database.
