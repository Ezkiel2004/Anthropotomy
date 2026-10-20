import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readGlbParts} from '../../tools/build-part-index.mjs';
import {cardKey, baseTerm, systemPool, allSystemsPool, setPool} from '../../assets/js/games/cards.js';
import {cardWeight, pickCards, streaks, normalizeAnswer, scrambleWords, DIFFICULTIES, MULTIPLIER} from '../../assets/js/games/runner-core.js';
import {games, gameByKey} from '../../assets/js/games/registry.js';
import {startRound} from '../../assets/js/games/play-kit.js';

test('readGlbParts returns described parts from a layer GLB', () => {
    const parts = readGlbParts(fs.readFileSync('system_model/layers/endocrine.glb'));
    assert.equal(parts.length, 8);
    assert.ok(parts.every(p => p.id.startsWith('za_') && p.name && p.description));
    assert.ok(parts.some(p => p.id === 'za_adenohypophysis' && p.name === 'Adenohypophysis'));
});

const sys = {system_code:'skeletal', system_name:'Skeletal System', structures:[]};
const parts = [{id:'za_femur_l',name:'Femur (left)',description:'The femur is the thigh bone. It is long.'},
               {id:'za_femur_r',name:'Femur (right)',description:'The femur is the thigh bone. It is long.'},
               {id:'za_patella',name:'Patella',description:'Kneecap.'}];
test('cardKey lowercases, trims and caps at 200', () => {
    assert.equal(cardKey('sys:skeletal', '  Femur '), 'sys:skeletal:femur');
    assert.equal(cardKey('set:3', 'x'.repeat(300)).length, 200);
});
test('baseTerm removes a trailing left or right marker', () => {
    assert.equal(baseTerm('Femur (left)'), 'Femur');
    assert.equal(baseTerm('Femur (right)'), 'Femur');
    assert.equal(baseTerm('Patella'), 'Patella');
});
test('systemPool merges left/right and keeps the first sentence', () => {
    const pool = systemPool(sys, parts);
    assert.deepEqual(pool.map(c => c.term), ['Femur', 'Patella']);
    assert.equal(pool[0].clue, 'The femur is the thigh bone.');
    assert.equal(pool[0].group, 'Skeletal System');
    assert.equal(pool[0].key, 'sys:skeletal:femur');
    assert.equal(pool[0].mesh, null);
});
test('systemPool keeps sided parts with mesh for 3D Hunt', () => {
    assert.deepEqual(systemPool(sys, parts, {sided:true}).map(c => c.mesh), ['za_femur_l','za_femur_r','za_patella']);
    assert.deepEqual(systemPool(sys, parts, {sided:true}).map(c => c.term), ['Femur (left)','Femur (right)','Patella']);
});
test('curated structures replace the part index at 4 or more', () => {
    const curated = {...sys, structures:['A','B','C','D'].map(n => ({name:n, desc:n+' desc. More.', mesh_name:''}))};
    const pool = systemPool(curated, parts);
    assert.deepEqual(pool.map(c => c.term), ['A','B','C','D']);
    assert.equal(pool[0].clue, 'A desc.');
    assert.equal(pool[0].mesh, null);
    assert.equal(systemPool({...sys, structures: curated.structures.slice(0,3)}, parts).length, 2);
});
test('curated structures keep mesh_name and drop blank or repeated names', () => {
    const structures = [{name:'A',desc:'a.',mesh_name:'m_a'},{name:' ',desc:'x.'},{name:'a',desc:'dup.'},{name:'B',desc:'b.'},{name:'C',desc:'c.'},{name:'D',desc:'d.'}];
    const pool = systemPool({...sys, structures}, parts);
    assert.deepEqual(pool.map(c => c.term), ['A','B','C','D']);
    assert.equal(pool[0].mesh, 'm_a');
    assert.equal(systemPool({...sys, structures: structures.slice(0,3)}, parts).length, 2);
});
test('systemPool handles missing parts', () => {
    assert.deepEqual(systemPool(sys, undefined), []);
});
test('allSystemsPool concatenates every system pool', () => {
    const systems = [sys, {system_code:'muscular', system_name:'Muscular System', structures:[]}];
    const pool = allSystemsPool(systems, {skeletal: parts, muscular: [{id:'za_biceps',name:'Biceps',description:'Flexes the elbow.'}]});
    assert.deepEqual(pool.map(c => c.term), ['Femur','Patella','Biceps']);
    assert.deepEqual(pool.map(c => c.group), ['Skeletal System','Skeletal System','Muscular System']);
});
test('setPool groups by card group, then the set system, then none', () => {
    const pool = setPool({set_id:3, system_name:'Skeletal System', cards:[{term:'Femur',clue:'Thigh'},{term:'Heart',clue:'Pump',group:'Circulatory'}]});
    assert.deepEqual(pool.map(c => [c.key, c.group]), [['set:3:femur','Skeletal System'],['set:3:heart','Circulatory']]);
    assert.equal(setPool({set_id:4, cards:[{term:'X',clue:'Y'}]})[0].group, null);
});
test('setPool uses the clue as given and mesh or null', () => {
    const [a, b] = setPool({set_id:5, cards:[{term:'A',clue:'One. Two.',mesh:'m'},{term:'B',clue:'Three.'}]});
    assert.equal(a.clue, 'One. Two.');
    assert.equal(a.mesh, 'm');
    assert.equal(b.mesh, null);
});
test('sided pools use curated structures only when 4 or more have a mesh_name', () => {
    const bare = {...sys, structures:['A','B','C','D'].map(n => ({name:n, desc:n+' desc.', mesh_name:''}))};
    assert.deepEqual(systemPool(bare, parts, {sided:true}).map(c => c.mesh), ['za_femur_l','za_femur_r','za_patella']);
    const meshed = {...sys, structures:['A','B','C','D'].map(n => ({name:n, desc:n+' desc.', mesh_name:'m_'+n}))};
    const pool = systemPool(meshed, parts, {sided:true});
    assert.deepEqual(pool.map(c => [c.term, c.mesh]), [['A','m_A'],['B','m_B'],['C','m_C'],['D','m_D']]);
    const mixed = {...sys, structures:[...meshed.structures, {name:'E', desc:'E desc.', mesh_name:''}]};
    assert.deepEqual(systemPool(mixed, parts, {sided:true}).map(c => c.term), ['A','B','C','D']);
    assert.equal(systemPool(mixed, parts).length, 5);
    const fewMeshes = {...sys, structures:[...meshed.structures.slice(0,3), {name:'E', desc:'E desc.', mesh_name:''}]};
    assert.deepEqual(systemPool(fewMeshes, parts, {sided:true}).map(c => c.mesh), ['za_femur_l','za_femur_r','za_patella']);
});

test('pickCards never repeats a term and respects n', () => {
    const pool = [{key:'a',term:'Femur'},{key:'b',term:'femur'},{key:'c',term:'Tibia'},{key:'d',term:'Ulna'}];
    const picked = pickCards(pool, 3, {}, () => 0.5);
    assert.equal(new Set(picked.map(c => c.term.toLowerCase())).size, picked.length);
    assert.ok(picked.length <= 3);
});
test('pickCards returns fewer than n for a short pool and never throws on an empty one', () => {
    const pool = [{key:'a',term:'Femur'},{key:'b',term:'FEMUR'},{key:'c',term:'Tibia'}];
    assert.equal(pickCards(pool, 5).length, 2);
    assert.deepEqual(pickCards([], 4), []);
    assert.deepEqual(pickCards(pool, 0), []);
});
test('pickCards favours missed cards over known ones', () => {
    const pool = ['a','b','c','d'].map(k => ({key:k, term:k.toUpperCase()}));
    const stats = {a:[3,1], b:[2,2], c:[2,2], d:[2,2]};
    let seed = 7;
    const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let missedFirst = 0;
    for (let i = 0; i < 400; i++) if (pickCards(pool, 1, stats, rng)[0].key === 'a') missedFirst++;
    assert.ok(missedFirst > 400 * 0.4, 'a missed card should win well above the 25% of an even pick');
});
test('missed cards are weighted above unseen above known', () => {
    assert.equal(cardWeight({key:'a'}, {a:[3,1]}), 3);
    assert.equal(cardWeight({key:'a'}, {}), 2);
    assert.equal(cardWeight({key:'a'}, {a:[2,2]}), 1);
});
test('streaks finds the longest run', () => {
    assert.equal(streaks([true,true,false,true,true,true]), 3);
    assert.equal(streaks([]), 0);
    assert.equal(streaks([false,false]), 0);
});
test('difficulty constants', () => {
    assert.deepEqual(DIFFICULTIES, ['easy','medium','hard']);
    assert.deepEqual(MULTIPLIER, {easy:1, medium:1.5, hard:2});
});

// Task 7: the four DOM games (levels, availability, Sort It's choose) and the pure round plumbing.
const cards = n => Array.from({length:n}, (_, i) => ({key:'k'+i, term:'Term'+String.fromCharCode(65+i), clue:'c', group:i%2?'G1':'G2', mesh:null}));
const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
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
test('the registry lists the four games in the spec order and finds them by key', () => {
    assert.deepEqual(games.map(g => [g.key, g.name, g.icon]), [
        ['match-pairs', 'Match Pairs', 'stack'], ['sort-it', 'Sort It', 'hand-grabbing'],
        ['beat-the-clock', 'Beat the Clock', 'clock'], ['unscramble', 'Unscramble', 'textbox']]);
    assert.equal(gameByKey('sort-it'), games[1]);
    assert.equal(gameByKey('nope'), null);
    for (const g of games) assert.equal(typeof g.play, 'function');
});
test('levels match the difficulty table', () => {
    assert.deepEqual(gameByKey('match-pairs').levels, {easy:{roundSize:4, previewSec:3}, medium:{roundSize:6}, hard:{roundSize:8, limitSec:90}});
    assert.deepEqual(gameByKey('sort-it').levels, {easy:{roundSize:6, maxBins:2}, medium:{roundSize:10, maxBins:3}, hard:{roundSize:14, maxBins:5, limitSec:60}});
    assert.deepEqual(gameByKey('beat-the-clock').levels, {easy:{roundSize:6, choices:3, perCardSec:12}, medium:{roundSize:10, choices:4, perCardSec:8}, hard:{roundSize:12, choices:5, perCardSec:5}});
    assert.deepEqual(gameByKey('unscramble').levels, {easy:{roundSize:6, firstLetter:true}, medium:{roundSize:8}, hard:{roundSize:10, perCardSec:20}});
});
test('match pairs and beat the clock count distinct terms only', () => {
    const dupes = [...cards(3), ...cards(3).map(c => ({...c, key:c.key + 'x', term:c.term.toUpperCase()}))];
    const mp = gameByKey('match-pairs'), btc = gameByKey('beat-the-clock');
    assert.equal(mp.available(dupes, mp.levels.easy), false);          // 3 distinct terms < 4
    assert.equal(btc.available(dupes, btc.levels.easy), true);         // 3 choices
    assert.equal(btc.available(dupes, btc.levels.medium), false);      // 4 choices
    assert.equal(mp.available([], mp.levels.easy), false);
    assert.equal(mp.available(undefined, mp.levels.easy), false);
});
test('sort it needs two groups and enough grouped cards, ignoring cards without a group', () => {
    const sort = gameByKey('sort-it');
    assert.equal(sort.available(cards(6), sort.levels.easy), true);
    assert.equal(sort.available(cards(5), sort.levels.easy), false);                       // 5 < 6
    assert.equal(sort.available(cards(6).map((c, i) => i < 2 ? {...c, group:null} : c), sort.levels.easy), false);   // 4 grouped
    assert.equal(sort.available(cards(7).map((c, i) => i ? {...c, group:'G1'} : {...c, group:null}), sort.levels.easy), false);   // one group left
});
test('unscramble counts only terms of 4 to 20 letters, letters only', () => {
    const un = gameByKey('unscramble');
    const terms = t => t.map(term => ({term}));
    const five = ['Vena cava', 'Biceps brachii', 'Ulna', 'Femur', 'Tibia'];
    assert.equal(un.available(terms([...five, 'Rib']), un.levels.easy), false);      // 3 letters
    assert.equal(un.available(terms([...five, 'Ab-c']), un.levels.easy), false);     // the hyphen is not a letter: 3 letters
    assert.equal(un.available(terms([...five, 'Abcd']), un.levels.easy), true);
    assert.equal(un.available(terms([...five, 'a'.repeat(21)]), un.levels.easy), false);
    assert.equal(un.available(terms([...five, 'a'.repeat(20)]), un.levels.easy), true);
    assert.equal(un.available(terms([...five, 'Pre-central gyrus']), un.levels.easy), true);   // 15 letters
    assert.equal(un.available(terms([...five, 'FEMUR']), un.levels.easy), false);    // repeated term
    assert.equal(un.available(terms([...five, 'Ünïcode']), un.levels.easy), true);
});
test('normalizeAnswer lowercases, trims and collapses whitespace', () => {
    assert.equal(normalizeAnswer('  Biceps \t\n BRACHII '), 'biceps brachii');
    assert.equal(normalizeAnswer(''), '');
    assert.equal(normalizeAnswer(null), '');
    assert.equal(normalizeAnswer(undefined), '');
});
test('scrambleWords shuffles letters inside each word and leaves spaces and hyphens in place', () => {
    const isLetter = ch => /\p{L}/u.test(ch);
    const words = s => s.split(/[\s-]+/).map(w => [...w].filter(isLetter).sort().join(''));
    for (const term of ['Femur', 'Vena cava', 'Biceps brachii', 'Pre-central gyrus', "Golgi's organ (tendon)"]) {
        for (let seed = 1; seed < 40; seed++) {
            const out = scrambleWords(term, seeded(seed));
            assert.equal(out.length, term.length, term);
            assert.deepEqual(words(out), words(term), term);
            [...term].forEach((ch, i) => { if (!isLetter(ch)) assert.equal(out[i], ch, `${term} @${i}`); });
            assert.notEqual(out.toLowerCase(), term.toLowerCase(), term);
        }
    }
});
test('scrambleWords never hands back the term when it can be changed, whatever the rng says', () => {
    for (const rng of [() => 0, () => 0.5, () => 0.9999]) {
        for (const term of ['Ulna', 'Vena cava', 'Ab-cd']) assert.notEqual(scrambleWords(term, rng).toLowerCase(), term.toLowerCase());
    }
    assert.equal(scrambleWords('Aaaa', () => 0.5), 'Aaaa');        // nothing to shuffle
    assert.equal(scrambleWords('', () => 0.5), '');
    assert.equal(typeof scrambleWords('Radius'), 'string');         // rng defaults to Math.random
});

const sixGroups = () => Array.from({length:30}, (_, i) => ({key:'p'+i, term:'Term'+i, clue:'c', group:'Group'+(i%6), mesh:null}));
test('sort it chooses cards from at most maxBins groups', () => {
    const sort = gameByKey('sort-it');
    for (let seed = 1; seed < 30; seed++) {
        const picked = sort.choose(sixGroups(), sort.levels.easy, {}, seeded(seed));
        assert.ok(picked.length <= 6 && picked.length > 0);
        assert.ok(picked.every(c => c.group != null));
        assert.ok(new Set(picked.map(c => c.group)).size <= 2);
    }
    const hard = sort.choose(sixGroups(), sort.levels.hard, {}, seeded(3));
    assert.ok(new Set(hard.map(c => c.group)).size <= 5);
    assert.ok(hard.length <= 14);
});
test('sort it choose ignores ungrouped cards, avoids repeated terms and copes with few groups', () => {
    const sort = gameByKey('sort-it');
    const pool = [...sixGroups().slice(0, 12), ...Array.from({length:6}, (_, i) => ({key:'n'+i, term:'None'+i, clue:'c', group:null, mesh:null}))];
    for (let seed = 1; seed < 20; seed++) {
        const picked = sort.choose(pool, sort.levels.medium, {}, seeded(seed));
        assert.ok(picked.every(c => c.group));
        assert.equal(new Set(picked.map(c => c.term)).size, picked.length);
        assert.ok(new Set(picked.map(c => c.group)).size <= 3);
    }
    const one = sixGroups().map(c => ({...c, group:'Only'}));
    assert.deepEqual(new Set(sort.choose(one, sort.levels.easy, {}, seeded(1)).map(c => c.group)), new Set(['Only']));
    assert.deepEqual(sort.choose([], sort.levels.easy, {}, seeded(1)), []);
    assert.deepEqual(sort.choose(undefined, sort.levels.easy), []);
});
test('only sort it needs its own card choice', () => {
    assert.deepEqual(games.filter(g => g.choose).map(g => g.key), ['sort-it']);
});

// startRound is the plumbing every play() shares: report once, resolve on the last card or on the limit.
const fakeRoot = () => ({textContent:'x'});
test('a round reports each card once and resolves when every card is reported', async () => {
    const list = cards(3), seen = [], root = fakeRoot();
    const round = startRound(root, list, (card, ok) => seen.push([card.key, ok]));
    root.textContent = 'game on screen';
    assert.equal(round.report(list[0], true), true);
    assert.equal(round.report(list[0], false), false);          // already reported
    assert.equal(round.report({key:'stranger'}, true), false);  // not in the round
    assert.equal(round.isOver(), false);
    round.report(list[1], false);
    round.report(list[2], 1);
    await round.done;
    assert.deepEqual(seen, [['k0', true], ['k1', false], ['k2', true]]);
    assert.equal(round.isOver(), true);
    assert.equal(root.textContent, '');
    assert.equal(round.report(list[0], true), false);           // nothing after the end
    assert.equal(seen.length, 3);
});
test('ending a round early reports every unreported card as missed, once', async () => {
    const list = cards(4), seen = [];
    const round = startRound(fakeRoot(), list, (card, ok) => seen.push([card.key, ok]));
    round.report(list[2], true);
    round.end();
    round.end();
    await round.done;
    assert.deepEqual(seen, [['k2', true], ['k0', false], ['k1', false], ['k3', false]]);
});
test('a round with no cards resolves at once', async () => {
    const root = fakeRoot();
    const round = startRound(root, [], () => assert.fail('nothing to report'));
    assert.equal(round.isOver(), true);
    await round.done;
    assert.equal(root.textContent, '');         // startRound empties the root it is given
});
test('a limit countdown ends the round and misses what is left; timers and listeners stop with the round', async () => {
    const list = cards(3), seen = [], ticks = [];
    const round = startRound(fakeRoot(), list, (card, ok) => seen.push([card.key, ok]));
    const target = new EventTarget();
    round.listen(target, 'ping', () => ticks.push('ping'));
    round.later(() => ticks.push('never'), 400);
    round.report(list[0], true);
    round.countdown(0.05, () => round.end());
    await round.done;
    assert.deepEqual(seen, [['k0', true], ['k1', false], ['k2', false]]);
    target.dispatchEvent(new Event('ping'));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.deepEqual(ticks, []);
});
test('the last report can linger so feedback stays on screen', async () => {
    const list = cards(1), seen = [];
    const root = fakeRoot();
    const round = startRound(root, list, (card, ok) => seen.push(ok));
    root.textContent = 'game on screen';
    const started = Date.now();
    round.report(list[0], true, 60);
    assert.equal(round.isOver(), false);
    assert.equal(root.textContent, 'game on screen');
    await round.done;
    assert.equal(root.textContent, '');
    assert.ok(Date.now() - started >= 50);
    assert.deepEqual(seen, [true]);
});
