# Practice Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five practice games with three difficulty levels, points, a weekly leaderboard for each section, per-card mastery stats and badges, for Grade 11 students. Plus a teacher page to make game sets, view results and manage badges.

**Architecture:** Every game plays from one shared card shape, `{key, term, clue, group, mesh}`. Default cards are built in the browser from a prebuilt `parts.json` (taken from the 3D models) and the teacher-curated structures; teacher sets come from a new table. Each game is one ES module listed in a registry. A shared runner chooses cards, applies the difficulty and posts results. PHP works out the points, saves the round, updates card stats and awards badges using the existing `achievement_rules` table.

**Tech Stack:** PHP 8 and MySQL (XAMPP), plain ES modules, `node --test` for unit tests, and the existing integration and browser suites in `tests/`.

**Spec:** `docs/superpowers/specs/2026-10-20-practice-games-design.md`

## Global Constraints

- Practice only. Nothing writes to `assessments`, `questions`, `assessment_submissions` or `answer_responses`.
- Games are tied to body systems, never lessons.
- Difficulty is `easy | medium | hard` (default `medium`). The points multiplier is 1, 1.5 or 2, applied as `points = round((10 × correct + 2 × best_streak) × multiplier)`.
- A perfect round is `correct = total AND total >= 4`.
- Card `key`: `sys:<system_code>:<term>` or `set:<set_id>:<term>`, with the term lowercased and trimmed, at most 200 characters.
- Icons come only from the Phosphor sprite `assets/icons/interface.svg`. No emoji, no pastel icon tiles. Badge icons: `game-controller`, `trophy`, `check-circle`, `target`, `flag`, `medal`.
- Sections come only from the `SECTIONS` constant in `api/helpers.php`. Grade is the `GRADE_LEVEL` constant.
- All user-supplied text (card terms, clues, set titles, names) is rendered with `textContent` or the existing `escHtml`, never as raw HTML.
- Schema changes go only in `database/migrate.php` and must be repeatable and non-destructive.
- Commit titles end with the date, e.g. `(2026-10-20)`, and every commit is pushed to `main`.

## Review Focus

1. **HTML in teacher cards.** A card term like `<img src=x onerror=alert(1)>` must show as literal text in every game and in the teacher editor. Test in Task 9.
2. **Multi-word and hyphenated terms in Unscramble** ("Vena cava", "Biceps brachii"). Letters are shuffled within words, spaces stay in place, and answers are compared ignoring case and extra spaces. The 4–20 range counts letters only. Test in Task 7.
3. **The same term appearing twice in a pool** (the same structure curated in two systems under "All systems", or left/right parts). A round never contains two cards with the same term. Test in Task 6.
4. **A student whose section isn't in `SECTIONS`** (left over from before Grade 11). The leaderboard returns their own section's board (possibly just them) without an error, and teachers can't request that section. Test in Task 5.
5. **Two rounds saved at almost the same moment.** A badge is still recorded only once, enforced by the `student_badges` primary key and `INSERT IGNORE`. Test in Task 3.

---

## File structure

| File | Responsibility |
|---|---|
| `tools/build-part-index.mjs` | Exports `readGlbParts(buffer)`; when run directly, writes `system_model/layers/parts.json` |
| `assets/js/games/cards.js` | Pure functions that build card pools |
| `assets/js/games/runner-core.js` | Pure helpers: weighted choice, streak, Unscramble normalising |
| `assets/js/games/runner.js` | Runs a round in the DOM: difficulty picker, timer, results, saving, badge popups |
| `assets/js/games/registry.js` | `export const games = [matchPairs, sortIt, beatTheClock, unscramble, hunt3d]` |
| `assets/js/games/{match-pairs,sort-it,beat-the-clock,unscramble,hunt-3d}.js` | One game each |
| `assets/js/games/student-page.js`, `teacher-page.js` | Page wiring |
| `assets/css/games.css` | Styles for both Games pages |
| `api/games/{sets,plays,leaderboard,mastery,badges}.php` | Endpoints |
| `api/helpers.php` | + `gameMetrics`, `badgeMetrics`, `awardBadges`, `scoreRound` |
| `student/games.html`, `teacher/games.html` | Pages |
| `tests/unit/games.test.mjs` | Unit tests for `cards`, `runner-core`, each game's `levels` and `available`, and `readGlbParts` |

---

### Task 1: Model part index

**Files:**
- Create: `tools/build-part-index.mjs`, `system_model/layers/parts.json` (generated)
- Modify: `README.md` (one line in the layer-export paragraph)
- Test: `tests/unit/games.test.mjs`

**Interfaces:**
- Produces:
  - `readGlbParts(buffer: Buffer): Array<{id: string, name: string, description: string}>`
  - `parts.json`, shaped as `{[system_code]: Array<{id, name, description}>}`

- [ ] **Step 1: Write the failing test**

```js
import {readGlbParts} from '../../tools/build-part-index.mjs';
test('readGlbParts returns described parts from a layer GLB', () => {
    const parts = readGlbParts(fs.readFileSync('system_model/layers/endocrine.glb'));
    assert.equal(parts.length, 8);                       // manifest.json: endocrine described = 8
    assert.ok(parts.every(p => p.id.startsWith('za_') && p.name && p.description));
    assert.ok(parts.some(p => p.id === 'za_adenohypophysis' && p.name === 'Adenohypophysis'));
});
```

- [ ] **Step 2: Run** `node --test tests/unit/games.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `readGlbParts`.** Read the JSON chunk: its length is at byte 12, and the chunk starts at byte 20. Return the nodes whose `extras.part_id` is set and whose `extras.description` isn't empty, mapped to `{id: part_id, name, description}`. When the script is run directly (`import.meta.url === pathToFileURL(process.argv[1]).href`), go through every entry in `manifest.json` and write `parts.json` with `JSON.stringify(index)` (no pretty-printing).
- [ ] **Step 4: Run** the test (expected PASS), then `node tools/build-part-index.mjs`. Expected: `parts.json` exists, and every system key in `manifest.json` is present.
- [ ] **Step 5:** Add to README, after the `integrate_layers.php` sentence: "Then run `node tools/build-part-index.mjs` to refresh `parts.json`, the part names and descriptions used by the practice games."
- [ ] **Step 6: Commit** `Games: part index from the 3D layers (2026-10-20)` and push.

### Task 2: Card pools (`cards.js`)

**Files:**
- Create: `assets/js/games/cards.js`
- Test: `tests/unit/games.test.mjs`

**Interfaces:**
- Consumes: the shape of `parts.json` (Task 1); the shape of an `anatomy-content.php` row: `{system_code, system_name, structures:[{name, desc, mesh_name}]}`
- Produces:
  - `cardKey(source: string, term: string): string`
  - `baseTerm(name: string): string`: removes a trailing ` (left)` or ` (right)`
  - `systemPool(system, parts, {sided = false} = {}): Card[]`
  - `allSystemsPool(systems, partsIndex): Card[]`
  - `setPool(set: {set_id, cards, system_name?}): Card[]`
  - `type Card = {key, term, clue, group, mesh}`

- [ ] **Step 1: Write the failing tests**

```js
const sys = {system_code:'skeletal', system_name:'Skeletal System', structures:[]};
const parts = [{id:'za_femur_l',name:'Femur (left)',description:'The femur is the thigh bone. It is long.'},
               {id:'za_femur_r',name:'Femur (right)',description:'The femur is the thigh bone. It is long.'},
               {id:'za_patella',name:'Patella',description:'Kneecap.'}];
test('cardKey lowercases, trims and caps at 200', () => {
    assert.equal(cardKey('sys:skeletal', '  Femur '), 'sys:skeletal:femur');
    assert.equal(cardKey('set:3', 'x'.repeat(300)).length, 200);
});
test('systemPool merges left/right and keeps the first sentence', () => {
    const pool = systemPool(sys, parts);
    assert.deepEqual(pool.map(c => c.term), ['Femur', 'Patella']);
    assert.equal(pool[0].clue, 'The femur is the thigh bone.');
    assert.equal(pool[0].group, 'Skeletal System');
});
test('systemPool keeps sided parts with mesh for 3D Hunt', () => {
    assert.deepEqual(systemPool(sys, parts, {sided:true}).map(c => c.mesh), ['za_femur_l','za_femur_r','za_patella']);
});
test('curated structures replace the part index at 4 or more', () => {
    const curated = {...sys, structures:['A','B','C','D'].map(n => ({name:n, desc:n+' desc.', mesh_name:''}))};
    assert.deepEqual(systemPool(curated, parts).map(c => c.term), ['A','B','C','D']);
    assert.equal(systemPool({...sys, structures: curated.structures.slice(0,3)}, parts).length, 2);
});
test('setPool groups by card group, then the set system, then none', () => {
    const pool = setPool({set_id:3, system_name:'Skeletal System', cards:[{term:'Femur',clue:'Thigh'},{term:'Heart',clue:'Pump',group:'Circulatory'}]});
    assert.deepEqual(pool.map(c => [c.key, c.group]), [['set:3:femur','Skeletal System'],['set:3:heart','Circulatory']]);
    assert.equal(setPool({set_id:4, cards:[{term:'X',clue:'Y'}]})[0].group, null);
});
```

- [ ] **Step 2: Run** `node --test tests/unit/games.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions listed under Interfaces. `firstSentence` comes from `../explorer/format.js`. Non-sided pools keep the first part for each `baseTerm` (with `mesh` set to null); sided pools keep every part and its `mesh`. `allSystemsPool` concatenates `systemPool` for every system.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Games: card pools from parts, structures and sets (2026-10-20)` and push.

### Task 3: Schema, badge metrics and awarding

**Files:**
- Modify: `database/migrate.php`, `api/helpers.php`, `api/achievements.php`, `api/dashboard/student-stats.php`
- Test: `tests/integration.mjs`

**Interfaces:**
- Produces (PHP, in `helpers.php`):
  - `gameMetrics(int $userId): array`: keys `games_played, perfect_rounds, best_game_streak, game_systems_played, total_points` (numbers)
  - `badgeMetrics(int $userId): array`: the existing profile metrics (`completed_lessons, avg_quiz_score, quizzes_taken, quizzes_passed, systems_explored, total_time_hours, overall_progress`) merged with `gameMetrics`
  - `awardBadges(int $userId): array`: newly earned `[{achievement_id, title, icon}]`
  - `const BADGE_METRICS`: the 7 existing metric names plus the 5 game metric names

- [ ] **Step 1: Write the failing integration checks** (after the student fixture is created in `tests/integration.mjs`):

```js
check((await teacher('achievements.php')).data.some(r=>r.badge_key==='first-game'&&r.icon==='game-controller'),'Built-in badges seeded with icons');
check((await teacher('achievements.php','POST',{title:'Play 1',metric:'games_played',threshold:1,icon:'trophy'})).success,'Game metric accepted');
check((await teacher('achievements.php','POST',{title:'Bad',metric:'games_played',threshold:1,icon:'<b>'})).status===422,'Icon must be a sprite id');
```

- [ ] **Step 2: Run** the integration suite (README "Testing" section: isolated DB, server on 127.0.0.1:8091). Expected: FAIL on "Built-in badges seeded".
- [ ] **Step 3: Migration.** Add to `migrate.php`:
  - the four tables and the `difficulty` column exactly as in spec section 4
  - `badge_key` and `icon` added to `achievement_rules`, using the same `information_schema` column check the file already uses
  - the 11 seed rows from spec section 5, inserted with `INSERT IGNORE`
- [ ] **Step 4: PHP helpers.**
  - Move the profile-metric query from `student-stats.php` into `badgeMetrics`.
  - `awardBadges` loops over active rules, inserts `INSERT IGNORE INTO student_badges` for each rule that's met and not yet held, and returns only the rows whose insert affected 1 row.
  - `achievements.php` validates `metric ∈ BADGE_METRICS` and `icon` against `^[a-z-]{1,40}$`. It also accepts `PUT ?id` with `title, metric, threshold, icon, is_active`, because the teacher Badges tab (Task 10) edits and toggles badges.
  - `student-stats.php` calls `awardBadges($user['user_id'])`, then builds `achievements` from the rules LEFT JOINed with `student_badges`, as `{name, icon, earned, earned_at}`.
- [ ] **Step 5: Add a check that badges stay stable:** calling `dashboard/student-stats.php` twice as the student returns the same earned count. The concurrency check for Review Focus 5 is in Task 4.
- [ ] **Step 6: Run** `php database/migrate.php` twice against the test DB (the second run must not fail or duplicate badges), then run the suite. Expected: PASS.
- [ ] **Step 7: Commit** `Games: schema, badge metrics and awarding (2026-10-20)` and push.

### Task 4: Game sets and saving rounds

**Files:**
- Create: `api/games/sets.php`, `api/games/plays.php`
- Modify: `api/helpers.php` (+ `scoreRound`)
- Test: `tests/integration.mjs`

**Interfaces:**
- Consumes: `awardBadges` (Task 3)
- Produces:
  - `scoreRound(array $results, string $difficulty): array{correct:int,total:int,best_streak:int,points:int}`
  - `GET/POST/PUT ?id/DELETE ?id sets.php`; a set is `{set_id, title, system_id, system_name, cards, is_active}`
  - `POST plays.php` with body `{game_key, difficulty, set_id?, system_code?, duration_sec, results:[{card_key, term, correct}]}`. It returns `{points, correct, total, best_streak, new_badges:[{title, icon}]}`.

- [ ] **Step 1: Write the failing checks**

```js
const set=await teacher('games/sets.php','POST',{title:'Leg bones',system_id:null,cards:[['Femur','Thigh bone'],['Tibia','Shin bone'],['Fibula','Thin leg bone'],['Patella','Kneecap']].map(([term,clue])=>({term,clue}))});
check(set.success,'Teacher creates a game set');
check((await teacher('games/sets.php','POST',{title:'Dup',cards:[{term:'A',clue:'x'},{term:'a',clue:'y'},{term:'B',clue:'z'},{term:'C',clue:'w'}]})).status===422,'Terms unique ignoring case');
check((await teacher('games/sets.php','POST',{title:'Short',cards:[{term:'A',clue:'x'}]})).status===422,'At least 4 cards');
check((await student('games/sets.php','POST',{title:'x',cards:[]})).status===403,'Students cannot create sets');
const r=(c)=>({card_key:'set:'+set.data.set_id+':'+c[0],term:c[0],correct:c[1]});
const play=await student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'hard',set_id:set.data.set_id,duration_sec:20,results:[['femur',1],['tibia',1],['fibula',0],['patella',1]].map(r)});
check(play.data.correct===3&&play.data.best_streak===2&&play.data.points===Math.round((30+4)*2),'Server scores the round with the hard multiplier');
check(play.data.new_badges.some(b=>b.title==='First Game'),'First round earns First Game');
for(const bad of [{difficulty:'insane'},{game_key:'Bad Key!'},{duration_sec:2},{results:[]},{set_id:999999}])
  check((await student('games/plays.php','POST',{game_key:'match-pairs',difficulty:'easy',duration_sec:20,results:[r(['femur',1]),r(['tibia',1]),r(['fibula',1])],...bad})).status===422,'Impossible round rejected: '+JSON.stringify(bad));
```

Review Focus 5: before the first `play` above, send two valid rounds at the same time with `Promise.all`. Then assert that `(await student('games/badges.php')).data.filter(b=>b.title==='First Game'&&b.earned_at).length===1` and that exactly one of the two responses lists First Game in `new_badges`. Remove the `First Game` assertion on the later `play`, since that badge has already been earned.

- [ ] **Step 2: Run.** Expected: FAIL (404).
- [ ] **Step 3: `scoreRound`.** `best_streak` is the longest run of consecutive `correct` results. Multipliers are `['easy'=>1,'medium'=>1.5,'hard'=>2]`. Points are `(int) round(...)`.
- [ ] **Step 4: `sets.php`.**
  - Validation: as in spec section 4.
  - GET for students: `is_active=1` sets only.
  - GET for teachers: all sets.
  - The `cards` value is stored with `json_encode(..., JSON_UNESCAPED_UNICODE)`.
- [ ] **Step 5: `plays.php`.**
  - `requireStudent()`, then validate according to spec section 6.
  - `system_code` is looked up to get `system_id`; an unknown code returns 422.
  - In one transaction: insert into `game_plays`, then for each result upsert `game_card_stats`: `INSERT … ON DUPLICATE KEY UPDATE seen=seen+1, correct=correct+VALUES(correct), last_seen=NOW()`. The term is cut to 100 characters.
  - After the commit, call `awardBadges`.
- [ ] **Step 6: Run.** Expected: PASS.
- [ ] **Step 7: Commit** `Games: game sets and scored rounds (2026-10-20)` and push.

### Task 5: Leaderboard, mastery and badges endpoints

**Files:**
- Create: `api/games/leaderboard.php`, `api/games/mastery.php`, `api/games/badges.php`
- Test: `tests/integration.mjs`

**Interfaces:**
- Produces:
  - `leaderboard.php` returns `{section, week_start, top:[{rank, user_id, full_name, points}], me:{rank, points}|null}`
  - `mastery.php` (student) returns `{[card_key]: [seen, correct]}`
  - `mastery.php?section=` (teacher) returns `[{term, seen, correct, miss_rate}]`, up to 20 rows
  - `badges.php` returns `[{achievement_id, title, icon, metric, threshold, value, earned_at}]`

- [ ] **Step 1: Write the failing checks.** The fixture student is in Rizal (Task 4 has already saved one round for them).

```js
const lb=await student('games/leaderboard.php?section=Bonifacio');
check(lb.data.section==='Rizal'&&lb.data.top[0].full_name==='Test Student','Students only see their own section');
check((await teacher('games/leaderboard.php')).status===422,'Teacher must pick a section');
check((await teacher('games/leaderboard.php?section=Nope')).status===422,'Teacher section must be official');
check((await teacher('games/leaderboard.php?section=Bonifacio')).data.top.length===0,'Other section is empty');
check(Array.isArray((await student('games/mastery.php')).data['set:'+set.data.set_id+':fibula']),'Student mastery map');
check((await student('games/badges.php')).data.find(b=>b.title==='First Game').earned_at,'Badge list shows earned date');
```

  For the misses check: post 2 more rounds where `fibula` is wrong (3 times seen in total), then assert that `teacher('games/mastery.php?section=Rizal').data[0].term==='fibula'`.
  For Review Focus 4: add a `legacy-section` action to `tests/database.php`, next to `expire`. It runs ``UPDATE `$name`.student_profiles SET section = ? WHERE student_id='TEST-STUDENT'`` with `$argv[2]`. Call it through `execFileSync`, the way line 49 calls `expire`: first with `'Old Section'`, then assert that `student('games/leaderboard.php')` succeeds with `section==='Old Section'`, then call it again with `'Rizal'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The week starts at `date('Y-m-d 00:00:00', strtotime('monday this week'))`.
  - Leaderboard order: `points DESC, MAX(played_at) ASC`.
  - Teacher mastery: aggregate `game_card_stats` joined to `student_profiles.section`, grouped by `term`, `HAVING SUM(seen) >= 3`, ordered by `1 - SUM(correct)/SUM(seen)` descending.
  - `badges.php` uses `badgeMetrics` for `value`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Games: leaderboard, mastery and badge endpoints (2026-10-20)` and push.

### Task 6: Runner core (pure)

**Files:**
- Create: `assets/js/games/runner-core.js`
- Test: `tests/unit/games.test.mjs`

**Interfaces:**
- Produces:
  - `cardWeight(card, stats): 1|2|3`: 3 if the student has missed it (`seen > correct`), 2 if never seen, otherwise 1
  - `pickCards(pool, n, stats = {}, rng = Math.random): Card[]`: weighted, no repeats, **distinct terms**
  - `streaks(results: boolean[]): number`: the best streak
  - `DIFFICULTIES = ['easy','medium','hard']`
  - `MULTIPLIER = {easy:1, medium:1.5, hard:2}`

- [ ] **Step 1: Write the failing tests**

```js
test('pickCards never repeats a term and respects n', () => {
    const pool = [{key:'a',term:'Femur'},{key:'b',term:'femur'},{key:'c',term:'Tibia'},{key:'d',term:'Ulna'}];
    const picked = pickCards(pool, 3, {}, () => 0.5);
    assert.equal(new Set(picked.map(c => c.term.toLowerCase())).size, picked.length);
    assert.ok(picked.length <= 3);
});
test('missed cards are weighted above unseen above known', () => {
    assert.equal(cardWeight({key:'a'}, {a:[3,1]}), 3);
    assert.equal(cardWeight({key:'a'}, {}), 2);
    assert.equal(cardWeight({key:'a'}, {a:[2,2]}), 1);
});
test('streaks finds the longest run', () => { assert.equal(streaks([true,true,false,true,true,true]), 3); });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `pickCards`: give each card the sort key `rng() ** (1 / weight)` (Efraimidis–Spirakis), sort descending, and take cards while skipping terms already taken (compared case-insensitively) until there are `n`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Games: runner core (2026-10-20)` and push.

### Task 7: Four DOM games and their levels

**Files:**
- Create: `assets/js/games/{match-pairs,sort-it,beat-the-clock,unscramble}.js`, `assets/js/games/registry.js`
- Modify: `assets/js/games/runner-core.js` (+ `normalizeAnswer`, `scrambleWords`)
- Test: `tests/unit/games.test.mjs`

**Interfaces:**
- Consumes: `Card` (Task 2)
- Produces:
  - each module's default export follows spec section 2: `{key, name, icon, levels, available(cards, level), play(root, cards, level, report): Promise<void>}`
  - `registry.js` exports `games` (ordered as in the spec table) and `gameByKey(key)`
  - `normalizeAnswer(s): string`: lowercase, trimmed, with repeated spaces collapsed
  - `scrambleWords(term, rng): string`: shuffles letters within each word and keeps spaces and hyphens where they are

**Levels** (copy exactly from the spec's difficulty table):

| key | icon | easy | medium | hard |
|---|---|---|---|---|
| match-pairs | stack | `{roundSize:4, previewSec:3}` | `{roundSize:6}` | `{roundSize:8, limitSec:90}` |
| sort-it | hand-grabbing | `{roundSize:6, maxBins:2}` | `{roundSize:10, maxBins:3}` | `{roundSize:14, maxBins:5, limitSec:60}` |
| beat-the-clock | clock | `{roundSize:6, choices:3, perCardSec:12}` | `{roundSize:10, choices:4, perCardSec:8}` | `{roundSize:12, choices:5, perCardSec:5}` |
| unscramble | textbox | `{roundSize:6, firstLetter:true}` | `{roundSize:8}` | `{roundSize:10, perCardSec:20}` |

- [ ] **Step 1: Write the failing tests**

```js
const cards = n => Array.from({length:n}, (_, i) => ({key:'k'+i, term:'Term'+String.fromCharCode(65+i), clue:'c', group:i%2?'G1':'G2', mesh:null}));
test('every game declares all three levels with roundSize', () => {
    for (const g of games) for (const d of DIFFICULTIES) assert.ok(g.levels[d].roundSize > 0, g.key + ' ' + d);
});
test('availability follows the level', () => {
    const mp = gameByKey('match-pairs');
    assert.equal(mp.available(cards(5), mp.levels.easy), true);
    assert.equal(mp.available(cards(5), mp.levels.medium), false);
    const sort = gameByKey('sort-it');
    assert.equal(sort.available(cards(10).map(c => ({...c, group:'G1'})), sort.levels.easy), false);   // one group
});
test('unscramble handles multi-word terms', () => {
    const s = scrambleWords('Vena cava', () => 0.3);
    assert.equal(s.split(' ').length, 2);
    assert.equal(normalizeAnswer('  vena   CAVA '), normalizeAnswer('Vena cava'));
    assert.equal(gameByKey('unscramble').available([{term:'Vena cava'},{term:'Biceps brachii'},{term:'Ulna'},{term:'Femur'},{term:'Tibia'},{term:'Patella'}], gameByKey('unscramble').levels.easy), true);
});
```

`unscramble.available` counts terms with 4–20 letters, counting only `/\p{L}/u` characters. `hunt-3d` is added to `registry.js` in Task 8; until then the registry lists 4 games.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the four modules.**
  - Each `play` builds its UI inside `root` using `textContent` only, and calls `report(card, correct)` exactly once per card.
  - A time-out or a give-up counts as `false`.
  - It resolves when every card has been reported or `limitSec` runs out; any cards left unreported are then reported as `false`.
  - **Match Pairs:** tiles are `<button>`s.
  - **Sort It:** tap a term, then tap a bin, and dragging works too. The bins are the `maxBins` most common groups among the chosen cards; cards outside those groups are swapped for others before the round starts.
  - **Beat the Clock:** wrong choices are other terms from the round's pool.
  - **Unscramble:** the clue is the hint; Easy shows the first letter.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Games: Match Pairs, Sort It, Beat the Clock, Unscramble (2026-10-20)` and push.

### Task 8: 3D Hunt

**Files:**
- Create: `assets/js/games/hunt-3d.js`
- Modify: `assets/js/games/registry.js`
- Test: `tests/unit/games.test.mjs` (levels and `available`); a browser check comes in Task 9

**Interfaces:**
- Consumes: the global `AnatomyViewer` from `assets/js/model-viewer.js`:
  - `init(canvas)`
  - layer loading as used by `assets/js/explorer/viewer.js`
  - `partAt(x, y)`
  - `findPart(meshName)`
  - `focusPart(part)`
  - `clearFocus()`
- Produces: a module with `key:'hunt-3d'`, `icon:'crosshair'` and levels `{easy:{roundSize:3,tries:3}, medium:{roundSize:5,tries:2}, hard:{roundSize:7,tries:1}}`. `available` is true when there are at least `roundSize` cards with `mesh`.

- [ ] **Step 1: Write the failing test.** `available` is false for 6 cards with `mesh` on hard and true on medium, and the levels match the table above.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Load only the card's system layer, the same way `explorer/viewer.js` loads one layer.
  - Prompt "Find: <term>".
  - On a click, `partAt` decides: if the part's `userData.part_id === card.mesh` it's correct; otherwise use up a try.
  - When the tries run out, call `focusPart(findPart(card.mesh))` for 1.5 s and report `false`.
  - When the round ends, release the viewer the same way the explorer does.
  - `hunt-3d` is only offered for a single-system pool, which `student-page.js` checks.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `Games: 3D Hunt (2026-10-20)` and push.

### Task 9: Student Games page and runner

**Files:**
- Create: `student/games.html`, `assets/js/games/runner.js`, `assets/js/games/student-page.js`, `assets/css/games.css`
- Modify:
  - `assets/js/sidebar.js`: in the student nav, after the Quizzes link, add `games.html` with the `game-controller` icon and label "Games"; bump the `sidebar.js` version string wherever pages include it
  - `api/anatomy-content.php`: skip the exploration checkpoint when `$_GET['games']` is set
  - `tests/browser.mjs`, `tests/navigation.mjs`
- Test: `tests/browser.mjs`, `tests/navigation.mjs`

**Interfaces:**
- Consumes:
  - Tasks 2, 6, 7 and 8
  - endpoints from Tasks 4 and 5
  - `../system_model/layers/parts.json`
  - `API_BASE/anatomy-content.php?games=1`
- Produces: `runRound({game, pool, level, difficulty, source:{set_id?|system_code?}, root, stats}): Promise<{saved: boolean, response?}>` in `runner.js`

- [ ] **Step 1: Write the failing browser checks** (in `tests/browser.mjs`, signed in as the fixture student):
  - The page loads with the pool picker, a difficulty picker defaulting to Medium, a leaderboard heading "This week in your section", and a Badges list.
  - Script a full Match Pairs round on Easy using a teacher set whose first card term is `<img src=x onerror=window.__xss=1>` (Review Focus 1). Assert that the results screen appears, `window.__xss` is undefined, and the term is visible as literal text.
  - `navigation.mjs`: the student sidebar now has 7 links, with Games after Quizzes.
- [ ] **Step 2: Run** both suites. Expected: FAIL.
- [ ] **Step 3: Build the page.**
  - Use the Stage layout and markup that `student/progress.html` uses.
  - **Pools:** "All systems", each active system (from `anatomy-content.php?games=1`) and each set from `games/sets.php`. Each pool's cards come from the Task 2 functions.
  - **Game cards:** one per game from the registry, greyed out with "Needs at least N terms" when `available` is false at the chosen level.
  - **Difficulty:** saved in `localStorage` under `anthropotomy_game_difficulty`, wrapped in try/catch.
  - **`runRound`:** picks the cards (`pickCards` with stats from `games/mastery.php`), runs `game.play`, and records `results` and `duration_sec`. It posts to `plays.php` and shows the results screen (correct/total, points, best streak, missed cards with clues, "Play again"). It shows a toast with icon and title for each entry in `new_badges`. On a network or 5xx failure, the results screen still appears with "Couldn't save this round" and a Retry button that resends the same request body.
  - **Empty state:** if every pool is empty, show "No game content yet".
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `Games: student Games page (2026-10-20)` and push.

### Task 10: Teacher Games page

**Files:**
- Create: `teacher/games.html`, `assets/js/games/teacher-page.js`
- Modify: `assets/js/sidebar.js` (in the teacher nav, after Assessments: `games.html`, `game-controller`, "Games"); `tests/browser.mjs`, `tests/navigation.mjs`
- Test: same

**Interfaces:**
- Consumes:
  - `sets.php` (Task 4)
  - `leaderboard.php` and `mastery.php` (Task 5)
  - `achievements.php` (Task 3), including its `PUT`
  - `SiteConfig.data.sections` from `api/config.php`
- Produces:
  - `parsePastedCards(text): Array<{term, clue, group?}>`, exported from `teacher-page.js`
  - one line per card. Two fields give `term, clue`. Three or more give `term`, then `clue` (everything between the first and last comma), then `group` (after the last comma). Blank lines are skipped.

- [ ] **Step 1: Write the failing tests.**
  - Unit test: `parsePastedCards('Femur, thigh bone\n\nHeart, pumps blood, Circulatory')` returns the two cards, the second with `group:'Circulatory'`, and `parsePastedCards('A, b, c, G')` returns `[{term:'A', clue:'b, c', group:'G'}]`. `teacher-page.js` must keep the DOM work out of module scope so the unit test can import it.
  - Browser test, signed in as teacher:
    - create a set by pasting 4 lines, and it appears in the list
    - turn it off, and it shows as off
    - the section picker shows the 4 sections, and the leaderboard and most-missed lists load
    - add a badge with icon `trophy`, and it appears
  - `navigation.mjs`: Games appears in the teacher sidebar after Assessments.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Build the page.** Four tabs: Game sets, Most-missed terms, Leaderboard, Badges, using the existing teacher modal and table classes. The badge icon picker offers only `game-controller, trophy, check-circle, target, flag, medal`.
- [ ] **Step 4: Run** the unit, browser and navigation suites. Expected: PASS.
- [ ] **Step 5: Commit** `Games: teacher Games page (2026-10-20)` and push.

### Task 11: Final check

- [ ] **Step 1:** Run every suite once against a fresh isolated test database: `node tests/check-syntax.mjs`, `node --test "tests/unit/*.test.mjs"`, the integration suite, the browser suite and the navigation suite. Expected: all pass.
- [ ] **Step 2:** Spot-check in the browser pane on Easy, Medium and Hard: one round of each game, with all points matching the formula.
- [ ] **Step 3:** Clean up the test database (`tests/database.php cleanup`), then commit any remaining test or README changes as `Games: final checks (2026-10-20)` and push.
