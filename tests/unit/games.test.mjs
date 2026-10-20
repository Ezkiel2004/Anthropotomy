import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readGlbParts} from '../../tools/build-part-index.mjs';
import {cardKey, baseTerm, systemPool, allSystemsPool, setPool} from '../../assets/js/games/cards.js';
import {cardWeight, pickCards, streaks, DIFFICULTIES, MULTIPLIER} from '../../assets/js/games/runner-core.js';

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
