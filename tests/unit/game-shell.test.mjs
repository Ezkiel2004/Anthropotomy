import test from 'node:test';
import assert from 'node:assert/strict';
import {GAMES, DEFAULT_SETTINGS, loadSettings, saveSettings, makeRng, starsFor, formatTime, saveOutcome, bestScore, boardView, boot, gameEntry, soundUrl, wakeAudio, newRoundId, swipeDirection, gameSettingValue} from '../../assets/js/games/shell.js';
import {STARS} from '../../assets/js/games/germ-smash.js';

const KEY = 'anthropotomy_game_settings';
const store = (stored) => ({getItem: (key) => (key === KEY ? stored : null), setItem() {}});

test('constants match the brief', () => {
    assert.deepEqual(DEFAULT_SETTINGS, {sfx: true, sfxVolume: 80, music: true, musicVolume: 50, reduceMotion: false, vibration: true, games: {}});
    assert.equal(GAMES['germ-smash'].title, 'Germ Smash');
    assert.equal(GAMES['germ-smash'].tagline, 'Smash the germs, spare the good bacteria.');
    assert.equal(GAMES['germ-smash'].card, '../assets/games/germ-smash/card.webp');
    assert.equal(typeof GAMES['germ-smash'].load, 'function');
    assert.equal(typeof boot, 'function');
});

test('loadSettings returns the defaults when storage is empty, missing or unreadable', () => {
    assert.deepEqual(loadSettings(store(null), false), DEFAULT_SETTINGS);
    assert.deepEqual(loadSettings(null, false), DEFAULT_SETTINGS);
    assert.deepEqual(loadSettings(undefined, false), DEFAULT_SETTINGS);
    assert.notEqual(loadSettings(store(null), false), DEFAULT_SETTINGS);
});

test('loadSettings reads the settings key', () => {
    let asked;
    loadSettings({getItem: (key) => { asked = key; return null; }}, false);
    assert.equal(asked, KEY);
});

test('loadSettings merges a partial stored object over the defaults', () => {
    assert.deepEqual(loadSettings(store('{"music":false,"sfxVolume":30}'), false), {...DEFAULT_SETTINGS, music: false, sfxVolume: 30});
});

test('loadSettings defaults reduceMotion to the OS preference only when not stored', () => {
    assert.equal(loadSettings(store(null), true).reduceMotion, true);
    assert.equal(loadSettings(store('{"reduceMotion":false}'), true).reduceMotion, false);
    assert.equal(loadSettings(store('{"reduceMotion":true}'), false).reduceMotion, true);
    assert.equal(loadSettings(store('{"reduceMotion":"yes"}'), true).reduceMotion, true);
});

test('loadSettings rounds and clamps volumes to 0-100 integers', () => {
    assert.equal(loadSettings(store('{"sfxVolume":250}'), false).sfxVolume, 100);
    assert.equal(loadSettings(store('{"sfxVolume":-5}'), false).sfxVolume, 0);
    assert.equal(loadSettings(store('{"musicVolume":42.6}'), false).musicVolume, 43);
    assert.equal(loadSettings(store('{"musicVolume":"loud"}'), false).musicVolume, DEFAULT_SETTINGS.musicVolume);
    assert.equal(loadSettings(store('{"musicVolume":null}'), false).musicVolume, DEFAULT_SETTINGS.musicVolume);
});

test('loadSettings falls back to the default for non-boolean flags', () => {
    const loaded = loadSettings(store('{"sfx":"yes","music":1,"vibration":null}'), false);
    assert.equal(loaded.sfx, true);
    assert.equal(loaded.music, true);
    assert.equal(loaded.vibration, true);
});

test('loadSettings drops unknown stored keys', () => {
    const loaded = loadSettings(store('{"sfx":false,"theme":"dark"}'), false);
    assert.equal(loaded.sfx, false);
    assert.equal('theme' in loaded, false);
});

test('loadSettings returns the defaults when storage throws or holds invalid JSON', () => {
    assert.deepEqual(loadSettings({getItem() { throw new Error('blocked'); }}, false), DEFAULT_SETTINGS);
    assert.deepEqual(loadSettings(store('{bad json'), false), DEFAULT_SETTINGS);
    assert.deepEqual(loadSettings(store('[1,2]'), false), DEFAULT_SETTINGS);
    assert.deepEqual(loadSettings(store('null'), false), DEFAULT_SETTINGS);
});

test('loadSettings still honors the OS motion preference when storage is unusable', () => {
    assert.deepEqual(loadSettings({getItem() { throw new Error('blocked'); }}, true), {...DEFAULT_SETTINGS, reduceMotion: true});
    assert.deepEqual(loadSettings(store('{bad json'), true), {...DEFAULT_SETTINGS, reduceMotion: true});
});

test('saveSettings writes only the known keys and reports success', () => {
    const written = {};
    const storage = {setItem: (key, value) => { written[key] = value; }};
    assert.equal(saveSettings(storage, {...DEFAULT_SETTINGS, sfx: false, extra: 1}), true);
    assert.deepEqual(JSON.parse(written[KEY]), {...DEFAULT_SETTINGS, sfx: false});
});

test('saveSettings returns false when storage is missing or throws', () => {
    assert.equal(saveSettings({setItem() { throw new Error('quota'); }}, DEFAULT_SETTINGS), false);
    assert.equal(saveSettings(null, DEFAULT_SETTINGS), false);
});

test('saved settings load back unchanged', () => {
    const data = {};
    const storage = {getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; }};
    const custom = {sfx: false, sfxVolume: 10, music: false, musicVolume: 90, reduceMotion: true, vibration: false, games: {'cell-runner': {controls: 'buttons'}}};
    saveSettings(storage, custom);
    assert.deepEqual(loadSettings(storage, false), custom);
});

test('makeRng is deterministic and stays in [0, 1)', () => {
    const a = makeRng(1), b = makeRng(1);
    const first = [a(), a(), a()];
    assert.deepEqual(first, [b(), b(), b()]);
    const rng = makeRng(12345);
    for (let i = 0; i < 1000; i++) { const value = rng(); assert.ok(value >= 0 && value < 1); }
});

test('makeRng follows mulberry32 over seed >>> 0', () => {
    let state = 42;
    const reference = () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rng = makeRng(42);
    for (let i = 0; i < 5; i++) assert.equal(rng(), reference());
    assert.equal(makeRng(-1)(), makeRng(0xFFFFFFFF)());
    assert.equal(makeRng(2 ** 32 + 5)(), makeRng(5)());
    assert.notEqual(makeRng(1)(), makeRng(2)());
});

test('starsFor counts the thresholds reached', () => {
    assert.equal(starsFor(299, STARS), 0);
    assert.equal(starsFor(300, STARS), 1);
    assert.equal(starsFor(699, STARS), 1);
    assert.equal(starsFor(700, STARS), 2);
    assert.equal(starsFor(1199, STARS), 2);
    assert.equal(starsFor(1200, STARS), 3);
    assert.equal(starsFor(99999, STARS), 3);
    assert.equal(starsFor(0, STARS), 0);
});

test('formatTime shows whole seconds left as m:ss, rounding up', () => {
    assert.equal(formatTime(60), '1:00');
    assert.equal(formatTime(59.2), '1:00');
    assert.equal(formatTime(59), '0:59');
    assert.equal(formatTime(9.01), '0:10');
    assert.equal(formatTime(0.2), '0:01');
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(-3), '0:00');
    assert.equal(formatTime(125), '2:05');
});

test('saveOutcome: saved on success, retry on network-like failures, refused on any other answer', () => {
    assert.deepEqual(saveOutcome(200, {success: true, data: {points: 12}}), {kind: 'saved', data: {points: 12}});
    assert.deepEqual(saveOutcome(201, {success: true, data: null}), {kind: 'saved', data: null});
    assert.deepEqual(saveOutcome(500, {success: false}), {kind: 'retry'});
    assert.deepEqual(saveOutcome(503, null), {kind: 'retry'});
    assert.deepEqual(saveOutcome(404, null), {kind: 'retry'}, 'a non-JSON refusal never reached plays.php');
    assert.deepEqual(saveOutcome(422, {success: false, message: 'bad'}), {kind: 'refused'});
    assert.deepEqual(saveOutcome(403, {success: false}), {kind: 'refused'});
    assert.deepEqual(saveOutcome(200, {success: false}), {kind: 'refused'});
});

test('saveOutcome: a 2xx answer that is not JSON is saved, never retried (a retry could save the round twice)', () => {
    assert.deepEqual(saveOutcome(200, null), {kind: 'saved', data: null});
    assert.deepEqual(saveOutcome(201, null), {kind: 'saved', data: null});
    assert.deepEqual(saveOutcome(204, null), {kind: 'saved', data: null});
});

test('bestScore: the all-time best once there is a score on record, otherwise null', () => {
    assert.equal(bestScore(null), null, 'teachers get no best');
    assert.equal(bestScore(undefined), null);
    assert.equal(bestScore({all_time: 0, week: null}), null, 'never played: No score yet');
    assert.equal(bestScore({all_time: 0, week: 0}), 0, 'played this week and scored 0');
    assert.equal(bestScore({all_time: 800, week: null}), 800, 'played before this week');
    assert.equal(bestScore({all_time: 800, week: 400}), 800);
});

test('boardView marks the viewer\'s row, or gives their rank when they are outside the list', () => {
    const top = [{rank: 1, user_id: 7, full_name: 'Ana', score: 900}, {rank: 2, user_id: 9, full_name: 'Ben', score: 500}];
    assert.deepEqual(boardView({top, me: {rank: 2, score: 500}}, 9), {
        rows: [{rank: 1, name: 'Ana', score: 900, own: false}, {rank: 2, name: 'Ben', score: 500, own: true}], you: null
    });
    assert.deepEqual(boardView({top, me: {rank: 11, score: 120}}, '4').you, {rank: 11, score: 120}, 'outside the list: one You line');
    assert.equal(boardView({top, me: null}, 4).you, null, 'not ranked: no You line');
    assert.deepEqual(boardView({top, me: null}, null).rows.map(row => row.own), [false, false], 'a teacher has no row of their own');
    assert.deepEqual(boardView({top: [], me: null}, 4), {rows: [], you: null});
});

test('gameEntry finds a game without Object.hasOwn (iOS before 15.4) and ignores inherited keys', () => {
    const saved = Object.hasOwn;
    try {
        delete Object.hasOwn;
        assert.equal(gameEntry('germ-smash').title, 'Germ Smash');
        assert.equal(gameEntry('constructor'), null);
        assert.equal(gameEntry('nope'), null);
    } finally { Object.hasOwn = saved; }
});

test('soundUrl swaps .ogg for the .m4a copy when the browser cannot play Ogg Vorbis', () => {
    assert.equal(soundUrl('../assets/games/germ-smash/', 'pop.ogg', true), '../assets/games/germ-smash/pop.ogg');
    assert.equal(soundUrl('../assets/games/germ-smash/', 'pop.ogg', false), '../assets/games/germ-smash/pop.m4a');
    assert.equal(soundUrl('x/', 'loop.mp3', false), 'x/loop.mp3');
});

test('wakeAudio resumes a suspended or interrupted context and leaves a running one alone', async () => {
    const ctx = state => ({state, resumed: 0, resume() { this.resumed++; return Promise.resolve(); }});
    for (const [state, woke] of [['suspended', true], ['interrupted', true], ['running', false], ['closed', false]]) {
        const c = ctx(state);
        assert.equal(wakeAudio(c), woke, state);
        assert.equal(c.resumed, woke ? 1 : 0, state);
    }
    assert.equal(wakeAudio(null), false);
});

test('newRoundId makes a 32-character lowercase hex id that differs each round', () => {
    const a = newRoundId(), b = newRoundId();
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.notEqual(a, b);
});

test('swipeDirection needs a quick, long, mostly horizontal stroke', () => {
    assert.equal(swipeDirection(40, 5, 200), 'right');
    assert.equal(swipeDirection(-40, 5, 200), 'left');
    assert.equal(swipeDirection(20, 0, 100), null, 'too short');
    assert.equal(swipeDirection(40, 40, 100), null, 'too diagonal');
    assert.equal(swipeDirection(40, 0, 700), null, 'too slow');
});

test('game settings are stored per game and fall back to the declared default', () => {
    const store = value => ({getItem: () => JSON.stringify(value), setItem() {}});
    assert.deepEqual(loadSettings(store({games: {'cell-runner': {controls: 'buttons'}}}), false).games, {'cell-runner': {controls: 'buttons'}});
    assert.deepEqual(loadSettings(store({games: {x: {y: 5}}}), false).games, {x: {}});
    assert.deepEqual(loadSettings(store({games: []}), false).games, {});
    assert.deepEqual(loadSettings(store({}), false).games, {});
    const decl = {key: 'controls', options: [['swipe', 'Swipe'], ['buttons', 'On-screen buttons']], default: 'swipe'};
    assert.equal(gameSettingValue({games: {'cell-runner': {controls: 'buttons'}}}, 'cell-runner', decl), 'buttons');
    assert.equal(gameSettingValue({games: {'cell-runner': {controls: 'joystick'}}}, 'cell-runner', decl), 'swipe');
    assert.equal(gameSettingValue({games: {}}, 'cell-runner', decl), 'swipe');
    let written = null;
    assert.equal(saveSettings({setItem: (k, v) => { written = JSON.parse(v); }}, {...DEFAULT_SETTINGS, games: {'cell-runner': {controls: 'buttons'}}}), true);
    assert.deepEqual(written.games, {'cell-runner': {controls: 'buttons'}});
});
