# Prompt: re-export the Z-Anatomy layers as accurately as possible

Paste everything below the line into Claude Code, opened in `C:\xampp\htdocs\Anthropotomy`, with Blender running `D:\Capstone_Model_Backup\Z-Anatomy.blend` and the Blender MCP add-on connected.

---

You are improving how faithfully the Anthropotomy anatomy explorer shows the Z-Anatomy model. Today, `tools/blender/export_layers.py` exports each body system from `Z-Anatomy.blend` to `system_model/layers/<system>.glb`. It keeps a flat 30% of the triangles of every part over 500 triangles, whatever that part looks like afterwards. Replace that with an export whose accuracy is measured: every part keeps its true shape and position, every structure that should be there is there, and every name and definition is right. The files must still load quickly in a browser.

## Read first, change nothing yet

1. Read `README.md` (the layered-model section), `docs/superpowers/specs/2026-10-06-layered-anatomy-viewer-design.md`, `tools/blender/export_layers.py`, `tools/blender/export_female_reproductive.py`, `tests/layers-asset.mjs`, `system_model/layers/manifest.json`, `system_model/layers/clusters.json`, `assets/js/model-viewer.js` and `assets/js/anatomy-layers-core.js` (`tissueLook`, `materialLook`).
2. Inspect the open scene through the Blender MCP before assuming anything. It runs Blender 5.2.1, metric units at scale 1, with about 7,200 objects. The top-level collections are `1: Skeletal system` … `8: Visceral systems`, `9: Regions of human body`, reference and cross-section collections, and a large `Bonus collection` that links copies of almost everything. Each system is reached through its group object (`Skeletal system.g`, `Muscular system.g`, …), as listed in `SYSTEMS` in the export script. Return structured data from `execute_blender_code`. Never dump the whole scene.
3. Record a baseline from the current GLBs for each system: part count, part IDs, names, triangles and bytes.

## Hard rules (the project depends on these)

- **Never save, and never permanently change, `Z-Anatomy.blend`.** Work on temporary copies of evaluated geometry, as the current script does, and restore every visibility and selection setting you touch.
- **One shared body frame.** All layers come from the same file and must overlay exactly. Keep `export_yup=True`, world transforms and metres. Do not re-centre or rescale anything.
- **Keep the part data the viewer reads,** exported as glTF extras on each part node: `anatomy_schema: "1.0"`, `anatomy_role: "part"`, `part_id`, `system_id`, `systems`, `name`, `description`, `function`, `identity_status`, `source_objects`.
- **Part IDs stay stable.** IDs are `za_` plus the slugged Z-Anatomy name (for example `za_femur_l`). Teacher structures and study clusters refer to parts by ID and display name, so an existing part must keep the same ID and display name. List every ID that appears, disappears or changes, and explain why.
- **`clusters.json` must still match.** Every name it lists must exist in its system's GLB (`tests/unit/explorer.test.mjs` checks this).
- **Keep the Z-Anatomy material names.** The viewer recolours parts by material name and part name, so do not rename, merge or bake materials. No textures, UVs, vertex colours or tangents.
- **Draco compression stays on,** and each file stays under the 15 MB limit in `tests/layers-asset.mjs`. Aim for 8 MB or less per system, because students open these on school laptops and phones.
- **The female reproductive layer** comes from a different pipeline (`export_female_reproductive.py`, from the Stanford model). Leave it alone unless a step below says otherwise.
- Extend `export_layers.py` instead of writing a parallel script, and match its style: module docstring, short comments, plain functions.

## What "accurate" means here, and how to measure it

### 1. Shape: decimate by error, not by a fixed ratio

- For each part, compare the reduced mesh with the full-resolution evaluated mesh. Build a `mathutils.bvhtree.BVHTree` on each side and sample distances both ways (source vertices to the reduced surface, and reduced vertices to the source surface). Report the 95th-percentile and maximum deviation in millimetres.
- Choose each part's decimation ratio as the lowest one that keeps the deviation within tolerance. Search the ratio between about 0.15 and 1.0, for example with a binary search. Suggested tolerances: 95th percentile ≤ 0.3 mm and maximum ≤ 1.0 mm for bones, joints and small organs; ≤ 0.5 mm and ≤ 1.5 mm for muscles, vessels and nerves. Parts under 500 triangles stay unreduced.
- If a system goes over budget, relax the tolerance for that system in small steps. Never cap the triangle count blindly. Report the tolerance each system ended up with.
- Keep thin and fine structures intact: small foramina, the ossicles of the ear, nerve and vessel branches, tendons and the edges of sheet-like parts (pleura, peritoneum, fasciae). Use `use_collapse_triangulate` and symmetry only if they lower the error, and keep the weld at 1e-6 so separate parts never fuse.
- Keep smooth and sharp shading as authored. Check that normals still export after the weld and decimate modifiers, and that no part turns faceted or inside-out.
- Check that Draco quantization does not undo this work. With 14 position bits over a body about 1.8 m tall, the step is roughly 0.1 mm. Confirm the measured deviation still holds after Draco decoding by re-importing the GLB in Blender and measuring a sample of parts against the source.

### 2. Completeness: every structure that belongs in a system

- For each system, list every object under its group that the current filter (`is_structure`, `HELPER_SUFFIX`, `LEFT_OUT`, the collection filter) leaves out, grouped by reason.
- Confirm each exclusion is right: labels, helpers (`.g .j .i .t`), muscle-attachment overlays (`.ol .or .el .er`), variants named `(...)` or `[...]`, and the greater omentum, which hides the intestines. Flag anything that looks like real anatomy but is dropped, for example a curve whose geometry comes from a bevel object or geometry nodes, an object with only a modifier-generated mesh, or a structure that sits only in another collection.
- Check that no structure lands in two layers and that none is missing from all of them. Each part belongs to exactly one file, chosen by its primary system.
- Check left/right pairs. Every `.l` part should have its `.r` partner unless the anatomy is unpaired, and the two should mirror each other across the midline within about 1 mm.

### 3. Placement: each part where it is in the body

- After export, re-import each GLB into a scratch scene. Compare every part's world-space bounding-box centre and size with its source object. The difference should be under 0.5 mm.
- Load all ten Z-Anatomy layers together and check that they overlap the way they do in the .blend: muscles on bone, vessels in their grooves, organs inside their cavities.

### 4. Names and descriptions

- `name` is the display name: Z-Anatomy name, synonym notes removed, side written as "(left)" or "(right)". List any name that still has stray suffixes, double spaces, `.001` copies or odd capitals.
- `description` comes from the matching Blender text datablock (the `definition()` function). Today some parts have none: compare `described` with `parts` in `manifest.json`. For each part without a description, try harder to find its text, for example under the base name without side, without synonym notes or under a near-identical name. List the parts that are still uncovered. Do not write or invent descriptions.
- Leave `function` empty and `identity_status` as `identified`. Function text is written separately.

## Steps

1. Baseline: per-system part lists, IDs, names, triangles and bytes from the current GLBs.
2. Audits 2 and 4 (completeness and names) on the scene. Report them before changing the exporter.
3. Implement error-driven decimation and the deviation measurement in `export_layers.py`, plus whatever fixes the audits showed are needed. Add the per-system tolerance and the measured deviation (`deviation_p95_mm`, `deviation_max_mm`) to each system's entry in `manifest.json`.
4. Export one small system first (`urinary`), then `skeletal`, and check both before running the rest. Large systems take minutes, so run the exec from `bpy.app.timers.register(...)` as the script's docstring says, to keep the MCP call from timing out.
5. Export the remaining Z-Anatomy systems: muscular, circulatory, lymphatic, nervous, respiratory, digestive, reproductive and endocrine.
6. Run the checks:
   - `node tests/layers-asset.mjs`
   - `node --test tests/unit/`
   - `C:/xampp/php/php.exe database/integrate_layers.php`
7. Look at the result in the real explorer (`student/anatomy.html` through XAMPP) with the built-in browser. Switch on skeletal, muscular and circulatory together, click a few small parts (an ear ossicle, a carpal bone, a coronary artery, a facial nerve branch) and confirm that the camera frames each one and the right name and description appear. Take before-and-after screenshots of the same close-up views.
8. If the models changed visibly, redraw the landing hero images: `npm run build:hero` in `landing-src/`.
9. Update the README's layered-model paragraph so it describes the new decimation and its tolerances.

## Report back

- A table per system: parts before → after, triangles before → after, MB before → after, deviation p95 and max in mm, and the tolerance used.
- Part IDs that were added, removed or changed, with the reason for each.
- Structures that were wrongly excluded and are now included, and structures still left out on purpose.
- Parts that still have no description.
- Before-and-after screenshots of the close-ups.
- Anything you could not verify.

Then commit with a dated title, for example `Accurate layer export: error-driven decimation, completeness and name audits (YYYY-MM-DD)`, and push to `main`.
