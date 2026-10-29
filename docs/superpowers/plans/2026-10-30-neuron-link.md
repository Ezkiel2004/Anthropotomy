# Neuron Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Neuron Link, a 2-minute tile-turning puzzle that connects a brain to a muscle, as the third game in the existing game shell.

**Architecture:** One ES module, `assets/js/games/neuron-link.js`. Its pure round logic (board generation, turning, the glow, scoring, the clock) is unit-tested in Node. Its Canvas 2D renderer and default export follow the shell's game contract, as Germ Smash and Cell Runner do. The server and gallery pick the game up from the two `GAMES` maps.

**Tech Stack:** vanilla JS (ES modules, Canvas 2D), PHP 8 / MySQL (no schema change), Node test runner, headless Chrome over CDP, Blender 5.2 in background mode, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-10-30-neuron-link-design.md`

## Global Constraints

- Key `neuron-link`, title `Neuron Link`, tagline `Connect the brain to the muscle and fire the signal.`
- `roundSeconds: 120`; server limits `max_score 100000, min_sec 115, max_sec 135`.
- Levels: first/largest board side Easy 4/6, Medium 5/7, Hard 6/8; the side grows by 1 after every 2 boards solved.
- Board score `100 × n + 25 × max(0, 2 × par − moves)`. Perfect means moves ≤ par.
- Solve pause 1.2 s: input is ignored and the clock keeps running.
- Stars `[1200, 3000, 6000]`.
- Stats: `hits` = boards solved, `misses` = taps beyond par summed over solved boards, `friendly_hits` = 0, `best_combo` = most perfect boards in a row.
- Openings bitmask N=1, E=2, S=4, W=8. Turning is clockwise only: N→E→S→W.
- Decoys: 45% bends, 30% straights, 25% forks. Forks never appear on the path.
- Colours: tile #1b1f3a, dim fibre #8a8fb5, lit fibre #f7c948.
- Layout: `tile = floor(min((w − 32) / n, (h − 88) / (n + 2.2)))`, capped at 96.
- Sounds: turn, zap, solve, beep, gameover (copies of Germ Smash's tick, buzz, chime, beep, gameover), each with an `.m4a` copy.
- Phosphor sprite icons only; no emoji. Nothing in the shell changes except the `__gameDebug.tileCenter` hook.

## Review Focus

1. A tap during the 1.2 s solve pause is ignored, and no move is counted against the next board.
2. A resize mid-board (a phone rotated) keeps taps landing on the tile drawn under the finger.
3. A board solved through a decoy chain in fewer moves than par scores the bonus and counts as perfect.
4. Time running out during the solve pause keeps that board's points, starts no new board, and ends the round once.
5. 8×8 at 360×640: tiles are at least 40 px, and the brain and muscle are on screen and clear of the HUD.

---

### Task 1: Round logic

**Files:**
- Create: `assets/js/games/neuron-link.js` (pure part only)
- Test: `tests/unit/neuron-link.test.mjs`

**Interfaces:**
- Produces:
  - `export const LEVELS = {easy: {first: 4, largest: 6}, medium: {first: 5, largest: 7}, hard: {first: 6, largest: 8}}`
  - `export const STARS`, `ROUND_SECONDS = 120`, `SOLVE_PAUSE = 1.2`, `N = 1, E = 2, S = 4, W = 8`
  - `export const turn = mask => ((mask << 1) | (mask >> 3)) & 15` (clockwise)
  - `export function tapsNeeded(mask, want) → 0..3`: the fewest turns that make `mask === want`, or for a straight `mask` either orientation of `want`. Returns `Infinity` when the types differ.
  - `export function litTiles(board) → boolean[]`: tiles reached from the brain tile (which must open N) through openings that meet on both sides.
  - `export function isSolved(board, lit = litTiles(board)) → boolean`: the muscle tile is lit and opens S.
  - `export function generateBoard(n, rng) → {n, tiles: number[n*n], want: (number|null)[n*n], path: number[], brainCol, muscleCol, par}`: row-major; `want` is the solved mask for path tiles and null elsewhere.
  - `export const boardScore = (n, par, moves) => 100 * n + 25 * Math.max(0, 2 * par - moves)`
  - `export function createRound(level, rng) → {state, tap(r, c) → events, tick(dt) → events}`
    - `state = {time, timeLeft, size, board, lit, moves, boardsSolved, score, perfectStreak, bestPerfectStreak, extraTaps, pause, over, lastSolve}`
    - events: `{type: 'turn', r, c}`, `{type: 'solve', points, perfect, par, moves, n}`, `{type: 'board', n}`, `{type: 'end'}`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/neuron-link.test.mjs`. Use a seeded LCG `lcg(seed)` like the Cell Runner test.
  - `turn`: `turn(N) === E`, `turn(W) === N`, `turn(N|E) === (E|S)`; four turns give the mask back.
  - `tapsNeeded`: `tapsNeeded(N|E, W|N) === 3`, `tapsNeeded(N|S, E|W) === 1`, `tapsNeeded(E|W, E|W) === 0`, `tapsNeeded(N|E|S, N|E) === Infinity`.
  - `litTiles` / `isSolved` on a hand-made 2×2:
    - `tiles = [N|S, 0, N|S, 0]`, `brainCol 0`, `muscleCol 0` → lit `[true, false, true, false]`, solved.
    - With the brain tile turned to E|W: nothing lit, not solved.
  - **Review Focus 3:** a decoy chain solves. A 2×2 board whose `want` path goes 0→1→3, but whose tiles already form 0→2 (brain col 0, muscle col 0): solved, even though the path tiles are not as `want`.
  - `generateBoard`, for 200 seeds and n of 4–8:
    - `path[0] === brainCol`;
    - `path.at(-1) === (n-1)*n + muscleCol`;
    - consecutive path cells are orthogonal neighbours, with no repeats;
    - setting every path tile to its `want` makes `isSolved` true;
    - the fresh board is never solved;
    - `par === sum(tapsNeeded(tiles[i], want[i]))` over the path;
    - every tile is a straight, bend or fork (2 or 3 bits), and path tiles are never forks.
  - **Determinism:** `generateBoard(6, lcg(5))` deep-equals a second call.
  - `createRound('easy', rng)`:
    - starts at `size 4`, `timeLeft 120`;
    - tapping turns the tile and counts a move;
    - out-of-range taps are ignored;
    - solving by tapping each path tile `tapsNeeded` times emits `solve` with `points === boardScore(4, par, moves)` and `perfect === (moves <= par)`.
  - **Review Focus 1:** a tap during the pause returns `[]`, leaves `moves` alone and leaves the tiles unchanged. After `tick(1.2)` a `board` event comes and `moves === 0`.
  - **Size growth:** after 2 solves the size is 5, after 4 it is 6, and after 6 it is still 6 (Easy). Hard starts at 6 and caps at 8.
  - **Perfect streak and stats:** a perfect solve then a sloppy one gives `perfectStreak 0`, `bestPerfectStreak 1`, and `extraTaps === moves − par` of the sloppy board.
  - **Review Focus 4:** solve with 0.5 s left, then `tick(1)`. Exactly one `end`, no `board` event, the score includes the board, and later ticks and taps return `[]`.
  - **Bad dt:** 0, −1, NaN or Infinity is ignored.
  - **Score cap bot:** for each level, a bot taps par moves at 10 taps a second (`tick(0.1)` between taps, then ticks through the pause) for the whole round. Its score is < 100000.
- [ ] **Step 2:** Run `node --test tests/unit/neuron-link.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the exports above. Notes:
  - Generation is a depth-first search from the brain tile (row 0) to the muscle tile (row n−1). Neighbours are shuffled with `rng`, and a visited set is shared across the whole search.
  - The path's openings: the first tile also opens N, the last also opens S.
  - Decoys draw their type, then a random rotation.
  - Scramble every tile with `rng() * 4 | 0` turns, and redo the scramble while the board is solved.
  - The clock lives in the round: `tick` adds dt, and at 0 the round ends even during a pause.
- [ ] **Step 4:** Run the tests. Expected: PASS. Also run the full unit suite and `node tests/check-syntax.mjs`.
- [ ] **Step 5: Commit** `Neuron Link: round logic (2026-10-30)` and push.

### Task 2: On its own page, in the gallery and on the server

**Files:**
- Modify:
  - `assets/js/games/neuron-link.js` (renderer and default export);
  - `assets/js/games/shell.js` (`GAMES` entry, `__gameDebug.tileCenter`);
  - `api/helpers.php` (`GAMES`).
- Create: `assets/games/neuron-link/brain.webp` (a copy of `assets/img/hero/nervous.webp`).
- Test:
  - `tests/unit/neuron-link.test.mjs` (contract);
  - `tests/integration.mjs`;
  - `tests/browser.mjs`;
  - `tests/navigation.mjs`.

**Interfaces:**
- Consumes: Task 1 exports; the shell `api` (`ctx, images, width, height, reducedMotion, rng, sound, vibrate, hud, gameOver`).
- Produces:
  - `create()` returns `{state, start, update, draw, pointer(x, y), key(code), tileCenter(r, c) → {x, y}, destroy}`;
  - `__gameDebug.tileCenter(r, c)`;
  - image names `brain`, `muscle` (the muscle falls back to a code drawing until Task 3);
  - sound names `turn`, `zap`, `solve`, `beep`, `gameover`.

- [ ] **Step 1: Write the failing tests.**
  - **Unit contract:**
    - key, title, tagline, `roundSeconds 120`, `stars === STARS`;
    - levels easy/medium/hard;
    - 4 howToPlay steps whose icons are in the sprite;
    - `assets.images.brain === 'brain.webp'`;
    - no `maxLives`, `touchButtons` or `settings`;
    - `create` and `drawBackdrop` are functions.
  - **Integration** (beside Cell Runner's):
    - a `neuron-link` round saves: Easy, score 3000, 120 s, stats `{hits: 6, misses: 9, friendly_hits: 0, best_combo: 2}`, so points 3000;
    - accepted: 115 s, 135 s, score 100000;
    - rejected: 114 s, 136 s, score 100001;
    - `leaderboard.php?game=neuron-link` best is 100000.
  - **Browser:** a Neuron Link block after Cell Runner's. Clear the stored settings first.
    - It loads and shows the menu.
    - Start Easy. The HUD shows the timer; hearts, distance and combo are hidden.
    - ArrowRight then Space turns tile (0,1).
    - Solve boards by clicking `tileCenter` for each path tile `tapsNeeded` times. Read the board from `__gameDebug.state`.
    - **Review Focus 1:** a click during the pause changes nothing.
    - **Review Focus 5:** at 360×640 with `state.size` forced to 8 through a fresh board, tiles are ≥ 40 px apart (from `tileCenter`), and the brain/muscle boxes are on screen below the HUD.
    - **Review Focus 2:** after a resize, a click at `tileCenter` turns that tile.
    - Keep solving until the round is over. It shows "Saved", and `boardsSolved ≥ 2`.
    - The gallery, teacher Try links and filter list three games. Navigation: the empty install offers three games.
- [ ] **Step 2:** Run the unit tests (contract RED) and the integration suite. Expected: "A Neuron Link round saves" fails.
- [ ] **Step 3: Implement.**
  - The renderer follows the spec's Look and feel and its layout formula.
  - **Tiles:** a turn eases over 0.12 s (instant under Reduce motion).
  - **Glow:** lit fibre gets a glow by drawing a wide, low-alpha stroke first.
  - **Signal:** the pulse runs along the lit chain in breadth-first order from the brain.
  - **Muscle:** contracts with `scale(1 − 0.2·k, 1 + 0.25·k)`.
  - **Text:** the "Board b · n×n · Moves m / Par p" line, plus floating "+points" and "Perfect!".
  - **Keyboard:** arrows move the cursor, clamped to the board; the cursor shows only after an arrow key. Space and Enter tap the cursor tile.
  - **HUD:** `api.hud({score, timeLeft})`.
  - **Game over:** call `gameOver` once with the stats mapping.
  - **Backdrop:** the neuron field plus a sample signal.
  - Add the `GAMES` entries (client card `../assets/games/neuron-link/card.webp`) and the debug hook.
- [ ] **Step 4:** Run every suite through the workspace runner (the explorer blocks skipped, as before). Expected: PASS. Screenshot desktop and phone.
- [ ] **Step 5: Commit** `Neuron Link on its own page, in the gallery and on the server (2026-10-30)` and push.

### Task 3: Muscle, card and sounds

**Files:**
- Create in `assets/games/neuron-link/`:
  - `muscle.webp` (512×256 with alpha, < 60 KB);
  - `card.webp` (1280×720, < 150 KB);
  - `{turn, zap, solve, beep, gameover}.ogg` plus `.m4a` copies.
- Modify:
  - `assets/js/games/neuron-link.js` (assets);
  - `README.md` (one credits line).
- Test:
  - `tests/unit/neuron-link.test.mjs`;
  - `tests/browser.mjs`.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:**
    - `assets.images.muscle === 'muscle.webp'`;
    - `assets.sounds` deep-equals `{turn: 'turn.ogg', zap: 'zap.ogg', solve: 'solve.ogg', beep: 'beep.ogg', gameover: 'gameover.ogg'}`;
    - every file exists;
    - every `.ogg` has an `.m4a`;
    - `card.webp` exists.
  - **Browser:** `__gameDebug.sounds` lists the 5 sounds.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Make the assets.**
  - **Muscle:** Blender `-b --factory-startup`, nothing saved. A spindle (a scaled UV sphere, pinched at the ends) in red with a striation bump, pale cylinder tendons at both ends, three-point light, and a transparent film.
  - **Card:** a headless-Chrome screenshot at 1280×720 of `play.html?game=neuron-link&seed=…` mid-round, just after a solve, with the HUD hidden.
  - **Sounds:** copies of Germ Smash's files.
  - Check sizes and alpha with the WebP header check.
- [ ] **Step 4:** Run every suite. Expected: PASS. Screenshot at both sizes.
- [ ] **Step 5: Commit** `Neuron Link: Blender muscle, card and sounds (2026-10-30)` and push.

### Task 4: Final check and review

- [ ] Run every suite on fresh test databases.
- [ ] Send the user screenshots.
- [ ] Run a whole-branch review on the most capable model, then fix any Critical or Important findings test-first.
- [ ] Push. Report the rulings and the deferred minor items.
