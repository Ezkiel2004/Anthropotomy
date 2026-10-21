<?php
require_once __DIR__ . '/helpers.php';
requireMethod('GET', 'POST', 'PUT');
$user = requireLogin();
$db = Database::getInstance();
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // The explorer's study clock starts here; the Games page (?games) reads the same rows without starting it.
    if ($user['role'] === 'student' && !isset($_GET['games'])) $_SESSION['exploration_checkpoint'] = time();
    $where = $user['role'] === 'student' ? 'WHERE bs.is_active = 1' : '';
    $rows = $db->fetchAll("SELECT bs.*, ac.model_url, ac.key_facts, ac.structures, ac.source_text FROM body_systems bs LEFT JOIN anatomy_content ac ON ac.system_id = bs.system_id $where ORDER BY bs.sort_order, bs.system_id");
    foreach ($rows as &$row) {
        $row['system_id'] = (int)$row['system_id'];
        $row['is_active'] = (bool)$row['is_active'];
        $row['key_facts'] = json_decode($row['key_facts'] ?? '{}', true) ?: new stdClass();
        $row['structures'] = json_decode($row['structures'] ?? '[]', true) ?: [];
    }
    jsonSuccess($rows);
}
requireTeacher();
$body = getJsonBody();
$name = requireField($body, 'system_name');
$code = requireField($body, 'system_code');
if (!is_string($code) || !preg_match('/^[a-z][a-z0-9_-]{0,29}$/', $code)) jsonError('System code must use lowercase letters, numbers, hyphens or underscores.', 422);
$color = $body['color_hex'] ?? '#3b82f6';
if (!is_string($color) || !preg_match('/^#[a-f0-9]{6}$/i', $color)) jsonError('Choose a valid color.', 422);
$url = trim($body['model_url'] ?? '');
if ($url !== '' && (!preg_match('~\.glb(?:\?.*)?$~i', $url) || !safeMediaUrl($url))) jsonError('Choose a GLB model URL from your media library.', 422);
$facts = $body['key_facts'] ?? [];
$structures = $body['structures'] ?? [];
if (!is_array($facts) || !is_array($structures) || count($structures) > 500) jsonError('Invalid anatomy content.', 422);
foreach ($facts as $label => $value) if (!is_string($value) || strlen($value) > 2000) jsonError('Facts must contain short text values.', 422);
foreach ($structures as $structure) {
    if (!is_array($structure) || empty($structure['name']) || !is_string($structure['name']) || !is_string($structure['desc'] ?? '') || !is_string($structure['mesh_name'] ?? '')) jsonError('Each structure needs a name and text description.', 422);
}
$pdo = $db->getConnection();
$pdo->beginTransaction();
try {
    $values = [$code, $name, $body['icon_emoji'] ?? '', $color, $body['description'] ?? '', (int)($body['sort_order'] ?? 0), !empty($body['is_active']) ? 1 : 0];
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $id = getIdParam();
        if (!$db->fetchOne('SELECT system_id FROM body_systems WHERE system_id = ?', [$id])) jsonError('System not found.', 404);
        $db->query('UPDATE body_systems SET system_code=?, system_name=?, icon_emoji=?, color_hex=?, description=?, sort_order=?, is_active=? WHERE system_id=?', [...$values, $id]);
    } else {
        $id = $db->insert('body_systems', array_combine(['system_code','system_name','icon_emoji','color_hex','description','sort_order','is_active'], $values));
    }
    $db->query('INSERT INTO anatomy_content (system_id, model_url, key_facts, structures, source_text) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE model_url=VALUES(model_url), key_facts=VALUES(key_facts), structures=VALUES(structures), source_text=VALUES(source_text)', [$id, $url ?: null, json_encode($facts, JSON_UNESCAPED_UNICODE), json_encode(array_values($structures), JSON_UNESCAPED_UNICODE), $body['source_text'] ?? '']);
    $pdo->commit();
    jsonSuccess(['system_id' => $id], 'Anatomy content saved.');
} catch (Throwable $e) { $pdo->rollBack(); throw $e; }
