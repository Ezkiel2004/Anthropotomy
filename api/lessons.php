<?php
/**
 * Anthropotomy – Lessons API
 *
 * GET    /api/lessons.php?module_id=1  → lessons in a module
 * GET    /api/lessons.php?id=1         → single lesson with full content
 * POST   /api/lessons.php              → create lesson (teacher, multipart OK)
 * PUT    /api/lessons.php?id=1         → update lesson (teacher)
 * DELETE /api/lessons.php?id=1         → archive lesson (teacher)
 *
 * File upload: POST with Content-Type: multipart/form-data
 *   Fields: module_id, title, lesson_type, content_text, duration_mins, sort_order, status
 *   File:   lesson_file (optional media attachment)
 */

require_once __DIR__ . '/helpers.php';
requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

// Upload directory (relative to project root)
define('UPLOAD_DIR', __DIR__ . '/../uploads/lessons/');

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $lesson = $db->fetchOne(
            "SELECT l.*, m.title AS module_title,
                    bs.system_name, bs.system_code, bs.icon_emoji, bs.color_hex
             FROM lessons l
             JOIN modules m      ON m.module_id  = l.module_id
             JOIN body_systems bs ON bs.system_id = m.system_id
             WHERE l.lesson_id = ?",
            [$id]
        );
        if (!$lesson) jsonError('Lesson not found.', 404);
        if (Auth::getCurrentUser()['role'] === 'student' && (!$db->fetchOne("SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id=l.module_id WHERE l.lesson_id=? AND l.status='published' AND m.status='published'", [$id]))) jsonError('Lesson unavailable.', 403);

        if (Auth::getCurrentUser()['role'] === 'student') $_SESSION['lesson_checkpoints'][$id] = time();
        // Track progress for students
        $user = Auth::getCurrentUser();
        if ($user && $user['role'] === 'student') {
            $progress = $db->fetchOne(
                "SELECT * FROM student_lesson_progress WHERE student_id = ? AND lesson_id = ?",
                [$user['user_id'], $id]
            );
            $lesson['progress'] = $progress;

            // Update to "in_progress" if first time viewing
            if (!$progress) {
                $db->query(
                    "INSERT INTO student_lesson_progress (student_id, lesson_id, status, started_at)
                     VALUES (?, ?, 'in_progress', NOW())
                     ON DUPLICATE KEY UPDATE status = IF(status='not_started','in_progress',status)",
                    [$user['user_id'], $id]
                );
            }
        }

        $lesson['lesson_id']     = (int) $lesson['lesson_id'];
        $lesson['module_id']     = (int) $lesson['module_id'];
        $lesson['duration_mins'] = (int) $lesson['duration_mins'];
        jsonSuccess($lesson);
    }

    // List lessons by module
    if (!isset($_GET['module_id'])) {
        jsonError('module_id parameter is required.', 400);
    }
    $moduleId = (int) $_GET['module_id'];
    if (Auth::getCurrentUser()['role'] === 'student' && !$db->fetchOne("SELECT module_id FROM modules WHERE module_id=? AND status='published'", [$moduleId])) jsonError('Module unavailable.', 403);

    $user   = Auth::getCurrentUser();
    $statusFilter = ($user && in_array($user['role'], ['teacher', 'admin']))
        ? "" : "AND l.status = 'published'";

    $lessons = $db->fetchAll(
        "SELECT l.lesson_id, l.title, l.lesson_type, l.duration_mins,
                l.sort_order, l.status, l.created_at, l.media_url
         FROM lessons l
         WHERE l.module_id = ? {$statusFilter}
         ORDER BY l.sort_order",
        [$moduleId]
    );

    // For students, attach their progress
    if ($user && $user['role'] === 'student' && !empty($lessons)) {
        $lessonIds = array_column($lessons, 'lesson_id');
        $placeholders = implode(',', array_fill(0, count($lessonIds), '?'));
        $progressMap = $db->fetchAll(
            "SELECT lesson_id, status, completion_pct
             FROM student_lesson_progress
             WHERE student_id = ? AND lesson_id IN ({$placeholders})",
            array_merge([$user['user_id']], $lessonIds)
        );
        $progByLesson = array_column($progressMap, null, 'lesson_id');
        foreach ($lessons as &$l) {
            $prog = $progByLesson[$l['lesson_id']] ?? null;
            $l['progress_status'] = $prog['status']         ?? 'not_started';
            $l['completion_pct']  = (float) ($prog['completion_pct'] ?? 0);
        }
    }

    jsonSuccess($lessons);
}

// ── POST (Create with optional file upload) ─────────────────────
if ($method === 'POST') {
    $user = requireTeacher();

    // Support both JSON body and multipart form data
    $isMultipart = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart') !== false;
    $data = $isMultipart ? $_POST : getJsonBody();

    $moduleId    = (int) requireField($data, 'module_id',    'Module');
    $title       = requireField($data, 'title',       'Lesson title');
    $lessonType  = optionalField($data, 'lesson_type', 'reading');
    $contentText = optionalField($data, 'content_text', '');
    $durationMin = (int) optionalField($data, 'duration_mins', 0);
    $status      = optionalField($data, 'status', 'draft');

    if (!in_array($lessonType, ['reading','video','3d_model','interactive','quiz_prep'])) {
        jsonError('Invalid lesson_type.', 422);
    }

    // Verify module exists
    $module = $db->fetchOne("SELECT module_id FROM modules WHERE module_id = ?", [$moduleId]);
    if (!$module) jsonError('Parent module not found.', 404);

    // Get max sort order
    $maxOrd = $db->fetchOne(
        "SELECT COALESCE(MAX(sort_order), 0) AS mo FROM lessons WHERE module_id = ?", [$moduleId]
    );

    $mediaUrl = null;

    // Handle file upload
    if ($isMultipart && isset($_FILES['lesson_file']) && $_FILES['lesson_file']['error'] === UPLOAD_ERR_OK) {
        $mediaUrl = _handleFileUpload($_FILES['lesson_file'], $user['user_id']);
    }

    $db->query(
        "INSERT INTO lessons (module_id, teacher_id, title, lesson_type, content_text, media_url, duration_mins, sort_order, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [$moduleId, $user['user_id'], $title, $lessonType, $contentText, $mediaUrl, $durationMin, (int)$maxOrd['mo'] + 1, $status]
    );
    $newId  = (int) $db->getConnection()->lastInsertId();
    $lesson = $db->fetchOne("SELECT * FROM lessons WHERE lesson_id = ?", [$newId]);
    jsonSuccess($lesson, 'Lesson created successfully.', 201);
}

// ── PUT (Update) ────────────────────────────────────────────────
if ($method === 'PUT') {
    requireTeacher();
    $id   = getIdParam();
    $body = getJsonBody();

    $existing = $db->fetchOne("SELECT * FROM lessons WHERE lesson_id = ?", [$id]);
    if (!$existing) jsonError('Lesson not found.', 404);

    $title       = optionalField($body, 'title',        $existing['title']);
    $lessonType  = optionalField($body, 'lesson_type',  $existing['lesson_type']);
    $contentText = optionalField($body, 'content_text', $existing['content_text']);
    $durationMin = (int) optionalField($body, 'duration_mins', $existing['duration_mins']);
    $status      = optionalField($body, 'status',       $existing['status']);

    $db->query(
        "UPDATE lessons SET title=?, lesson_type=?, content_text=?, duration_mins=?, status=? WHERE lesson_id=?",
        [$title, $lessonType, $contentText, $durationMin, $status, $id]
    );
    jsonSuccess(null, 'Lesson updated successfully.');
}

// ── DELETE ──────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id = getIdParam();
    $existing = $db->fetchOne("SELECT lesson_id FROM lessons WHERE lesson_id = ?", [$id]);
    if (!$existing) jsonError('Lesson not found.', 404);
    $db->query("UPDATE lessons SET status = 'archived' WHERE lesson_id = ?", [$id]);
    jsonSuccess(null, 'Lesson archived successfully.');
}

jsonError('Method not supported.', 405);

// ── File Upload Helper ───────────────────────────────────────────
function _handleFileUpload(array $file, int $userId): string {
    $allowedTypes = [
        'image/jpeg'       => 'jpg',
        'image/png'        => 'png',
        'image/gif'        => 'gif',
        'image/webp'       => 'webp',
        'application/pdf'  => 'pdf',
        'video/mp4'        => 'mp4',
        'video/webm'       => 'webm',
        'model/gltf-binary' => 'glb',
        'application/octet-stream' => 'glb', // .glb sometimes
    ];

    // Validate MIME
    $finfo    = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);

    $ext = $allowedTypes[$mimeType] ?? null;
    // Also check extension for .glb and .obj since MIME can be unreliable
    $origExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!$ext && $origExt === 'glb') {
        $ext = $origExt;
    }

    if (!$ext) {
        jsonError('Unsupported file type: ' . $mimeType, 422);
    }

    if ($ext === 'glb' && file_get_contents($file['tmp_name'], false, null, 0, 4) !== 'glTF') jsonError('Upload a valid GLB model.', 422);
    // Max 50 MB
    if ($file['size'] > 50 * 1024 * 1024) {
        jsonError('File too large. Maximum size is 50 MB.', 422);
    }

    // Create upload directory
    if (!is_dir(UPLOAD_DIR)) {
        mkdir(UPLOAD_DIR, 0755, true);
    }

    $filename = 'lesson_' . $userId . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $destPath = UPLOAD_DIR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        jsonError('File upload failed. Check server permissions.', 500);
    }

    // Return web-accessible URL (relative to project root)
    return rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/') . '/uploads/lessons/' . $filename;
}
?>
