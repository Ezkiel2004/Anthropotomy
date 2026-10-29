# Entertainment games, sub-project 2: Cell Runner — design

Date: 2026-10-30
Builds on `2026-10-25-entertainment-games-design.md` (the game shell, Germ Smash, scoring, leaderboard, badges). Everything there still applies unless this document changes it.

## Goal

Cell Runner is the second game. The student plays a red blood cell racing down the inside of a blood vessel: dodge clots and viruses, grab oxygen bubbles, and deliver them to the organs the vessel passes. It is endless and keeps speeding up until the cell has lost all 3 lives.

**Done means:**
- Cell Runner plays smoothly on phone and desktop, from the menu through to game over.
- It saves scores to its own High Scores and to the weekly leaderboard.
- It appears as a second card in the Games gallery.
- Germ Smash still works exactly as before.

## Decisions

The user chose these:
- The run is endless with 3 lives.
- The view is a tunnel seen from just behind the cell.
- The only action is switching lanes, with a "Controls" setting of Swipe or On-screen buttons.

The user said "go with the recommended options" for the rest. Every other choice below is the recommended default, and the user reviews it afterwards.

## 1. Shell changes (shared by every game)

These are small, backward-compatible additions to `assets/js/games/shell.js` and `student/play.html`. Germ Smash keeps working unchanged.

1. **HUD fields.** `api.hud({score, combo, timeLeft, lives, distance})`:
   - The shell shows the timer only when `timeLeft` is a number.
   - It shows hearts (filled, then empty, out of the game's `maxLives`) only when `lives` is a number.
   - It shows "1,234 m" only when `distance` is a number.
   - Germ Smash sends no `lives` or `distance`, so its HUD is unchanged.
2. **Round length.** A game may set `roundSeconds: null`, meaning endless. The shell never ends a round on its own; the game calls `api.gameOver`. The pause and countdown rules are unchanged.
3. **Swipes.** If the game defines `swipe(direction)`, the shell detects a horizontal swipe (pointer movement ≥ 30 px, mostly horizontal, within 600 ms) and calls `swipe('left' | 'right')`. A short tap still goes to `pointer(x, y)`.
4. **Game-specific settings.** This replaces the deferred item from sub-project 1. A game declares, for example:

   ```js
   settings: [{key: 'controls', label: 'Controls', options: [['swipe', 'Swipe'], ['buttons', 'On-screen buttons']], default: 'swipe'}]
   ```

   - The Settings screen shows each one as a segmented radio group under the shared settings.
   - Values are stored inside the same `anthropotomy_game_settings` object as `games: {'cell-runner': {controls: 'buttons'}}`.
   - `loadSettings` drops unknown games, keys and values, and falls back to the default.
   - The game reads them as `api.gameSettings.controls`.
5. **On-screen buttons.** A game that sets `touchButtons: ['left', 'right']` gets two large real `<button>`s at the bottom of the play area, but only while `controls === 'buttons'`. Pressing one calls `key('ArrowLeft')` or `key('ArrowRight')`. The buttons are 72 px tall, have labels ("Move left" / "Move right") and are reachable by keyboard.

## 2. Cell Runner gameplay

**The track:**
- Three lanes run along the floor of the vessel.
- The cell moves one lane per input; a move eases over 0.12 s.
- The input keeps working mid-move (it re-targets).

**Speed:**
- It starts at the level's start speed and rises linearly by the level's ramp per second, up to the level's top speed.
- Distance (m) is the integral of speed.

**Objects** (spawned ahead of the cell along the track):

| Object | Look | Effect |
|---|---|---|
| Clot | A dark red cluster (Blender render) | Hit: −1 life |
| Virus | A spiky germ (reuses the Germ Smash `germ-1/2/3.webp`) | Hit: −1 life |
| Oxygen bubble | A glossy pale-blue bubble with "O₂", drawn in code | +20 points, +1 oxygen carried (max 5) |
| Organ gate | Once every 400 m, an organ render spanning all lanes (heart, lungs, kidney or brain, from `assets/img/hero/`) | Passing it delivers the oxygen carried: +100 × oxygen carried × the delivery streak multiplier, then empties the carry |

**Hits:**
- A hit costs 1 life, plus a red flash, a shake (none with Reduce motion), `api.vibrate(120)` and the `crash` sound.
- It gives 1.5 s of invulnerability, during which the cell blinks and hazards pass through.
- It resets the oxygen streak.

**Streaks:**
- **Oxygen streak:** bubbles collected in a row without a hit. This is the game's `best_combo`.
- **Delivery streak:** gates delivered to with at least 1 oxygen in a row, without a hit in between. Multiplier: ×1, then ×2 from the 2nd, then ×3 from the 4th delivery.

**Fairness:**
- Hazards come in rows.
- Every row leaves at least one lane free, and two blocked lanes appear only on Medium and Hard.
- Rows are at least the level's minimum gap apart (in seconds of travel at the current speed), so a free lane is always reachable.

**Score** = floor(distance) + bubble points + delivery points.

**The run ends** when lives reach 0. It then calls `api.gameOver({score, stats})` with:
- `stats.hits` = bubbles collected
- `stats.misses` = hazards hit
- `stats.friendly_hits` = 0
- `stats.best_combo` = best oxygen streak

This mapping fits the existing `plays.php` stats contract, so there is no server schema change, and "On a Roll" (best combo of 20) means 20 bubbles in a row.

**Difficulty** (starting values, tuned with the user):

| | Easy | Medium | Hard |
|---|---|---|---|
| Start speed (m/s) | 12 | 16 | 20 |
| Ramp (m/s per s) | 0.15 | 0.25 | 0.35 |
| Top speed (m/s) | 30 | 38 | 46 |
| Row gap (s) | 1.4 | 1.1 | 0.85 |
| Rows with 2 lanes blocked | 0% | 25% | 45% |
| Virus share of hazards | 30% | 45% | 60% |
| Bubble chance per row | 60% | 50% | 40% |

**Stars:** 1★ 1,500 / 2★ 4,000 / 3★ 8,000 (the score before the difficulty multiplier).

## 3. Look and feel (tunnel view)

**The view:**
- A Canvas 2D perspective projection with a vanishing point at about 40% from the top of the canvas.
- The vessel wall is drawn as rings (ellipses) rushing toward the camera.
- The rings are coloured from deep crimson at the back to warm red near the camera, pulse slowly in size with a heartbeat rhythm (1.1 s), and show faint wall texture streaks.
- Plasma particles drift past.

**Lanes and objects:**
- Lanes are shown as three faint guide lines along the floor.
- Objects scale with distance (1/z) and fade in from the far end.

**The player:**
- The red blood cell is a Blender render: a glossy biconcave disc seen from slightly above and behind.
- It sits at the bottom of the view, tilts briefly toward the lane it moves to, and has a soft shadow on the floor.

**HUD:** score, distance, hearts, the oxygen carried (5 small bubble icons) and the delivery streak.

**Feedback:**
- **A collected bubble:** a sparkle burst and a floating "+20".
- **A delivery:** the organ gate glows, and "+300 ×2" appears.

All motion is reduced or removed under Reduce motion.

**Controls and How to Play:**
- **Keyboard:** ← / → or A / D.
- **Swipe:** left / right.
- **Buttons:** on-screen ◀ ▶, drawn with the sprite's `arrow-left` / `arrow-right` icons.
- **How to Play** (4 steps):
  1. switch lanes;
  2. dodge clots and viruses, with 3 lives;
  3. grab O₂;
  4. deliver it at the organs for big points.

**Art:**
- **Blender** (a new scene, nothing saved), producing:
  - `cell.webp`, the red blood cell, 256×256 with transparency;
  - `clot.webp`, 256×256 with transparency;
  - `card.webp`, 1280×720: the cell racing down a vessel with a bubble and a virus.
- **Reused:** Germ Smash's `germ-1/2/3.webp` for viruses, and `assets/img/hero/decor-heart.webp`, `decor-kidney.webp`, `respiratory.webp` and `nervous.webp` for organ gates.
- **Drawn in code:** everything else.

**Sounds:** Kenney CC0, from the packs already approved: Interface Sounds, Impact Sounds and Music Jingles. Each is converted to mono OGG with an `.m4a` copy:
- `move`: a short whoosh or click on a lane change
- `bubble`
- `crash`
- `deliver`
- `beep`: the countdown, which the shell already plays
- `gameover`

No music. Music stays hidden until a CC0 loop exists.

## 4. Server and pages

**Server:**
- `GAMES` in `api/helpers.php` gains:

  ```php
  'cell-runner' => ['title' => 'Cell Runner', 'max_score' => 100000, 'min_sec' => 5, 'max_sec' => 900]
  ```
- `GAMES` in `shell.js` gains `'cell-runner'` with its title, tagline ("Race through the bloodstream and deliver oxygen.") and card.
- Nothing else on the server changes: `plays.php`, the per-game leaderboard and badges are already generic.
- All-Rounder becomes earnable once Neuron Link exists.

**Pages:**
- **Gallery:** shows two cards automatically, from `GAMES`.
- **Teacher page:** its game filter and the "Try" links list both games automatically.

## 5. Testing

- **Unit:**
  - the Cell Runner round logic:
    - spawning: every row leaves a free lane, the minimum gap holds, no 2-lane rows on Easy;
    - movement: lane changes stop at the edges;
    - collisions: a hit removes 1 life and starts invulnerability; a hit during invulnerability is ignored;
    - bubbles: the carry caps at 5;
    - deliveries: points and the streak multiplier;
    - speed: the ramp and its cap;
    - the score total;
    - the run ends at 0 lives;
    - a seeded run is deterministic;
  - the shell's game-settings storage: loading, dropping unknown values, defaults;
  - swipe detection, as a pure helper.
- **Integration:** `cell-runner` rounds save; durations of 5 and 900 s are accepted, and 4 and 901 are rejected; the score cap; the game leaderboard for `cell-runner`.
- **Browser:**
  - `play.html?game=cell-runner&seed=1` loads, shows the menu, and Settings shows Controls;
  - switching Controls to Buttons shows the on-screen buttons in a round, and pressing them changes lane;
  - the HUD shows hearts and distance and no timer;
  - a run driven into hazards ends after 3 hits and saves;
  - the gallery shows 2 cards;
  - the Germ Smash checks still pass.

## Out of scope

Jump and duck; music; Neuron Link (sub-project 3); a Hard-only twist; anti-cheat beyond the score and duration limits.
