import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readGlbParts} from '../../tools/build-part-index.mjs';

test('readGlbParts returns described parts from a layer GLB', () => {
    const parts = readGlbParts(fs.readFileSync('system_model/layers/endocrine.glb'));
    assert.equal(parts.length, 8);
    assert.ok(parts.every(p => p.id.startsWith('za_') && p.name && p.description));
    assert.ok(parts.some(p => p.id === 'za_adenohypophysis' && p.name === 'Adenohypophysis'));
});
