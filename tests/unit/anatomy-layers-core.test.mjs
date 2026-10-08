import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../../assets/js/anatomy-layers-core.js');

const node = (userData = {}, parent = null, name = '') => ({userData, parent, name});

test('resolvePart walks up to the object carrying part_id', () => {
    const part = node({part_id: 'anatomy_00001'});
    const child = node({}, part);
    assert.equal(core.resolvePart(child), part);
    assert.equal(core.resolvePart(node({})), null);
});

test('pickPart prefers the focused part, otherwise the nearest part', () => {
    const near = node({part_id: 'a'}), far = node({part_id: 'b'});
    const hits = [{object: node({})}, {object: near}, {object: far}];
    assert.equal(core.pickPart(hits, null), near);
    assert.equal(core.pickPart(hits, 'b'), far);
    assert.equal(core.pickPart([], 'b'), null);
});

test('partInfo marks unidentified parts and never invents content', () => {
    const info = core.partInfo({name: 'Bone component 00123', system_id: 'skeletal', systems: ['skeletal'], identity_status: 'source_identity_required', description: '', function: ''}, {skeletal: 'Skeletal System'});
    assert.equal(info.title, 'Bone component 00123');
    assert.equal(info.systemName, 'Skeletal System');
    assert.equal(info.unidentified, true);
    assert.equal(info.description, core.UNIDENTIFIED_TEXT);
    assert.equal(info.func, '');
    assert.deepEqual(info.alsoPartOf, []);
});

test('partInfo shows identified content, shared systems and safe references only', () => {
    const data = {name: 'Bulbospongiosus', system_id: 'muscular', systems: ['muscular', 'reproductive'], identity_status: 'visual_identification_requires_review', description: 'Wraps the bulb.', function: 'Compresses the urethra.', reference: 'https://openstax.org/x'};
    const info = core.partInfo(data, {muscular: 'Muscular System', reproductive: 'Reproductive System'});
    assert.equal(info.unidentified, false);
    assert.equal(info.description, 'Wraps the bulb.');
    assert.equal(info.func, 'Compresses the urethra.');
    assert.deepEqual(info.alsoPartOf, ['Reproductive System']);
    assert.equal(info.reference, 'https://openstax.org/x');
    assert.equal(core.partInfo({...data, reference: 'javascript:alert(1)'}, {}).reference, '');
});

test('a teacher structure overrides the part name and description', () => {
    const info = core.partInfo({name: 'Bone component 7', system_id: 'skeletal', identity_status: 'source_identity_required'}, {}, {name: 'Femur', desc: 'Thigh bone.'});
    assert.equal(info.title, 'Femur');
    assert.equal(info.description, 'Thigh bone.');
    assert.equal(info.unidentified, false);
});

test('matchStructure matches part ID, node name or parent name', () => {
    const parent = node({}, null, 'Group_7');
    const part = node({part_id: 'anatomy_00848'}, parent, 'Urethra_|_anatomy_00848');
    const structures = [{name: 'A', mesh_name: ''}, {name: 'Urethra', mesh_name: 'anatomy_00848'}];
    assert.equal(core.matchStructure(structures, part).name, 'Urethra');
    assert.equal(core.matchStructure([{name: 'G', mesh_name: 'Group_7'}], part).name, 'G');
    assert.equal(core.matchStructure([{name: 'X', mesh_name: 'nope'}], part), null);
    assert.equal(core.matchStructure(undefined, part), null);
});

test('toggleStatus reports model, loading and error states', () => {
    assert.equal(core.toggleStatus({modelUrl: ''}, null), 'No 3D model yet');
    assert.equal(core.toggleStatus({modelUrl: 'a.glb'}, {status: 'loading', progress: 45}), 'Loading 45%');
    assert.equal(core.toggleStatus({modelUrl: 'a.glb'}, {status: 'loading', progress: null}), 'Loading…');
    assert.equal(core.toggleStatus({modelUrl: 'a.glb'}, {status: 'error'}), "Couldn't load — select to retry");
    assert.equal(core.toggleStatus({modelUrl: 'a.glb'}, {status: 'ready'}), '');
    assert.equal(core.toggleStatus({modelUrl: 'a.glb'}, null), '');
});

test('fitDistance frames a sphere inside the narrower field of view', () => {
    const d = core.fitDistance(1, 40, 1, 1);
    assert.ok(Math.abs(d - 1 / Math.sin(20 * Math.PI / 180)) < 1e-9);
    assert.ok(core.fitDistance(1, 40, 0.5, 1) > d, 'a narrow viewport needs more distance');
});

test('contextAfterDisable falls back to the most recently enabled system', () => {
    assert.equal(core.contextAfterDisable(['skeletal', 'muscular'], 'muscular', 'muscular'), 'skeletal');
    assert.equal(core.contextAfterDisable(['skeletal', 'muscular'], 'muscular', 'skeletal'), 'skeletal');
    assert.equal(core.contextAfterDisable(['skeletal'], 'skeletal', 'skeletal'), 'skeletal');
});

test('easeInOutCubic starts at 0, ends at 1 and is symmetric', () => {
    assert.equal(core.easeInOutCubic(0), 0);
    assert.equal(core.easeInOutCubic(1), 1);
    assert.ok(Math.abs(core.easeInOutCubic(0.5) - 0.5) < 1e-12);
});

test('distanceLimits scales with the model diagonal', () => {
    assert.deepEqual(core.distanceLimits(2), {min: 0.04, max: 8});
    assert.deepEqual(core.distanceLimits(0), {min: 0.02, max: 4});
    assert.deepEqual(core.distanceLimits(NaN), {min: 0.02, max: 4});
});

test('only hovering adds a glow; a selected part keeps its own colour', () => {
    assert.deepEqual(core.glowFor('hover'), {color: 0x1d6f6a, intensity: 1});
    assert.equal(core.glowFor('focus'), null);
    assert.equal(core.glowFor('ghost'), null);
    assert.equal(core.glowFor(null), null);
});

test('materialLook gives each layered system its surface finish', () => {
    assert.deepEqual(core.materialLook('skeletal'), {roughness: 0.8, metalness: 0, colorScale: 1});
    assert.deepEqual(core.materialLook('muscular'), {roughness: 0.5, metalness: 0, colorScale: 0.65});
    assert.equal(core.materialLook('circulatory').roughness, 0.35);
    for (const id of ['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'lymphatic']) assert.equal(core.materialLook(id).roughness, 0.4, id);
    assert.deepEqual(core.materialLook('unknown-system'), {roughness: 0.6, metalness: 0, colorScale: 1});
});
