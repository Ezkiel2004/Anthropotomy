import test from 'node:test';
import assert from 'node:assert/strict';
import {firstSentence, splitLinks, safeUrl, saveFileName, shortcutAction, panelDefault, stageState} from '../../assets/js/explorer/format.js';

test('firstSentence stops at the first sentence end', () => {
    assert.equal(firstSentence('Bones support the body. They also store minerals.'), 'Bones support the body.');
    assert.equal(firstSentence('No full stop here'), 'No full stop here');
    assert.equal(firstSentence(''), '');
});

test('splitLinks keeps punctuation and parentheses out of URLs', () => {
    const text = '3D model: Z-Anatomy (https://github.com/LluisV/Z-Anatomy), licensed CC BY-SA 4.0.';
    assert.deepEqual(splitLinks(text), [
        {text: '3D model: Z-Anatomy ('},
        {text: 'https://github.com/LluisV/Z-Anatomy', href: 'https://github.com/LluisV/Z-Anatomy'},
        {text: '), licensed CC BY-SA 4.0.'}
    ]);
    assert.deepEqual(splitLinks('See https://openstax.org/books.'), [{text: 'See '}, {text: 'https://openstax.org/books', href: 'https://openstax.org/books'}, {text: '.'}]);
    assert.deepEqual(splitLinks('No links'), [{text: 'No links'}]);
    assert.deepEqual(splitLinks(''), []);
});

test('safeUrl accepts only http and https', () => {
    assert.equal(safeUrl('https://openstax.org/x'), 'https://openstax.org/x');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('not a url'), null);
    assert.equal(safeUrl(undefined), null);
});

test('saveFileName uses the system code and local date', () => {
    assert.equal(saveFileName('nervous', new Date(2026, 9, 8)), 'anatomy-nervous-20261008.png');
    assert.equal(saveFileName('', new Date(2026, 0, 5)), 'anatomy-view-20260105.png');
});

test('shortcutAction maps keys and ignores typing, modifiers and toggle repeats', () => {
    const key = (k, extra = {}) => shortcutAction({key: k, target: {tagName: 'BODY'}, ...extra});
    assert.equal(key('+'), 'zoom-in');
    assert.equal(key('='), 'zoom-in');
    assert.equal(key('-'), 'zoom-out');
    assert.deepEqual(['r', 'R', 'a', 'f', 'i', 's'].map(k => key(k)), ['reset', 'reset', 'rotate', 'fullscreen', 'info', 'save']);
    assert.equal(key('+', {repeat: true}), 'zoom-in');
    assert.equal(key('f', {repeat: true}), null);
    assert.equal(key('r', {ctrlKey: true}), null);
    assert.equal(key('s', {metaKey: true}), null);
    assert.equal(key('i', {altKey: true}), null);
    assert.equal(key('r', {target: {tagName: 'INPUT'}}), null);
    assert.equal(key('r', {target: {tagName: 'TEXTAREA'}}), null);
    assert.equal(key('r', {target: {tagName: 'SELECT'}}), null);
    assert.equal(key('r', {target: {tagName: 'DIV', isContentEditable: true}}), null);
    assert.equal(key('x'), null);
});

test('panelDefault trusts only "1" and "0"', () => {
    assert.equal(panelDefault('1', false), true);
    assert.equal(panelDefault('0', true), false);
    for (const value of [null, '', 'true', 'open']) {
        assert.equal(panelDefault(value, true), true);
        assert.equal(panelDefault(value, false), false);
    }
});

test('stageState picks the overlay in priority order', () => {
    const base = {viewerReady: true, hasVisible: false, loading: null, contextHasModel: true, failedId: null};
    assert.equal(stageState({...base, viewerReady: false}).kind, 'unavailable');
    assert.deepEqual(stageState({...base, hasVisible: true}), {kind: 'ready', message: ''});
    assert.equal(stageState({...base, loading: {progress: 45}}).message, 'Loading model: 45%');
    assert.equal(stageState({...base, loading: {progress: null}}).message, 'Loading model…');
    assert.equal(stageState({...base, contextHasModel: false}).message, 'No 3D model has been added for this system. You can read the available content alongside the viewer.');
    assert.deepEqual(stageState({...base, failedId: 'muscular'}), {kind: 'error', message: "The model couldn't be loaded.", retryId: 'muscular'});
    assert.deepEqual(stageState(base), {kind: 'idle', message: 'Switch on a body system to begin.'});
});

import {systems, mergeSystem} from '../../assets/js/explorer/data.js';

const db = (over = {}) => ({id: 'skeletal', system_id: 1, name: 'Skeletal System', isActive: true, color: '#f59e0b', description: '', keyFacts: {}, structures: [], modelUrl: '../system_model/layers/skeletal.glb', source: 'Credit (https://example.org).', ...over});

test('data.js covers the ten database systems with complete entries', () => {
    assert.deepEqual(systems.map(s => s.id).sort(), ['circulatory', 'digestive', 'endocrine', 'lymphatic', 'muscular', 'nervous', 'reproductive', 'respiratory', 'skeletal', 'urinary']);
    for (const s of systems) {
        assert.ok(s.summary && s.description, s.id + ' has text');
        assert.ok(s.functions.length >= 3, s.id + ' functions');
        assert.ok(s.trivia.length >= 3, s.id + ' trivia');
        assert.ok(s.sources.length >= 1 && s.sources.every(x => x.title && /^https:\/\/openstax\.org\//.test(x.url)), s.id + ' sources');
    }
});

test('mergeSystem lets the database win and maps structures', () => {
    const merged = mergeSystem(db({description: 'Teacher text. More.', keyFacts: {Bones: '206'}, structures: [{name: 'Femur', desc: 'Thigh bone.', mesh_name: 'anatomy_00848'}, {name: 'Skull', desc: ''}]}));
    assert.equal(merged.description, 'Teacher text. More.');
    assert.deepEqual(merged.structures, [{id: 'anatomy_00848', name: 'Femur', meshName: 'anatomy_00848', description: 'Thigh bone.'}, {id: 'structure-1', name: 'Skull', meshName: '', description: ''}]);
    assert.equal(merged.trivia.at(-1), 'Bones: 206');
    assert.equal(merged.sourceNote, 'Credit (https://example.org).');
    assert.equal(merged.modelUrl, '../system_model/layers/skeletal.glb');
    assert.ok(merged.functions.length >= 3);
});

test('mergeSystem falls back to static text and tolerates unknown systems', () => {
    const skeletal = systems.find(s => s.id === 'skeletal');
    assert.equal(mergeSystem(db({description: '  '})).description, skeletal.description);
    const unknown = mergeSystem(db({id: 'test-system', description: 'Database description. Second.', modelUrl: null, source: ''}));
    assert.equal(unknown.summary, 'Database description.');
    assert.deepEqual([unknown.functions, unknown.trivia, unknown.sources, unknown.modelUrl], [[], [], [], null]);
});

test('mergeSystem treats generated setup text as an empty description', () => {
    const own = id => systems.find(s => s.id === id).description;
    const layered = mergeSystem(db({id: 'lymphatic', description: 'Explore the Lymphatic System in the layered body model. Switch body systems on and off, then select a part to zoom in on it.'}));
    assert.equal(layered.description, own('lymphatic'));
    const skeleton = mergeSystem(db({description: 'Explore the supplied human skeleton model. Rotate, zoom, and reset the view to study its overall form. This asset is a single combined mesh; individual bones cannot be selected separately.'}));
    assert.equal(skeleton.description, own('skeletal'));
    assert.equal(mergeSystem(db({description: 'Explore how bones grow. Teacher notes.'})).description, 'Explore how bones grow. Teacher notes.');
});

test('student content keeps reviewed facts accurate', () => {
    const endocrine = systems.find(s => s.id === 'endocrine').description;
    assert.doesNotMatch(endocrine, /receptors, so their effects/, 'receptor specificity does not make hormones slower');
    const pulmonary = systems.find(s => s.id === 'circulatory').trivia.find(t => /pulmonary arteries/i.test(t));
    assert.match(pulmonary, /after birth/i, 'umbilical arteries also carry oxygen-poor blood before birth');
});
