# Layered 3D Anatomy Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-system 3D Anatomy Explorer with a layered whole-body viewer. Body systems are independent layers that can be switched on in any combination, and clicking any part zooms in on it and shows its name, description and function.

**Architecture:** A Blender script exports each body system of `HumanAnatomyBackup.blend` as its own Draco-compressed GLB, with the part metadata embedded as glTF extras. The rewritten `AnatomyViewer` keeps one layer per system in a shared body frame and loads each layer the first time it is switched on. `anatomy-page.js` drives the system toggles, the focus mode and the part info panel. Logic that doesn't depend on the DOM lives in `anatomy-layers-core.js` and is unit tested in Node.

**Tech Stack:** Three.js r128 (vendored: GLTFLoader, OrbitControls, plus DRACOLoader and decoder), Blender 5.2 Python (`bpy`, glTF exporter), PHP 8 CLI + MySQL (existing `Database` class), Node 25 (`node:test`, existing `tests/*.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-06-layered-anatomy-viewer-design.md`

**One clarification of the spec:** today the explorer lets students read the content of systems that have no 3D model. To keep that working, a model-less system's toggle stays clickable. Clicking it shows that system's content and the toggle reads "No 3D model yet"; it never switches on.

**No git:** this folder is not a git repository. Each task ends with a **Checkpoint** (syntax check) instead of a commit. If git is initialised later, commit at each checkpoint.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `assets/js/anatomy-layers-core.js` | Create | Pure helpers: part resolution, hit picking, info-panel model, toggle labels, camera framing math, easing, context fallback. No DOM, no WebGL. |
| `tests/unit/anatomy-layers-core.test.mjs` | Create | `node:test` unit tests for the core helpers. |
| `tools/blender/export_layers.py` | Create | Runs inside Blender. Per-system decimate, Draco GLB export with extras, and `manifest.json`. |
| `tests/layers-asset.mjs` | Create | Validates exported GLBs against `manifest.json`: marker, Draco, part count, extras, size. |
| `system_model/layers/` | Create (generated) | `skeletal.glb`, `muscular.glb`, `manifest.json`. |
| `assets/vendor/three/DRACOLoader.js`, `assets/vendor/three/draco/*` | Create (vendored) | r128 Draco loader and decoder. |
| `assets/js/model-viewer.js` | Rewrite | `AnatomyViewer`: layers, load-on-first-use, hover, focus/fade, camera glide. |
| `tests/layers-harness.html` | Create | Dev page to check the viewer against the real GLBs without PHP or sign-in. |
| `assets/js/anatomy-page.js` | Rewrite | Toggles, context system, part info panel, focus exit, structures, practice, analytics. |
| `student/anatomy.html`, `teacher/anatomy.html` | Modify | Toggles replace the select; info panel fields; new scripts. |
| `assets/css/teacher-dashboard.css` | Modify (append) | Toggle, hover label and info panel styles (both pages load this file). |
| `database/integrate_layers.php` | Create | CLI: point Skeletal/Muscular at the layer files and credit Z-Anatomy. |
| `tests/browser.mjs` | Modify | Toggles in place of the `<select>`; ready-layer check in place of `AnatomyViewer.root`. |
| `README.md` | Modify | Document the layered explorer, the export and the integration. |

---

### Task 1: Core helpers (TDD)

**Files:**
- Create: `tests/unit/anatomy-layers-core.test.mjs`
- Create: `assets/js/anatomy-layers-core.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/anatomy-layers-core.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "tests/unit/*.test.mjs"`
Expected: FAIL with `Cannot find module '../../assets/js/anatomy-layers-core.js'`.

- [ ] **Step 3: Write the implementation**

Create `assets/js/anatomy-layers-core.js`:

```js
'use strict';
// Pure helpers for the layered anatomy viewer. No DOM or WebGL access, so Node can unit test them.
const AnatomyLayersCore = (() => {
    const UNIDENTIFIED_TEXT = "This part hasn't been identified yet. Its description and function will be added after review.";

    // Three.js copies glTF node extras into userData. A multi-material part is a Group of meshes,
    // so walk up from the hit mesh to the object that carries the part ID.
    function resolvePart(object) {
        for (let node = object; node; node = node.parent) {
            if (node.userData && node.userData.part_id) return node;
        }
        return null;
    }

    function pickPart(hits, focusedPartId) {
        let first = null;
        for (const hit of hits) {
            const part = resolvePart(hit.object);
            if (!part) continue;
            if (focusedPartId && part.userData.part_id === focusedPartId) return part;
            if (!first) first = part;
        }
        return first;
    }

    function matchStructure(structures, part) {
        if (!part) return null;
        const keys = [part.userData.part_id, part.name, part.parent && part.parent.name].filter(Boolean);
        return (structures || []).find(s => s.mesh_name && keys.includes(s.mesh_name)) || null;
    }

    function partInfo(data, systemNames, structure) {
        const names = systemNames || {};
        const systems = Array.isArray(data.systems) ? data.systems : [];
        const unidentified = !structure && data.identity_status === 'source_identity_required';
        return {
            title: (structure && structure.name) || data.name || 'Unnamed part',
            systemName: names[data.system_id] || data.system_id || '',
            alsoPartOf: systems.filter(id => id !== data.system_id).map(id => names[id] || id),
            description: (structure && structure.desc) || data.description || (unidentified ? UNIDENTIFIED_TEXT : 'No description provided.'),
            func: data.function || '',
            reference: /^https?:\/\//i.test(data.reference || '') ? data.reference : '',
            unidentified
        };
    }

    function toggleStatus(system, state) {
        if (!system.modelUrl) return 'No 3D model yet';
        if (!state) return '';
        if (state.status === 'loading') return state.progress == null ? 'Loading…' : `Loading ${state.progress}%`;
        if (state.status === 'error') return "Couldn't load — select to retry";
        return '';
    }

    // Distance at which a sphere of this radius fits the narrower of the two fields of view.
    function fitDistance(radius, fovDeg, aspect, margin = 1.3) {
        const vfov = fovDeg * Math.PI / 180;
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
        return Math.max(radius, 1e-6) / Math.sin(Math.min(vfov, hfov) / 2) * margin;
    }

    const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    function contextAfterDisable(enabledOrder, disabledId, current) {
        if (current !== disabledId) return current;
        const remaining = enabledOrder.filter(id => id !== disabledId);
        return remaining.length ? remaining[remaining.length - 1] : current;
    }

    return {UNIDENTIFIED_TEXT, resolvePart, pickPart, matchStructure, partInfo, toggleStatus, fitDistance, easeInOutCubic, contextAfterDisable};
})();
if (typeof module === 'object' && module.exports) module.exports = AnatomyLayersCore;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "tests/unit/*.test.mjs"`
Expected: `ℹ pass 10`, `# fail 0`.

- [ ] **Step 5: Checkpoint**

Run: `node tests/check-syntax.mjs`
Expected: `Passed: …` (no syntax errors). The new file is under `assets/js`, so it is included.

---

### Task 2: Blender export script and the skeletal layer

**Files:**
- Create: `tests/layers-asset.mjs`
- Create: `tools/blender/export_layers.py`
- Generated: `system_model/layers/skeletal.glb`, `system_model/layers/manifest.json`

**Precondition:** Blender is running with `HumanAnatomyBackup.blend` open and the Blender MCP connected. Optional: save the `.blend` first. The export reads the live session, so saving isn't required.

**Revised during execution:** the first run crashed Blender 5.2 with an access violation in `BKE_object_eval_eval_base_flags`. The script had switched `window.scene` and forced a scene-graph update in the same call. `tools/blender/export_layers.py` is now the source of truth. It no longer switches scenes; it refuses to run unless the window already shows "Anatomy - Layered", and it counts exported triangles from the GLB's accessors instead of evaluating meshes. A second revision came after the browser check showed holes in focused parts. The source meshes are unwelded triangle soup, and Collapse decimation deletes disconnected triangles, so the script now adds a temporary Weld modifier (merge distance 1e-6) before the Decimate modifier on every part. Before Step 4, switch the scene in a **separate** MCP call:

```python
bpy.context.window_manager.windows[0].scene = bpy.data.scenes["Anatomy - Layered"]
```

- [ ] **Step 1: Write the failing asset test**

Create `tests/layers-asset.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/layers-asset.mjs skeletal`
Expected: FAIL with `ENOENT … system_model\layers\manifest.json`.

- [ ] **Step 3: Write the export script**

Create `tools/blender/export_layers.py`:

```python
"""Export each body system of the layered anatomy model as its own web GLB.

Run inside Blender with HumanAnatomyBackup.blend open, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
    g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "skeletal"}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

LAYER_EXPORT_SYSTEMS is a comma-separated list of system codes, or "all".
Each part keeps about 30% of its triangles (small parts keep all of them). Part custom
properties travel as glTF extras. Temporary modifiers and the selection are restored
afterwards, and the .blend file is never saved.
"""
import json
import os

import bpy

SCENE = "Anatomy - Layered"
ROOT = "ANATOMY | whole body"
RATIO = 0.30
MIN_TRIS = 500


def default_out_dir():
    here = globals().get("__file__")
    if here and os.path.isfile(here):
        return os.path.normpath(os.path.join(os.path.dirname(here), "..", "..", "system_model", "layers"))
    raise RuntimeError("Set LAYER_EXPORT_DIR to the project's system_model/layers folder.")


def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def layer_empty(scene, code):
    for o in scene.objects:
        if o.get("anatomy_role") == "system" and o.get("system_id") == code:
            return o
    raise RuntimeError(f"No layer empty for system '{code}'.")


def system_parts(scene, code):
    return [o for o in scene.objects
            if o.type == 'MESH' and o.get("anatomy_role") == "part" and o.get("system_id") == code]


def check_assembled(objects):
    moved = [o.name for o in objects if any(abs(v) > 1e-6 for v in o.location)]
    if moved:
        raise RuntimeError(f"{len(moved)} objects are not at their rest position (e.g. '{moved[0]}'). "
                           "Use 'Reassemble body' in the Anatomy panel, then export again.")


def export_system(scene, code, out_dir):
    root = scene.objects[ROOT]
    empty = layer_empty(scene, code)
    parts = system_parts(scene, code)
    if not parts:
        raise RuntimeError(f"System '{code}' has no parts.")
    check_assembled(parts + [empty])

    view_layer = scene.view_layers[0]
    window = bpy.context.window_manager.windows[0]
    previous_scene = window.scene
    previous_selected = {o.name for o in scene.objects if o.select_get(view_layer=view_layer)}
    previous_active = view_layer.objects.active
    added = []
    source_tris = export_tris = 0
    path = os.path.join(out_dir, f"{code}.glb")
    try:
        window.scene = scene
        for o in parts:
            tris = tri_count(o.data)
            source_tris += tris
            if tris > MIN_TRIS:
                mod = o.modifiers.new("WebDecimate", 'DECIMATE')
                mod.decimate_type = 'COLLAPSE'
                mod.ratio = RATIO
                added.append((o, mod))

        depsgraph = view_layer.depsgraph
        depsgraph.update()
        for o in parts:
            evaluated = o.evaluated_get(depsgraph)
            export_tris += tri_count(evaluated.to_mesh())
            evaluated.to_mesh_clear()

        for o in scene.objects:
            o.select_set(False, view_layer=view_layer)
        for o in [root, empty] + parts:
            o.select_set(True, view_layer=view_layer)
        view_layer.objects.active = root

        with bpy.context.temp_override(window=window, scene=scene, view_layer=view_layer):
            bpy.ops.export_scene.gltf(
                filepath=path, export_format='GLB', use_selection=True, use_visible=False,
                export_apply=True, export_extras=True, export_yup=True,
                export_texcoords=False, export_normals=True, export_tangents=False,
                export_vertex_color='NONE', export_attributes=False, export_materials='EXPORT',
                export_animations=False, export_skins=False, export_morph=False,
                export_cameras=False, export_lights=False,
                export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_normal_quantization=10)
    finally:
        for o, mod in added:
            o.modifiers.remove(mod)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active
        window.scene = previous_scene

    return {"file": f"{code}.glb", "parts": len(parts), "source_triangles": source_tris,
            "triangles": export_tris, "bytes": os.path.getsize(path)}


def write_manifest(out_dir, reports):
    path = os.path.join(out_dir, "manifest.json")
    manifest = {}
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    manifest.update(reports)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=True)
        fh.write("\n")


def main(systems_arg):
    scene = bpy.data.scenes[SCENE]
    known = sorted({o["system_id"] for o in scene.objects if o.get("anatomy_role") == "system"})
    codes = known if systems_arg.strip() == "all" else [c.strip() for c in systems_arg.split(",") if c.strip()]
    unknown = [c for c in codes if c not in known]
    if unknown:
        raise RuntimeError(f"Unknown system(s): {', '.join(unknown)}. Known: {', '.join(known)}")
    out_dir = globals().get("LAYER_EXPORT_DIR") or default_out_dir()
    os.makedirs(out_dir, exist_ok=True)
    reports = {}
    for code in codes:
        r = reports[code] = export_system(scene, code, out_dir)
        print(f"[layers] {code}: {r['parts']} parts, {r['source_triangles']:,} -> {r['triangles']:,} triangles, "
              f"{r['bytes'] / 1048576:.1f} MB")
    write_manifest(out_dir, reports)
    return reports


if __name__ == "__main__":
    LAYER_EXPORT_REPORT = main(globals().get("LAYER_EXPORT_SYSTEMS", "skeletal"))
```

- [ ] **Step 4: Run the skeletal export in Blender**

Call `mcp__Blender__execute_blender_code` with:

```python
p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "skeletal"}
exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)
result = {"report": g["LAYER_EXPORT_REPORT"]}
```

Expected: `{"skeletal": {"file": "skeletal.glb", "parts": 1599, "source_triangles": ~1784000, "triangles": ~550000, "bytes": <15 MB}}`.

If the MCP call times out, Blender keeps running the script. Wait, then check that `system_model/layers/manifest.json` exists before continuing.

- [ ] **Step 5: Run the asset test to verify it passes**

Run: `node tests/layers-asset.mjs skeletal`
Expected: `skeletal: 1599 parts, … triangles, … MB — OK`.

If `systems is a list` fails, the exporter wrote `systems` as a string. Change `partInfo` and its unit test to parse that format before continuing. Don't loosen the asset test.

- [ ] **Step 6: Checkpoint**

Run: `node tests/check-syntax.mjs`
Expected: `Passed: …`.

---

### Task 3: Vendor the Draco decoder

**Files:**
- Create: `assets/vendor/three/DRACOLoader.js`
- Create: `assets/vendor/three/draco/draco_decoder.js`, `draco_decoder.wasm`, `draco_wasm_wrapper.js`

These are third-party downloads from `cdn.jsdelivr.net` (package `three@0.128.0`, about 1.2 MB in total). **Ask the user for permission before downloading.**

- [ ] **Step 1: Confirm they are missing**

Run: `Test-Path assets\vendor\three\DRACOLoader.js`
Expected: `False`.

- [ ] **Step 2: Download (after the user approves)**

```powershell
$base = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js'
New-Item -ItemType Directory -Force assets\vendor\three\draco | Out-Null
Invoke-WebRequest "$base/loaders/DRACOLoader.js" -OutFile assets\vendor\three\DRACOLoader.js
foreach ($f in 'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js') { Invoke-WebRequest "$base/libs/draco/$f" -OutFile "assets\vendor\three\draco\$f" }
```

- [ ] **Step 3: Verify the files**

Run:
```powershell
Select-String -Path assets\vendor\three\DRACOLoader.js -Pattern 'THREE.DRACOLoader = DRACOLoader' -Quiet
[BitConverter]::ToString([IO.File]::ReadAllBytes('assets\vendor\three\draco\draco_decoder.wasm')[0..3])
Get-ChildItem assets\vendor\three\draco | Select-Object Name, Length
```
Expected: `True`, `00-61-73-6D` (WebAssembly magic), and three non-empty files.

---

### Task 4: Layered viewer (`model-viewer.js`) and dev harness

**Files:**
- Rewrite: `assets/js/model-viewer.js`
- Create: `tests/layers-harness.html`

- [ ] **Step 1: Replace `assets/js/model-viewer.js` with:**

```js
'use strict';
// Layered anatomy viewer. Each body system is its own GLB layer in a shared body frame.
// A layer loads the first time it is switched on; any combination of layers can be shown.
const AnatomyViewer = {
    dracoPath: '../assets/vendor/three/draco/',
    layers: new Map(), materialCache: new Map(),
    focusedPart: null, hoveredPart: null, savedView: null, tween: null, pendingHover: null, lastHover: 0,
    onPartClick: null, labelFor: null,
    init(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#101c2e');
        this.camera = new THREE.PerspectiveCamera(40, 1, .01, 10000);
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536077, 1.6));
        const light = new THREE.DirectionalLight(0xffffff, 1.4); light.position.set(4, 8, 6); this.scene.add(light);
        this.world = new THREE.Group(); this.scene.add(this.world);
        this.controls = new THREE.OrbitControls(this.camera, canvas); this.controls.enableDamping = true;
        this.controls.enablePan = true;
        this.controls.screenSpacePanning = true;
        this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
        this.controls.listenToKeyEvents(canvas);
        this.controls.addEventListener('start', () => { this.tween = null; });
        this.raycaster = new THREE.Raycaster();
        const draco = new THREE.DRACOLoader(); draco.setDecoderPath(this.dracoPath);
        this.loader = new THREE.GLTFLoader(); this.loader.setDRACOLoader(draco);
        this.label = document.createElement('div'); this.label.className = 'part-hover-label'; this.label.hidden = true;
        canvas.parentElement.append(this.label);
        // Intercept wheel zoom before OrbitControls' center-based wheel handler.
        // Moving camera and orbit target around the same anchor keeps it under the pointer.
        canvas.addEventListener('wheel', event => {
            if (!this.hasVisibleLayer() || !this.controls.enabled || !this.controls.enableZoom) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
            const delta = Math.max(-200, Math.min(200, event.deltaY * units));
            this.zoom(Math.exp(delta * .002), this.pointerAnchor(event.clientX, event.clientY));
        }, {capture: true, passive: false});
        this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
        let pointerStart = null;
        canvas.addEventListener('pointerdown', e => { pointerStart = {x: e.clientX, y: e.clientY}; });
        canvas.addEventListener('pointerup', e => {
            const start = pointerStart; pointerStart = null;
            if (e.button !== 0 || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
            this.onPartClick?.(this.partAt(e.clientX, e.clientY));
        });
        canvas.addEventListener('pointermove', e => {
            if (e.buttons) { this.pendingHover = null; this.setHover(null); return; }
            this.pendingHover = {x: e.clientX, y: e.clientY};
        });
        canvas.addEventListener('pointerleave', () => { this.pendingHover = null; this.setHover(null); });
        this.animate = () => {
            this.frame = requestAnimationFrame(this.animate);
            if (document.hidden) return;
            const now = performance.now();
            this.stepTween(now);
            if (this.pendingHover && now - this.lastHover > 50) { // at most ~20 hover raycasts per second
                const {x, y} = this.pendingHover; this.pendingHover = null; this.lastHover = now;
                this.setHover(this.partAt(x, y), x, y);
            }
            this.controls.update(); this.renderer.render(this.scene, this.camera);
        };
        this.animate();
    },
    resize() { const rect = this.canvas.parentElement.getBoundingClientRect(); this.renderer.setSize(rect.width, rect.height, false); this.camera.aspect = rect.width / Math.max(rect.height, 1); this.camera.updateProjectionMatrix(); },

    // ── Layers ──
    layerState(id) { return this.layers.get(id) || null; },
    visibleRoots() { return [...this.layers.values()].filter(layer => layer.root && layer.root.visible).map(layer => layer.root); },
    hasVisibleLayer() { return this.visibleRoots().length > 0; },
    createLayer(id) {
        const layer = {id, status: 'idle', progress: null, layered: false, wanted: false, root: null, parts: new Map(), loading: null};
        this.layers.set(id, layer); return layer;
    },
    async setLayerVisible(system, visible, onProgress) {
        const layer = this.layers.get(system.id) || this.createLayer(system.id);
        layer.wanted = visible;
        if (layer.root) layer.root.visible = visible;
        if (!visible) {
            if (this.focusedPart && this.focusedPart.userData.layerId === system.id) this.clearFocus();
            if (this.hoveredPart && this.hoveredPart.userData.layerId === system.id) this.setHover(null);
            return layer;
        }
        if (layer.root) { this.applyMaterials(); return layer; }
        if (!system.modelUrl) return layer;
        if (!layer.loading) layer.loading = this.loadLayer(layer, system, onProgress);
        await layer.loading;
        return layer;
    },
    async loadLayer(layer, system, onProgress) {
        layer.status = 'loading'; layer.progress = null; onProgress?.(layer);
        try {
            const gltf = await new Promise((resolve, reject) => this.loader.load(system.modelUrl, resolve, event => {
                layer.progress = event.total ? Math.round(event.loaded / event.total * 100) : null; onProgress?.(layer);
            }, reject));
            this.adoptLayer(layer, system, gltf.scene);
            layer.status = 'ready';
        } catch (error) {
            layer.status = 'error'; console.warn('Anatomy layer could not be loaded:', system.modelUrl, error);
        } finally { layer.loading = null; }
        onProgress?.(layer);
    },
    adoptLayer(layer, system, root) {
        let layered = false;
        root.traverse(node => { if (node.userData && node.userData.anatomy_schema) layered = true; });
        layer.layered = layered;
        root.traverse(node => {
            if (node.isMesh) node.userData.baseMaterial = node.material;
            if (!layered && node.isMesh) {
                // Models made outside the layered export: only meshes named in a structure are selectable, as before.
                const structure = (system.structures || []).find(s => s.mesh_name && (s.mesh_name === node.name || s.mesh_name === node.parent?.name));
                if (structure) Object.assign(node.userData, {part_id: 'legacy:' + node.uuid, name: structure.name, system_id: system.id, structure});
            }
            if (node.userData.part_id) { node.userData.layerId = system.id; layer.parts.set(node.userData.part_id, node); }
            node.updateMatrix(); node.matrixAutoUpdate = false; // the anatomy never moves; skip per-frame matrix work
        });
        root.visible = layer.wanted;
        this.world.add(root); root.updateMatrixWorld(true);
        layer.root = root;
        if (root.visible && this.focusedPart) this.applyMaterials(root);
        if (root.visible && this.visibleRoots().length === 1) this.resetView();
    },
    findPart(meshName) {
        if (!meshName) return null;
        for (const layer of this.layers.values()) {
            if (!layer.root || !layer.root.visible) continue;
            if (layer.parts.has(meshName)) return layer.parts.get(meshName);
            for (const part of layer.parts.values()) if (part.name === meshName || part.parent?.name === meshName) return part;
        }
        return null;
    },

    // ── Picking and hover ──
    rayFrom(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        this.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    },
    partAt(x, y) {
        const roots = this.visibleRoots(); if (!roots.length) return null;
        this.rayFrom(x, y);
        return AnatomyLayersCore.pickPart(this.raycaster.intersectObjects(roots, true), this.focusedPart?.userData.part_id);
    },
    setHover(part, x, y) {
        if (part !== this.hoveredPart) {
            const previous = this.hoveredPart; this.hoveredPart = part;
            if (previous) this.applyMaterials(previous);
            if (part) this.applyMaterials(part);
            this.canvas.style.cursor = part ? 'pointer' : '';
        }
        if (part && x !== undefined) {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.label.textContent = this.labelFor?.(part) || part.userData.name || '';
            this.label.style.left = (x - rect.left + 14) + 'px'; this.label.style.top = (y - rect.top + 14) + 'px';
            this.label.hidden = !this.label.textContent;
        } else if (!part) this.label.hidden = true;
    },

    // ── Materials: base, hover glow, focus glow, faded ghost ──
    variant(material, kind) {
        let entry = this.materialCache.get(material.uuid);
        if (!entry) { entry = {}; this.materialCache.set(material.uuid, entry); }
        if (!entry[kind]) {
            const copy = material.clone();
            if (kind === 'ghost') { copy.transparent = true; copy.opacity = 0.12; copy.depthWrite = false; }
            else if (copy.emissive) { copy.emissive.setHex(kind === 'focus' ? 0xa86f12 : 0x1d6f6a); copy.emissiveIntensity = 1; }
            entry[kind] = copy;
        }
        return entry[kind];
    },
    materialFor(mesh, part) {
        const base = mesh.userData.baseMaterial;
        const kind = part && part === this.focusedPart ? 'focus' : this.focusedPart ? 'ghost' : part && part === this.hoveredPart ? 'hover' : null;
        if (!kind) return base;
        return Array.isArray(base) ? base.map(m => this.variant(m, kind)) : this.variant(base, kind);
    },
    applyMaterials(scope) {
        for (const root of scope ? [scope] : this.visibleRoots()) root.traverse(node => {
            if (node.isMesh && node.userData.baseMaterial) node.material = this.materialFor(node, AnatomyLayersCore.resolvePart(node));
        });
    },

    // ── Focus ──
    focusPart(part) {
        if (!part) return;
        if (!this.focusedPart) this.savedView = {position: this.camera.position.clone(), target: this.controls.target.clone()};
        this.focusedPart = part;
        this.applyMaterials();
        const sphere = new THREE.Box3().setFromObject(part).getBoundingSphere(new THREE.Sphere());
        const direction = this.camera.position.clone().sub(this.controls.target);
        if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1);
        direction.normalize().multiplyScalar(AnatomyLayersCore.fitDistance(sphere.radius, this.camera.fov, this.camera.aspect));
        this.moveCamera(sphere.center.clone().add(direction), sphere.center);
    },
    clearFocus() {
        if (!this.focusedPart) return;
        this.focusedPart = null; this.applyMaterials();
        if (this.savedView) this.moveCamera(this.savedView.position, this.savedView.target);
        this.savedView = null;
    },
    moveCamera(position, target) {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            this.tween = null; this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update(); return;
        }
        this.tween = {start: performance.now(), duration: 800, fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPosition: position.clone(), toTarget: target.clone()};
    },
    stepTween(now) {
        const tween = this.tween; if (!tween) return;
        const k = Math.min(1, (now - tween.start) / tween.duration), eased = AnatomyLayersCore.easeInOutCubic(k);
        this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
        this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        if (k >= 1) this.tween = null;
    },

    // ── View ──
    resetView() {
        const roots = this.visibleRoots(); if (!roots.length) return;
        const box = new THREE.Box3(); roots.forEach(root => box.expandByObject(root));
        const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()).length() || 1;
        this.tween = null; this.savedView = null;
        this.camera.position.copy(center).add(new THREE.Vector3(0, size * .1, size * 1.4));
        this.camera.near = Math.max(size / 1000, .001); this.camera.far = size * 100; this.camera.updateProjectionMatrix();
        this.controls.target.copy(center); this.controls.update();
    },
    pointerAnchor(x, y) {
        this.rayFrom(x, y);
        // Raycast every visible mesh, including ones without part data.
        const hit = this.raycaster.intersectObjects(this.visibleRoots(), true)[0];
        if (hit) return hit.point;
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), this.controls.target);
        return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || this.controls.target.clone();
    },
    zoom(factor, anchor = this.controls.target.clone()) {
        if (!this.hasVisibleLayer() || !Number.isFinite(factor) || factor <= 0) return;
        this.tween = null;
        const distance = this.camera.position.distanceTo(this.controls.target);
        const next = THREE.MathUtils.clamp(distance * factor, Math.max(this.camera.near * 10, this.controls.minDistance), Math.min(this.camera.far * .5, this.controls.maxDistance));
        const scale = next / Math.max(distance, Number.EPSILON);
        this.camera.position.sub(anchor).multiplyScalar(scale).add(anchor);
        this.controls.target.sub(anchor).multiplyScalar(scale).add(anchor);
        this.controls.update();
    },
    screenshot() { const link = document.createElement('a'); link.download = 'anatomy-view.png'; link.href = this.canvas.toDataURL('image/png'); link.click(); }
};
```

- [ ] **Step 2: Create the dev harness `tests/layers-harness.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Layer Viewer Harness</title>
  <link rel="stylesheet" href="../assets/css/content.css"/>
  <link rel="stylesheet" href="../assets/css/teacher-dashboard.css"/>
  <script src="../assets/vendor/three/three.min.js"></script>
  <script src="../assets/vendor/three/OrbitControls.js"></script>
  <script src="../assets/vendor/three/GLTFLoader.js"></script>
  <script src="../assets/vendor/three/DRACOLoader.js"></script>
  <style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#f8fafc}#bar{display:flex;gap:8px;align-items:center;margin-bottom:8px}#log{white-space:pre-wrap;font-size:12px;max-height:30vh;overflow:auto}</style>
</head>
<body class="teacher-dashboard">
  <div id="bar"><span id="fps">– fps</span></div>
  <div class="model-stage"><canvas id="anatomyCanvas"></canvas></div>
  <pre id="log">Switch a layer on.</pre>
  <script src="../assets/js/anatomy-layers-core.js"></script>
  <script src="../assets/js/model-viewer.js"></script>
  <script>
  'use strict';
  // Dev-only page: exercises AnatomyViewer against the exported layers without PHP or sign-in.
  const harnessSystems=[{id:'skeletal',name:'Skeletal System',modelUrl:'../system_model/layers/skeletal.glb',structures:[]},{id:'muscular',name:'Muscular System',modelUrl:'../system_model/layers/muscular.glb',structures:[]}];
  const harnessNames=Object.fromEntries(harnessSystems.map(s=>[s.id,s.name]));
  const harnessLog=document.getElementById('log'), harnessOn=new Set();
  AnatomyViewer.init(document.getElementById('anatomyCanvas'));
  AnatomyViewer.onPartClick=part=>{
    if(!part){AnatomyViewer.clearFocus();harnessLog.textContent='(full body)';return;}
    AnatomyViewer.focusPart(part);harnessLog.textContent=JSON.stringify(AnatomyLayersCore.partInfo(part.userData,harnessNames),null,2);
  };
  addEventListener('keydown',e=>{if(e.key==='Escape')AnatomyViewer.clearFocus();});
  for(const system of harnessSystems){
    const button=document.createElement('button');button.textContent=system.name;
    button.onclick=async()=>{
      const on=!harnessOn.has(system.id);on?harnessOn.add(system.id):harnessOn.delete(system.id);
      button.textContent=system.name+(on?' ✓':'');
      const layer=await AnatomyViewer.setLayerVisible(system,on,l=>{harnessLog.textContent=`${system.id}: ${l.status} ${l.progress??''}`;});
      harnessLog.textContent=`${system.id}: ${layer.status}, layered=${layer.layered}, parts=${layer.parts.size}`;
    };
    document.getElementById('bar').append(button);
  }
  let frames=0,since=performance.now();
  (function count(){frames++;const now=performance.now();if(now-since>=1000){window.harnessFps=Math.round(frames*1000/(now-since));document.getElementById('fps').textContent=window.harnessFps+' fps';frames=0;since=now;}requestAnimationFrame(count);})();
  </script>
</body>
</html>
```

- [ ] **Step 3: Serve the project and open the harness**

Start the server in the background (PowerShell, `run_in_background: true`):

```powershell
& C:\xampp\php\php.exe -S 127.0.0.1:8092 -t .
```

Then open `http://127.0.0.1:8092/tests/layers-harness.html` in the built-in browser (`mcp__Claude_Browser__preview_start` with `url`).

- [ ] **Step 4: Verify the skeleton layer in the browser**

Click "Skeletal System", then check with `mcp__Claude_Browser__javascript_tool`:

```js
(async()=>{for(let i=0;i<60&&AnatomyViewer.layerState('skeletal')?.status!=='ready';i++)await new Promise(r=>setTimeout(r,500));const l=AnatomyViewer.layerState('skeletal');return {status:l.status,layered:l.layered,parts:l.parts.size,fps:window.harnessFps};})()
```
Expected: `{status:'ready', layered:true, parts:1599, fps: ≥30}`.

Focus a part programmatically, then take a screenshot:

```js
(()=>{const p=[...AnatomyViewer.layerState('skeletal').parts.values()][200];AnatomyViewer.onPartClick(p);return p.userData.name;})()
```
Expected: the camera glides to one bone, which glows gold while the rest fades. The log shows `"unidentified": true` and the "hasn't been identified yet" description. Press Escape and confirm the full body comes back.

Also click a bone with the mouse and confirm the same result. Hover a bone and confirm the teal glow and name label.

Check `mcp__Claude_Browser__read_console_messages` with `onlyErrors: true`. Expected: no errors.

- [ ] **Step 5: Checkpoint**

Run: `node tests/check-syntax.mjs` and `node --test "tests/unit/*.test.mjs"`
Expected: both pass.

---

### Task 5: Explorer pages (toggles, info panel, page logic)

**Files:**
- Modify: `student/anatomy.html`, `teacher/anatomy.html`
- Modify: `assets/css/teacher-dashboard.css` (append)
- Rewrite: `assets/js/anatomy-page.js`

- [ ] **Step 1: Add the scripts to both pages**

In `student/anatomy.html` and in `teacher/anatomy.html`, after `<script src="../assets/vendor/three/GLTFLoader.js"></script>` add:

```html
  <script src="../assets/vendor/three/DRACOLoader.js"></script>
```

In `student/anatomy.html`, replace:

```html
<script src="../assets/js/anatomy.js"></script>
<script src="../assets/js/model-viewer.js?v=20260915-pointerzoom1"></script>
<script src="../assets/js/anatomy-page.js"></script>
```
with:
```html
<script src="../assets/js/anatomy.js"></script>
<script src="../assets/js/anatomy-layers-core.js?v=20261006-layers1"></script>
<script src="../assets/js/model-viewer.js?v=20261006-layers1"></script>
<script src="../assets/js/anatomy-page.js?v=20261006-layers1"></script>
```

In `teacher/anatomy.html`, replace:

```html
<script src="../assets/js/model-viewer.js?v=20260915-pointerzoom1"></script>
<script src="../assets/js/teacher-anatomy.js"></script>
<script src="../assets/js/anatomy-page.js"></script>
```
with:
```html
<script src="../assets/js/anatomy-layers-core.js?v=20261006-layers1"></script>
<script src="../assets/js/model-viewer.js?v=20261006-layers1"></script>
<script src="../assets/js/teacher-anatomy.js"></script>
<script src="../assets/js/anatomy-page.js?v=20261006-layers1"></script>
```

- [ ] **Step 2: Replace the system select with toggles (both pages)**

In both files, replace the whole section containing `<label for="systemSelect" …>` and `<select id="systemSelect" …>…</select>` with:

```html
      <section class="content-panel" style="margin-bottom:14px;">
        <p id="systemTogglesLabel" class="system-toggles-label">Body systems</p>
        <div id="systemToggles" class="system-toggles" role="group" aria-labelledby="systemTogglesLabel">Loading...</div>
        <p id="layerNote" class="layer-note" role="status" hidden>This model isn't part of the layered body, so it's shown on its own.</p>
      </section>
```

- [ ] **Step 3: Replace the structure info panel (both pages)**

In both files, replace:

```html
          <section class="content-panel" style="margin-top:14px;">
            <h2 id="structureTitle" style="font-size:1.05rem;font-weight:700;margin-bottom:6px;">Choose a structure</h2>
            <p id="structureDescription" style="font-size:0.82rem;color:var(--text-secondary);margin:0;">Structure descriptions will appear here.</p>
          </section>
```
with:
```html
          <section class="content-panel part-info" style="margin-top:14px;" aria-live="polite">
            <div class="part-info-head">
              <h2 id="structureTitle" style="font-size:1.05rem;font-weight:700;margin-bottom:6px;">Choose a structure</h2>
              <button type="button" class="btn btn-secondary btn-sm" id="exitFocus" hidden>Back to full body</button>
            </div>
            <p id="structureSystem" class="part-info-system"></p>
            <span id="structureBadge" class="part-info-badge" hidden>Awaiting identification</span>
            <p id="structureDescription" style="font-size:0.82rem;color:var(--text-secondary);margin:0;">Structure descriptions will appear here.</p>
            <p id="structureFunctionRow" class="part-info-function" hidden><strong>Function: </strong><span id="structureFunction"></span></p>
            <p id="structureAlso" class="part-info-also" hidden></p>
            <a id="structureReference" class="part-info-reference" href="#" target="_blank" rel="noopener" hidden>Reference</a>
          </section>
```

- [ ] **Step 4: Append the styles to `assets/css/teacher-dashboard.css`**

```css

/* ── Layered anatomy explorer ── */
.teacher-dashboard .system-toggles-label { font-weight: 600; font-size: 0.82rem; color: var(--text-secondary); margin: 0 0 6px; }
.teacher-dashboard .system-toggles { display: flex; flex-wrap: wrap; gap: 8px; }
.teacher-dashboard .system-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid var(--border); border-radius: 999px; background: #ffffff; color: var(--text-primary); font: inherit; font-size: 0.82rem; cursor: pointer; transition: all 0.15s ease; }
.teacher-dashboard .system-toggle:hover { border-color: #0da474; }
.teacher-dashboard .system-toggle[aria-checked="true"] { border-color: #0da474; background: #e5f6ef; color: #056044; font-weight: 600; }
.teacher-dashboard .system-toggle:focus-visible { outline: 2px solid #0da474; outline-offset: 2px; }
.teacher-dashboard .system-toggle-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--system-color); opacity: 0.35; }
.teacher-dashboard .system-toggle[aria-checked="true"] .system-toggle-dot { opacity: 1; }
.teacher-dashboard .system-toggle-status { color: var(--text-muted); font-size: 0.75rem; font-weight: 500; }
.teacher-dashboard .system-toggle-status:empty { display: none; }
.teacher-dashboard .layer-note { margin: 8px 0 0; font-size: 0.78rem; color: var(--text-muted); }
.teacher-dashboard .part-hover-label { position: absolute; z-index: 2; max-width: 240px; padding: 4px 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.88); color: #ffffff; font-size: 0.75rem; pointer-events: none; }
.teacher-dashboard .part-info-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.teacher-dashboard .part-info-system,
.teacher-dashboard .part-info-also { margin: 0 0 6px; font-size: 0.78rem; color: var(--text-muted); }
.teacher-dashboard .part-info-badge { display: inline-block; margin: 0 0 8px; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 0.72rem; font-weight: 600; }
.teacher-dashboard .part-info-function { margin: 8px 0 0; font-size: 0.82rem; color: var(--text-secondary); }
.teacher-dashboard .part-info-reference { display: inline-block; margin-top: 8px; font-size: 0.78rem; }
.teacher-dashboard .part-info [hidden],
.teacher-dashboard .part-hover-label[hidden] { display: none; }
```

- [ ] **Step 5: Replace `assets/js/anatomy-page.js` with:**

```js
'use strict';
const teacherExplorer=document.body.dataset.anatomyRole==='teacher';
const studentPreview=teacherExplorer && new URLSearchParams(location.search).get('preview')==='student';
let selectedSystem=null, activeSeconds=0, lastTick=Date.now(), interactions=0, viewed=new Set(), viewerReady=false, contextVersion=0, focusVersion=0;
const enabledOrder=[]; // ids of switched-on systems, oldest first
const modelMessage=document.getElementById('modelMessage');
const toggleBox=document.getElementById('systemToggles');
const anatomyEl=id=>document.getElementById(id);
const IDLE_HINT='Select a part of the model or a structure below.';
const textInfo=(title,description,systemName='')=>({title,description,systemName,unidentified:false,func:'',alsoPartOf:[],reference:''});

// ── Part info panel ──
function systemNames(){return Object.fromEntries(AnatomyData.systems.map(s=>[s.id,s.name]));}
function structureFor(part){
    if(part.userData.structure)return part.userData.structure;
    return AnatomyLayersCore.matchStructure(AnatomyData.getSystem(part.userData.system_id)?.structures,part);
}
function renderInfo(info,focused){
    anatomyEl('structureTitle').textContent=info.title;
    anatomyEl('structureSystem').textContent=info.systemName?'System: '+info.systemName:'';
    anatomyEl('structureBadge').hidden=!info.unidentified;
    anatomyEl('structureDescription').textContent=info.description;
    anatomyEl('structureFunction').textContent=info.func;anatomyEl('structureFunctionRow').hidden=!info.func;
    const also=anatomyEl('structureAlso');also.textContent=info.alsoPartOf.length?'Also part of: '+info.alsoPartOf.join(', '):'';also.hidden=!info.alsoPartOf.length;
    const reference=anatomyEl('structureReference');reference.href=info.reference||'#';reference.hidden=!info.reference;
    anatomyEl('exitFocus').hidden=!focused;
}
function recordView(name){if(name){viewed.add(name);interactions++;}}
async function focusOnPart(part){
    const version=++focusVersion;
    AnatomyViewer.focusPart(part);
    const system=AnatomyData.getSystem(part.userData.system_id);
    if(system && system!==selectedSystem)await setContext(system);
    if(version!==focusVersion)return;
    const structure=structureFor(part);
    renderInfo(AnatomyLayersCore.partInfo(part.userData,systemNames(),structure),true);
    recordView(structure?.name||part.userData.name);
}
function exitFocus(){
    focusVersion++;
    if(viewerReady)AnatomyViewer.clearFocus();
    renderInfo(textInfo('Choose a structure',IDLE_HINT),false);
}
function showStructure(structure){
    const part=viewerReady?AnatomyViewer.findPart(structure.mesh_name):null;
    if(part){focusOnPart(part);return;}
    focusVersion++;
    if(viewerReady)AnatomyViewer.clearFocus();
    renderInfo(textInfo(structure.name,structure.desc||'No description provided.',selectedSystem?.name),false);
    recordView(structure.name);
}
function handlePartClick(part){if(part)focusOnPart(part);else if(AnatomyViewer.focusedPart)exitFocus();}

// ── Context system: the side panel shows the system of the last clicked part or last switched-on system ──
async function flushExploration(){
    if(teacherExplorer || !selectedSystem || activeSeconds<1)return;
    const payload={system_id:selectedSystem.system_id,duration_secs:Math.floor(activeSeconds),interactions,structures_viewed:[...viewed]};
    activeSeconds=0;interactions=0;viewed.clear();
    try{const response=await fetch(API_BASE+'/analytics/exploration.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin',keepalive:true});if(!response.ok)console.warn('Exploration progress could not be saved.');}catch(error){console.warn('Exploration progress could not be saved.');}
}
async function setContext(system){
    const version=++contextVersion;
    await flushExploration(); if(version!==contextVersion)return;
    selectedSystem=system;
    document.dispatchEvent(new CustomEvent('anatomysystemselected',{detail:system}));
    anatomyEl('systemTitle').textContent=system.name;
    anatomyEl('systemDescription').textContent=system.description || 'Your teacher has not added a description yet.';
    anatomyEl('systemSources').textContent=system.source;
    const facts=anatomyEl('systemFacts');facts.replaceChildren();
    Object.entries(system.keyFacts).forEach(([key,value])=>{const item=document.createElement('p');const strong=document.createElement('strong');strong.textContent=key+': ';item.append(strong,document.createTextNode(value));facts.append(item);});
    const structures=anatomyEl('structures');structures.replaceChildren();
    system.structures.forEach(s=>{const button=document.createElement('button');button.className='structure-button';button.textContent=s.name;button.onclick=()=>showStructure(s);structures.append(button);});
    if(!system.structures.length)structures.textContent='No structures added yet.';
    anatomyEl('practicePrompt').textContent='';anatomyEl('practiceResult').textContent='';anatomyEl('practiceChoices').replaceChildren();
    anatomyEl('practiceButton').disabled=system.structures.filter(s=>s.desc).length<2;
    if(!AnatomyViewer.focusedPart)renderInfo(textInfo('Choose a structure',IDLE_HINT),false);
    updateStage();
}

// ── System toggles ──
function createToggle(system){
    const button=document.createElement('button');button.type='button';button.className='system-toggle';button.dataset.system=system.id;
    button.setAttribute('role','switch');button.setAttribute('aria-checked','false');
    const dot=document.createElement('span');dot.className='system-toggle-dot';dot.style.setProperty('--system-color',system.color||'#64748b');
    const name=document.createElement('span');name.className='system-toggle-name';name.textContent=system.name+(teacherExplorer&&!studentPreview&&!system.isActive?' (hidden)':'');
    const status=document.createElement('span');status.className='system-toggle-status';
    button.append(dot,name,status);button.onclick=()=>toggleSystem(system);
    return button;
}
function renderToggle(system){
    const button=toggleBox.querySelector(`[data-system="${CSS.escape(system.id)}"]`);if(!button)return;
    button.setAttribute('aria-checked',String(enabledOrder.includes(system.id)));
    button.querySelector('.system-toggle-status').textContent=AnatomyLayersCore.toggleStatus(system,viewerReady?AnatomyViewer.layerState(system.id):null);
}
function renderAll(){AnatomyData.systems.forEach(renderToggle);updateStage();}
function updateStage(){
    const loading=enabledOrder.map(id=>AnatomyViewer.layerState(id)).find(state=>state&&state.status==='loading');
    let message='';
    if(!viewerReady)message='3D viewing is unavailable on this device. You can still read the anatomy content.';
    else if(AnatomyViewer.hasVisibleLayer())message='';
    else if(loading)message=loading.progress==null?'Loading model…':`Loading model: ${loading.progress}%`;
    else if(selectedSystem && !selectedSystem.modelUrl)message='No 3D model has been added for this system. You can read the available content alongside the viewer.';
    else if(AnatomyData.systems.some(s=>AnatomyViewer.layerState(s.id)?.status==='error'))message='The model could not be loaded. Select the system again to retry, or contact your teacher.';
    else message='Switch on a body system to begin.';
    modelMessage.textContent=message;modelMessage.style.display=message?'grid':'none';
    anatomyEl('layerNote').hidden=!enabledOrder.some(id=>{const state=AnatomyViewer.layerState(id);return state&&state.status==='ready'&&!state.layered;});
}
function disableSystem(id){
    const index=enabledOrder.indexOf(id);if(index<0)return;
    const next=AnatomyLayersCore.contextAfterDisable(enabledOrder,id,selectedSystem?.id);
    enabledOrder.splice(index,1);
    AnatomyViewer.setLayerVisible(AnatomyData.getSystem(id),false);
    if(!AnatomyViewer.focusedPart && !anatomyEl('exitFocus').hidden)exitFocus(); // the focused part's layer was switched off
    if(next && next!==selectedSystem?.id)setContext(AnatomyData.getSystem(next));
}
async function toggleSystem(system){
    if(!viewerReady || !system.modelUrl){await setContext(system);return;}
    if(enabledOrder.includes(system.id)){disableSystem(system.id);renderAll();return;}
    enabledOrder.push(system.id);
    setContext(system);
    renderAll();
    const layer=await AnatomyViewer.setLayerVisible(system,true,()=>{renderToggle(system);updateStage();});
    if(!enabledOrder.includes(system.id)){renderAll();return;} // switched off while loading
    if(layer.status==='error')enabledOrder.splice(enabledOrder.indexOf(system.id),1);
    else if(layer.status==='ready'){
        // A model made outside the layered export has its own frame, so it is never mixed with other layers.
        for(const other of [...enabledOrder]){
            if(other===system.id)continue;
            const state=AnatomyViewer.layerState(other);
            if(!layer.layered || (state && state.status==='ready' && !state.layered))disableSystem(other);
        }
        if(!layer.layered)AnatomyViewer.resetView();
    }
    renderAll();
}

// ── Practice and viewer tools ──
anatomyEl('practiceButton').onclick=()=>{
    const entries=selectedSystem?.structures.filter(s=>s.desc)||[];if(entries.length<2)return;
    const target=entries[Math.floor(Math.random()*entries.length)];
    anatomyEl('practicePrompt').textContent=target.desc;
    anatomyEl('practiceResult').textContent='';const list=anatomyEl('practiceChoices');list.replaceChildren();
    const shuffled=[...entries];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    const choices=[target,...shuffled.filter(s=>s!==target).slice(0,3)].sort(()=>Math.random()-.5);
    choices.forEach(s=>{const button=document.createElement('button');button.className='btn btn-secondary';button.textContent=s.name;button.onclick=()=>{anatomyEl('practiceResult').textContent=s===target?'Correct. '+target.desc:'Try again. Read the description carefully.';};list.append(button);});
};
anatomyEl('exitFocus').onclick=exitFocus;
anatomyEl('resetModel').onclick=()=>{if(!viewerReady)return;if(AnatomyViewer.focusedPart)exitFocus();AnatomyViewer.resetView();};
anatomyEl('zoomIn').onclick=()=>viewerReady&&AnatomyViewer.zoom(.85);
anatomyEl('zoomOut').onclick=()=>viewerReady&&AnatomyViewer.zoom(1.15);
anatomyEl('rotateModel').onclick=e=>{if(viewerReady){AnatomyViewer.controls.autoRotate=!AnatomyViewer.controls.autoRotate;e.target.setAttribute('aria-pressed',String(AnatomyViewer.controls.autoRotate));}};
anatomyEl('exportModel').onclick=()=>viewerReady&&AnatomyViewer.hasVisibleLayer()&&AnatomyViewer.screenshot();
// Capture phase, so Escape leaves focus before it can also leave presentation mode.
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&viewerReady&&AnatomyViewer.focusedPart){event.stopImmediatePropagation();exitFocus();}},true);
if(!teacherExplorer){
setInterval(()=>{const now=Date.now();if(!document.hidden && selectedSystem)activeSeconds+=Math.min((now-lastTick)/1000,2);lastTick=now;},1000);
setInterval(flushExploration,45000);window.addEventListener('pagehide',flushExploration);
document.addEventListener('visibilitychange',()=>{lastTick=Date.now();if(document.hidden)flushExploration();});
}
(async()=>{
    if(!await Auth.requireAuth(teacherExplorer?'teacher':'student'))return;
    try{
        await AnatomyData.load();
        if(studentPreview)AnatomyData.systems=AnatomyData.systems.filter(s=>s.isActive);
        const systems=AnatomyData.systems;toggleBox.replaceChildren();
        if(!systems.length){toggleBox.textContent='No body systems yet.';modelMessage.textContent='No anatomy content has been published yet.';anatomyEl('systemTitle').textContent='Anatomy content is coming soon';return;}
        try{AnatomyViewer.init(anatomyEl('anatomyCanvas'));AnatomyViewer.onPartClick=handlePartClick;AnatomyViewer.labelFor=part=>structureFor(part)?.name||part.userData.name;viewerReady=true;}catch(error){console.warn('3D viewing is unavailable.',error);}
        systems.forEach(s=>toggleBox.append(createToggle(s)));
        const params=new URLSearchParams(location.search);
        const lessonId=studentPreview?null:params.get('lesson_id');
        if(lessonId){const response=await fetch(API_BASE+'/lessons.php?id='+encodeURIComponent(lessonId));const result=await response.json();if(result.success && /\.glb$/i.test(result.data.media_url||'')){const system=AnatomyData.getSystem(result.data.system_code);if(system){system.modelUrl=result.data.media_url;system.name=result.data.title;}}}
        const first=AnatomyData.getSystem(params.get('system'))||systems.find(s=>s.modelUrl)||systems[0];
        await toggleSystem(first);
        renderAll();
    }catch(error){modelMessage.textContent='Unable to load anatomy content. Reload the page to try again.';}
})();
```

- [ ] **Step 6: Run the syntax check**

Run: `node tests/check-syntax.mjs`
Expected: `Passed: …`, including the new local resources (`DRACOLoader.js`, `anatomy-layers-core.js`) referenced from both pages.

- [ ] **Step 7: Checkpoint**

Run: `node --test "tests/unit/*.test.mjs"`
Expected: `ℹ pass 10`.

---

### Task 6: Muscular layer

**Files:**
- Generated: `system_model/layers/muscular.glb`, updated `manifest.json`

- [ ] **Step 1: Export it in Blender**

Call `mcp__Blender__execute_blender_code` with:

```python
p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "muscular"}
exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)
result = {"report": g["LAYER_EXPORT_REPORT"]}
```
Expected: `muscular`: 1154 parts, ~3.74M source → ~1.1M triangles, under 15 MB.

- [ ] **Step 2: Run the asset test for both layers**

Run: `node tests/layers-asset.mjs`
Expected: `skeletal: … OK` and `muscular: … OK`.

- [ ] **Step 3: Verify both layers together in the harness**

Reload `http://127.0.0.1:8092/tests/layers-harness.html`, click both buttons, then run:

```js
(async()=>{for(let i=0;i<90&&['skeletal','muscular'].some(id=>AnatomyViewer.layerState(id)?.status!=='ready');i++)await new Promise(r=>setTimeout(r,500));await new Promise(r=>setTimeout(r,2000));return {skeletal:AnatomyViewer.layerState('skeletal').parts.size,muscular:AnatomyViewer.layerState('muscular').parts.size,fps:window.harnessFps};})()
```
Expected: `{skeletal:1599, muscular:1154, fps: ≥30}`.

Take a screenshot and confirm the muscles sit exactly on the skeleton with no offset or scale mismatch. Switch muscles off and on and confirm it happens instantly, with no second download (check `read_network_requests` with `urlPattern: 'muscular.glb'` for a single request).

Focus `Bulbospongiosus | anatomy_04876`:

```js
(()=>{const p=AnatomyViewer.layerState('muscular').parts.get('anatomy_04876');AnatomyViewer.onPartClick(p);return document.getElementById('log').textContent;})()
```
Expected: the info shows the description, function, `alsoPartOf: ["reproductive"]` (the harness has no name for reproductive) and the OpenStax reference.

If FPS is below 30 with both layers on, record the value and the device, and report it to the user before going on. Don't change the decimation ratio without asking.

- [ ] **Step 4: Stop the harness server**

Stop the background `php -S` task.

---

### Task 7: Database hook-up

**Files:**
- Create: `database/integrate_layers.php`

**Precondition:** Apache and MySQL are running in XAMPP.

- [ ] **Step 1: Verify the attribution link**

Fetch `https://github.com/LluisV/Z-Anatomy` and confirm it is the Z-Anatomy project with a CC BY-SA 4.0 licence. If it isn't, remove the URL in parentheses from `LAYER_CREDIT` below, leaving "Z-Anatomy, licensed CC BY-SA 4.0".

- [ ] **Step 2: Create `database/integrate_layers.php`**

```php
<?php
/** Connect the layered whole-body model files to their body systems without replacing learning content. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/connection.php';
const LAYER_CREDIT = '3D model: Z-Anatomy (https://github.com/LluisV/Z-Anatomy), licensed CC BY-SA 4.0. Reduced for web; the reduced model files are shared under the same licence.';
// Default text written by integrate_skeleton.php for the old single-mesh skeleton; it no longer applies.
const OLD_SKELETON_DESCRIPTION = 'Explore the supplied human skeleton model. Rotate, zoom, and reset the view to study its overall form. This asset is a single combined mesh; individual bones cannot be selected separately.';
$layers = ['skeletal' => ['Skeletal System', '#1a6b4a', 1], 'muscular' => ['Muscular System', '#b91c1c', 2]];

function glbJson(string $file): array {
    $stream = fopen($file, 'rb');
    $header = unpack('Vmagic/Vversion/Vlength/VjsonLength/Vtype', fread($stream, 20));
    if ($header['magic'] !== 0x46546c67 || $header['version'] !== 2 || $header['type'] !== 0x4e4f534a) throw new RuntimeException(basename($file) . ' is not a GLB 2.0 model.');
    $json = json_decode(fread($stream, $header['jsonLength']), true, 512, JSON_THROW_ON_ERROR);
    fclose($stream);
    return $json;
}

// The old skeleton's credit, built exactly as integrate_skeleton.php built it, is removed from the Skeletal System.
$oldCredit = '';
$oldAsset = __DIR__ . '/../system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb';
if (is_file($oldAsset)) {
    $extras = glbJson($oldAsset)['asset']['extras'] ?? [];
    $oldCredit = implode("\n", array_filter([$extras['title'] ?? '', 'Author: ' . ($extras['author'] ?? ''), 'License: ' . ($extras['license'] ?? ''), 'Source: ' . ($extras['source'] ?? '')]));
}

$only = array_slice($argv, 1);
$db = Database::getInstance();
$pdo = $db->getConnection();
foreach ($layers as $code => [$name, $color, $order]) {
    if ($only && !in_array($code, $only, true)) continue;
    $file = __DIR__ . "/../system_model/layers/$code.glb";
    if (!is_file($file)) throw new RuntimeException("Missing system_model/layers/$code.glb. Export it with tools/blender/export_layers.py first.");
    $layered = false;
    foreach (glbJson($file)['nodes'] ?? [] as $node) if (($node['extras']['anatomy_schema'] ?? null) === '1.0') $layered = true;
    if (!$layered) throw new RuntimeException("$code.glb is not a layered anatomy export.");
    $description = "Explore the $name in the layered body model. Switch body systems on and off, then select a part to zoom in on it.";
    $pdo->beginTransaction();
    try {
        $system = $db->fetchOne('SELECT system_id, description FROM body_systems WHERE system_code = ?', [$code]);
        if ($system) {
            $id = (int)$system['system_id'];
            if (trim($system['description'] ?? '') === OLD_SKELETON_DESCRIPTION) $db->query('UPDATE body_systems SET description=? WHERE system_id=?', [$description, $id]);
        } else {
            $id = $db->insert('body_systems', ['system_code'=>$code, 'system_name'=>$name, 'color_hex'=>$color, 'description'=>$description, 'sort_order'=>$order, 'is_active'=>1]);
        }
        $existing = $db->fetchOne('SELECT source_text FROM anatomy_content WHERE system_id=?', [$id]);
        $source = trim($existing['source_text'] ?? '');
        if ($code === 'skeletal' && $oldCredit !== '') $source = trim(str_replace($oldCredit, '', $source));
        if (!str_contains($source, LAYER_CREDIT)) $source = $source === '' ? LAYER_CREDIT : $source . "\n\n" . LAYER_CREDIT;
        $db->query('INSERT INTO anatomy_content (system_id, model_url, key_facts, structures, source_text) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model_url=VALUES(model_url), source_text=VALUES(source_text)', [$id, "../system_model/layers/$code.glb", '{}', '[]', $source]);
        $pdo->commit();
        echo "$name connected to system_model/layers/$code.glb. Existing facts and structures preserved.\n";
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
}
```

- [ ] **Step 3: Lint it**

Run: `C:\xampp\php\php.exe -l database\integrate_layers.php`
Expected: `No syntax errors detected`.

- [ ] **Step 4: Record the current rows, then run it**

```powershell
& C:\xampp\mysql\bin\mysql.exe -u root anatomiq_db -e "SELECT bs.system_code, bs.is_active, ac.model_url, LEFT(ac.source_text,120) FROM body_systems bs LEFT JOIN anatomy_content ac ON ac.system_id=bs.system_id ORDER BY bs.sort_order;"
& C:\xampp\php\php.exe database\integrate_layers.php
```
Expected output:
```
Skeletal System connected to system_model/layers/skeletal.glb. Existing facts and structures preserved.
Muscular System connected to system_model/layers/muscular.glb. Existing facts and structures preserved.
```

- [ ] **Step 5: Verify the rows**

Re-run the `SELECT` from Step 4.
Expected: `skeletal` and `muscular` have `../system_model/layers/<code>.glb` and the Z-Anatomy credit. Other systems are unchanged. Key facts and structures that existed before are unchanged.

- [ ] **Step 6: Verify the real explorer pages**

Open `http://localhost/Anthropotomy/student/anatomy.html` and `http://localhost/Anthropotomy/teacher/anatomy.html` in the built-in browser. Ask the user to sign in themselves (do not enter credentials). On each page, check:

1. The skeleton toggle is on and the skeleton loads. The other systems are listed; those without models say "No 3D model yet".
2. Switching on Muscular overlays the muscles. Switching Skeletal off leaves only the muscles.
3. Clicking a bone glides to it, fades the rest, and shows the "Awaiting identification" badge and the unidentified text.
4. Esc, "Back to full body" and clicking empty space each restore the view. On the teacher page, Esc in presentation mode with nothing focused still exits presentation.
5. The side panel switches to the clicked part's system.
6. The Sources line shows the Z-Anatomy credit.
7. Check `read_console_messages` with `onlyErrors: true`. Expected: no errors.
8. Resize to `mobile`, confirm the toggles wrap and there's no horizontal scroll, then reset to `desktop`.

---

### Task 8: Browser test and README

**Files:**
- Modify: `tests/browser.mjs:54-56`, `tests/browser.mjs:72`, `tests/browser.mjs:129-131`
- Modify: `README.md`

- [ ] **Step 1: Update `tests/browser.mjs`**

Replace lines 54–56:

```js
        for(let i=0;i<25;i++){if(await evaluate('Boolean(AnatomyViewer.root)'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.ok(await evaluate('Boolean(AnatomyViewer.root)'),'Teacher loads the real GLB');
        assert.equal(await evaluate(`document.querySelectorAll('#systemSelect option').length`),2,'Teacher sees hidden systems');
```
with:
```js
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
        assert.ok(await evaluate('AnatomyViewer.hasVisibleLayer()'),'Teacher loads the real GLB');
        assert.equal(await evaluate(`document.querySelectorAll('#systemToggles .system-toggle').length`),2,'Teacher sees hidden systems');
        assert.equal(await evaluate(`document.querySelector('#systemToggles .system-toggle[aria-checked="true"]').dataset.system`),'test-system','The system with a model starts switched on');
```

Replace line 72:

```js
        assert.equal(await evaluate(`document.querySelectorAll('#systemSelect option').length`),1,'Student preview excludes hidden systems');
```
with:
```js
        assert.equal(await evaluate(`document.querySelectorAll('#systemToggles .system-toggle').length`),1,'Student preview excludes hidden systems');
```

Replace lines 129 and 131:

```js
        for(let i=0;i<25;i++){if(await evaluate('Boolean(AnatomyViewer.root)'))break;await new Promise(resolve=>setTimeout(resolve,400));}
```
```js
        assert.ok(await evaluate('Boolean(AnatomyViewer.root)'),'Real GLB model loaded');
```
with:
```js
        for(let i=0;i<25;i++){if(await evaluate('AnatomyViewer.hasVisibleLayer()'))break;await new Promise(resolve=>setTimeout(resolve,400));}
```
```js
        assert.ok(await evaluate('AnatomyViewer.hasVisibleLayer()'),'Real GLB model loaded');
```

The fixture points at the old single-mesh skeleton, so these checks also cover the "shown on its own" path for models outside the layered export.

- [ ] **Step 2: Update `README.md`**

In **Anatomy content**, replace the paragraph that starts "Use the Media Library to upload a GLB model" and the paragraph that starts "The existing skeleton asset is in system_model/" with:

```markdown
The explorer shows a layered whole body. Each body system is a toggle; any combination can be switched on, and a system downloads the first time it is switched on. Selecting a part glides the camera to it, fades everything else and shows the part's name, system, description and function. Esc, **Back to full body** or a click on empty space returns to the full view. Most parts of the supplied model have not been identified yet. These show an **Awaiting identification** badge, and no description is invented for them.

The layered models are in `system_model/layers/`, one GLB per system. They are exported from the prepared Blender file with `tools/blender/export_layers.py`, which reduces each part to about 30% of its triangles, compresses with Draco and embeds each part's ID, name, description and function. `node tests/layers-asset.mjs` checks the exported files against `system_model/layers/manifest.json`. After exporting, run `C:/xampp/php/php.exe database/integrate_layers.php` to connect the Skeletal and Muscular systems. The source model is Z-Anatomy (CC BY-SA 4.0); the reduced files are shared under the same licence and credited in each system's sources.

A teacher can still upload a GLB in the Media Library and choose its URL in School & Anatomy Content. A model that was not made by the layered export is shown on its own. A structure's optional model part name maps its description to a named mesh or parent group in the GLB file, or to a part ID such as `anatomy_00848` in the layered models.
```

In **Supplied skeletal model**, replace the section body with:

```markdown
The bundled `system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb` is used by the landing page hero. The anatomy explorers use the layered models in `system_model/layers/` instead (see Anatomy content). `database/integrate_skeleton.php` remains for installations that want the single-mesh skeleton connected to the Skeletal System.
```

In **Verification**, after the `node tests/check-syntax.mjs` block, add:

```markdown
Unit tests for the layered viewer's helpers run with `node --test "tests/unit/*.test.mjs"`. `node tests/layers-asset.mjs` validates the exported layer files.
```

- [ ] **Step 3: Final checks**

Run: `node tests/check-syntax.mjs`, `node --test "tests/unit/*.test.mjs"`, `node tests/layers-asset.mjs`
Expected: all three pass.

The full `tests/browser.mjs` run needs the isolated test database, the PHP test server and headless Chrome described in the README. Run it if that setup is available. Otherwise say plainly that it wasn't run, and rely on the manual checks from Task 7 Step 6.

---

## Later (not in this plan)

- Export the other nine systems one at a time: `LAYER_EXPORT_SYSTEMS = "circulatory"` and so on, then add each code to `$layers` in `integrate_layers.php` (circulatory is the heaviest at 4.0M triangles; check its size and frame rate first).
- The content project: identifying parts and teacher editing keyed by `part_id`.
