"""Export each body system of the Z-Anatomy model as its own web GLB layer.

Run inside Blender with Z-Anatomy.blend open, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
    g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "urinary"}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

LAYER_EXPORT_SYSTEMS is a comma-separated list of system codes, or "all". Large systems take a few
minutes; to keep the MCP call from timing out, run the exec from bpy.app.timers.register(...).

For each system the script:
1. collects the structures under that system's Z-Anatomy group objects (meshes with geometry and
   curves with thickness, such as vessels and nerves), leaving out text labels, helper objects
   (.g .j .i .t), muscle-attachment overlays (.ol .or .el .er) and anatomical variants named
   "(...)" or "[...]";
2. briefly makes them visible, copies their evaluated geometry (modifiers applied, curves turned
   into meshes) into temporary objects, then restores every visibility setting;
3. welds the copies, keeps about 30% of the triangles of each part over 500 triangles, adds the
   part data the viewer reads (part ID, name, Z-Anatomy definition, system) as glTF extras, and
   exports system_model/layers/<system>.glb with Draco compression;
4. deletes the temporary objects and meshes. The user's objects are never changed and the .blend
   file is never saved.

All systems come from the same file, so the layers share one body frame and overlay exactly.
"""
import json
import os
import re
import struct

import bpy

RATIO = 0.30
MIN_TRIS = 500
WELD_DISTANCE = 1e-6
TEMP_COLLECTION = "ZA web export (temporary)"

# code -> Z-Anatomy group objects whose structures form the layer, and the collections they must be in
# (the collection filter drops copies that live in other collections, such as muscle insertions).
SYSTEMS = {
    "skeletal": (["Skeletal system.g", "Joints.g"], ["1: Skeletal system", "3: Joints"]),
    "muscular": (["Muscular system.g"], ["4: Muscular system"]),
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
SIDE = {"l": "left", "r": "right"}


def default_out_dir():
    here = globals().get("__file__")
    if here and os.path.isfile(here):
        return os.path.normpath(os.path.join(os.path.dirname(here), "..", "..", "system_model", "layers"))
    raise RuntimeError("Set LAYER_EXPORT_DIR to the project's system_model/layers folder.")


# ── Selection ──
def has_geometry(o):
    if o.type == 'MESH':
        return len(o.data.polygons) > 0
    if o.type == 'CURVE':
        return o.data.bevel_depth > 0 or o.data.bevel_object is not None or o.data.extrude > 0
    return False


def is_structure(o):
    return (has_geometry(o) and not HELPER_SUFFIX.search(o.name)
            and not o.name.startswith(("(", "[")) and re.search(r"[A-Za-z]", o.name))


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


def definition(name):
    text = bpy.data.texts.get(base_name(name)) or bpy.data.texts.get(re.sub(r"\s*\(//.*\)\s*$", "", base_name(name)))
    if text is None:
        return ""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.as_string()) if p.strip()]
    paragraphs = [p for p in paragraphs if not p.isupper()]  # drop the upper-case title line
    if not paragraphs:
        return ""
    body = re.sub(r"\s+", " ", paragraphs[0])
    body = re.sub(r"\(\s*[,;]\s*", "(", body)       # "( , pl. femora )" -> "(pl. femora )"
    body = re.sub(r"\s+\)", ")", body)
    body = re.sub(r"\(\s*\)", "", body).replace(" ,", ",").strip()
    sentences = re.split(r"(?<=[.!?])\s+", body)
    out = ""
    for sentence in sentences:
        if out and len(out) + len(sentence) > 320:
            break
        out = f"{out} {sentence}".strip()
    return out


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


def export_system(code, out_dir):
    window = bpy.context.window_manager.windows[0]
    scene, view_layer = window.scene, window.view_layer
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
                pid = part_id(o.name, used)
                temp = bpy.data.objects.new(pid, mesh)
                temp_col.objects.link(temp)
                temp.matrix_world = o.matrix_world.copy()
                for i, slot in enumerate(o.material_slots):
                    if slot.link == 'OBJECT' and i < len(temp.material_slots):
                        temp.material_slots[i].link = 'OBJECT'
                        temp.material_slots[i].material = slot.material
                temp["anatomy_schema"] = "1.0"
                temp["anatomy_role"] = "part"
                temp["part_id"] = pid
                temp["system_id"] = code
                temp["systems"] = [code]
                temp["name"] = display_name(o.name)
                temp["description"] = definition(o.name)
                temp["function"] = ""
                temp["identity_status"] = "identified"
                temp["source_objects"] = [o.name]
                temps.append(temp)
        finally:
            restore()

        for temp in temps:
            tris = tri_count(temp.data)
            source_tris += tris
            weld = temp.modifiers.new("WebWeld", 'WELD')
            weld.mode = 'ALL'
            weld.merge_threshold = WELD_DISTANCE
            if tris > MIN_TRIS:
                decimate = temp.modifiers.new("WebDecimate", 'DECIMATE')
                decimate.decimate_type = 'COLLAPSE'
                decimate.ratio = RATIO

        for o in scene.objects:
            o.select_set(False, view_layer=view_layer)
        for temp in temps:
            temp.select_set(True, view_layer=view_layer)
        view_layer.objects.active = temps[0]
        with bpy.context.temp_override(window=window):
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
        for temp in temps:
            mesh = temp.data
            bpy.data.objects.remove(temp)
            bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(temp_col)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active

    described = sum(1 for t in parts if definition(t.name))
    return {"file": f"{code}.glb", "parts": len(temps), "source_triangles": source_tris,
            "triangles": glb_triangles(path), "bytes": os.path.getsize(path), "described": described}


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
              f"{r['source_triangles']:,} -> {r['triangles']:,} triangles, {r['bytes'] / 1048576:.1f} MB")
    write_manifest(out_dir, reports)
    return reports


if __name__ == "__main__":
    LAYER_EXPORT_REPORT = main(globals().get("LAYER_EXPORT_SYSTEMS", "skeletal"))
