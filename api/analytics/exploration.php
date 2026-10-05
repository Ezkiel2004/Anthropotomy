<?php
/**
 * Anthropotomy – 3D Anatomy Explorer Analytics API
 *
 * POST /api/analytics/exploration.php  → Log a 3D exploration session (Student)
 * GET  /api/analytics/exploration.php  → Retrieve exploration logs (Teacher / Student)
 */

require_once __DIR__ . '/../helpers.php';

$user   = requireLogin();
$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

// ── POST: Log 3D viewer exploration session ──────────────────────
if ($method === 'POST') {
    requireStudent();
    $body = getJsonBody();

    $systemCode = $body['system_code'] ?? null;
    $systemId   = isset($body['system_id']) ? (int)$body['system_id'] : null;

    if (!$systemId && $systemCode) {
        $sysRow = $db->fetchOne("SELECT system_id FROM body_systems WHERE system_code = ?", [$systemCode]);
        if ($sysRow) {
            $systemId = (int)$sysRow['system_id'];
        }
    }

    if (!$systemId) {
        jsonError('Valid system_id or system_code is required.', 422);
    }

    if (!$db->fetchOne('SELECT system_id FROM body_systems WHERE system_id=? AND is_active=1', [$systemId])) jsonError('System unavailable.', 403);
    $elapsed = max(0, time() - ($_SESSION['exploration_checkpoint'] ?? time()));
    $durationSecs = min(max(0, (int)($body['duration_secs'] ?? 0)), $elapsed, 3600);
    $_SESSION['exploration_checkpoint'] = time();
    if ($durationSecs < 1) jsonSuccess(['duration_secs'=>0], 'No additional study time to record.');
    $interactions = min(max(0, (int)($body['interactions'] ?? 0)), $durationSecs * 20);
    $content = $db->fetchOne('SELECT structures FROM anatomy_content WHERE system_id=?', [$systemId]);
    $allowedStructures = array_column(json_decode($content['structures'] ?? '[]', true) ?: [], 'name');
    $requestedStructures = $body['structures_viewed'] ?? [];
    if (!is_array($requestedStructures)) jsonError('Invalid structure list.', 422);
    $structuresViewed = json_encode(array_values(array_intersect(array_filter($requestedStructures, 'is_string'), $allowedStructures)), JSON_UNESCAPED_UNICODE);

    $db->query(
        "INSERT INTO system_exploration_log (student_id, system_id, session_start, session_end, duration_secs, interactions, structures_viewed)
         VALUES (?, ?, DATE_SUB(NOW(), INTERVAL ? SECOND), NOW(), ?, ?, ?)",
        [$user['user_id'], $systemId, $durationSecs, $durationSecs, $interactions, $structuresViewed]
    );

    $logId = (int)$db->lastInsertId();

    // ── Update cached student_progress_summary ──────────────────────
    $stats = $db->fetchOne(
        "SELECT COUNT(DISTINCT system_id) AS distinct_systems,
                COALESCE(SUM(duration_secs), 0) AS total_secs
         FROM system_exploration_log
         WHERE student_id = ?",
        [$user['user_id']]
    );

    // Recalculate progress summary dynamically
    _updateProgressSummary($user['user_id'], $db);
    $distinctSystems = (int)($stats['distinct_systems'] ?? 0);

    jsonSuccess([
        'log_id'           => $logId,
        'systems_explored' => $distinctSystems,
        'duration_secs'    => $durationSecs
    ], 'Exploration logged successfully.', 201);
}

// ── GET: Fetch exploration activity / logs ──────────────────────
if ($method === 'GET') {
    if ($user['role'] === 'student') {
        // Student's own logs
        $logs = $db->fetchAll(
            "SELECT l.log_id, l.session_start, l.session_end, l.duration_secs, l.interactions, l.structures_viewed,
                    bs.system_code, bs.system_name, bs.icon_emoji, bs.color_hex
             FROM system_exploration_log l
             JOIN body_systems bs ON bs.system_id = l.system_id
             WHERE l.student_id = ?
             ORDER BY l.session_start DESC
             LIMIT 20",
            [$user['user_id']]
        );

        $summary = $db->fetchOne(
            "SELECT COUNT(DISTINCT system_id) AS explored_count,
                    COALESCE(SUM(duration_secs), 0) AS total_time_secs,
                    COALESCE(SUM(interactions), 0) AS total_interactions
             FROM system_exploration_log
             WHERE student_id = ?",
            [$user['user_id']]
        );

        jsonSuccess([
            'logs'    => $logs,
            'summary' => [
                'systems_explored'   => (int)($summary['explored_count'] ?? 0),
                'total_time_minutes' => round(($summary['total_time_secs'] ?? 0) / 60),
                'total_interactions' => (int)($summary['total_interactions'] ?? 0),
            ]
        ]);
    } else {
        // Teacher view: all student exploration logs with filters
        $studentId = isset($_GET['student_id']) ? (int)$_GET['student_id'] : null;
        $systemId  = isset($_GET['system_id']) ? (int)$_GET['system_id'] : null;

        $sql = "SELECT l.log_id, l.student_id, l.session_start, l.session_end, l.duration_secs, l.interactions, l.structures_viewed,
                       u.full_name AS student_name,
                       sp.student_id AS student_id_code,
                       sp.section,
                       bs.system_code, bs.system_name, bs.icon_emoji, bs.color_hex
                FROM system_exploration_log l
                JOIN users u ON u.user_id = l.student_id
                JOIN student_profiles sp ON sp.user_id = l.student_id
                JOIN body_systems bs ON bs.system_id = l.system_id
                WHERE 1=1 ";
        $params = [];

        if ($studentId) {
            $sql .= " AND l.student_id = ? ";
            $params[] = $studentId;
        }
        if ($systemId) {
            $sql .= " AND l.system_id = ? ";
            $params[] = $systemId;
        }

        $sql .= " ORDER BY l.session_start DESC LIMIT 50";
        $logs = $db->fetchAll($sql, $params);

        jsonSuccess([
            'logs' => $logs
        ]);
    }
}

jsonError('Unsupported request method.', 405);
