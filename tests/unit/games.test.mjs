import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readGlbParts} from '../../tools/build-part-index.mjs';
import {cardKey, baseTerm, systemPool, allSystemsPool, setPool} from '../../assets/js/games/cards.js';

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
