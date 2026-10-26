import test from 'node:test';
import assert from 'node:assert/strict';
import game, {LEVELS, SKIN_TONES, STARS, ROUND_SECONDS, comboMultiplier, ramp, keyToPore, pickSkinTone, createRound} from '../../assets/js/games/germ-smash.js';

const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const germ = (upFor = 99) => ({kind: 'germ', variant: 0, cracked: false, age: 0, upFor});
const tough = (upFor = 99) => ({kind: 'tough', variant: 0, cracked: false, age: 0, upFor});
const friendly = (upFor = 99) => ({kind: 'friendly', variant: 0, cracked: false, age: 0, upFor});

test('constants match the spec', () => {
    assert.deepEqual(LEVELS, {
        easy: {cols: 3, rows: 3, upTime: 1.4, spawnEvery: 0.9, friendly: 0.10, tough: 0},
        medium: {cols: 4, rows: 3, upTime: 1.0, spawnEvery: 0.7, friendly: 0.15, tough: 0.10},
        hard: {cols: 4, rows: 4, upTime: 0.75, spawnEvery: 0.5, friendly: 0.20, tough: 0.20}
    });
    assert.deepEqual(STARS, [300, 700, 1200]);
    assert.equal(ROUND_SECONDS, 60);
    assert.equal(SKIN_TONES.length, 8);
});

test('comboMultiplier thresholds', () => {
    assert.deepEqual([0, 4, 5, 9, 10, 19, 20, 50].map(comboMultiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('ramp shrinks to 70% at 60 s', () => {
    assert.equal(ramp(1, 0), 1);
    assert.equal(ramp(1, 30), 0.85);
    assert.equal(ramp(1, 60), 0.7);
    assert.equal(ramp(1, 90), 0.7);
});

test('keyToPore keypad and QWER layouts', () => {
    assert.equal(keyToPore('Numpad7', 3, 3), 0);
    assert.equal(keyToPore('Digit3', 3, 3), 8);
    assert.equal(keyToPore('KeyR', 4, 3), 3);
    assert.equal(keyToPore('KeyZ', 4, 3), 8);
    assert.equal(keyToPore('KeyZ', 4, 4), 12);
    assert.equal(keyToPore('KeyV', 4, 4), 15);
    assert.equal(keyToPore('KeyQ', 3, 3), null);
});

test('keyToPore covers every key of each grid and rejects the rest', () => {
    assert.deepEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(n => keyToPore('Digit' + n, 3, 3)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(['7', '8', '9', '4', '5', '6', '1', '2', '3'].map(n => keyToPore('Numpad' + n, 3, 3)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual('QWERASDFZXCV'.split('').map(k => keyToPore('Key' + k, 4, 3)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.equal(keyToPore('Digit1', 4, 4), 0);
    assert.equal(keyToPore('Digit4', 4, 4), 3);
    assert.equal(keyToPore('KeyQ', 4, 4), 4);
    assert.equal(keyToPore('KeyA', 4, 4), 8);
    assert.equal(keyToPore('Digit1', 4, 3), null);
    assert.equal(keyToPore('Numpad7', 4, 4), null);
    assert.equal(keyToPore('Digit0', 3, 3), null);
    assert.equal(keyToPore('Space', 3, 3), null);
    assert.equal(keyToPore(undefined, 3, 3), null);
});

test('skin tone is always one of the 8', () => {
    for (const v of [0, .124, .5, .999]) assert.ok(SKIN_TONES.includes(pickSkinTone(() => v)));
    assert.equal(pickSkinTone(() => 0), SKIN_TONES[0]);
    assert.equal(pickSkinTone(() => 0.999), SKIN_TONES[7]);
});

test('a new round starts empty', () => {
    const {state} = createRound('medium', () => 0.5);
    assert.equal(state.pores.length, 12);
    assert.ok(state.pores.every(p => p.kind === null));
    assert.deepEqual([state.score, state.streak, state.bestCombo, state.hits, state.misses, state.friendlyHits, state.time, state.over], [0, 0, 0, 0, 0, 0, 0, false]);
    assert.equal(createRound('hard', () => 0.5).state.pores.length, 16);
});

test('spawning waits for the interval and carries the remainder', () => {
    const round = createRound('easy', seq(0.99, 0.5, 0.7));
    assert.deepEqual(round.tick(0.5), []);
    assert.deepEqual(round.tick(0.5), [{type: 'spawn', pore: 8, kind: 'germ'}]);
    const spawned = round.state.pores[8];
    assert.deepEqual([spawned.kind, spawned.variant, spawned.cracked, spawned.age], ['germ', 2, false, 0]);
    assert.equal(spawned.upFor, ramp(1.4, round.state.time));
    const spare = round.state.pores.filter(p => p.kind === null).length;
    assert.equal(spare, 8);
    assert.deepEqual(round.tick(0.7), []);
    assert.equal(round.tick(0.2).filter(e => e.type === 'spawn').length, 1);
});

test('spawn draws the pore first, then the kind, then the variant', () => {
    const medium = createRound('medium', seq(0, 0.12, 0.99, 0.2, 0.0, 0.5, 0.9));
    medium.tick(0.7);
    assert.equal(medium.state.pores[0].kind, 'friendly');
    medium.tick(0.7);
    assert.equal(medium.state.pores[11].kind, 'tough');
    assert.equal(medium.state.pores[11].upFor, ramp(1.0, medium.state.time));
    const easy = createRound('easy', seq(0, 0.1, 0.5));
    easy.tick(0.9);
    assert.deepEqual([easy.state.pores[0].kind, easy.state.pores[0].variant], ['germ', 1]);
});

test('spawn events name the kind that appeared', () => {
    const medium = createRound('medium', seq(0, 0.12, 0.99, 0.2, 0.5, 0.5, 0.9));
    assert.deepEqual(medium.tick(0.7), [{type: 'spawn', pore: 0, kind: 'friendly'}]);
    assert.deepEqual(medium.tick(0.7), [{type: 'spawn', pore: 11, kind: 'tough'}]);
    assert.deepEqual(medium.tick(0.7).map(e => [e.type, e.pore, e.kind]), [['escape', 0, 'friendly'], ['spawn', 5, 'germ']]);
});

test('tick ignores a zero, negative or non-finite dt', () => {
    let calls = 0;
    const round = createRound('easy', () => { calls++; return 0.5; });
    round.state.pores[4] = germ(1);
    for (const dt of [0, -0.5, NaN, Infinity, -Infinity, undefined, null, '0.5']) {
        assert.deepEqual(round.tick(dt), [], 'dt ' + String(dt));
    }
    assert.equal(round.state.time, 0);
    assert.equal(round.state.pores[4].age, 0);
    assert.equal(round.state.over, false);
    assert.equal(calls, 0);
    assert.equal(round.tick(0.9).filter(e => e.type === 'spawn').length, 1, 'a normal dt still works afterwards');
});

test('spawn skips when every pore is occupied and draws nothing', () => {
    let calls = 0;
    const round = createRound('easy', () => { calls++; return 0.5; });
    round.state.pores.forEach((_, i) => { round.state.pores[i] = friendly(); });
    assert.deepEqual(round.tick(1), []);
    assert.equal(calls, 0);
});

test('5 hits in a row make the 5th worth 20', () => {
    const round = createRound('easy', () => 0.5);
    const results = [];
    for (let i = 0; i < 5; i++) {
        round.state.pores[0] = germ();
        results.push(round.tap(0));
    }
    assert.deepEqual(results.map(r => r.value), [10, 10, 10, 10, 20]);
    assert.deepEqual(results.map(r => r.multiplier), [1, 1, 1, 1, 2]);
    assert.ok(results.every(r => r.type === 'hit'));
    assert.deepEqual([round.state.score, round.state.streak, round.state.bestCombo, round.state.hits], [60, 5, 5, 5]);
    assert.equal(round.state.pores[0].kind, null);
});

test('a tough germ cracks, then dies for 25 x the multiplier', () => {
    const round = createRound('medium', () => 0.5);
    round.state.streak = 4;
    round.state.pores[3] = tough();
    assert.deepEqual(round.tap(3), {type: 'crack', value: 0, multiplier: 1});
    assert.deepEqual([round.state.score, round.state.streak, round.state.hits], [0, 4, 0]);
    assert.equal(round.state.pores[3].cracked, true);
    assert.equal(round.state.pores[3].kind, 'tough');
    assert.deepEqual(round.tap(3), {type: 'kill', value: 50, multiplier: 2});
    assert.deepEqual([round.state.score, round.state.streak, round.state.bestCombo, round.state.hits], [50, 5, 5, 1]);
    assert.equal(round.state.pores[3].kind, null);
});

test('a friendly tap costs 15 but never goes below 0, and breaks the combo', () => {
    const round = createRound('easy', () => 0.5);
    round.state.score = 5;
    round.state.streak = 7;
    round.state.bestCombo = 7;
    round.state.pores[1] = friendly();
    const result = round.tap(1);
    assert.equal(result.type, 'friendly');
    assert.deepEqual([round.state.score, round.state.streak, round.state.bestCombo, round.state.friendlyHits], [0, 0, 7, 1]);
    assert.equal(round.state.pores[1].kind, null);
    round.state.score = 100;
    round.state.pores[1] = friendly();
    round.tap(1);
    assert.equal(round.state.score, 85);
});

test('an escaping germ is a miss and breaks the combo; a friendly leaving is free', () => {
    const round = createRound('easy', () => 0.5);
    round.state.streak = 6;
    round.state.bestCombo = 6;
    round.state.pores[2] = germ(0.4);
    round.state.pores[5] = friendly(0.4);
    round.state.pores[6] = {...tough(0.4), cracked: true};
    const events = round.tick(0.5);
    assert.deepEqual(events, [{type: 'escape', pore: 2, kind: 'germ'}, {type: 'escape', pore: 5, kind: 'friendly'}, {type: 'escape', pore: 6, kind: 'tough'}]);
    assert.deepEqual([round.state.misses, round.state.streak, round.state.bestCombo, round.state.score, round.state.friendlyHits], [2, 0, 6, 0, 0]);
    assert.ok(round.state.pores.every(p => p.kind === null));
});

test('a friendly leaving alone changes no stat', () => {
    const round = createRound('easy', () => 0.5);
    round.state.streak = 3;
    round.state.pores[0] = friendly(0.2);
    assert.deepEqual(round.tick(0.3), [{type: 'escape', pore: 0, kind: 'friendly'}]);
    assert.deepEqual([round.state.misses, round.state.streak], [0, 3]);
});

test('characters age every tick', () => {
    const round = createRound('easy', () => 0.5);
    round.state.pores[4] = germ(1.4);
    round.tick(0.25);
    round.tick(0.25);
    assert.equal(round.state.pores[4].age, 0.5);
});

test('tapping the same pore twice right after a kill scores once', () => {
    const round = createRound('easy', () => 0.5);
    round.state.pores[0] = germ();
    assert.equal(round.tap(0).type, 'hit');
    assert.deepEqual(round.tap(0), {type: 'empty', value: 0, multiplier: 1});
    assert.deepEqual([round.state.score, round.state.hits, round.state.streak], [10, 1, 1]);
    round.state.pores[1] = tough();
    round.tap(1);
    assert.equal(round.tap(1).type, 'kill');
    assert.equal(round.tap(1).type, 'empty');
    assert.equal(round.state.score, 35);
});

test('an empty tap or an out-of-range tap changes nothing', () => {
    const round = createRound('easy', () => 0.5);
    round.state.streak = 3;
    assert.equal(round.tap(0).type, 'empty');
    assert.equal(round.tap(-1).type, 'empty');
    assert.equal(round.tap(9).type, 'empty');
    assert.equal(round.tap(undefined).type, 'empty');
    assert.deepEqual([round.state.score, round.state.streak, round.state.misses], [0, 3, 0]);
});

test('ticking past 60 s ends the round exactly once', () => {
    const round = createRound('easy', () => 0.5);
    let ends = 0;
    for (let i = 0; i < 239; i++) ends += round.tick(0.25).filter(e => e.type === 'end').length;
    assert.equal(ends, 0);
    assert.equal(round.state.over, false);
    const last = round.tick(0.25);
    assert.equal(last.filter(e => e.type === 'end').length, 1);
    assert.equal(last.at(-1).type, 'end');
    assert.equal(round.state.over, true);
    assert.deepEqual(round.tick(0.25), []);
    assert.deepEqual(round.tick(5), []);
    round.state.pores[0] = germ();
    const score = round.state.score;
    assert.equal(round.tap(0).type, 'empty');
    assert.equal(round.state.score, score);
    assert.equal(round.state.time, 60);
});

test('the same seed script gives the same easy round', () => {
    const play = () => {
        const round = createRound('easy', () => 0.5);
        for (let frame = 0; !round.state.over; frame++) {
            round.tick(1 / 60);
            if (frame % 11 === 0) round.tap(frame % 9);
        }
        return round.state;
    };
    const a = play(), b = play();
    assert.equal(a.score, b.score);
    assert.equal(a.hits, b.hits);
    assert.equal(a.misses, b.misses);
    assert.ok(a.score > 0 && a.misses > 0);
});

test('the default export follows the game module contract', async () => {
    const {readFile} = await import('node:fs/promises');
    const sprite = await readFile(new URL('../../assets/icons/interface.svg', import.meta.url), 'utf8');
    assert.equal(game.key, 'germ-smash');
    assert.equal(game.title, 'Germ Smash');
    assert.equal(game.tagline, 'Smash the germs, spare the good bacteria.');
    assert.equal(game.theme.accent, '#2ccf9a');
    assert.equal(game.stars, STARS);
    assert.equal(game.roundSeconds, ROUND_SECONDS);
    assert.deepEqual(game.settings, []);
    assert.ok(game.howToPlay.length >= 3 && game.howToPlay.length <= 4, 'How to Play has 3 or 4 steps');
    for (const step of game.howToPlay) {
        assert.ok(sprite.includes(`<symbol id="${step.icon}"`), 'How to Play icon is in the sprite: ' + step.icon);
        assert.ok(typeof step.text === 'string' && step.text.length > 0);
    }
    assert.deepEqual(Object.keys(game.levels), ['easy', 'medium', 'hard'], 'Each difficulty has a description');
    assert.deepEqual(Object.keys(game.keys), ['easy', 'medium', 'hard'], 'Each difficulty lists its keys');
    for (const [level, rows] of Object.entries(game.keys)) {
        const {cols, rows: count} = LEVELS[level];
        assert.equal(rows.length, count, level + ' key rows');
        rows.forEach((row, r) => row.forEach((code, c) => assert.equal(keyToPore(code, cols, count), r * cols + c, level + ' ' + code)));
    }
    assert.ok(game.assets && typeof game.assets.images === 'object' && typeof game.assets.sounds === 'object');
    assert.equal(typeof game.drawBackdrop, 'function');
    assert.equal(typeof game.create, 'function');
});

test('every character uses its Blender render, and the gallery card exists', async () => {
    const {existsSync} = await import('node:fs');
    assert.deepEqual(game.assets.images, {
        germ1: 'germ-1.webp', germ2: 'germ-2.webp', germ3: 'germ-3.webp',
        tough: 'tough.webp', toughCracked: 'tough-cracked.webp', friendly: 'friendly.webp'
    });
    for (const file of [...Object.values(game.assets.images), 'card.webp'])
        assert.ok(existsSync(new URL('../../assets/games/germ-smash/' + file, import.meta.url)), 'missing ' + file);
});

test('every sound the game plays is a Kenney CC0 file on disk, and there is no music loop', async () => {
    const {existsSync} = await import('node:fs');
    assert.deepEqual(game.assets.sounds, {
        pop: 'pop.ogg', thud: 'thud.ogg', buzz: 'buzz.ogg', chime: 'chime.ogg', beep: 'beep.ogg', tick: 'tick.ogg', gameover: 'gameover.ogg'
    });
    for (const file of Object.values(game.assets.sounds))
        assert.ok(existsSync(new URL('../../assets/games/germ-smash/' + file, import.meta.url)), 'missing ' + file);
    assert.equal(game.assets.music, undefined, 'No CC0 loop fits, so the game ships without music');
});
