"""Export each body system of the layered anatomy model as its own web GLB.

Run inside Blender with HumanAnatomyBackup.blend open and the window showing the
"Anatomy - Layered" scene, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_layers.py"
    g = {"__name__": "__main__", "__file__": p, "LAYER_EXPORT_SYSTEMS": "skeletal"}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

LAYER_EXPORT_SYSTEMS is a comma-separated list of system codes, or "all".
Coincident vertices are welded, then each part keeps about 30% of its triangles (small parts
keep all of them). Part custom
properties travel as glTF extras. Temporary modifiers and the selection are restored
afterwards, and the .blend file is never saved.
"""
import json
import os
import struct

import bpy

SCENE = "Anatomy - Layered"
ROOT = "ANATOMY | whole body"
RATIO = 0.30
MIN_TRIS = 500
WELD_DISTANCE = 1e-6  # mesh-local units; the body is about 1.6 units tall


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


def active_window():
    # Switching window.scene and evaluating it in the same script crashes Blender 5.2
    # (BKE_object_eval_eval_base_flags), so the scene must already be showing.
    window = bpy.context.window_manager.windows[0]
    if window.scene.name != SCENE:
        raise RuntimeError(f"Switch the Blender window to the '{SCENE}' scene first, then run the export again.")
    return window


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


def export_system(scene, code, out_dir):
    root = scene.objects[ROOT]
    empty = layer_empty(scene, code)
    parts = system_parts(scene, code)
    if not parts:
        raise RuntimeError(f"System '{code}' has no parts.")
    check_assembled(parts + [empty])

    window = active_window()
    view_layer = window.view_layer
    previous_selected = {o.name for o in scene.objects if o.select_get(view_layer=view_layer)}
    previous_active = view_layer.objects.active
    added = []
    source_tris = 0
    path = os.path.join(out_dir, f"{code}.glb")
    try:
        for o in parts:
            tris = tri_count(o.data)
            source_tris += tris
            # The source meshes are unwelded triangle soup (every triangle has its own vertices).
            # Collapse decimation cannot merge disconnected triangles and deletes them instead,
            # leaving holes, so weld coincident vertices first.
            weld = o.modifiers.new("WebWeld", 'WELD')
            weld.mode = 'ALL'
            weld.merge_threshold = WELD_DISTANCE
            added.append((o, weld))
            if tris > MIN_TRIS:
                mod = o.modifiers.new("WebDecimate", 'DECIMATE')
                mod.decimate_type = 'COLLAPSE'
                mod.ratio = RATIO
                added.append((o, mod))

        for o in scene.objects:
            o.select_set(False, view_layer=view_layer)
        for o in [root, empty] + parts:
            o.select_set(True, view_layer=view_layer)
        view_layer.objects.active = root

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
        for o, mod in added:
            o.modifiers.remove(mod)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active

    return {"file": f"{code}.glb", "parts": len(parts), "source_triangles": source_tris,
            "triangles": glb_triangles(path), "bytes": os.path.getsize(path)}


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
    active_window()
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
