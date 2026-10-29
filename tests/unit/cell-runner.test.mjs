import test from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS, STARS, MAX_LIVES, MAX_OXYGEN, GATE_EVERY, SPAWN_Z, INVULNERABLE, deliveryMultiplier, createRun} from '../../assets/js/games/cell-runner.js';

const still = () => 0.99;                       // rows block lane 2 only and never hold a bubble
const lcg = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const put = (run, kind, z, lane = run.state.lane) => run.state.objects.push({id: 1e6 + run.state.objects.length, kind, lane: kind === 'gate' ? null : lane, z, variant: 0, organ: 'heart'});
const clear = run => { run.state.objects.length = 0; };

test('levels, stars and limits match the spec', () => {
    assert.deepEqual(LEVELS.easy, {startSpeed: 12, ramp: 0.15, topSpeed: 30, rowGap: 1.4, twoLane: 0, virusShare: 0.30, bubbleChance: 0.60});
    assert.deepEqual(LEVELS.medium, {startSpeed: 16, ramp: 0.25, topSpeed: 38, rowGap: 1.1, twoLane: 0.25, virusShare: 0.45, bubbleChance: 0.50});
    assert.deepEqual(LEVELS.hard, {startSpeed: 20, ramp: 0.35, topSpeed: 46, rowGap: 0.85, twoLane: 0.45, virusShare: 0.60, bubbleChance: 0.40});
    assert.deepEqual(STARS, [1500, 4000, 8000]);
    assert.deepEqual([MAX_LIVES, MAX_OXYGEN, GATE_EVERY, SPAWN_Z, INVULNERABLE], [3, 5, 400, 120, 1.5]);
});

test('deliveryMultiplier: x1, x2 from the 2nd delivery in a row, x3 from the 4th', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(deliveryMultiplier), [1, 1, 2, 2, 3, 3]);
});

test('speed ramps from the start speed and stops at the top speed', () => {
    const run = createRun('easy', still);
    run.state.invulnerable = 1e9;
    for (let i = 0; i < 400; i++) run.tick(0.5);
    assert.equal(run.state.speed, 30);
    const fresh = createRun('easy', still);
    fresh.tick(0.5);
    assert.ok(Math.abs(fresh.state.speed - (12 + 0.15 * 0.5)) < 1e-9);
});

test('move changes one lane at a time and stops at the edges', () => {
    const run = createRun('easy', still);
    assert.equal(run.state.lane, 1);
    assert.equal(run.move(-1), true); assert.equal(run.state.lane, 0);
    assert.equal(run.move(-1), false); assert.equal(run.state.lane, 0);
    run.move(1); run.move(1);
    assert.equal(run.move(1), false); assert.equal(run.state.lane, 2);
});

test('a hazard in your lane costs a life and starts the invulnerable blink', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    put(run, 'clot', 0.05);
    const events = run.tick(0.02);
    assert.ok(events.some(e => e.type === 'crash'));
    assert.equal(run.state.lives, 2);
    assert.equal(run.state.hits, 1);
    assert.equal(run.state.invulnerable, INVULNERABLE);
});

test('Review Focus 4: a hazard during the blink costs nothing and passes through', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    put(run, 'virus', 0.05);
    run.tick(0.02);
    put(run, 'clot', 0.05);
    const events = run.tick(0.02);
    assert.equal(run.state.lives, 2);
    assert.ok(!events.some(e => e.type === 'crash'));
    assert.equal(run.state.objects.length, 0, 'the hazard is gone once it passed');
});

test('a hazard in another lane is missed', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    put(run, 'clot', 0.05, 0);
    run.tick(0.02);
    assert.equal(run.state.lives, 3);
});

test('bubbles: +20 each, the carry stops at 5, the streak and best combo grow', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    for (let i = 0; i < 7; i++) { put(run, 'bubble', 0.05); run.tick(0.02); }
    assert.equal(run.state.oxygen, MAX_OXYGEN);
    assert.equal(run.state.bubbles, 7);
    assert.equal(run.state.bubblePoints, 140);
    assert.equal(run.state.oxygenStreak, 7);
    assert.equal(run.state.bestCombo, 7);
    put(run, 'clot', 0.05); run.tick(0.02);
    assert.equal(run.state.oxygenStreak, 0);
    assert.equal(run.state.bestCombo, 7);
});

test('deliveries: 100 x oxygen x streak multiplier; an empty gate resets the streak', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    run.state.oxygen = 3; put(run, 'gate', 0.05);
    let deliver = run.tick(0.02).find(e => e.type === 'deliver');
    assert.deepEqual([deliver.value, deliver.multiplier, deliver.oxygen], [300, 1, 3]);
    assert.equal(run.state.oxygen, 0);
    run.state.oxygen = 2; put(run, 'gate', 0.05);
    deliver = run.tick(0.02).find(e => e.type === 'deliver');
    assert.deepEqual([deliver.value, deliver.multiplier], [400, 2]);
    assert.equal(run.state.deliveryPoints, 700);
    put(run, 'gate', 0.05); run.tick(0.02);
    assert.equal(run.state.deliveryStreak, 0, 'a gate passed with no oxygen breaks the streak');
});

test('the score is floor(distance) plus bubble and delivery points', () => {
    const run = createRun('easy', still);
    run.state.invulnerable = 1e9;
    for (let i = 0; i < 100; i++) run.tick(0.05);
    run.state.bubblePoints = 40; run.state.deliveryPoints = 300;
    run.tick(0.05);
    assert.equal(run.state.score, Math.floor(run.state.distance) + 340);
});

test('the run ends at 0 lives, emits end once, then ignores ticks and moves', () => {
    const run = createRun('easy', still);
    run.tick(0.01); clear(run);
    const ends = [];
    for (let i = 0; i < 3; i++) {
        put(run, 'clot', 0.05);
        ends.push(...run.tick(0.02).filter(e => e.type === 'end'));
        run.state.invulnerable = 0;
    }
    assert.equal(run.state.lives, 0);
    assert.equal(run.state.over, true);
    assert.equal(ends.length, 1);
    assert.deepEqual(run.tick(0.5), []);
    assert.equal(run.move(-1), false);
});

test('bad time steps are ignored', () => {
    const run = createRun('easy', still);
    for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(run.tick(dt), []);
    assert.equal(run.state.time, 0);
});

test('a seeded run is deterministic', () => {
    const play = () => {
        const run = createRun('medium', lcg(7));
        for (let i = 0; i < 2000 && !run.state.over; i++) { run.tick(0.05); if (i % 37 === 0) run.move(i % 74 ? 1 : -1); }
        return [run.state.score, run.state.distance, run.state.lives];
    };
    assert.deepEqual(play(), play());
});

test('Review Focus 3: 15 minutes on Hard keeps a free lane, a reachable gap and the score under the server cap', () => {
    const run = createRun('hard', lcg(42));
    let last = null;
    for (let i = 0; i < 18000; i++) {
        run.state.invulnerable = 1e9;
        for (const e of run.tick(0.05)) {
            if (e.type !== 'spawn' || e.kind !== 'row') continue;
            assert.ok(e.blocked.length >= 1 && e.blocked.length <= 2, 'a row never blocks all three lanes');
            if (last) assert.ok(e.at - last.at >= LEVELS.hard.rowGap * last.speed - 0.5, 'rows are a reachable gap apart');
            last = e;
        }
    }
    assert.ok(run.state.time >= 899);
    assert.ok(run.state.score < 250000);
    const best = 46 * 900 + Math.ceil((46 * 900) / GATE_EVERY) * 100 * MAX_OXYGEN * 3 + Math.ceil(900 / LEVELS.hard.rowGap) * 20;
    assert.ok(best < 250000, 'even a perfect 15-minute Hard run fits under the cap');
});

test('Easy never blocks two lanes', () => {
    const run = createRun('easy', lcg(3));
    for (let i = 0; i < 4000; i++) {
        run.state.invulnerable = 1e9;
        for (const e of run.tick(0.05)) if (e.type === 'spawn' && e.kind === 'row') assert.equal(e.blocked.length, 1);
    }
});

test('the default export follows the game module contract', async () => {
    const {default: game} = await import('../../assets/js/games/cell-runner.js');
    const {readFile} = await import('node:fs/promises');
    const sprite = await readFile(new URL('../../assets/icons/interface.svg', import.meta.url), 'utf8');
    assert.equal(game.key, 'cell-runner');
    assert.equal(game.title, 'Cell Runner');
    assert.equal(game.tagline, 'Race through the bloodstream and deliver oxygen.');
    assert.equal(game.roundSeconds, null, 'endless');
    assert.equal(game.maxLives, MAX_LIVES);
    assert.deepEqual(game.touchButtons, ['left', 'right']);
    assert.deepEqual(game.settings, [{key: 'controls', label: 'Controls', options: [['swipe', 'Swipe'], ['buttons', 'On-screen buttons']], default: 'swipe'}]);
    assert.equal(game.stars, STARS);
    assert.deepEqual(Object.keys(game.levels), ['easy', 'medium', 'hard']);
    assert.equal(game.howToPlay.length, 4);
    for (const step of game.howToPlay) assert.ok(sprite.includes(`<symbol id="${step.icon}"`), 'How to Play icon is in the sprite: ' + step.icon);
    for (const name of ['germ1', 'germ2', 'germ3', 'heart', 'lungs', 'kidney', 'brain']) assert.ok(game.assets.images[name], 'image ' + name);
    assert.equal(typeof game.create, 'function');
    assert.equal(typeof game.drawBackdrop, 'function');
});

test('the cell, clot and card art and the 6 sounds are on disk, each sound with an .m4a copy for iPhones', async () => {
    const {default: game} = await import('../../assets/js/games/cell-runner.js');
    const {existsSync} = await import('node:fs');
    const dir = new URL('../../assets/games/cell-runner/', import.meta.url);
    assert.equal(game.assets.images.cell, 'cell.webp');
    assert.equal(game.assets.images.clot, 'clot.webp');
    assert.deepEqual(game.assets.sounds, {move: 'move.ogg', bubble: 'bubble.ogg', crash: 'crash.ogg', deliver: 'deliver.ogg', beep: 'beep.ogg', gameover: 'gameover.ogg'});
    for (const file of [...Object.values(game.assets.images), 'card.webp']) assert.ok(existsSync(new URL(file, dir)), 'image ' + file);
    for (const file of Object.values(game.assets.sounds)) {
        assert.ok(existsSync(new URL(file, dir)), 'sound ' + file);
        assert.ok(existsSync(new URL(file.replace(/\.ogg$/, '.m4a'), dir)), 'iPhone copy of ' + file);
    }
});
