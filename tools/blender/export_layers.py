"""Export each body system of the Z-Anatomy model as its own web GLB layer.

Run inside Blender with Z-Anatomy.blend open, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
    g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "urinary"}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

LAYER_EXPORT_SYSTEMS is a comma-separated list of system codes, or "all". Large systems take several
minutes; to keep the MCP call from timing out, run the exec from bpy.app.timers.register(...), or leave the open
Blender alone and run the same three lines in the background:

    blender -b --factory-startup Z-Anatomy.blend --python-expr "p = ...; g = {...}; exec(...)"

For each system the script:
1. collects the structures under that system's Z-Anatomy group objects (meshes with geometry, including
   meshes whose faces come from modifiers such as Skin or geometry nodes, and curves with thickness, such as
   vessels and nerves), leaving out text labels, helper objects (.g .j .i .t), muscle-attachment overlays
   (.ol .or .el .er), anatomical variants named "(...)" or "[...]" and the structures in LEFT_OUT (the
   greater omentum);
2. briefly makes them visible, copies their evaluated geometry (modifiers applied, curves turned
   into meshes) into temporary objects, then restores every visibility setting;
3. welds the copies and decimates each part over MIN_TRIS triangles to the lowest ratio (MIN_RATIO to 1)
   that keeps it within the system's TOLERANCE of its full-resolution mesh, and within SIZE_SHARE of its own
   size: distances are measured both ways (each mesh's vertices to the other's surface), and the bounding box
   may move at most PLACEMENT_MM. A
   system whose file would pass BUDGET_BYTES is refitted with its tolerance relaxed in RELAX steps;
4. adds the part data the viewer reads (part ID, name, Z-Anatomy definition, system) as glTF extras, exports
   system_model/layers/<system>.glb with Draco compression, then re-imports the file and measures every part
   again after Draco decoding (deviation, bounding box, faceted or inside-out parts);
5. deletes the temporary objects, meshes and imports. The user's objects are never changed and the .blend
   file is never saved.

All systems come from the same file, so the layers share one body frame and overlay exactly.
"""
import contextlib
import json
import os
import re
import struct

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

MIN_TRIS = 500
MIN_RATIO = 0.15
RATIO_STEP = 0.02  # the search stops when the passing and failing ratios are this close
RATIO = 0.30  # flat ratio, used only by export_female_reproductive.py
WELD_DISTANCE = 1e-6
# Deviation allowed between a part and its full-resolution mesh, in mm: (95th percentile, maximum). Bones, joints
# and organs keep the fine one; muscles, vessels and nerves the coarse one.
FINE, COARSE = (0.3, 1.0), (0.5, 1.5)
TOLERANCE = {"skeletal": FINE, "muscular": COARSE, "circulatory": COARSE, "nervous": COARSE, "lymphatic": FINE,
             "respiratory": FINE, "digestive": FINE, "urinary": FINE, "reproductive": FINE, "endocrine": FINE}
# Never more than this share of the part's bounding-box diagonal either: the explorer fills the view with a selected
# part, so an ear ossicle needs hundredths of a millimetre where a femur is fine with tenths.
SIZE_SHARE = (1 / 1000, 1 / 250)
PLACEMENT_MM = 0.5  # largest change of a part's bounding-box centre or size
BUDGET_BYTES = 8 * 1024 * 1024
RELAX = 1.2  # tolerance step for a system over budget
TEMP_COLLECTION = "ZA web export (temporary)"
CHECK_COLLECTION = "ZA web check (temporary)"

# code -> Z-Anatomy group objects whose structures form the layer, and the collections they must be in
# (the collection filter drops copies that live in other collections, such as muscle insertions).
SYSTEMS = {
    "skeletal": (["Skeletal system.g", "Joints.g"], ["1: Skeletal system", "3: Joints"]),
    "muscular": (["Muscular system.g", "Fasciae.g"], ["4: Muscular system"]),
    "circulatory": (["Arterial system.g", "Venous system.g"], ["5: Cardiovascular system"]),
    "lymphatic": (["Lymphoid organs.g"], ["6: Lymphoid organs"]),
    "nervous": (["Nervous system & Sense organs.g"], ["7: Nervous system & Sense organs"]),
    "respiratory": (["Respiratory system.g", "Thoracic cavity.g"], ["8: Visceral systems"]),
    "digestive": (["Digestive system.g", "Abdominopelvic cavity.g"], ["8: Visceral systems"]),
    "urinary": (["Urinary system.g"], ["8: Visceral systems"]),
    "reproductive": (["Genital systems.g"], ["8: Visceral systems"]),
    "endocrine": (["Endocrine glands.g"], ["8: Visceral systems"]),
}

HELPER_SUFFIX = re.compile(r"\.(g|j|i|t|ol|or|el|er)(\.\d{3})?$")
# Structures left out of the web layers (lower-case names): the greater omentum hides the intestines.
LEFT_OUT = {"greater omentum"}
SIDE = {"l": "left", "r": "right"}
# Words a definition's title may write differently from the structure's name.
ORDINALS = {"first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th", "sixth": "6th",
            "seventh": "7th", "eighth": "8th", "ninth": "9th", "tenth": "10th", "eleventh": "11th", "twelfth": "12th"}
SPELLINGS = {"mammillary": "mamillary", "ileofemoral": "iliofemoral"}


def default_out_dir():
    here = globals().get("__file__")
    if here and os.path.isfile(here):
        return os.path.normpath(os.path.join(os.path.dirname(here), "..", "..", "system_model", "layers"))
    raise RuntimeError("Set LAYER_EXPORT_DIR to the project's system_model/layers folder.")


# ── Selection ──
def has_geometry(o):
    if o.type == 'MESH':  # faces may come from modifiers (Skin, geometry nodes); empty results are dropped on export
        return len(o.data.polygons) > 0 or len(o.modifiers) > 0
    if o.type == 'CURVE':
        return o.data.bevel_depth > 0 or o.data.bevel_object is not None or o.data.extrude > 0
    return False


def is_structure(o):
    return (has_geometry(o) and not HELPER_SUFFIX.search(o.name)
            and not o.name.startswith(("(", "[")) and re.search(r"[A-Za-z]", o.name)
            and re.sub(r"\.\d{3}$", "", o.name).lower() not in LEFT_OUT)


def system_parts(code):
    groups, collections = SYSTEMS[code]
    allowed = set()
    for name in collections:
        allowed.update(o.name for o in bpy.data.collections[name].all_objects)
    parts = []
    for group in groups:
        root = bpy.data.objects.get(group)
        if root is None:
            raise RuntimeError(f"Group object '{group}' not found. Is Z-Anatomy.blend open?")
        parts += [o for o in root.children_recursive if o.name in allowed and is_structure(o)]
    return parts


# ── Names and definitions ──
def base_name(name):
    name = re.sub(r"\.\d{3}$", "", name)
    return re.sub(r"\.(l|r)$", "", name)


def display_name(name):
    clean = re.sub(r"\.\d{3}$", "", name)
    clean = re.sub(r"\s*\(//.*\)\s*$", "", clean)  # Z-Anatomy synonym notes, e.g. "(//Posterior '')"
    side = re.search(r"\.(l|r)$", clean)
    clean = re.sub(r"\.(l|r)$", "", clean).strip()
    return f"{clean} ({SIDE[side.group(1)]})" if side else clean


def summary(text):
    """The first paragraph of a Z-Anatomy definition text, cleaned of Wikipedia leftovers, about 320 characters."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.as_string()) if p.strip()]
    paragraphs = [p for p in paragraphs if not p.isupper()]  # drop the upper-case title line
    if not paragraphs:
        return ""
    body = re.sub(r"\s+", " ", paragraphs[0])
    body = re.sub(r"\(\s*listen\s*\)", "", body)  # Wikipedia audio links: "( (listen) or (listen))"
    body = re.sub(r"\(\s*(or\s*)?\)", "", body)
    body = re.sub(r"\(\s*[,;]\s*", "(", body)       # "( , pl. femora )" -> "(pl. femora )"
    body = re.sub(r"\s+\)", ")", body)
    body = re.sub(r"\s{2,}", " ", re.sub(r"\(\s*\)", "", body)).replace(" ,", ",").strip()  # "womb () is" -> "womb is"
    body = re.sub(r"(?<=[a-z0-9][.!?])(?=[A-Z][a-z])", " ", body)  # sentences joined without a space: "30.The sacrum"
    sentences = re.split(r"(?<=[.!?])\s+", body)
    out = ""
    for sentence in sentences:
        if out and len(out) + len(sentence) > 320:
            break
        out = f"{out} {sentence}".strip()
    return out


def name_key(name):
    """A name reduced to its words: lower case, no punctuation, plurals, "the", "of" or "lymph", ordinals as numbers."""
    words = [SPELLINGS.get(w, ORDINALS.get(w, w)) for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in ("the", "of", "lymph")]
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words)


_texts_by_key = {}


def definition(name):
    plain = re.sub(r"\s*\(//.*\)\s*$", "", base_name(name))
    for text in (bpy.data.texts.get(base_name(name)), bpy.data.texts.get(plain)):
        if text and summary(text):
            return summary(text)
    # A text whose title differs only in case, punctuation, plurals, "the", "of", "lymph" or ordinals; never a guess
    # between two candidates.
    if not _texts_by_key:
        for text in bpy.data.texts:
            if summary(text):
                _texts_by_key.setdefault(name_key(text.name), []).append(text)
    found = _texts_by_key.get(name_key(plain), [])
    return summary(found[0]) if len(found) == 1 else ""


def part_id(name, used):
    slug = "za_" + re.sub(r"[^a-z0-9]+", "_", re.sub(r"\.\d{3}$", "", name).lower()).strip("_")
    candidate, n = slug, 2
    while candidate in used:
        candidate, n = f"{slug}_{n}", n + 1
    used.add(candidate)
    return candidate


# ── Temporary visibility ──
def layer_collections(layer_collection):
    yield layer_collection
    for child in layer_collection.children:
        yield from layer_collections(child)


def reveal(parts, view_layer, collections):
    """Make the parts evaluable and return a function that restores every changed setting.

    Only the system's own collections are shown. Z-Anatomy also links every structure into its large
    "Bonus collection"; showing that would make Blender evaluate millions of extra triangles."""
    undo = []
    for lc in layer_collections(view_layer.layer_collection):
        if lc.collection.name in collections:
            undo.append((lc, "exclude", lc.exclude)); undo.append((lc, "hide_viewport", lc.hide_viewport))
            undo.append((lc.collection, "hide_viewport", lc.collection.hide_viewport))
            lc.exclude = False; lc.hide_viewport = False; lc.collection.hide_viewport = False
    hidden = []
    for o in parts:
        undo.append((o, "hide_viewport", o.hide_viewport))
        o.hide_viewport = False
        if o.hide_get(view_layer=view_layer):
            hidden.append(o)
            o.hide_set(False, view_layer=view_layer)

    def restore():
        for o in hidden:
            o.hide_set(True, view_layer=view_layer)
        for target, attr, value in reversed(undo):
            setattr(target, attr, value)
    return restore


# ── Accuracy ──
def world_surface(mesh, matrix):
    """World-space vertices (n, 3), BVH tree and triangles (m, 3) of mesh placed by matrix. Loose vertices, which
    some Z-Anatomy meshes keep and glTF drops, are left out."""
    m = np.array(matrix)
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    mesh.calc_loop_triangles()
    tris = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tris)
    used = np.unique(tris)
    co = co.reshape(-1, 3)[used] @ m[:3, :3].T + m[:3, 3]
    tris = np.searchsorted(used, tris).reshape(-1, 3)
    return co, BVHTree.FromPolygons(co.tolist(), tris.tolist()), tris


def deviation(a, b):
    """95th-percentile and largest distance in mm between surfaces a and b (from world_surface), sampled both ways:
    a's vertices to b's surface and b's vertices to a's surface. One vertex per 0.1 mm cell counts, so the copies
    glTF and Draco make along shading seams and material borders do not weigh twice."""
    one = lambda co: co[np.unique(np.round(co * 1e4), axis=0, return_index=True)[1]].tolist()
    there = [b[1].find_nearest(p)[3] for p in one(a[0])]
    back = [a[1].find_nearest(p)[3] for p in one(b[0])]
    return 1000 * max(np.percentile(there, 95), np.percentile(back, 95)), 1000 * max(max(there), max(back))


def placement(a, b):
    """Largest difference in mm between the bounding-box centres and sizes of two vertex sets."""
    low_a, high_a, low_b, high_b = a.min(0), a.max(0), b.min(0), b.max(0)
    return 1000 * max(np.abs(low_a + high_a - low_b - high_b).max() / 2, np.abs(high_a - low_a - high_b + low_b).max())


def inside_out(source, part):
    """Share of part's surface area facing away from the nearest point of source's surface."""
    co, _, tris = part
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    normals = np.cross(b - a, c - a)
    area = np.linalg.norm(normals, axis=1)
    facing = [source[1].find_nearest(p)[1].dot(n) for p, n in zip(((a + b + c) / 3).tolist(), normals.tolist())]
    return float(area[np.array(facing) < 0].sum() / max(area.sum(), 1e-12))


def web_modifiers(temp, ratio):
    """Gives temp the weld (and below ratio 1 the decimation) the export applies, replacing earlier ones."""
    for modifier in [m for m in temp.modifiers if m.name.startswith("Web")]:
        temp.modifiers.remove(modifier)
    weld = temp.modifiers.new("WebWeld", 'WELD')
    weld.mode = 'ALL'
    weld.merge_threshold = WELD_DISTANCE
    if ratio < 1:
        decimate = temp.modifiers.new("WebDecimate", 'DECIMATE')
        decimate.decimate_type = 'COLLAPSE'
        decimate.ratio = ratio


def fit_ratios(temps, tolerance, relax=1.0):
    """Decimates each part over MIN_TRIS triangles to the lowest ratio between MIN_RATIO and 1 that keeps it within
    tolerance ((p95, max) in mm, or less for a small part, see SIZE_SHARE) and PLACEMENT_MM of its full-resolution
    mesh, all times relax. Bisection, with all parts stepping together so Blender evaluates them in one pass. Returns
    {part name: (ratio, p95 mm, max mm)}."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    fits, sources, limits, failed, trial = {}, {}, {}, {}, {}
    for temp in temps:
        fits[temp.name] = (1.0, 0.0, 0.0)
        if tri_count(temp.data) > MIN_TRIS:
            sources[temp.name] = world_surface(temp.data, temp.matrix_world)
            size = 1000 * np.linalg.norm(np.ptp(sources[temp.name][0], axis=0))
            limits[temp.name] = [relax * min(t, s * size) for t, s in zip(tolerance, SIZE_SHARE)]
            trial[temp.name] = MIN_RATIO
        web_modifiers(temp, trial.get(temp.name, 1.0))
    while trial:
        for name, ratio in trial.items():
            bpy.data.objects[name].modifiers["WebDecimate"].ratio = ratio
        depsgraph.update()
        for name, ratio in trial.items():
            evaluated = bpy.data.objects[name].evaluated_get(depsgraph)
            reduced = world_surface(evaluated.to_mesh(), evaluated.matrix_world)
            evaluated.to_mesh_clear()
            p95, worst = deviation(sources[name], reduced)
            if p95 <= limits[name][0] and worst <= limits[name][1] and placement(sources[name][0], reduced[0]) <= PLACEMENT_MM:
                fits[name] = (ratio, p95, worst)
            else:
                failed[name] = ratio
        trial = {n: (failed[n] + fits[n][0]) / 2 for n in trial if n in failed and fits[n][0] - failed[n] > RATIO_STEP}
        sources = {n: sources[n] for n in trial}
    for temp in temps:
        if fits[temp.name][0] == 1.0:
            web_modifiers(temp, 1.0)
        else:
            temp.modifiers["WebDecimate"].ratio = fits[temp.name][0]
    return fits


def verify(path, temps, window, view_layer):
    """Re-imports the exported file into a scratch collection and measures every part against its full-resolution
    mesh after Draco decoding: the worst 95th-percentile and largest deviation, the largest bounding-box change, and
    the parts that came back faceted (split vertices on a smooth source) or inside out."""
    scene = window.scene if window else bpy.context.scene
    kinds = ("objects", "meshes", "materials", "node_groups", "images")
    before = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
    previous_collection = view_layer.active_layer_collection
    scratch = bpy.data.collections.new(CHECK_COLLECTION)
    scene.collection.children.link(scratch)
    sources = {t["part_id"]: t for t in temps}
    found, p95s, worsts, shifts, faceted, flipped = set(), [0.0], [0.0], [0.0], [], []
    try:
        view_layer.active_layer_collection = view_layer.layer_collection.children[scratch.name]
        with bpy.context.temp_override(window=window) if window else contextlib.nullcontext():
            bpy.ops.import_scene.gltf(filepath=path)
        for o in scratch.all_objects:
            temp = sources.get(o.get("part_id"))
            if o.type != 'MESH' or temp is None:
                continue
            found.add(o["part_id"])
            source, part = world_surface(temp.data, temp.matrix_world), world_surface(o.data, o.matrix_world)
            p95, worst = deviation(source, part)
            p95s.append(p95); worsts.append(worst); shifts.append(placement(source[0], part[0]))
            sharp = [a for a in ("sharp_face", "sharp_edge") if a in temp.data.attributes]
            if len(part[0]) > 1.2 * len(part[2]) and not sharp:
                faceted.append(o["part_id"])
            if inside_out(source, part) > 0.5:
                flipped.append(o["part_id"])
    finally:
        for kind in kinds:
            collection = getattr(bpy.data, kind)
            for name in set(collection.keys()) - before[kind]:
                if collection.get(name) is not None:
                    collection.remove(collection[name])
        view_layer.active_layer_collection = previous_collection
        bpy.data.collections.remove(scratch)
    return {"draco_deviation_p95_mm": round(max(p95s), 3), "draco_deviation_max_mm": round(max(worsts), 3),
            "placement_max_mm": round(max(shifts), 3), "missing": sorted(set(sources) - found),
            "faceted": sorted(faceted), "inside_out": sorted(flipped)}


# ── Export ──
def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def glb_triangles(path):
    with open(path, "rb") as fh:
        json_length = struct.unpack("<I", fh.read(20)[12:16])[0]
        doc = json.loads(fh.read(json_length))
    accessors = doc.get("accessors", [])
    tris = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if prim.get("mode", 4) == 4:
                accessor = prim["indices"] if "indices" in prim else prim["attributes"]["POSITION"]
                tris += accessors[accessor]["count"] // 3
    return tris


def tag_part(obj, pid, code, name, description, sources):
    """Custom properties the viewer reads from each part (exported as glTF extras)."""
    obj["anatomy_schema"] = "1.0"
    obj["anatomy_role"] = "part"
    obj["part_id"] = pid
    obj["system_id"] = code
    obj["systems"] = [code]
    obj["name"] = name
    obj["description"] = description
    obj["function"] = ""
    obj["identity_status"] = "identified"
    obj["source_objects"] = list(sources)


def export_temps(temps, path, window, view_layer, reduce=True):
    """Export only the temporary part objects and return their source triangles. Parts fit_ratios has not prepared
    (the female layer) are welded and, with reduce, keep a flat RATIO of their triangles.

    The caller restores the selection and deletes the temporary objects. window may be None when Blender runs
    in the background (blender -b), which has no windows."""
    source_tris = 0
    for temp in temps:
        tris = tri_count(temp.data)
        source_tris += tris
        if "WebWeld" not in temp.modifiers:
            web_modifiers(temp, RATIO if reduce and tris > MIN_TRIS else 1.0)
    for o in (window.scene if window else bpy.context.scene).objects:
        o.select_set(False, view_layer=view_layer)
    for temp in temps:
        temp.select_set(True, view_layer=view_layer)
    view_layer.objects.active = temps[0]
    with bpy.context.temp_override(window=window) if window else contextlib.nullcontext():
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, use_visible=False,
            export_apply=True, export_extras=True, export_yup=True,
            export_texcoords=False, export_normals=True, export_tangents=False,
            export_vertex_color='NONE', export_attributes=False, export_materials='EXPORT',
            export_animations=False, export_skins=False, export_morph=False,
            export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14, export_draco_normal_quantization=10)
    return source_tris


def export_system(code, out_dir):
    wm = bpy.context.window_manager
    window = wm.windows[0] if wm.windows else None  # None in the background (blender -b)
    scene = window.scene if window else bpy.context.scene
    view_layer = window.view_layer if window else bpy.context.view_layer
    parts = system_parts(code)
    if not parts:
        raise RuntimeError(f"System '{code}' has no structures.")
    previous_selected = {o.name for o in scene.objects if o.select_get(view_layer=view_layer)}
    previous_active = view_layer.objects.active
    temp_col = bpy.data.collections.new(TEMP_COLLECTION)
    scene.collection.children.link(temp_col)
    temps, source_tris, used = [], 0, set()
    path = os.path.join(out_dir, f"{code}.glb")
    try:
        restore = reveal(parts, view_layer, SYSTEMS[code][1])
        try:
            depsgraph = bpy.context.evaluated_depsgraph_get()
            depsgraph.update()
            for o in parts:
                mesh = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
                if len(mesh.polygons) == 0:
                    bpy.data.meshes.remove(mesh)
                    continue
                mesh.validate()  # the glTF exporter repairs invalid meshes before decimating; the fit must see the same mesh
                pid = part_id(o.name, used)
                temp = bpy.data.objects.new(pid, mesh)
                temp_col.objects.link(temp)
                temp.matrix_world = o.matrix_world.copy()
                for i, slot in enumerate(o.material_slots):
                    if slot.link == 'OBJECT' and i < len(temp.material_slots):
                        temp.material_slots[i].link = 'OBJECT'
                        temp.material_slots[i].material = slot.material
                tag_part(temp, pid, code, display_name(o.name), definition(o.name), [o.name])
                temps.append(temp)
        finally:
            restore()
        relax = 1.0
        fits = fit_ratios(temps, TOLERANCE[code])
        source_tris = export_temps(temps, path, window, view_layer)
        while os.path.getsize(path) > BUDGET_BYTES and any(r > MIN_RATIO for r, _, _ in fits.values()):
            relax *= RELAX
            fits = fit_ratios(temps, TOLERANCE[code], relax)
            export_temps(temps, path, window, view_layer)
        checks = verify(path, temps, window, view_layer)
        described = sum(1 for t in temps if t["description"])
    finally:
        for temp in temps:
            mesh = temp.data
            bpy.data.objects.remove(temp)
            bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(temp_col)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active

    report = {"file": f"{code}.glb", "parts": len(temps), "source_triangles": source_tris,
              "triangles": glb_triangles(path), "bytes": os.path.getsize(path), "described": described,
              "tolerance_p95_mm": round(TOLERANCE[code][0] * relax, 3), "tolerance_max_mm": round(TOLERANCE[code][1] * relax, 3),
              "tolerance_size_share": [round(s * relax, 5) for s in SIZE_SHARE],
              "deviation_p95_mm": round(max(p for _, p, _ in fits.values()), 3),
              "deviation_max_mm": round(max(w for _, _, w in fits.values()), 3)}
    report.update({k: v for k, v in checks.items() if v or not isinstance(v, list)})
    return report


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
    codes = sorted(SYSTEMS) if systems_arg.strip() == "all" else [c.strip() for c in systems_arg.split(",") if c.strip()]
    unknown = [c for c in codes if c not in SYSTEMS]
    if unknown:
        raise RuntimeError(f"Unknown system(s): {', '.join(unknown)}. Known: {', '.join(sorted(SYSTEMS))}")
    out_dir = globals().get("LAYER_EXPORT_DIR") or default_out_dir()
    os.makedirs(out_dir, exist_ok=True)
    reports = {}
    for code in codes:
        r = reports[code] = export_system(code, out_dir)
        print(f"[layers] {code}: {r['parts']} parts ({r['described']} with definitions), "
              f"{r['source_triangles']:,} -> {r['triangles']:,} triangles, {r['bytes'] / 1048576:.1f} MB, "
              f"deviation p95 {r['deviation_p95_mm']} / max {r['deviation_max_mm']} mm "
              f"(tolerance {r['tolerance_p95_mm']} / {r['tolerance_max_mm']}), after Draco "
              f"{r['draco_deviation_p95_mm']} / {r['draco_deviation_max_mm']} mm, placement {r['placement_max_mm']} mm")
        for problem in ("missing", "faceted", "inside_out"):
            if r.get(problem):
                print(f"[layers] {code}: {problem}: {', '.join(r[problem])}")
    write_manifest(out_dir, reports)
    return reports


if __name__ == "__main__":
    LAYER_EXPORT_REPORT = main(globals().get("LAYER_EXPORT_SYSTEMS", "skeletal"))
