// Checks exported layer files against system_model/layers/manifest.json (written by tools/blender/export_layers.py).
// Usage: node tests/layers-asset.mjs [system ...]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = 'system_model/layers';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const only = process.argv.slice(2);
function readGlbJson(file) {
    const buf = fs.readFileSync(file);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, `${file} is not a GLB`);
    assert.equal(buf.readUInt32LE(4), 2, `${file} is not glTF 2.0`);
    assert.equal(buf.readUInt32LE(16), 0x4e4f534a, `${file} has no JSON chunk`);
    return {json: JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')), bytes: buf.length};
}
let checked = 0;
for (const [code, entry] of Object.entries(manifest)) {
    if (only.length && !only.includes(code)) continue;
    const {json, bytes} = readGlbJson(path.join(dir, entry.file));
    assert.equal(bytes, entry.bytes, `${code}: file size matches the export report`);
    assert.ok(bytes < 15 * 1024 * 1024, `${code}: stays under 15 MB (${(bytes / 1048576).toFixed(1)} MB)`);
    assert.ok((json.extensionsUsed || []).includes('KHR_draco_mesh_compression'), `${code}: uses Draco compression`);
    const nodes = json.nodes || [];
    assert.ok(nodes.some(n => n.extras?.anatomy_schema === '1.0'), `${code}: root carries the layered-model marker`);
    const parts = nodes.filter(n => n.extras?.anatomy_role === 'part');
    assert.equal(parts.length, entry.parts, `${code}: every exported part is present`);
    assert.ok(parts.every(n => n.extras.system_id === code), `${code}: parts belong only to this system`);
    assert.equal(new Set(parts.map(n => n.extras.part_id)).size, parts.length, `${code}: part IDs are unique`);
    assert.ok(parts.every(n => typeof n.extras.name === 'string' && n.extras.name && 'description' in n.extras && 'function' in n.extras && 'identity_status' in n.extras), `${code}: parts carry name, description, function and identity status`);
    assert.ok(parts.every(n => Array.isArray(n.extras.systems)), `${code}: systems is a list`);
    console.log(`${code}: ${parts.length} parts, ${entry.triangles.toLocaleString()} triangles, ${(bytes / 1048576).toFixed(1)} MB — OK`);
    checked++;
}
assert.ok(checked > 0, 'At least one layer was checked');
