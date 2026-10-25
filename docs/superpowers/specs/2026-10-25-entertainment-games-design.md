# Entertainment games, sub-project 1: game shell, Germ Smash, quiz games removed — design

Date: 2026-10-25
Replaces the quiz-style games from `2026-10-20-practice-games-design.md`. That spec's points, weekly leaderboard and badges carry over, as changed in section 4 below.

## Goal

The Games area is for fun, with an anatomy theme. It no longer asks questions. Each game opens on its own full-screen page with a loading screen and a real game menu, as console and mobile games do. This sub-project builds the shared game shell and the first game, Germ Smash, and removes the quiz games. Cell Runner and Neuron Link follow later, as separate sub-projects that each get their own spec and plan. The user checks each game before the next one starts.

**Done means:**
- Germ Smash plays smoothly on phone and desktop, from the menu through to game over.
- Its scores save, and show on both the in-game High Scores screen and the Games page leaderboard.
- The quiz games are gone from both portals.

## Decisions (agreed in brainstorming)

- Entertainment only: no quiz mechanics.
- Each game opens on its own page, `student/play.html?game=<key>`, without the portal sidebar or top bar.
- **Art:** a mix.
  - Characters are 3D renders made in **Blender** and saved as transparent `.webp` images.
  - Sounds come from **Kenney.nl** (CC0).
  - Everything else is drawn in code, in the existing Stage colors and the Bungee and Plus Jakarta Sans fonts.
  - Only CC0 or self-made assets are used, and everything is free.
- **Approach:** one play page plus a shared shell (`shell.js`), with each game as one module.
- The Germ Smash backdrop picks a random natural human skin tone each round.
- Points, the weekly leaderboard for each section, and badges stay.

## Scope

- **New:**
  - `student/play.html`, `assets/js/games/shell.js`, `assets/css/play.css`
  - `assets/js/games/germ-smash.js`
  - `assets/games/germ-smash/` (images and sounds)
- **Changed:**
  - `student/games.html` and `assets/js/games/student-page.js` (now a gallery)
  - `teacher/games.html` and `assets/js/games/teacher-page.js` (Leaderboard and Badges tabs only)
  - `api/games/plays.php`, `api/games/leaderboard.php`
  - `api/helpers.php`, `api/achievements.php`, `database/migrate.php`
  - `assets/css/games.css`, `README.md`
  - tests
- **Removed:** see section 5.
- **Out of scope:**
  - Cell Runner and Neuron Link
  - server-side anti-cheat beyond score and duration limits
  - multiplayer

## 1. The play page and the shell

`student/play.html` calls `Auth.requireAuthSync()` without a role, so any signed-in user can open it. It loads `shell.js` as a module, and the shell reads `?game=` and imports that game from a fixed map (`{'germ-smash': './germ-smash.js'}`). An unknown or missing key shows "That game doesn't exist", with a button back to the Games page.

**Screen flow:**
```
Loading → "Tap to start" → Main menu
Main menu → New Game → difficulty (Easy / Medium / Hard) → 3-2-1 → Playing ⇄ Paused → Game over
Main menu → How to Play | Settings | High Scores → back to the menu
Exit (from the menu, pause or game over) → student/games.html (teachers: teacher/games.html)
```

**Loading:**
- A progress bar fills as the game's images and sounds load.
- Images are preloaded with `img.decode()`.
- Sounds are fetched and decoded into an `AudioContext`. The context is resumed on the "Tap to start" tap, which browsers require before sound can play.
- If anything fails, the shell shows "Couldn't load the game" with Retry and Exit.

**Main menu:**
- The game's title, in Bungee, sits over the game's moving backdrop (`drawBackdrop`).
- Buttons: New Game, How to Play, Settings, High Scores, Exit.
- They are real `<button>`s, with Up/Down arrows moving focus and Enter activating.

**Settings:** stored in `localStorage` under `anthropotomy_game_settings`, with every access wrapped in try/catch. They are shared by all games.
- **Sound effects:** on/off, plus volume from 0 to 100. Default: on, 80.
- **Music:** on/off, plus volume from 0 to 100. Default: on, 50.
- **Reduce motion:** defaults to the device's `prefers-reduced-motion` setting.
  - Turns off screen shake.
  - Cuts particles by 75%.
  - Replaces the countdown's zoom with a fade.
- **Vibration:** shown only when `navigator.vibrate` exists. Default: on.
- **Game-specific options:** any options the game declares in `settings` are shown below the shared ones.

**Other screens:**
- **How to Play:** the game's `howToPlay` steps, 3–4 lines each with an icon.
- **High Scores:**
  - the student's all-time best and this week's best for this game;
  - the top 10 weekly best scores in their section;
  - their own rank when they're outside the top 10.

  Data comes from `leaderboard.php?game=<key>` (section 4).
- **Countdown:** 3, 2, 1, Go, with a beep on each number.

**During play:**
- **Heads-up display (HUD):** score, a combo badge, the time left and a Pause button. The game updates it through `api.hud(...)`.
- **Pause:** opened by the Pause button, Esc, P, or the page losing visibility (`visibilitychange`).
  - Options: Resume, Restart, Settings, Quit to Menu.
  - Time stops while paused, and paused time doesn't count toward `duration_sec`.
- **Game over:**
  - score, personal best ("New best!" when beaten) and 0–3 stars from the game's `stars` thresholds;
  - points, new badges and weekly rank, once the save succeeds;
  - Play Again, Main Menu and Exit.
  - If the save fails on the network or with a 5xx error: "Couldn't save this score" and a Retry button that resends the same body.
  - A 422: "This score couldn't be saved", with no Retry.

**Preview mode:**
- For teachers and admins, a "Preview: scores aren't saved" tag stays visible, and nothing is posted.
- High Scores shows section Rizal by default, with a section picker.

**Frame loop:**
- The shell owns `requestAnimationFrame`.
- Each frame it calls `update(dt)` with dt in seconds, capped at 0.05 so a long frame can't jump the game ahead, then `draw()`.
- Pausing just stops those calls.
- The canvas fills the viewport and is sized for `devicePixelRatio`, up to 2. The shell redraws on resize.

### Game module contract
```js
export default {
  key: 'germ-smash', title: 'Germ Smash', tagline: 'Smash the germs, spare the good bacteria.',
  theme: { accent: '#2ccf9a' },
  howToPlay: [{ icon: 'target', text: '…' }, …],      // Phosphor sprite ids
  assets: { images: { germ1: 'germ-1.webp', … }, sounds: { pop: 'pop.ogg', … }, music: 'loop.ogg' },
  stars: [300, 700, 1200],                             // score for 1, 2 and 3 stars
  roundSeconds: 60,
  settings: [],                                        // game-specific options (none for Germ Smash)
  drawBackdrop(ctx, t, w, h) {},                       // menu backdrop
  create(canvas, api) { return { start(difficulty) {}, update(dt) {}, draw() {}, pointer(x, y) {}, key(code) {}, destroy() {} }; },
};
```

`api`:
- `ctx`, `width`, `height`
- `images` (decoded)
- `sound(name)`, which respects the settings
- `vibrate(ms)`, which respects the settings
- `reducedMotion`
- `rng()`, seeded from `?seed=` when given, otherwise `Math.random`
- `hud({score, combo, timeLeft})`
- `gameOver({score, stats})`

Asset paths are relative to `assets/games/<key>/`.

## 2. Germ Smash

Germs pop out of pores on a patch of skin. The student smashes them before they sink back and leaves the friendly bacteria alone. Each round lasts 60 seconds.

| Character | Art | Tap result | Appears in |
|---|---|---|---|
| Germ | Spiky virus, 3 color variants (`germ-1/2/3.webp`) | +10 | All levels |
| Tough germ | Bigger and armored; the first tap shows `tough-cracked.webp`, the second tap kills it | +25 on the kill | Medium, Hard |
| Friendly bacterium | Round, smooth and blue (`friendly.webp`): a different shape, not only a different color | −15 (the score never goes below 0), and the combo resets | All levels |

**Combo:**
- The multiplier is ×1 at the start, ×2 after 5 hits in a row, ×3 after 10 and ×4 after 20.
- A germ escaping, or a tap on a friendly bacterium, resets the combo to 0.
- A tap on an empty pore changes nothing.
- A hit's value is the base value × the current multiplier.

**Difficulty:** these are starting values, tuned with the user during testing.

| | Easy | Medium | Hard |
|---|---|---|---|
| Grid | 3×3 | 4×3 | 4×4 |
| A germ stays up for | 1.4 s | 1.0 s | 0.75 s |
| A new germ appears every | 0.9 s | 0.7 s | 0.5 s |
| Friendly bacteria | 10% | 15% | 20% |
| Tough germs | 0% | 10% | 20% |

**Ramp:** over the round, the stay-up time and the spawn interval both shrink linearly to 70% of their starting values by the 60-second mark. Only one character occupies a pore at a time.

**Stars:** 1★ 300, 2★ 700, 3★ 1200, compared against the score before the difficulty multiplier.

**Controls:**
- Tap or click a germ.
- 3×3 grid: keys `7 8 9 / 4 5 6 / 1 2 3`, numpad or top row.
- 4-wide grids: keys `Q W E R / A S D F / Z X C V`, with the 4×3 grid using the first three rows.

**Backdrop:**
- Each round picks one of 8 natural human skin tones at random with `api.rng()`:
  `#F6D9C5 #EAC2A5 #D9A47F #C68A63 #A86F4C #8A5A3C #6B442B #4A2F20`.
- Pores are darker ellipses in the same tone, with a soft lighter rim.
- There is a subtle surface grain and a vignette.
- The menu backdrop uses the same drawing, cycling slowly through the tones.

**Readability:**
- Every character has a soft dark outline and a light glow, so it stands out on all 8 tones.
- Germs and friendly bacteria differ in shape as well as color.

**Game feel:**
- Characters rise out of their pore with an ease-out and a small wobble, and sink back when missed.
- **A hit:**
  - squash and stretch;
  - 8–14 particles in the character's color (2–4 with reduce motion);
  - a floating "+10 ×3".
- **Killing a tough germ:** a 4 px screen shake lasting 120 ms (none with reduce motion), and a thud.
- **Tapping a friendly bacterium:** a red edge flash, a buzz and `vibrate(80)`.
- **The combo multiplier rising:** a chime, and the combo badge pulses.
- **The last 10 seconds:** the timer pulses and a tick plays every second.

**Sounds** (Kenney CC0; the final files are listed for the user's OK before download):
- `pop`, `thud` and `buzz` for hits
- `chime` when the combo rises
- `beep` for the countdown and `tick` for the last 10 seconds
- `gameover`, a short jingle
- `music`, one loop

If no CC0 loop fits, the Music setting is hidden until one exists.

**Stats** sent at game over: `{hits, misses, friendly_hits, best_combo}`.
- `hits` = germs killed, plus tough germs killed.
- `misses` = germs that escaped.

**Blender renders:**
- `germ-1.webp`, `germ-2.webp`, `germ-3.webp`
- `tough.webp`, `tough-cracked.webp`
- `friendly.webp`
- `card.webp`, a 16:9 render of the germ group for the gallery card

Each character is 256×256 with a transparent background and the same three-point lighting as the landing renders.

## 3. Student and teacher pages

**`student/games.html`** becomes a game gallery:
- One large card per **finished** game (only Germ Smash for now; no "Coming soon" placeholders). Each card shows:
  - `card.webp`, the title and the tagline;
  - the student's best score;
  - a Play button that opens `play.html?game=<key>`.
- "This week in your section": total points across games, as now.
- Badges, as now.
- The difficulty picker moves into each game's New Game screen.

**`teacher/games.html`** keeps two tabs:
- **Leaderboard:** a section picker plus a game filter. "All games" shows total points; a single game shows weekly best scores.
- **Badges:** the existing editor. The metric dropdown gains "Different games played" (`games_variety`) and drops the two quiz-only metrics.

A "Try the games" link opens each game in preview mode.

**Sidebar and phone tab bar:** Games stays where it is now in both portals.

## 4. Server: scores, leaderboard, badges

**`api/helpers.php`** gains:
```php
const GAMES = ['germ-smash' => ['title' => 'Germ Smash', 'max_score' => 20000, 'min_sec' => 55, 'max_sec' => 75]];
```

**`POST api/games/plays.php`** (student only)
- **Body:** `{game_key, difficulty, score, duration_sec, stats:{hits, misses, friendly_hits, best_combo}}`. The old `results` body is removed.
- **Rejected with 422 when:**
  - `game_key` is not in `GAMES`;
  - `difficulty` is not `easy`, `medium` or `hard`;
  - `score` is not an integer from 0 to `max_score`;
  - `duration_sec` is outside `min_sec`–`max_sec`;
  - any stat is not a non-negative integer;
  - `best_combo > hits`.
- **Points:** `points = (int) round(score × multiplier)`, with multipliers 1, 1.5 and 2.
- **Stored in `game_plays`:**
  - `correct = hits`
  - `total = hits + misses + friendly_hits`
  - `best_streak = best_combo`
  - `points`
  - `score`, a new column: `INT UNSIGNED NOT NULL DEFAULT 0`, added through `addColumnIfMissing`
  - `set_id = NULL`, `system_id = NULL`
- **Returns:** `{score, points, new_badges:[{title, icon}]}`.

**`GET api/games/leaderboard.php`**
- **Without `game`:** unchanged; weekly total points.
- **With `?game=<key>`:**
  - The key must be in `GAMES`, otherwise 422.
  - Returns each student's **best score this week** (`MAX(score)`) for that game in the section, as `{section, week_start, game, top:[{rank, user_id, full_name, score}], me:{rank, score}|null, best:{all_time, week}|null}`.
  - Ties go to whoever reached the score first.
  - Students only ever see their own section. Teachers must pass a valid `section`. `best` is null for teachers.

**Badges:**
- **`BADGE_METRICS`:**
  - removes `perfect_rounds` and `game_systems_played`;
  - adds `games_variety` (`COUNT(DISTINCT game_key)` over `game_plays`).
- **`best_game_streak`** now means the best combo (the same `MAX(best_streak)`).
- **`migrate.php`:**
  - Seeds with `INSERT IGNORE`:
    - `combo-20` "On a Roll" (`best_game_streak` 20, icon `target`)
    - `combo-40` "Unstoppable" (`best_game_streak` 40, icon `target`)
    - `all-rounder` "All-Rounder" (`games_variety` 3, icon `flag`)
  - **Once only**, guarded by the `app_settings` key `games_v2_badges`: sets `is_active = 0` on the built-ins `perfect-1`, `explorer-3`, `explorer-6`, `streak-10` and `streak-25`, and on any rule whose metric is `perfect_rounds` or `game_systems_played`. Nothing is deleted, earned badges stay in `student_badges`, and a teacher who turns one back on later is not overruled.
- **`achievements.php`** validates against the updated `BADGE_METRICS`.

## 5. Removed

These are files only; no database data is deleted.
- **Quiz game modules:** `assets/js/games/match-pairs.js`, `sort-it.js`, `beat-the-clock.js`, `unscramble.js`, `hunt-3d.js`.
- **Quiz helpers:** `cards.js`, `runner-core.js`, `runner.js`, `play-kit.js`, `registry.js`.
- **Card APIs:** `api/games/sets.php`, `api/games/mastery.php`.
- **The model part list:** `system_model/layers/parts.json`, `tools/build-part-index.mjs`, and the README sentence about it.
- **The `?games` guard** in `api/anatomy-content.php`.
- **Tests for the removed code:**
  - `tests/unit/games.test.mjs` (its quiz parts) and `tests/unit/teacher-page.test.mjs`
  - the set, mastery, card-stats and quiz-round checks in `tests/integration.mjs`
  - the quiz-round checks in `tests/browser.mjs`
- **Kept but unused:** the `game_sets` and `game_card_stats` tables. Dropping them can't be undone, and they hold nothing important.

## 6. Testing

- **Unit** (`tests/unit/games.test.mjs`, rewritten):
  - Shell: settings defaults, load and save, and corrupt-storage fallback.
  - Germ Smash's pure helpers:
    - combo multiplier thresholds
    - hit value
    - score floor at 0
    - the ramp (the interval at 0 s, 30 s and 60 s)
    - stars from a score
    - key-to-pore mapping for each grid
    - the skin tone is always one of the 8, chosen by the seeded rng
- **Integration:**
  - The new plays body is accepted.
  - Each rejection rule returns 422.
  - Points multipliers are applied.
  - `score` is stored.
  - `leaderboard.php?game=`: weekly best, ties, section isolation, and the teacher section requirement.
  - The new badges are seeded; the quiz badges are inactive after the migration; running the migration again doesn't turn them off again after a teacher re-enables one.
  - `sets.php` and `mastery.php` return 404.
- **Browser:**
  - `play.html?game=germ-smash&seed=1`:
    - loading leads to the menu;
    - a Settings toggle persists across a reload;
    - How to Play and High Scores open;
    - New Game on Easy, then the countdown;
    - clicking germs raises the score;
    - pause and resume stop the clock;
    - the full 60-second round reaches game over, and the score saves;
    - preview mode as a teacher posts nothing.
  - The gallery shows the Germ Smash card and no quiz games.
  - A phone viewport at 375×812 has no horizontal scroll.
- **Manual (the user's check):** play each difficulty on a phone and a desktop, then tune the numbers in section 2.
