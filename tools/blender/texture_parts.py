"""Paint Z-Anatomy parts with the surface of a reference model.

export_layers.py calls texture_temps() for each system. For a system listed in SOURCES it:
1. imports the reference model (a GLB kept outside Git, see tools/blender/sources/) into a temporary collection;
2. gives every listed part texture coordinates (Smart UV Project) and a cell of one shared texture, sized by the
   part's surface area;
3. lays the reference structure over the part (bounding box onto bounding box, each axis scaled on its own, so a
   kidney drawn rounder or longer still covers the Z-Anatomy kidney end to end) and, for every texel of the part,
   copies the colour of the nearest point of the reference surface;
4. gives those parts a material that carries the texture, named like the material it replaces so the viewer still
   picks the same finish.

The part's shape, place and ID never change: only its colour comes from the reference. Parts that are not listed
keep their plain material and the viewer's tissue colour.
"""
import os

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(globals().get("__file__") or "")
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
REFERENCE_PX = 2048  # reference textures are read at this size at most
PADDING_PX = 3  # empty texels kept round each part's cell; island colours are spread into them
ISLAND_MARGIN = 0.01

# System code -> {"file": GLB path relative to the repository, "px": texture size,
#   "rotation": optional 3x3 rows turning the reference into Z-Anatomy's frame (+X the body's left, -Y its front,
#       +Z up) when its import does not already face that way,
#   "parts": {part ID: {"from": [reference mesh name prefixes], "side": "left" | "right" | None}}}
# "side" keeps only the pieces of the reference meshes on that side of the reference's own middle.
SOURCES = {}


def upstream_image(socket):
    """The image of the first Image Texture node feeding socket, or None."""
    stack = [link.from_node for link in socket.links]
    while stack:
        node = stack.pop()
        if node.type == 'TEX_IMAGE' and node.image is not None:
            return node.image
        stack.extend(link.from_node for s in node.inputs for link in s.links)
    return None


def image_pixels(image, cache):
    """image as a (height, width, 3) float array, read once and at most REFERENCE_PX wide."""
    if image.name not in cache:
        scaled = image.copy()
        width, height = scaled.size
        if max(width, height) > REFERENCE_PX:
            factor = REFERENCE_PX / max(width, height)
            width, height = max(1, round(width * factor)), max(1, round(height * factor))
            scaled.scale(width, height)
        pixels = np.empty(width * height * 4, dtype=np.float32)
        scaled.pixels.foreach_get(pixels)
        bpy.data.images.remove(scaled)
        cache[image.name] = pixels.reshape(height, width, 4)[:, :, :3].copy()
    return cache[image.name]


def mesh_arrays(obj):
    """World-space triangles of obj: corner positions (n, 3, 3), corner texture coordinates (n, 3, 2) and each
    triangle's material slot (n)."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    verts = np.empty(count * 3, dtype=np.int32)
    loops = np.empty(count * 3, dtype=np.int32)
    slots = np.empty(count, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", verts)
    mesh.loop_triangles.foreach_get("loops", loops)
    mesh.loop_triangles.foreach_get("material_index", slots)
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    m = np.array(obj.matrix_world)
    co = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    uv = np.zeros((len(mesh.loops), 2))
    if mesh.uv_layers:
        flat = np.empty(len(mesh.loops) * 2)
        mesh.uv_layers[0].data.foreach_get("uv", flat)
        uv = flat.reshape(-1, 2)
    return co[verts].reshape(-1, 3, 3), uv[loops].reshape(-1, 3, 2), slots


def reference_surface(objects, side, rotation, pixels):
    """The reference structure made of objects: triangles (n, 3, 3), their texture coordinates (n, 3, 2) and one
    colour image per triangle (list of arrays, None where the material has no colour texture)."""
    tris, uvs, images = [], [], []
    for obj in objects:
        t, u, slots = mesh_arrays(obj)
        slot_images = []
        for slot in obj.material_slots:
            shader = next((n for n in slot.material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if slot.material and slot.material.node_tree else None
            image = upstream_image(shader.inputs["Base Color"]) if shader else None
            slot_images.append(image_pixels(image, pixels) if image else None)
        tris.append(t); uvs.append(u)
        images.extend(slot_images[s] if s < len(slot_images) else None for s in slots)
    tris, uvs = np.concatenate(tris), np.concatenate(uvs)
    if rotation is not None:
        tris = tris @ np.array(rotation, dtype=float).T
    if side:
        middle = (tris[:, :, 0].min() + tris[:, :, 0].max()) / 2
        keep = (tris[:, :, 0].mean(1) > middle) == (side == "left")
        tris, uvs, images = tris[keep], uvs[keep], [image for image, k in zip(images, keep) if k]
    return tris, uvs, images


def unwrap(temp, window, view_layer):
    """Smart UV Project on temp; its texture coordinates then fill the unit square."""
    for o in view_layer.objects:
        o.select_set(False, view_layer=view_layer)
    temp.select_set(True, view_layer=view_layer)
    view_layer.objects.active = temp
    override = {"window": window} if window else {}
    with bpy.context.temp_override(**override):
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=ISLAND_MARGIN)
        bpy.ops.object.mode_set(mode='OBJECT')


def cells(areas, px):
    """Square cells (x, y, side in texels) for parts with these surface areas: shelves filled from the largest
    part down, at the largest scale that fits a px x px texture."""
    order = np.argsort(areas)[::-1]
    roots = np.sqrt(np.asarray(areas, dtype=float))

    def place(scale):
        out, x, y, shelf = {}, 0, 0, 0
        for i in order:
            side = max(8 + 2 * PADDING_PX, int(roots[i] * scale))
            if x + side > px:
                x, y, shelf = 0, y + shelf, 0
            if y + side > px:
                return None
            out[int(i)] = (x, y, side)
            x, shelf = x + side, max(shelf, side)
        return out

    low, high = 0.0, px / max(roots.max(), 1e-12)
    best = place(low)
    for _ in range(30):
        middle = (low + high) / 2
        placed = place(middle)
        if placed:
            best, low = placed, middle
        else:
            high = middle
    return best


def texels(tris, uvs, px):
    """The texels covered by triangles with texture coordinates uvs (in texels): their (row, column) and the
    world position each one shows."""
    rows, columns, points = [], [], []
    for tri, uv in zip(tris, uvs):
        low = np.floor(uv.min(0) - 0.5).astype(int).clip(0, px - 1)
        high = np.ceil(uv.max(0) + 0.5).astype(int).clip(0, px - 1)
        xs, ys = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1))
        centres = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1)
        a, b, c = uv
        det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(det) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (centres[:, 0] - c[0]) + (c[0] - b[0]) * (centres[:, 1] - c[1])) / det
        w1 = ((c[1] - a[1]) * (centres[:, 0] - c[0]) + (a[0] - c[0]) * (centres[:, 1] - c[1])) / det
        w = np.stack([w0, w1, 1 - w0 - w1], 1)
        inside = (w >= -0.02).all(1)  # a hair past the edge, so neighbouring triangles leave no gap
        if not inside.any():
            continue
        w = w[inside].clip(0, 1)
        w /= w.sum(1, keepdims=True)
        rows.append(ys.ravel()[inside]); columns.append(xs.ravel()[inside]); points.append(w @ tri)
    if not rows:
        return np.zeros(0, int), np.zeros(0, int), np.zeros((0, 3))
    return np.concatenate(rows), np.concatenate(columns), np.concatenate(points)


def nearest_colours(points, reference):
    """Colour of the reference surface's nearest point for each of points, and the share that found a textured one."""
    tris, uvs, images = reference
    tree = BVHTree.FromPolygons(tris.reshape(-1, 3).tolist(), np.arange(len(tris) * 3).reshape(-1, 3).tolist())
    found = [tree.find_nearest(p) for p in points.tolist()]
    index = np.array([f[2] if f[2] is not None else -1 for f in found])
    hit = np.array([f[0][:] if f[0] is not None else (0.0, 0.0, 0.0) for f in found])
    a, b, c = tris[index, 0], tris[index, 1], tris[index, 2]
    v0, v1, v2 = b - a, c - a, hit - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = np.where(np.abs(d00 * d11 - d01 * d01) < 1e-20, 1.0, d00 * d11 - d01 * d01)
    w1, w2 = (d11 * d20 - d01 * d21) / den, (d00 * d21 - d01 * d20) / den
    uv = uvs[index, 0] * (1 - w1 - w2)[:, None] + uvs[index, 1] * w1[:, None] + uvs[index, 2] * w2[:, None]
    colours = np.zeros((len(points), 3), dtype=np.float32)
    textured = np.zeros(len(points), dtype=bool)
    slots = {}
    for i, tri_index in enumerate(index.tolist()):
        if tri_index >= 0 and images[tri_index] is not None:
            slots.setdefault(id(images[tri_index]), (images[tri_index], []))[1].append(i)
    for image, rows in slots.values():
        rows = np.array(rows)
        height, width = image.shape[:2]
        x = (uv[rows, 0] % 1.0) * width - 0.5
        y = (uv[rows, 1] % 1.0) * height - 0.5
        x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        tap = lambda dx, dy: image[(y0 + dy) % height, (x0 + dx) % width]
        colours[rows] = (tap(0, 0) * (1 - fx) + tap(1, 0) * fx) * (1 - fy) + (tap(0, 1) * (1 - fx) + tap(1, 1) * fx) * fy
        textured[rows] = True
    return colours, textured


def spread(atlas, filled, rounds):
    """Copies each island's edge colours outwards into empty texels, so texture filtering never blends in black."""
    for _ in range(rounds):
        total = np.zeros_like(atlas)
        count = np.zeros(filled.shape, dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            total += np.roll(atlas * filled[:, :, None], (dy, dx), (0, 1))
            count += np.roll(filled, (dy, dx), (0, 1))
        grow = (~filled) & (count > 0)
        atlas[grow] = total[grow] / count[grow][:, None]
        filled = filled | grow
    return atlas, filled


def texture_temps(code, temps, window, view_layer, sources=None):
    """Paints the parts of system code that SOURCES (or sources) lists. Returns a report for the manifest, or None
    when the system has no reference model."""
    source = (sources or SOURCES).get(code)
    if not source:
        return None
    path = source["file"] if os.path.isabs(source["file"]) else os.path.join(ROOT, source["file"])
    if not os.path.isfile(path):
        raise RuntimeError(f"Missing {path}: the reference model for the {code} layer (see tools/blender/sources/).")
    scene = window.scene if window else bpy.context.scene
    px = source.get("px", 1024)
    wanted = [t for t in temps if t["part_id"] in source["parts"]]
    absent = sorted(set(source["parts"]) - {t["part_id"] for t in wanted})
    if absent:
        raise RuntimeError(f"{code}: parts listed for texturing but not exported: {', '.join(absent)}")

    kinds = ("objects", "meshes", "materials", "images", "textures", "node_groups")
    before = {k: set(getattr(bpy.data, k).keys()) for k in kinds}
    previous_collection = view_layer.active_layer_collection
    scratch = bpy.data.collections.new("Texture reference (temporary)")
    scene.collection.children.link(scratch)
    report = {"file": os.path.basename(path), "px": px, "parts": {}}
    try:
        view_layer.active_layer_collection = view_layer.layer_collection.children[scratch.name]
        with bpy.context.temp_override(**({"window": window} if window else {})):
            bpy.ops.import_scene.gltf(filepath=path)
        view_layer.active_layer_collection = previous_collection
        view_layer.update()
        reference_meshes = [o for o in scratch.all_objects if o.type == 'MESH']

        areas, surfaces = [], []
        for temp in wanted:
            unwrap(temp, window, view_layer)
            tris, uvs, _ = mesh_arrays(temp)
            areas.append(float(np.linalg.norm(np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]), axis=1).sum() / 2))
            surfaces.append((tris, uvs))
        layout = cells(areas, px)
        atlas = np.zeros((px, px, 3), dtype=np.float32)
        filled = np.zeros((px, px), dtype=bool)
        pixels = {}
        for i, temp in enumerate(wanted):
            spec = source["parts"][temp["part_id"]]
            objects = [o for o in reference_meshes if any(o.name.startswith(prefix) for prefix in spec["from"])]
            if not objects:
                raise RuntimeError(f"{code}: no reference mesh named {spec['from']} for {temp['part_id']}")
            ref_tris, ref_uvs, ref_images = reference_surface(objects, spec.get("side"), source.get("rotation"), pixels)
            tris, uvs = surfaces[i]
            # Bounding box onto bounding box: the reference structure is stretched over the part, axis by axis.
            low, high = tris.reshape(-1, 3).min(0), tris.reshape(-1, 3).max(0)
            ref_low, ref_high = ref_tris.reshape(-1, 3).min(0), ref_tris.reshape(-1, 3).max(0)
            scale = (high - low) / np.maximum(ref_high - ref_low, 1e-9)
            fitted = (ref_tris - ref_low) * scale + low
            x, y, side = layout[i]
            inner = side - 2 * PADDING_PX
            cell_uv = uvs * inner + np.array([x + PADDING_PX, y + PADDING_PX])
            rows, columns, points = texels(tris, cell_uv, px)
            colours, textured = nearest_colours(points, (fitted, ref_uvs, ref_images))
            atlas[rows[textured], columns[textured]] = colours[textured]
            filled[rows[textured], columns[textured]] = True
            flat = np.empty(len(temp.data.loops) * 2)
            temp.data.uv_layers[0].data.foreach_get("uv", flat)
            flat = (flat.reshape(-1, 2) * inner + np.array([x + PADDING_PX, y + PADDING_PX])) / px
            temp.data.uv_layers[0].data.foreach_set("uv", flat.ravel())
            report["parts"][temp["part_id"]] = {"from": [o.name for o in objects], "texels": int(len(rows)),
                                                "textured_share": round(float(textured.mean()) if len(rows) else 0.0, 3),
                                                "stretch": [round(float(s), 3) for s in scale]}
        atlas, filled = spread(atlas, filled, PADDING_PX + 1)
    finally:
        view_layer.active_layer_collection = previous_collection
        for kind in kinds:
            collection = getattr(bpy.data, kind)
            for name in set(collection.keys()) - before[kind]:
                if collection.get(name) is not None:
                    collection.remove(collection[name])
        bpy.data.collections.remove(scratch)

    image = bpy.data.images.new(f"{code} colour", px, px, alpha=False)
    rgba = np.ones((px, px, 4), dtype=np.float32)
    rgba[:, :, :3] = atlas
    image.pixels.foreach_set(rgba.ravel())
    materials = {}
    for temp in wanted:
        old = temp.material_slots[0].material if temp.material_slots else None
        name = old.name if old else "Organ"
        if name not in materials:
            material = bpy.data.materials.new(name)  # Blender adds ".001"; the viewer reads the name without it
            material.use_nodes = True
            nodes, links = material.node_tree.nodes, material.node_tree.links
            nodes.clear()
            shader, texture = nodes.new("ShaderNodeBsdfPrincipled"), nodes.new("ShaderNodeTexImage")
            texture.image = image
            links.new(texture.outputs["Color"], shader.inputs["Base Color"])
            links.new(shader.outputs["BSDF"], nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
            shader.inputs["Roughness"].default_value = 0.5
            materials[name] = material
        temp.data.materials.clear()
        temp.data.materials.append(materials[name])
        temp.data.polygons.foreach_set("material_index", np.zeros(len(temp.data.polygons), dtype=np.int32))
    report["created"] = {"images": [image.name], "materials": [m.name for m in materials.values()]}
    return report


def discard(report):
    """Removes the image and materials texture_temps made, once the layer is exported."""
    for kind, names in (report or {}).get("created", {}).items():
        collection = getattr(bpy.data, kind)
        for name in names:
            if collection.get(name) is not None:
                collection.remove(collection[name])
