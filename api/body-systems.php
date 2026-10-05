<?php
/**
 * Anthropotomy – Body Systems API
 * GET /api/body-systems.php  → list all active body systems
 *
 * Optional query params:
 *   ?with_stats=1  → include module/lesson counts per system
 */

require_once __DIR__ . '/helpers.php';
requireMethod('GET');
requireLogin();

$db         = Database::getInstance();
$withStats  = isset($_GET['with_stats']);

if ($withStats) {
    $systems = $db->fetchAll(
        "SELECT bs.*,
                COUNT(DISTINCT m.module_id)  AS module_count,
                COUNT(DISTINCT l.lesson_id)  AS lesson_count
         FROM body_systems bs
         LEFT JOIN modules m  ON m.system_id = bs.system_id AND m.status = 'published'
         LEFT JOIN lessons l  ON l.module_id = m.module_id  AND l.status = 'published'
         WHERE bs.is_active = 1
         GROUP BY bs.system_id
         ORDER BY bs.sort_order"
    );
} else {
    $systems = $db->fetchAll(
        "SELECT * FROM body_systems WHERE is_active = 1 ORDER BY sort_order"
    );
}

// Cast types for JSON
foreach ($systems as &$s) {
    $s['system_id']   = (int) $s['system_id'];
    $s['sort_order']  = (int) $s['sort_order'];
    $s['is_active']   = (bool) $s['is_active'];
    if (isset($s['module_count'])) $s['module_count'] = (int) $s['module_count'];
    if (isset($s['lesson_count'])) $s['lesson_count'] = (int) $s['lesson_count'];
}

jsonSuccess($systems, 'Body systems retrieved.');
?>
