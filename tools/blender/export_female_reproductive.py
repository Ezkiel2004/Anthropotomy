"""Export the female reproductive layer (system code "reproductive-female") from the Human Reference Atlas
reference organs, fitted into the Z-Anatomy pelvis.

Z-Anatomy has no female reproductive organs, so this layer uses the HRA uterus and ovaries from NIH 3D
(CC BY 4.0; originals and credits in tools/blender/sources/hra/). Run inside Blender with Z-Anatomy.blend
open, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_female_reproductive.py"
    g = {"__name__": "__main__", "__file__": p}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

What the script does:
1. imports the three HRA files into a temporary collection;
2. turns them into Z-Anatomy's frame (+Z up, -Y anterior, +X the body's left). The HRA files face glTF -Z, with
   the uterus tipped backwards (its anterior wall lies on the upper side of the uterine axis) and their
   left/right labels behave as mirrored, so the ovaries are named by the side they end up on;
3. tips the uterus forward about its internal os into the usual anteverted position (axis 60 degrees above
   horizontal, pointing forward), with the internal os just behind the Z-Anatomy urinary bladder;
4. places each ovary on the pelvic side wall just above the bladder, keeping its own shape and size
   (both models are real-world size in metres);
5. adds the part data the viewer reads and exports system_model/layers/reproductive-female.glb with the
   same settings as the other layers (welded, Draco-compressed; no reduction, the organs are small);
6. deletes everything it imported and restores the selection. The .blend file is never saved.
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

CODE = "reproductive-female"
HERE = os.path.dirname(globals().get("__file__") or "")
SOURCES = os.path.join(HERE, "sources", "hra")
FILES = ["VH_F_Uterus.glb", "VH_F_Ovary_L.glb", "VH_F_Ovary_R.glb"]
# Placement (can be preset before exec, e.g. for a placement sweep):
AXIS_ELEVATION_DEG = globals().get('AXIS_ELEVATION_DEG', 60)  # uterine axis above horizontal, pointing anteriorly
OS_OFFSET = globals().get('OS_OFFSET', (0.010, 0.016))  # internal os: metres behind the bladder's back, above its middle

# HRA node name (without "VH_F_") -> (display name, Z-Anatomy definition text)
PARTS = {
    "abdominal_ostium_of_uterine_tube": ("Abdominal ostia of uterine tubes", "Fallopian tube"),
    "body_of_uterus": ("Body of uterus", "Uterus"),
    "fundus_of_uterus": ("Fundus of uterus", "Uterus"),
    "cornua": ("Uterine cornua", "Uterus"),
    "lower_uterine_segment": ("Lower uterine segment", "Uterus"),
    "posterior_wall_of_uterus": ("Posterior wall of uterus", "Uterus"),
    "anterior_wall_of_uterus": ("Anterior wall of uterus", "Uterus"),
    "cervix": ("Cervix of uterus", "Cervical canal"),
    "internal_cervical_os": ("Internal os of cervix", "Cervical canal"),
    "external_cervical_os": ("External os of cervix", "Cervical canal"),
    "left_ovary": ("Ovary", "Ovary"),
    "right_ovary": ("Ovary", "Ovary"),
}


def load_layer_tools():
    """Reuse tag_part, export_temps, definition, glb_triangles and write_manifest from export_layers.py."""
    path = os.path.join(HERE, "export_layers.py")
    tools = {"__name__": "export_layers_tools", "__file__": path}
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), tools)
    return tools


def world_bounds(obj):
    pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)]))


def centroid(obj):
    verts = obj.data.vertices
    return sum((obj.matrix_world @ v.co for v in verts), Vector()) / max(1, len(verts))


def key_of(obj):
    return obj.name.split(".")[0].replace("VH_F_", "")


def inside_fraction(objs, solid):
    """Share of the vertices of objs that lie inside the closed mesh solid (a placement sanity check)."""
    from mathutils.bvhtree import BVHTree
    mesh = solid.data
    tree = BVHTree.FromPolygons([solid.matrix_world @ v.co for v in mesh.vertices], [p.vertices[:] for p in mesh.polygons])
    # A mirrored object (negative scale, like Z-Anatomy's left-side copies) has its normals flipped in world space.
    flip = -1 if solid.matrix_world.determinant() < 0 else 1
    total = inside = 0
    for o in objs:
        for v in list(o.data.vertices)[::4]:
            p = o.matrix_world @ v.co
            location, normal, _, _ = tree.find_nearest(p)
            total += 1
            if location is not None and flip * (p - location).dot(normal) < 0:
                inside += 1
    return round(inside / max(1, total), 3)


def export(out_dir):
    tools = load_layer_tools()
    window = bpy.context.window_manager.windows[0]
    scene, view_layer = window.scene, window.view_layer
    bladder = bpy.data.objects.get("Urinary bladder")
    if bladder is None:
        raise RuntimeError("Urinary bladder not found. Is Z-Anatomy.blend open?")
    b_min, b_max = world_bounds(bladder)
    b_mid = (b_min + b_max) / 2

    kinds = ("objects", "meshes", "materials", "images")
    before = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
    previous_selected = {o.name for o in scene.objects if o.select_get(view_layer=view_layer)}
    previous_active = view_layer.objects.active
    previous_collection = view_layer.active_layer_collection
    temp_col = bpy.data.collections.new("HRA female export (temporary)")
    scene.collection.children.link(temp_col)
    path = os.path.join(out_dir, f"{CODE}.glb")
    try:
        view_layer.active_layer_collection = view_layer.layer_collection.children[temp_col.name]
        for name in FILES:
            with bpy.context.temp_override(window=window):
                bpy.ops.import_scene.gltf(filepath=os.path.join(SOURCES, name))
        meshes = [o for o in temp_col.all_objects if o.type == 'MESH' and key_of(o) in PARTS]
        missing = sorted(set(PARTS) - {key_of(o) for o in meshes})
        if missing:
            raise RuntimeError(f"Missing HRA parts: {', '.join(missing)}")
        # Flatten the hierarchy and turn the HRA front (glTF -Z, which is +Y after import) to Z-Anatomy's front (-Y).
        turn = Matrix.Rotation(math.pi, 4, 'Z')
        for o in meshes:
            world = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = turn @ world
        by_key = {key_of(o): o for o in meshes}
        uterus = [o for o in meshes if "ovary" not in key_of(o)]
        ovaries = [o for o in meshes if "ovary" in key_of(o)]

        # Tip the uterus forward about its internal os (anteverted), internal os just behind the bladder.
        os_now = centroid(by_key["internal_cervical_os"])
        axis = centroid(by_key["fundus_of_uterus"]) - centroid(by_key["cervix"])
        now = math.atan2(axis.z, axis.y)
        elevation = math.radians(AXIS_ELEVATION_DEG)
        behind, above = OS_OFFSET
        target = math.atan2(math.sin(elevation), -math.cos(elevation))
        os_target = Vector((b_mid.x, b_max.y + behind, b_mid.z + above))
        place = Matrix.Translation(os_target) @ Matrix.Rotation(target - now, 4, 'X') @ Matrix.Translation(-os_now)
        for o in uterus:
            o.matrix_world = place @ o.matrix_world

        # Ovaries on the pelvic side walls, just lateral to and above the bladder, named by side (+X is left).
        half_width = (b_max.x - b_min.x) / 2
        for o in ovaries:
            c = centroid(o)
            side = 1 if c.x > b_mid.x else -1
            goal = Vector((b_mid.x + side * (half_width + 0.008), b_max.y - 0.002, b_max.z + 0.018))
            o.matrix_world = Matrix.Translation(goal - c) @ o.matrix_world

        clearance = {"uterus_inside_bladder": inside_fraction(uterus, bladder)}
        for name in ("Hip bone.l", "Hip bone.r", "Sacrum"):
            if bpy.data.objects.get(name):
                clearance[f"ovaries_inside_{name}"] = inside_fraction(ovaries, bpy.data.objects[name])
                clearance[f"uterus_inside_{name}"] = inside_fraction(uterus, bpy.data.objects[name])

        temps = []
        for o in meshes:
            key = key_of(o)
            name, text = PARTS[key]
            pid = f"hra_{key}"
            if "ovary" in key:
                side = "left" if centroid(o).x > b_mid.x else "right"
                name, pid = f"Ovary ({side})", f"hra_ovary_{side}"
            o.name = pid
            tools["tag_part"](o, pid, CODE, name, tools["definition"](text), [f"VH_F_{key}"])
            temps.append(o)
        source_tris = tools["export_temps"](temps, path, window, view_layer, reduce=False)
        described = sum(1 for o in temps if o["description"])
        positions = {o["name"]: [round(v, 4) for v in centroid(o)] for o in temps}
    finally:
        after = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
        for n in after["objects"] - before["objects"]:
            bpy.data.objects.remove(bpy.data.objects[n])
        for n in after["meshes"] - before["meshes"]:
            bpy.data.meshes.remove(bpy.data.meshes[n])
        for n in after["materials"] - before["materials"]:
            bpy.data.materials.remove(bpy.data.materials[n])
        for n in after["images"] - before["images"]:
            bpy.data.images.remove(bpy.data.images[n])
        view_layer.active_layer_collection = previous_collection
        bpy.data.collections.remove(temp_col)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active

    report = {"file": f"{CODE}.glb", "parts": len(temps), "source_triangles": source_tris, "clearance": clearance,
              "triangles": tools["glb_triangles"](path), "bytes": os.path.getsize(path), "described": described}
    tools["write_manifest"](out_dir, {CODE: report})
    print(f"[layers] {CODE}: {report['parts']} parts, {report['triangles']:,} triangles, {report['bytes'] / 1024:.0f} KB")
    return report, positions


if __name__ == "__main__":
    out = globals().get("LAYER_EXPORT_DIR") or os.path.normpath(os.path.join(HERE, "..", "..", "system_model", "layers"))
    os.makedirs(out, exist_ok=True)
    LAYER_EXPORT_REPORT, LAYER_EXPORT_POSITIONS = export(out)
