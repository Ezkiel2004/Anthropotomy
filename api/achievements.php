<?php
require_once __DIR__ . '/helpers.php';
requireTeacher();
requireMethod('GET', 'POST', 'PUT', 'DELETE');
$db = Database::getInstance();
if ($_SERVER['REQUEST_METHOD'] === 'GET') jsonSuccess($db->fetchAll('SELECT * FROM achievement_rules ORDER BY achievement_id'));
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $db->query('DELETE FROM achievement_rules WHERE achievement_id=?', [getIdParam()]);
    jsonSuccess(null, 'Goal removed.');
}

/** Each validator returns the cleaned value, or null when the value is not acceptable. */
$validators = [
    'title'     => fn($v) => is_string($v) && trim($v) !== '' && mb_strlen(trim($v)) <= 100 ? trim($v) : null,
    'metric'    => fn($v) => is_string($v) && in_array($v, BADGE_METRICS, true) ? $v : null,
    'threshold' => fn($v) => ($n = filter_var($v, FILTER_VALIDATE_FLOAT)) !== false && $n > 0 && $n <= 99999999 ? $n : null,
    'icon'      => fn($v) => is_string($v) && preg_match('/^[a-z-]{1,40}$/', $v) ? $v : null,
    'is_active' => fn($v) => is_bool($v) || $v === 0 || $v === 1 ? (int) $v : null,
];
$messages = [
    'title'     => 'Give the badge a title of up to 100 characters.',
    'metric'    => 'Choose a metric from the list.',
    'threshold' => 'Choose a positive target (up to 99999999).',
    'icon'      => 'Choose an icon from the list.',
    'is_active' => 'Active must be true or false.',
];
$body = getJsonBody();

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $id = getIdParam();
    if (!$db->fetchOne('SELECT achievement_id FROM achievement_rules WHERE achievement_id=?', [$id])) jsonError('Badge not found.', 404);
    $changes = [];
    foreach ($validators as $field => $clean) {
        if (!array_key_exists($field, $body)) continue;
        $value = $clean($body[$field]);
        if ($value === null) jsonError($messages[$field], 422);
        $changes[$field] = $value;
    }
    if (!$changes) jsonError('Nothing to update.', 422);
    $db->query('UPDATE achievement_rules SET ' . implode(', ', array_map(fn($f) => "`$f`=?", array_keys($changes))) . ' WHERE achievement_id=?', [...array_values($changes), $id]);
    jsonSuccess(['achievement_id' => $id], 'Badge updated.');
}

$row = [];
foreach (['title', 'metric', 'threshold', 'icon'] as $field) {
    if ($field === 'icon' && !array_key_exists('icon', $body)) continue; // the column default is 'medal'
    $value = $validators[$field]($body[$field] ?? null);
    if ($value === null) jsonError($messages[$field], 422);
    $row[$field] = $value;
}
$id = $db->insert('achievement_rules', $row);
jsonSuccess(['achievement_id'=>$id], 'Goal created.', 201);
