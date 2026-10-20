// Writes system_model/layers/parts.json: the described parts of every layer GLB, for the practice games.
// Usage: node tools/build-part-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function readGlbParts(buffer) {
    const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
    return (json.nodes || [])
        .filter(n => n.extras?.part_id && n.extras.description)
        .map(n => ({id: n.extras.part_id, name: n.extras.name, description: n.extras.description}));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system_model', 'layers');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const index = {};
    for (const [code, entry] of Object.entries(manifest)) index[code] = readGlbParts(fs.readFileSync(path.join(dir, entry.file)));
    fs.writeFileSync(path.join(dir, 'parts.json'), JSON.stringify(index));
    for (const [code, parts] of Object.entries(index)) console.log(`${code}: ${parts.length} parts`);
}
