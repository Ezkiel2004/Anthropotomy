<?php
/** Connect the layered whole-body model files to their body systems without replacing learning content. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/connection.php';
const LAYER_CREDIT = '3D model: Z-Anatomy (https://github.com/LluisV/Z-Anatomy), licensed CC BY-SA 4.0. Reduced for web; the reduced model files are shared under the same licence.';
// Default text written by integrate_skeleton.php for the old single-mesh skeleton; it no longer applies.
const OLD_SKELETON_DESCRIPTION = 'Explore the supplied human skeleton model. Rotate, zoom, and reset the view to study its overall form. This asset is a single combined mesh; individual bones cannot be selected separately.';
// code => [name, colour, sort order]; name, colour and order are used only when the system has to be created.
$layers = [
    'skeletal' => ['Skeletal System', '#1a6b4a', 1], 'muscular' => ['Muscular System', '#b91c1c', 2], 'circulatory' => ['Circulatory System', '#dc2626', 3],
    'respiratory' => ['Respiratory System', '#0ea5e9', 4], 'digestive' => ['Digestive System', '#d97706', 5], 'urinary' => ['Urinary System', '#ca8a04', 6],
    'reproductive' => ['Reproductive System', '#db2777', 8], 'endocrine' => ['Endocrine System', '#7c3aed', 9], 'lymphatic' => ['Lymphatic System', '#16a34a', 10],
];

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
