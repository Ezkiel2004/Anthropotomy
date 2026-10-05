<?php
/**
 * Anthropotomy – Modules API
 *
 * GET    /api/modules.php              → list all published modules
 * GET    /api/modules.php?id=1         → single module with lessons
 * GET    /api/modules.php?system=skeletal → modules for a system
 * POST   /api/modules.php              → create module (teacher)
 * PUT    /api/modules.php?id=1         → update module (teacher)
 * DELETE /api/modules.php?id=1         → delete module (teacher)
 */

require_once __DIR__ . '/helpers.php';
requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    $user = Auth::getCurrentUser();
    $isStudent = ($user && $user['role'] === 'student');
    $studentId = $isStudent ? (int)$user['user_id'] : 0;

    // Single module
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $sql = "SELECT m.*, bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code,
                       u.full_name AS teacher_name,
                       COUNT(DISTINCT l.lesson_id) AS lesson_count" .
                       ($isStudent ? ", COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons" : "") . "
                FROM modules m
                JOIN body_systems bs ON bs.system_id = m.system_id
                JOIN users u         ON u.user_id    = m.teacher_id
                LEFT JOIN lessons l  ON l.module_id  = m.module_id AND l.status = 'published' " .
                ($isStudent ? "LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ? " : "") . "
                WHERE m.module_id = ?
                GROUP BY m.module_id";
        
        $params = $isStudent ? [$studentId, $id] : [$id];
        $module = $db->fetchOne($sql, $params);
        if (!$module) jsonError('Module not found.', 404);
        if ($isStudent && $module['status'] !== 'published') jsonError('Module unavailable.', 403);

        // Also fetch lessons for this module
        $lessonSql = "SELECT l.lesson_id, l.title, l.lesson_type, l.duration_mins, l.sort_order, l.status, l.media_url" .
                     ($isStudent ? ", COALESCE(slp.status, 'not_started') AS progress_status, COALESCE(slp.completion_pct, 0) AS completion_pct" : "") . "
                      FROM lessons l " .
                      ($isStudent ? "LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ? " : "") . "
                      WHERE l.module_id = ? AND l.status = 'published'
                      ORDER BY l.sort_order";
        $lessonParams = $isStudent ? [$studentId, $id] : [$id];
        $lessons = $db->fetchAll($lessonSql, $lessonParams);

        $module['lessons']           = $lessons;
        $module['module_id']         = (int) $module['module_id'];
        $module['system_id']         = (int) $module['system_id'];
        $module['lesson_count']      = (int) $module['lesson_count'];
        $completedLessons            = (int) ($module['completed_lessons'] ?? 0);
        $module['completed_lessons'] = $completedLessons;
        $module['completion_pct']    = $module['lesson_count'] > 0
            ? round(($completedLessons / $module['lesson_count']) * 100, 1)
            : 0.0;

        jsonSuccess($module);
    }

    // By system code
    $systemFilter = '';
    $params       = [];
    if (isset($_GET['system'])) {
        $systemFilter = "AND bs.system_code = ?";
        $params[]     = $_GET['system'];
    }

    // Role-based status filter: teachers see all, students see only published
    $statusFilter = ($user && in_array($user['role'], ['teacher', 'admin']))
        ? "AND m.status IN ('draft','published','archived')"
        : "AND m.status = 'published'";

    $selectFields = "m.module_id, m.title, m.description, m.status, m.sort_order,
                     m.created_at, m.published_at,
                     bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code, bs.system_id,
                     u.full_name AS teacher_name,
                     COUNT(DISTINCT l.lesson_id) AS lesson_count";
    $joinProgress = "";
    $queryParams = [];

    if ($isStudent) {
        $selectFields .= ", COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons";
        $joinProgress = "LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ? ";
        $queryParams[] = $studentId;
    }

    $queryParams = array_merge($queryParams, $params);

    $modules = $db->fetchAll(
        "SELECT {$selectFields}
         FROM modules m
         JOIN body_systems bs ON bs.system_id = m.system_id
         JOIN users u         ON u.user_id    = m.teacher_id
         LEFT JOIN lessons l  ON l.module_id  = m.module_id AND l.status = 'published'
         {$joinProgress}
         WHERE 1=1 {$systemFilter} {$statusFilter}
         GROUP BY m.module_id
         ORDER BY bs.sort_order, m.sort_order",
        $queryParams
    );

    foreach ($modules as &$m) {
        $m['module_id']         = (int) $m['module_id'];
        $m['system_id']         = (int) $m['system_id'];
        $m['lesson_count']      = (int) $m['lesson_count'];
        $completed              = (int) ($m['completed_lessons'] ?? 0);
        $m['completed_lessons'] = $completed;
        $m['completion_pct']    = $m['lesson_count'] > 0
            ? round(($completed / $m['lesson_count']) * 100, 1)
            : 0.0;
    }

    jsonSuccess($modules);
}

// ── POST (Create) ───────────────────────────────────────────────
if ($method === 'POST') {
    $user = requireTeacher();
    $body = getJsonBody();

    $title       = requireField($body, 'title',     'Module title');
    $system_id   = (int) requireField($body, 'system_id', 'Body system');
    $description = optionalField($body, 'description', '');
    $status      = optionalField($body, 'status', 'draft');

    if (!in_array($status, ['draft', 'published', 'archived'])) {
        jsonError('Invalid status. Use: draft, published, archived.', 422);
    }

    // Get current max sort_order for this system
    $maxOrder = $db->fetchOne(
        "SELECT COALESCE(MAX(sort_order), 0) AS max_ord FROM modules WHERE system_id = ?",
        [$system_id]
    );

    $moduleId = $db->query(
        "INSERT INTO modules (system_id, teacher_id, title, description, status, sort_order, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            $system_id,
            $user['user_id'],
            $title,
            $description,
            $status,
            (int) $maxOrder['max_ord'] + 1,
            $status === 'published' ? date('Y-m-d H:i:s') : null,
        ]
    );

    $newId = (int) $db->getConnection()->lastInsertId();
    $module = $db->fetchOne("SELECT m.*, bs.system_name, bs.icon_emoji, bs.color_hex
                             FROM modules m JOIN body_systems bs ON bs.system_id = m.system_id
                             WHERE m.module_id = ?", [$newId]);

    jsonSuccess($module, 'Module created successfully.', 201);
}

// ── PUT (Update) ────────────────────────────────────────────────
if ($method === 'PUT') {
    requireTeacher();
    $id   = getIdParam();
    $body = getJsonBody();

    $existing = $db->fetchOne("SELECT * FROM modules WHERE module_id = ?", [$id]);
    if (!$existing) jsonError('Module not found.', 404);

    $title       = optionalField($body, 'title',       $existing['title']);
    $description = optionalField($body, 'description', $existing['description']);
    $status      = optionalField($body, 'status',      $existing['status']);

    if (!in_array($status, ['draft', 'published', 'archived'])) {
        jsonError('Invalid status.', 422);
    }

    $publishedAt = $existing['published_at'];
    if ($status === 'published' && !$publishedAt) {
        $publishedAt = date('Y-m-d H:i:s');
    }

    $db->query(
        "UPDATE modules SET title = ?, description = ?, status = ?, published_at = ? WHERE module_id = ?",
        [$title, $description, $status, $publishedAt, $id]
    );

    jsonSuccess(null, 'Module updated successfully.');
}

// ── DELETE ──────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id = getIdParam();

    $existing = $db->fetchOne("SELECT module_id FROM modules WHERE module_id = ?", [$id]);
    if (!$existing) jsonError('Module not found.', 404);

    // Soft-archive instead of hard delete to preserve lesson history
    $db->query("UPDATE modules SET status = 'archived' WHERE module_id = ?", [$id]);
    jsonSuccess(null, 'Module archived successfully.');
}

jsonError('Method not supported.', 405);
?>
