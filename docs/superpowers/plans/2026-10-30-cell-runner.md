# Cell Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cell Runner, an endless 3-lane tunnel runner. It plugs into the existing game shell, with the small shell additions it needs: a HUD with lives and distance, swipe input, game-specific settings, and on-screen buttons.

**Architecture:** `assets/js/games/cell-runner.js` follows the Germ Smash pattern. Pure round logic (unit-tested, no DOM at the top level) sits in the same file as a Canvas 2D renderer with a perspective projection. The shell gains backward-compatible hooks. The server only gains a `GAMES` entry.

**Tech Stack:** plain ES modules and Canvas 2D, PHP 8 and MySQL (XAMPP), `node --test`, and the existing integration, browser (CDP) and navigation suites; Blender MCP for the renders; Kenney CC0 sounds (already approved) converted with ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-30-cell-runner-design.md` (it builds on `2026-10-25-entertainment-games-design.md`)

## Global Constraints

- **Icons:** only from the Phosphor sprite `assets/icons/interface.svg`. No emoji, no pastel tiles, no new downloads (the existing ids include `arrow-left` and `arrow-right`).
- **Text:** user text goes in through `textContent` only. Every `localStorage` access is in try/catch.
- **Germ Smash:** must keep working unchanged. Its unit, integration and browser checks stay green.
- **Server limits:** `'cell-runner' => ['title' => 'Cell Runner', 'max_score' => 100000, 'min_sec' => 5, 'max_sec' => 900]`.
- **Stats mapping:** `hits` = bubbles collected, `misses` = hazards hit, `friendly_hits` = 0, `best_combo` = best oxygen streak.
- **Stars:** `[1500, 4000, 8000]`.
- **Counts:** `MAX_LIVES` 3, `MAX_OXYGEN` 5, a gate every 400 m, invulnerability 1.5 s, a lane move eases over 0.12 s.
- **Levels:**
  - easy `{startSpeed 12, ramp 0.15, topSpeed 30, rowGap 1.4, twoLane 0, virusShare .30, bubbleChance .60}`
  - medium `{16, .25, 38, 1.1, .25, .45, .50}`
  - hard `{20, .35, 46, .85, .45, .60, .40}`
- **Points:**
  - bubble +20;
  - delivery = 100 × oxygen carried × multiplier, where the multiplier is ×1, ×2 from the 2nd delivery in a row, and ×3 from the 4th;
  - score = floor(distance) + bubble points + delivery points.
- **Commits:** titles end with the date `(2026-10-30)`, and each is pushed to `main` (fast-forward only). Never stage `.impeccable/config.json`.

## Review Focus

1. **Swiping while paused, or during the countdown,** must not move the cell or reach the game. Test in Task 1.
2. **Switching Controls mid-round from the pause menu's Settings** shows or hides the on-screen buttons right away on resume. Test in Task 1.
3. **A very long run on Hard** (top speed for minutes): rows always leave a free lane and a reachable gap at top speed, and the score stays under `max_score`. Test in Task 2.
4. **Hitting a hazard during the invulnerable blink** costs no life, and the hazard passes through. Test in Task 2.
5. **Tiny phones (360×640) and wide desktops (1920×1080):** the cell, the lanes and the HUD stay on screen and the on-screen buttons don't cover the cell. Test in Task 3.

---

### Task 1: Shell hooks — HUD fields, endless rounds, swipes, game settings, on-screen buttons

**Files:**
- Modify: `assets/js/games/shell.js`, `student/play.html`, `assets/css/play.css`
- Test: `tests/unit/game-shell.test.mjs`, `tests/browser.mjs`

**Interfaces:**
- Produces:
  - `swipeDirection(dx, dy, ms) → 'left' | 'right' | null`: a swipe needs `|dx| ≥ 30`, `|dx| > 1.5 × |dy|` and `ms ≤ 600`.
  - `loadSettings` / `saveSettings` keep `settings.games`: an object of `{[gameKey]: {[name]: string}}`. Anything else (a non-object, a non-string value, more than 20 games or keys) is dropped.
  - `gameSettingValue(settings, gameKey, decl) → string`: returns the stored value if it's one of `decl.options` values, otherwise `decl.default`.
  - The game receives `api.gameSettings`, a read-only object with each declared setting's value.
  - `api.hud({score, combo, timeLeft, lives, distance})`:
    - the timer shows only if `timeLeft` is a number;
    - hearts show only if `lives` is a number, out of `game.maxLives`;
    - distance (`"1,234 m"`) shows only if `distance` is a number.
  - The game contract adds these optional fields: `swipe(direction)`, `maxLives`, `touchButtons: ['left', 'right']`, and `settings: [{key, label, options: [[value, text], …], default}]`.
- Rules:
  - A swipe reaches `instance.swipe` only while the screen is `playing` and the round isn't paused. A short tap still goes to `pointer`.
  - On-screen buttons (`#touchLeft`, `#touchRight`, real `<button>`s with "Move left" / "Move right" labels, 72 px tall) show only while playing, when `touchButtons` is set and `gameSettings.controls === 'buttons'`. They call `instance.key('ArrowLeft' / 'ArrowRight')`.
  - Settings shows each game setting as a radio group (`role="radiogroup"`) under the shared settings. A change saves and applies right away, including from the pause menu's Settings.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:**
    - `swipeDirection(40, 5, 200) === 'right'`, `(-40, 5, 200) === 'left'`;
    - `(20, 0, 100) === null` (too short), `(40, 40, 100) === null` (too diagonal), `(40, 0, 700) === null` (too slow);
    - `loadSettings` keeps `{games: {'cell-runner': {controls: 'buttons'}}}` and drops `{games: {x: {y: 5}}}` and `{games: []}`;
    - `gameSettingValue` returns the default for an unknown value, and the stored value for a known one;
    - `saveSettings` round-trips `games`.
  - **Browser** (with Germ Smash, whose HUD must be unchanged): the HUD timer is still visible during a round, and no heart or distance element is visible.
  - Cell Runner browser checks for these hooks come in Task 3.
- [ ] **Step 2: Run** `node --test "tests/unit/*.test.mjs"`. Expected: FAIL (the new exports are missing).
- [ ] **Step 3: Implement** the hooks above.
- [ ] **Step 4: Run** the unit tests, the syntax check, and the browser suite. Germ Smash checks must pass, and the explorer blocks fail as before.
- [ ] **Step 5: Commit** `Game shell: HUD lives and distance, swipes, game settings and on-screen buttons (2026-10-30)`.

### Task 2: Cell Runner round logic (pure)

**Files:**
- Create: `assets/js/games/cell-runner.js` (pure exports only in this task; no DOM at the top level)
- Test: `tests/unit/cell-runner.test.mjs`

**Interfaces:**
- Produces:
  - `LEVELS`, `STARS`, `MAX_LIVES`, `MAX_OXYGEN`, `GATE_EVERY = 400`, `SPAWN_Z = 120` (metres ahead of the cell where rows appear), `INVULNERABLE = 1.5`.
  - `deliveryMultiplier(streak) → 1 | 2 | 3`: 1 for a streak below 2, 2 for 2–3, 3 from 4.
  - `createRun(level, rng)` returns `{state, tick(dt) → events[], move(dir: -1 | 1) → boolean}`.
    - `state = {time, distance, speed, lane: 0..2, lives, invulnerable, oxygen, oxygenStreak, bestCombo, deliveryStreak, bubbles, hits, bubblePoints, deliveryPoints, score, over, objects: [{id, kind: 'clot' | 'virus' | 'bubble' | 'gate', lane: 0..2 | null, z, variant, organ}]}`
    - Events: `{type: 'spawn' | 'bubble' | 'crash' | 'deliver' | 'end', …}`. `deliver` carries `{value, multiplier, oxygen}`.
  - `move` changes the lane by one and returns false at the edges or once the run is over.
- Rules, in tick order:
  1. **Time and speed:** `time += dt`; `speed = min(topSpeed, startSpeed + ramp × time)`; `distance += speed × dt`; every object's `z -= speed × dt`; `invulnerable = max(0, invulnerable − dt)`.
  2. **Collisions:** an object whose `z` crossed 0 this tick resolves against the current `lane`:
     - **a hazard in the same lane while not invulnerable:** `lives -= 1`, `hits += 1`, `invulnerable = 1.5`, `oxygenStreak = 0`, `deliveryStreak = 0`;
     - **a hazard in the same lane while invulnerable:** ignored;
     - **a bubble in the same lane:**
       - `oxygen = min(5, oxygen + 1)`
       - `bubbles += 1`
       - `bubblePoints += 20`
       - `oxygenStreak += 1`
       - `bestCombo = max(bestCombo, oxygenStreak)`
     - **a gate (every lane):**
       - with `oxygen ≥ 1`: `deliveryStreak += 1`, then value = `100 × oxygen × deliveryMultiplier(deliveryStreak)`; `deliveryPoints += value`; `oxygen = 0`;
       - with `oxygen = 0`: `deliveryStreak = 0`.

     Resolved objects are removed.
  3. **Rows:** while `distance + SPAWN_Z ≥ nextRowAt`, spawn a row at `z = nextRowAt − distance`, then `nextRowAt += rowGap × speed`.
     - **Blocked lanes:** 2 if `rng() < twoLane`, otherwise 1, chosen at random.
     - **Hazard kind:** `virus` (with a variant from 0–2) if `rng() < virusShare`, otherwise `clot`.
     - **Bubble:** with probability `bubbleChance`, one bubble in a random free lane.
     - Never block all 3 lanes.
  4. **Gates:** while `distance + SPAWN_Z ≥ nextGateAt`, spawn a gate (`organ` cycling `heart, lungs, kidney, brain`), then `nextGateAt += 400`.
     - Rows that would land within 8 m of a gate's `z` are skipped. The gate must be readable.
  5. **Score:** `score = floor(distance) + bubblePoints + deliveryPoints`.
  6. **End:** when `lives === 0`, emit `end` once and set `over = true`. After that, `tick` and `move` do nothing.
  - A non-finite or `dt ≤ 0` returns `[]`.
  - The first row is at 40 m and the first gate at 400 m.

- [ ] **Step 1: Write the failing tests:**
  - `deliveryMultiplier` thresholds;
  - the speed ramp and its cap, over 200 s on Easy;
  - `move` stops at the edges;
  - **a hazard hit** costs 1 life and starts invulnerability;
  - **Review Focus 4:** a second hazard reaching the cell within 1.5 s costs no life;
  - **bubbles:** the carry caps at 5, and the streak and best combo update;
  - **deliveries:**
    - 3 oxygen at the 1st gate gives 300;
    - 2 oxygen at the 2nd gate in a row gives 400 (×2);
    - an empty gate resets the streak;
  - the score total;
  - the run ends at 0 lives and emits `end` exactly once;
  - a seeded run (`makeRng`-style scripted rng) gives the same score twice;
  - **Review Focus 3:** simulate 900 s on Hard with dt 0.05 and an rng that varies:
    - every row leaves at least one free lane;
    - consecutive rows are at least `rowGap × speed − 0.5` m apart;
    - the score stays below 100000.
- [ ] **Step 2: Run** `node --test tests/unit/cell-runner.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the exports.
- [ ] **Step 4: Run** the unit suite and the syntax check. Expected: PASS.
- [ ] **Step 5: Commit** `Cell Runner: round logic (2026-10-30)`.

### Task 3: Cell Runner on canvas, registered in both GAMES lists

**Files:**
- Modify:
  - `assets/js/games/cell-runner.js`: default export plus renderer.
  - `assets/js/games/shell.js`: add `'cell-runner'` to `GAMES` with the title "Cell Runner", the tagline "Race through the bloodstream and deliver oxygen." and the card `../assets/games/cell-runner/card.webp`.
  - `api/helpers.php`: add `GAMES['cell-runner']`.
- Test: `tests/unit/cell-runner.test.mjs` (the contract), `tests/integration.mjs`, `tests/browser.mjs`

**Interfaces:**
- Consumes: Task 1's hooks and Task 2's `createRun`.
- **The module:**
  - `{key: 'cell-runner', title, tagline, theme: {accent: '#f2545b'}, howToPlay (4 steps, sprite icons), assets: {images: {cell, clot, germ1, germ2, germ3, heart, lungs, kidney, brain}, sounds: {beep, move, bubble, crash, deliver, gameover}}, stars: STARS, roundSeconds: null, maxLives: 3, touchButtons: ['left', 'right'], settings: [{key: 'controls', label: 'Controls', options: [['swipe', 'Swipe'], ['buttons', 'On-screen buttons']], default: 'swipe'}], levels (one-line descriptions), drawBackdrop, create}`
  - Image paths come from `assets/games/cell-runner/`. Copies of the reused files go there too, so the game folder is self-contained:
    - `germ-1/2/3.webp` from Germ Smash;
    - `heart.webp` from `assets/img/hero/decor-heart.webp`;
    - `lungs.webp` from `respiratory.webp`;
    - `kidney.webp` from `decor-kidney.webp`;
    - `brain.webp` from `nervous.webp`.
  - Until Task 4, `cell` and `clot` fall back to code drawings, and missing sounds are skipped.
- **Renderer:**
  - **Projection:** `screenY = vpY + (floorY − vpY) × (F / (z + F))` with `F = 12`; lanes spread at x offsets −1, 0, 1 scaled the same way; the vanishing point at 40% height.
  - **Vessel:** rings every 6 m, drawn as ellipses from the back to the front with a crimson-to-warm-red gradient and a 1.1 s heartbeat pulse (±3% radius, none with Reduce motion), plus faint lane guide lines and drifting plasma particles.
  - **Objects:** drawn from the back to the front, scaled by `F / (z + F)`.
  - **The cell:** at the bottom, eased toward its lane over 0.12 s, with a tilt of ±8° while moving and a floor shadow; it blinks while invulnerable.
  - **HUD:** `api.hud({score, lives, distance})`, plus the oxygen carried as 5 small bubbles and the delivery streak, drawn on the canvas below the shell's HUD.
  - **Feedback:**
    - bubble: a sparkle and a floating "+20";
    - delivery: a gate glow and "+300 ×2";
    - crash: a red flash, a 6 px / 150 ms shake (none with Reduce motion), `api.vibrate(120)` and `api.sound('crash')`;
    - a lane move plays `api.sound('move')`.
  - **Input:** `key` (ArrowLeft/ArrowRight/KeyA/KeyD → `move`), `swipe(dir)`, and `pointer` (a tap on the left or right third of the canvas also moves, so the game works even if swipes fail).
  - **Game over:** `api.gameOver({score, stats: {hits: bubbles, misses: hits, friendly_hits: 0, best_combo: bestCombo}})`.

- [ ] **Step 1: Write the failing tests:**
  - **Unit:** the default-export contract (the fields above; every `howToPlay` icon exists in the sprite).
  - **Integration:**
    - `cell-runner` rounds save with duration 5 and 900;
    - 4 and 901 are rejected, and so is score 100001;
    - `leaderboard.php?game=cell-runner` works.
  - **Browser:**
    - `play.html?game=cell-runner&seed=1` loads and shows the menu;
    - Settings shows Controls with 2 options;
    - New game on Easy leads to the HUD showing 3 hearts and a distance, and no timer;
    - pressing ArrowRight changes `__gameDebug.state.lane`;
    - with Controls = Buttons, `#touchRight` is visible and changes the lane;
    - **Review Focus 1:** a swipe dispatched while paused does not change the lane;
    - **Review Focus 2:** switching Controls in the pause menu's Settings, then Resume, shows the buttons;
    - drive 3 crashes through the debug state (set a hazard at z 0.5 in the cell's lane, three times, with ticks in between), then expect game over, "Saved", and the gallery showing 2 cards;
    - **Review Focus 5:** at 360×640 and 1920×1080, the cell's projected box (`__gameDebug.cellBox()`) is inside the canvas and doesn't overlap `#touchLeft`/`#touchRight`.
- [ ] **Step 2: Run** the unit, integration and browser suites. Expected: the new checks FAIL.
- [ ] **Step 3: Implement** the renderer, the module, the asset copies and both `GAMES` entries.
- [ ] **Step 4: Run** every suite. Expected: PASS, apart from the known explorer blocks. Take screenshots at 1366×900 and 375×812 of the menu, settings, a run, and game over, and look at them.
- [ ] **Step 5: Commit** `Cell Runner on its own page, in the gallery and on the server (2026-10-30)`.

### Task 4: Blender cell, clot and card; Kenney sounds

**Files:**
- Create: `assets/games/cell-runner/cell.webp` and `clot.webp` (256×256 with alpha, each under 40 KB), `card.webp` (1280×720, under 150 KB), and `{beep, move, bubble, crash, deliver, gameover}.ogg` plus `.m4a` copies (mono, each under 60 KB).
- Modify: `assets/js/games/cell-runner.js` (assets), `README.md` (credits line)
- Test: `tests/unit/cell-runner.test.mjs`, `tests/browser.mjs`

**Art and sound:**
- **Renders:** made in Blender in a new scene, never saved, with the same three-point lighting and Standard view transform as the Germ Smash renders.
  - **Cell:** a glossy red biconcave disc seen from about 35° above and behind.
  - **Clot:** a dark red cluster of cells meshed with pale fibrin strands.
  - **Card:** the cell racing down a red vessel tunnel, with a bubble and a virus ahead.
- **Sounds:** picked from the approved Kenney packs (Interface Sounds, Impact Sounds, Music Jingles), re-downloaded if the scratch copy is gone, and converted with ffmpeg like Germ Smash's.
  - `beep` is a copy of Germ Smash's.
  - `move` is a short whoosh or click.

- [ ] **Step 1: Write the failing tests:**
  - **Unit:** `assets.images.cell === 'cell.webp'`, `clot === 'clot.webp'`, every image and sound file exists, and every `.ogg` has a `.m4a` copy.
  - **Browser:** `__gameDebug.sounds` lists the 6 sounds.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3:** Make the renders and the sounds; check each file's size, dimensions and alpha with the WebP header script from Germ Smash Task 6.
- [ ] **Step 4: Run** every suite. Expected: PASS. Screenshot a run at both sizes and check that the cell and clot read clearly against the vessel.
- [ ] **Step 5: Commit** `Cell Runner: Blender cell, clot and card; sounds (2026-10-30)`.

### Task 5: Final check and review

- [ ] **Step 1:** Run every suite on a fresh isolated database.
- [ ] **Step 2:** Send the user screenshots: the menu, settings with Controls, a run with the buttons, a delivery, game over, and the gallery with 2 cards.
- [ ] **Step 3:** Dispatch a whole-branch review on the most capable model, fix its Critical and Important findings test-first, then push.
