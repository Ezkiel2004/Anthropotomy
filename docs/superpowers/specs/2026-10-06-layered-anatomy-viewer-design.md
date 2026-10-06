# Layered 3D Anatomy Viewer — Design

Date: 2026-10-06
Status: Approved in brainstorming, awaiting spec review

## Goal

Upgrade the existing 3D Anatomy Explorer (student and teacher pages) into a layered whole-body viewer:

- Each body system is an independent layer that can be switched on or off in any combination, starting with the skeleton and then the muscles.
- Every part of a visible system is clickable. Clicking zooms in on that part and shows its name, description and function.

## Decisions

| Topic | Decision |
|---|---|
| Content for parts | Ship the viewer first. Unidentified parts are clearly marked; identifying and describing them is a separate later project. |
| Placement | Replace the current explorer on `student/anatomy.html` and `teacher/anatomy.html`. Preview, presentation mode, quick practice and analytics stay. |
| Click behaviour | Camera glides to the part, the part glows, everything else fades to a faint see-through shell, info panel opens. |
| Detail level | About 30% of source triangles per part (skeleton ≈ 550k, muscles ≈ 1.1M), Draco-compressed, roughly 5–10 MB per system. |
| Architecture | One compressed GLB per system with part metadata embedded (approach A). |
| First systems | Skeletal, then Muscular. The other nine follow one at a time with the same pipeline. |
| Model source | Z-Anatomy, CC BY-SA 4.0. Credited in each system's Sources line. |

## Out of scope

- Identifying the ~4,850 unnamed parts, and writing their descriptions and functions.
- Teacher tools for editing part content, and database overrides keyed by part ID. The design leaves room for them: part IDs are stable.
- The "spread parts apart" (explode) animation. The stored explode directions are not used yet.
- Removing the unused `assets/js/anatomy-three.js`.

## Source asset

`HumanAnatomyBackup.blend`, scene **Anatomy - Layered**. The assembly root is `ANATOMY | whole body`, which carries the shared body transform. Under it are 11 system empties (`LAYER | Skeletal`, `LAYER | Muscular`, …), each with its part meshes. Every part mesh is at zero local transform and has these custom properties:

`anatomy_role` (`part`), `part_id`, `system_id`, `systems`, `name`, `assembly_id`, `description`, `function`, `identity_status`, `reference`, `source_objects`, `rest_position`, `focus_center`, `bounds_min`, `bounds_max`, `explode_direction`.

| System | Meshes | Triangles | Identified |
|---|---|---|---|
| Skeletal | 1,599 | 1.78M | 0 |
| Muscular | 1,154 | 3.74M | 5 |

`identity_status` is `source_identity_required` for unidentified parts and `visual_identification_requires_review` for the few provisionally identified ones.

## 1. Asset pipeline

New script: `tools/blender/export_layers.py`, run inside Blender against the open file. It takes one system code or `all`.

For each requested system it:

1. Selects the assembly root, that system's `LAYER | …` empty, and the system's part meshes (`anatomy_role == "part"` and `system_id == <code>`).
2. Adds a temporary Decimate (Collapse) modifier at ratio 0.30 to each part with more than 500 triangles. Smaller parts are left as they are so they keep their shape.
3. Exports `system_model/layers/<system_code>.glb` with selection only, modifiers applied, custom properties as glTF `extras`, and Draco mesh compression on.
4. Removes the temporary modifiers so the scene is unchanged. The script never saves the `.blend`.
5. Prints a report: part count, exported triangle count, and file size.

Rules:

- **One file per part.** Each part goes into exactly one file, chosen by its primary `system_id`. Other entries in `systems` are shown as information only and do not affect visibility.
- **Shared frame.** Every file contains the same assembly root transform, so layers overlay exactly when loaded together. The root node's extras include `anatomy_schema: "1.0"`; the viewer uses this marker to recognise layered files.
- **Licence.** The exported GLBs are adaptations of Z-Anatomy and are distributed under CC BY-SA 4.0.

## 2. Viewer

`assets/js/model-viewer.js` is rewritten. It keeps the `AnatomyViewer` global and the existing `init`, `resetView`, `zoom`, `screenshot` and `onSelect` members.

**Layers.** `layers` is a `Map` from system code to `{ status, root, parts }`, where `status` is one of `idle`, `loading`, `ready` or `error`.

- `setLayerVisible(system, on)` loads the file the first time a system is switched on, and after that only shows or hides it.
- A per-layer generation counter discards loads that finish after the user has already switched the layer off.

**Draco.** `GLTFLoader` is given a `DRACOLoader` that points at the vendored r128 decoder files in `assets/vendor/three/draco/`.

**Part data.** Three.js copies node `extras` into `userData`. A multi-material part becomes a Group with child meshes, so a hit resolves its part by walking up the parents to the first object with `userData.part_id`.

**Legacy files.** A loaded GLB without the `anatomy_schema` marker, such as a teacher upload or a lesson attachment, is shown alone: other layers are hidden and a short note explains why. This preserves today's behaviour, including mesh-name structure mapping.

**Hover**

- Raycasting is throttled to one per animation frame and only tests visible layers.
- The hovered part glows teal and a small label shows its name.

**Focus (click)**

- The camera glides over 800 ms (ease-in-out) to frame the part's world bounding box, computed at runtime, while keeping the current viewing direction. With `prefers-reduced-motion` it jumps instead.
- The selected part gets a cloned highlight material (gold emissive).
- Every other visible part swaps to a shared translucent ghost material: one per layer, about 12% opacity, `depthWrite` off. The original material is kept in `userData` and restored on exit.
- When a click hits several parts, the focused part wins if it was hit; otherwise the nearest hit is used. So clicking a faded part moves focus to it.
- Exit by pressing Esc, clicking "Back to full body", or clicking empty space. Exiting restores materials and the camera position saved before focus.
- If the focused part's layer is switched off, focus ends.

## 3. Page and UI

Both explorer pages get the same changes, driven by `assets/js/anatomy-page.js`. The HTML changes are in `student/anatomy.html` and `teacher/anatomy.html`.

**System toggles**

- The "Body system" `<select>` becomes a group of toggle buttons (`role="switch"`, `aria-checked`), one per database system, in `sort_order`.
- The skeleton (or the first system with a model) is on when the page opens.
- Any combination may be on. With none on, the stage shows "Switch on a body system to begin."
- Each toggle shows its own status:
  - "Loading 45%" while downloading
  - "Couldn't load — select to retry" after a failure
  - "No 3D model yet" when the system has no `model_url`. The toggle never switches on, but clicking it still shows that system's content, as the explorer does today.
- Teacher view marks hidden systems "(hidden)". Student preview lists only active systems.

**Part info panel**

The existing "Choose a structure" panel shows, for the focused part:

- name and system name
- description
- function
- "Also part of: …" when `systems` has more than one entry
- reference link, when present
- "Back to full body" button

For unidentified parts (`identity_status == "source_identity_required"`):

- The name shows as given (for example "Bone component 00123") with an **Awaiting identification** badge.
- The description area reads: "This part hasn't been identified yet. Its description and function will be added after review."
- Nothing else is filled in.

**Side panel**

The system description, key facts, structures and sources shown are for the *context system*: the system of the last clicked part, otherwise the last system switched on.

Teacher-defined structures keep working. A structure's `mesh_name` may now hold a part ID (for example `anatomy_00848`), a node name or a parent name. Clicking a structure button focuses its part when the part is loaded, and otherwise behaves as today.

**Kept unchanged:** quick practice, zoom and reset buttons, auto rotate, Save image, student preview, presentation mode, and the lesson GLB override (`?lesson_id=`).

**Analytics:** exploration time and interactions are attributed to the context system. When the context system changes, the pending record is flushed, as happens today when the system changes. `structures_viewed` receives the names of parts and structures that were focused.

## 4. Database hook-up

New CLI script: `database/integrate_layers.php`, following `database/integrate_skeleton.php`.

- Points the Skeletal and Muscular systems' `anatomy_content.model_url` at `system_model/layers/skeletal.glb` and `system_model/layers/muscular.glb`.
- Creates either system if it is absent, visible to students, as the skeleton script does.
- Sets `source_text` to credit "Z-Anatomy (CC BY-SA 4.0), reduced for web".
- Preserves existing descriptions, facts and structures.
- No schema change.

The landing page keeps using `system_model/male_human_skeleton_-_zbrush_-_anatomy_study.glb`.

## 5. Error handling

| Case | Behaviour |
|---|---|
| One system's file fails to load | That toggle shows the retry state; other layers keep working. |
| No WebGL | Content stays readable (existing message). |
| Draco decoder missing | Load error, shown in the toggle state. |
| Rapid toggling or clicking | Generation counters drop stale loads and camera animations. |
| Legacy GLB | Shown alone with a note. |

## 6. Testing

- `node tests/check-syntax.mjs` for all JavaScript.
- `tests/browser.mjs`: replace the `#systemSelect option` counts with toggle counts, and replace `AnatomyViewer.root` checks with a ready-layer check.
- Export report: part counts per file match Blender, and triangle counts and sizes are within the target.
- Manual check in the in-app browser on localhost, with XAMPP running:
  - Layers toggle independently in any combination.
  - Skeleton and muscles line up.
  - Click focuses, fades the rest and fills the panel; Esc, the back button and empty-space clicks all restore the view.
  - The unidentified badge appears for unidentified parts.
  - A failed load shows the retry state.
  - Mobile width works.
  - Frame rate stays smooth with skeleton and muscles both on.

## 7. Implementation checklist

Critical path first:

1. Write `tools/blender/export_layers.py` and export `skeletal.glb`; verify the report and that extras are present.
2. Vendor `DRACOLoader.js` and the r128 decoder into `assets/vendor/three/`.
3. Rewrite `model-viewer.js` with per-system layers, load-on-first-use, show/hide and the legacy fallback.
4. Replace the dropdown with toggles on both explorer pages, with per-toggle status.
5. Add focus (camera glide, fade, highlight), the part info panel and exit paths.
6. Export `muscular.glb`, write and run `database/integrate_layers.php`, and verify skeleton and muscles together.
7. Add the hover label and throttled raycasting, and check performance.
8. Map structures, practice and analytics onto part IDs and the context system.
9. Update `tests/browser.mjs` and the README.
10. Later, one at a time: export the other nine systems. After that, the separate content project.
