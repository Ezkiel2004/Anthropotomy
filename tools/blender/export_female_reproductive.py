"""Export the female reproductive layer (system code "reproductive-female") from the Stanford "Female Reproductive
System" model, fitted into the Z-Anatomy pelvis.

Z-Anatomy has no female reproductive organs, so this layer uses "Female Reproductive System" by stanfordedtechteam
(Sketchfab, CC BY 4.0; credits in tools/blender/sources/stanford/README.md). The download is 171 MB, mostly
textures, so it is not kept in Git: save it as system_model/female_reproductive_system.glb before running.

Run with Z-Anatomy.blend open, either in the background (no window is touched):

    blender -b Z-Anatomy.blend --python tools/blender/export_female_reproductive.py

or inside a running Blender, for example from the Blender MCP:

    p = r"C:/xampp/htdocs/Anthropotomy/tools/blender/export_female_reproductive.py"
    g = {"__name__": "__main__", "__file__": p}
    exec(compile(open(p, encoding="utf-8").read(), p, "exec"), g)

What the script does:
1. imports the model into a temporary collection and bakes every transform into its meshes;
2. fits the model's own pelvis and sacrum onto Z-Anatomy's hip bones, sacrum and coccyx (iterative closest
   points with rotation, translation and one scale), so each organ keeps its place relative to the bones;
3. keeps the reproductive organs only (the model's bones, bladder, rectum and pelvic floor muscles are already in
   other layers, and its cut-away uterus duplicates the whole one), splits the paired organs into left and right
   parts (+X is the body's left) and cuts the uterus from the vagina (UTERUS_CUT);
4. settles the organs into the Z-Anatomy pelvis, which is male and narrower: wherever an organ lies inside a hip
   bone, the sacrum or the coccyx it is pushed out (towards the midline, or forwards) by a smooth displacement, so
   it bends rather than dents;
5. gives each part a plain material named by tissue in place of the textured ones (the viewer colours parts
   itself), adds the part data the viewer reads and exports system_model/layers/reproductive-female.glb with the
   same settings as the other layers (welded, about 30% of the triangles kept, Draco-compressed);
6. deletes everything it imported and restores the selection. The .blend file is never saved.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

CODE = "reproductive-female"
HERE = os.path.dirname(globals().get("__file__") or "")
SOURCE = globals().get("FEMALE_SOURCE") or os.path.normpath(os.path.join(HERE, "..", "..", "system_model", "female_reproductive_system.glb"))
FIT_MESHES = ("Pelvis_Edit_", "Sacrum_Edit_")
FIT_TARGET = ("Hip bone.l", "Hip bone.r", "Sacrum", "Coccyx")
FIT_ITERATIONS = 40
SEAM_WELD = 1e-5  # metres; joins the vertices the importer splits along texture seams, to find each organ's pieces
# Z-Anatomy structure -> direction organs leave it in: 'medial' (towards the midline), or a fixed direction
# Z-Anatomy's bladder is a man's and fills the space the vagina runs through, so organs are not pushed out of it
# (bending the vagina round it twists it); with the urinary layer on, the lower vagina passes through the bladder.
CLEAR_OF = {"Hip bone.l": "medial", "Hip bone.r": "medial", "Sacrum": (0, -1, 0), "Coccyx": (0, -1, 0)}
OVERLAP_CHECKED = ("Urinary bladder",)  # reported in the manifest, not pushed out of
CLEARANCE = 0.0015  # metres left between an organ and the structure it was pushed out of
SETTLE_RADIUS = 0.006  # metres; how far a push spreads along the organ, so it bends smoothly
SETTLE_ROUNDS = 8
RAY_DIRECTIONS = [Vector(d).normalized() for d in ((0.31, 0.52, 0.79), (-0.7, 0.2, -0.68), (0.1, -0.95, 0.29))]

# Source mesh name prefix -> (display name, Z-Anatomy definition text, material, paired)
PARTS = {
    "Fallopian_Edits_": ("Uterine tube", "Fallopian tube", "Tube", True),
    "Ovaries_Edit_": ("Ovary", "Ovary", "Ovary", True),
    "RoundLigament_": ("Round ligament of uterus", "Round ligament of uterus", "Ligament", True),
    "Broad_Ligament_FNL_": ("Broad ligament of uterus", "Broad ligament of the uterus", "Broad ligament", True),
    "Bartholin_Glands_": ("Greater vestibular gland", None, "Gland", True),
    "Bulb_of_Vestibule_": ("Bulb of vestibule", "Bulb of vestibule", "Erectile", False),
    "Crus_of_Clitoris_": ("Clitoris", "Clitoris", "Erectile", False),
    "HymenalCaruncle_UrethralOrifice_": ("Labia minora", "Labia minora", "Mucosa", False),
}
UTERUS_VAGINA = "UterusVagina_"
# The uterus and vagina are one mesh in the source. This plane (point and normal in the source model's coordinates,
# metres) crosses its narrowest point, between the body of the uterus and the vagina; the cervix stays with the uterus.
UTERUS_CUT = ((-0.0045, 0.256, 0.897), (0.0, 0.26, 0.97))


def load_layer_tools():
    """Reuse tag_part, export_temps, definition, glb_triangles and write_manifest from export_layers.py."""
    path = os.path.join(HERE, "export_layers.py")
    tools = {"__name__": "export_layers_tools", "__file__": path}
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"), tools)
    return tools


def mesh_points(obj, step=1):
    """World-space vertex positions of obj with its modifiers applied, as an (n, 3) array."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    evaluated.to_mesh_clear()
    m = np.array(obj.matrix_world)
    return co.reshape(-1, 3)[::step] @ m[:3, :3].T + m[:3, 3]


def fit_pelvis(source, target):
    """Similarity transform (4x4) taking the source points onto the target surface: iterative closest points,
    ignoring the worst 10% of matches each round (the two pelvises are not the same shape)."""
    tree = KDTree(len(target))
    for i, p in enumerate(target):
        tree.insert(Vector(p), i)
    tree.balance()
    fit = np.eye(4)
    fit[:3, 3] = target.mean(0) - source.mean(0)
    for _ in range(FIT_ITERATIONS):
        moved = source @ fit[:3, :3].T + fit[:3, 3]
        nearest = np.array([tree.find(Vector(p))[1] for p in moved])
        distance = np.linalg.norm(target[nearest] - moved, axis=1)
        keep = distance < np.quantile(distance, 0.9)
        a, b = moved[keep], target[nearest][keep]
        ma, mb = a.mean(0), b.mean(0)
        u, s, vt = np.linalg.svd((b - mb).T @ (a - ma) / len(a))
        d = np.diag([1, 1, np.sign(np.linalg.det(u @ vt))])
        rotation = u @ d @ vt
        scale = np.trace(np.diag(s) @ d) / ((a - ma) ** 2).sum(1).mean()
        step = np.eye(4)
        step[:3, :3] = scale * rotation
        step[:3, 3] = mb - scale * rotation @ ma
        fit = step @ fit
    moved = source @ fit[:3, :3].T + fit[:3, 3]
    residual = np.array([tree.find(Vector(p))[2] for p in moved])
    return Matrix(fit.tolist()), float(np.median(residual))


def evaluated_tree(obj):
    """BVH tree of obj's world-space surface with its modifiers applied."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    tree = BVHTree.FromPolygons([obj.matrix_world @ v.co for v in mesh.vertices], [p.vertices[:] for p in mesh.polygons])
    evaluated.to_mesh_clear()
    return tree


def is_inside(tree, point):
    """Point-in-solid test by counting surface crossings along three rays (majority vote)."""
    votes = 0
    for direction in RAY_DIRECTIONS:
        crossings, origin = 0, point.copy()
        for _ in range(64):
            location = tree.ray_cast(origin, direction)[0]
            if location is None:
                break
            crossings += 1
            origin = location + direction * 1e-5
        votes += crossings % 2
    return votes >= 2


def inside_share(points, obstacle):
    """Share of points inside obstacle (a (tree, bounds) pair)."""
    tree, (low, high) = obstacle
    near = [Vector(p) for p in points if (p >= low).all() and (p <= high).all()]
    return sum(is_inside(tree, p) for p in near) / max(1, len(points))


def settle(points, obstacles):
    """Pushes points out of the obstacles ({name: (tree, bounds, direction)}) with a smooth displacement field:
    each point found inside moves along its obstacle's direction to just past the surface, and every point within
    SETTLE_RADIUS follows with a Gaussian falloff. Repeats until nothing is inside. Returns the moved points."""
    points = points.copy()
    for _ in range(SETTLE_ROUNDS):
        centres, pushes = [], []
        for tree, (low, high), direction in obstacles.values():
            for i in np.nonzero(((points >= low) & (points <= high)).all(1))[0]:
                p = Vector(points[i])
                if not is_inside(tree, p):
                    continue
                d = Vector((-np.sign(p.x) or 1.0, 0, 0)) if direction == "medial" else Vector(direction)
                exit_point = tree.ray_cast(p, d)[0]
                if exit_point is not None:
                    centres.append(points[i].copy())
                    pushes.append(np.array(exit_point + d * CLEARANCE - p))
        if not centres:
            break
        tree = KDTree(len(centres))
        for i, c in enumerate(centres):
            tree.insert(Vector(c), i)
        tree.balance()
        moved = points.copy()
        for i, p in enumerate(points):
            found = tree.find_range(Vector(p), SETTLE_RADIUS * 2.5)
            if not found:
                continue
            weights = np.array([math.exp(-(dist / SETTLE_RADIUS) ** 2) for _, _, dist in found])
            push = sum(w * pushes[j] for w, (_, j, _) in zip(weights, found))
            moved[i] = p + push / max(1.0, weights.sum())
        points = moved
    return points


def bake(obj):
    """Moves obj's world transform into its mesh, so its vertices are world positions."""
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)


def islands(bm):
    """Groups of connected faces in bm."""
    seen, groups = set(), []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack, group = [face], []
        seen.add(face.index)
        while stack:
            f = stack.pop()
            group.append(f)
            for edge in f.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        groups.append(group)
    return groups


def new_part(source, name, keep_island, collection):
    """A new object holding the connected pieces of source for which keep_island(faces) is true."""
    bm = bmesh.new()
    bm.from_mesh(source.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=SEAM_WELD)
    bm.faces.ensure_lookup_table()
    keep = set()
    for group in islands(bm):
        if keep_island(group):
            keep.update(f.index for f in group)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def cut_part(source, name, plane, keep_above, collection):
    """A new object holding the side of source above (or below) plane, with the cut closed."""
    bm = bmesh.new()
    bm.from_mesh(source.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=SEAM_WELD)
    co, no = plane
    cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=co, plane_no=no,
                                 clear_inner=keep_above, clear_outer=not keep_above)
    rim = [e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid and e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=rim, sides=0)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def group_centre(group):
    verts = {v for f in group for v in f.verts}
    return sum((v.co for v in verts), Vector()) / len(verts)


def plain_material(name, cache):
    """One untextured material per tissue; the viewer recolours parts by name and material."""
    if name not in cache:
        material = bpy.data.materials.new(name)
        material.diffuse_color = (0.8, 0.55, 0.5, 1)
        cache[name] = material
    return cache[name]


def export(out_dir):
    tools = load_layer_tools()
    wm = bpy.context.window_manager
    window = wm.windows[0] if wm.windows else None
    scene = window.scene if window else bpy.context.scene
    view_layer = window.view_layer if window else bpy.context.view_layer
    missing = [n for n in FIT_TARGET + ("Urinary bladder",) if bpy.data.objects.get(n) is None]
    if missing:
        raise RuntimeError(f"{', '.join(missing)} not found. Is Z-Anatomy.blend open?")
    if not os.path.isfile(SOURCE):
        raise RuntimeError(f"Missing {SOURCE}. Download the model first (see tools/blender/sources/stanford/README.md).")
    target = np.vstack([mesh_points(bpy.data.objects[n]) for n in FIT_TARGET])

    kinds = ("objects", "meshes", "materials", "images", "textures")
    before = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
    previous_selected = {o.name for o in scene.objects if o.select_get(view_layer=view_layer)}
    previous_active = view_layer.objects.active
    previous_collection = view_layer.active_layer_collection
    temp_col = bpy.data.collections.new("Female reproductive export (temporary)")
    scene.collection.children.link(temp_col)
    path = os.path.join(out_dir, f"{CODE}.glb")
    try:
        view_layer.active_layer_collection = view_layer.layer_collection.children[temp_col.name]
        if window:
            with bpy.context.temp_override(window=window):
                bpy.ops.import_scene.gltf(filepath=SOURCE)
        else:
            bpy.ops.import_scene.gltf(filepath=SOURCE)
        view_layer.update()
        meshes = [o for o in temp_col.all_objects if o.type == 'MESH']
        for o in meshes:
            bake(o)
        by_prefix = lambda prefix: next((o for o in meshes if o.name.startswith(prefix)), None)
        needed = FIT_MESHES + tuple(PARTS) + (UTERUS_VAGINA,)
        absent = [p for p in needed if by_prefix(p) is None]
        if absent:
            raise RuntimeError(f"Missing meshes in the source model: {', '.join(absent)}")

        source = np.vstack([np.array([v.co[:] for v in by_prefix(p).data.vertices])[::2] for p in FIT_MESHES])
        fit, residual = fit_pelvis(source, target)
        for o in meshes:
            o.data.transform(fit)

        materials, temps = {}, []
        side_of = lambda group: "left" if group_centre(group).x > 0 else "right"
        for prefix, (name, text, material, paired) in PARTS.items():
            src = by_prefix(prefix)
            sides = ("left", "right") if paired else (None,)
            for side in sides:
                part = new_part(src, f"{name} ({side})" if side else name, (lambda g, s=side: side_of(g) == s) if side else (lambda g: True), temp_col)
                part.data.materials.append(plain_material(material, materials))
                pid = "fem_" + "_".join(name.lower().split()) + (f"_{side[0]}" if side else "")
                tools["tag_part"](part, pid, CODE, part.name, tools["definition"](text) if text else "", [src.name])
                temps.append(part)
        uterus_vagina = by_prefix(UTERUS_VAGINA)
        plane = (fit @ Vector(UTERUS_CUT[0]), (fit.to_3x3() @ Vector(UTERUS_CUT[1])).normalized())
        for name, above in (("Uterus", True), ("Vagina", False)):
            part = cut_part(uterus_vagina, name, plane, above, temp_col)
            part.data.materials.append(plain_material(name, materials))
            tools["tag_part"](part, f"fem_{name.lower()}", CODE, name, tools["definition"](name), [uterus_vagina.name])
            temps.append(part)

        obstacles, checked = {}, {}
        for name in tuple(CLEAR_OF) + OVERLAP_CHECKED:
            obj = bpy.data.objects[name]
            pts = mesh_points(obj)
            checked[name] = (evaluated_tree(obj), (pts.min(0), pts.max(0)))
            if name in CLEAR_OF:
                obstacles[name] = checked[name] + (CLEAR_OF[name],)
        counts = [len(o.data.vertices) for o in temps]
        points = np.vstack([np.array([v.co[:] for v in o.data.vertices]) for o in temps])
        before_settle = {n: round(inside_share(points[::3], c), 3) for n, c in checked.items()}
        settled = settle(points, obstacles)
        clearance = {n: round(inside_share(settled[::3], c), 3) for n, c in checked.items()}
        moved = np.linalg.norm(settled - points, axis=1)
        for o, part in zip(temps, np.split(settled, np.cumsum(counts)[:-1])):
            o.data.vertices.foreach_set("co", part.ravel())
            o.data.update()

        source_tris = tools["export_temps"](temps, path, window, view_layer, reduce=True)
        described = sum(1 for o in temps if o["description"])
        parts = sorted(o.name for o in temps)
    finally:
        after = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
        for kind in ("objects", "meshes", "materials", "textures", "images"):
            collection = getattr(bpy.data, kind)
            for n in after[kind] - before[kind]:
                if collection.get(n) is not None:
                    collection.remove(collection[n])
        view_layer.active_layer_collection = previous_collection
        bpy.data.collections.remove(temp_col)
        for o in scene.objects:
            o.select_set(o.name in previous_selected, view_layer=view_layer)
        view_layer.objects.active = previous_active

    report = {"file": f"{CODE}.glb", "parts": len(temps), "source_triangles": source_tris, "fit_median_mm": round(residual * 1000, 1),
              "inside_before_settling": before_settle, "clearance": clearance, "settle_max_mm": round(float(moved.max()) * 1000, 1),
              "triangles": tools["glb_triangles"](path), "bytes": os.path.getsize(path), "described": described}
    tools["write_manifest"](out_dir, {CODE: report})
    print(f"[layers] {CODE}: {report['parts']} parts, {report['triangles']:,} triangles, {report['bytes'] / 1024:.0f} KB")
    return report, parts


if __name__ == "__main__":
    out = globals().get("LAYER_EXPORT_DIR") or os.environ.get("LAYER_EXPORT_DIR") or os.path.normpath(os.path.join(HERE, "..", "..", "system_model", "layers"))
    os.makedirs(out, exist_ok=True)
    LAYER_EXPORT_REPORT, LAYER_EXPORT_PARTS = export(out)
