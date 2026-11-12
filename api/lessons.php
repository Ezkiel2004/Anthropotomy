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
 *   File:   lesson_file (optional): PDF, PowerPoint (.ppt, .pptx), Word (.doc, .docx), or a legacy video, image or GLB
 */

require_once __DIR__ . '/helpers.php';
requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

// Upload directory (relative to project root)
define('UPLOAD_DIR', __DIR__ . '/../uploads/lessons/');
const LESSON_TYPES = ['reading', 'video', '3d_model', 'interactive', 'quiz_prep'];
// PowerPoint and Word files: finfo names Office files inconsistently, so the extension decides and the first bytes
// must match it (a zip for .pptx/.docx, an OLE compound file for the older .ppt/.doc).
const OFFICE_SIGNATURES = [
    'pptx' => "PK\x03\x04",
    'docx' => "PK\x03\x04",
    'ppt'  => "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1",
    'doc'  => "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1",
];

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

    jsonSuccess($lessons);
}

// ── POST (Create with optional file upload) ─────────────────────
if ($method === 'POST' && isset($_GET['id'])) {
    // Multipart update (PHP does not parse multipart bodies on PUT)
    $user = requireTeacher();
    $id   = getIdParam();
    $isMultipart = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart') !== false;
    _rejectUnparsedMultipart($isMultipart);
    $data = $isMultipart ? $_POST : getJsonBody();

    $existing = $db->fetchOne("SELECT * FROM lessons WHERE lesson_id = ?", [$id]);
    if (!$existing) jsonError('Lesson not found.', 404);

    $title       = optionalField($data, 'title',        $existing['title']);
    $lessonType  = optionalField($data, 'lesson_type',  $existing['lesson_type']);
    $contentText = optionalField($data, 'content_text', $existing['content_text']);
    $durationMin = (int) optionalField($data, 'duration_mins', $existing['duration_mins']);
    $status      = optionalField($data, 'status',       $existing['status']);
    if (!in_array($lessonType, LESSON_TYPES, true)) jsonError('Invalid lesson_type.', 422);
    if (!in_array($status, ['draft', 'published', 'archived'], true)) jsonError('Invalid status.', 422);

    $mediaUrl = $existing['media_url'];
    $oldUrl   = null;
    $uploadError = $isMultipart && isset($_FILES['lesson_file']) ? $_FILES['lesson_file']['error'] : UPLOAD_ERR_NO_FILE;
    if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) jsonError('File too large. Maximum size is 500 MB.', 422);
    if ($uploadError !== UPLOAD_ERR_NO_FILE && $uploadError !== UPLOAD_ERR_OK) jsonError('File upload failed. Please try again.', 500);
    if ($uploadError === UPLOAD_ERR_OK) {
        $newUrl = _handleFileUpload($_FILES['lesson_file'], $user['user_id']);
        $oldUrl = $existing['media_url'];
        $mediaUrl = $newUrl;
    } elseif (optionalField($data, 'remove_media', '') === '1' || optionalField($data, 'remove_media', false) === true) {
        $oldUrl = $existing['media_url'];
        $mediaUrl = null;
    }

    try {
        $db->query(
            "UPDATE lessons SET title=?, lesson_type=?, content_text=?, duration_mins=?, status=?, media_url=? WHERE lesson_id=?",
            [$title, $lessonType, $contentText, $durationMin, $status, $mediaUrl, $id]
        );
    } catch (Throwable $e) {
        if ($mediaUrl !== $existing['media_url'] && $mediaUrl) _deleteLessonFile($mediaUrl);
        throw $e;
    }
    // Old file goes only after the new state is saved
    if ($oldUrl && $oldUrl !== $mediaUrl) _deleteLessonFile($oldUrl);
    jsonSuccess(['media_url' => $mediaUrl], 'Lesson updated successfully.');
}

if ($method === 'POST') {
    $user = requireTeacher();

    // Support both JSON body and multipart form data
    $isMultipart = strpos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart') !== false;
    _rejectUnparsedMultipart($isMultipart);
    $data = $isMultipart ? $_POST : getJsonBody();

    $moduleId    = (int) requireField($data, 'module_id',    'Module');
    $title       = requireField($data, 'title',       'Lesson title');
    $lessonType  = optionalField($data, 'lesson_type', 'reading');
    $contentText = optionalField($data, 'content_text', '');
    $durationMin = (int) optionalField($data, 'duration_mins', 0);
    $status      = optionalField($data, 'status', 'draft');

    if (!in_array($lessonType, LESSON_TYPES, true)) {
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
    $uploadError = $isMultipart && isset($_FILES['lesson_file']) ? $_FILES['lesson_file']['error'] : UPLOAD_ERR_NO_FILE;
    if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) jsonError('File too large. Maximum size is 500 MB.', 422);
    if ($uploadError !== UPLOAD_ERR_NO_FILE && $uploadError !== UPLOAD_ERR_OK) jsonError('File upload failed. Please try again.', 500);
    if ($uploadError === UPLOAD_ERR_OK) {
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
if ($method === 'PUT' && isset($_GET['reorder'])) {
    requireTeacher();
    $body     = getJsonBody();
    $moduleId = (int) ($body['module_id'] ?? 0);
    $order    = $body['order'] ?? null;
    $stale    = 'The lesson list changed. Reload and try again.';
    if (!$moduleId || !is_array($order)) jsonError($stale, 422);
    $order = array_map(fn($v) => is_int($v) || (is_string($v) && ctype_digit($v)) ? (int) $v : -1, array_values($order));
    $current = array_map('intval', array_column(
        $db->fetchAll("SELECT lesson_id FROM lessons WHERE module_id = ? AND status <> 'archived'", [$moduleId]),
        'lesson_id'
    ));
    $a = $order; $b = $current; sort($a); sort($b);
    if ($a !== $b || count(array_unique($order)) !== count($order)) jsonError($stale, 422);

    $pdo = $db->getConnection();
    $pdo->beginTransaction();
    try {
        foreach ($order as $i => $lessonId) {
            $db->query("UPDATE lessons SET sort_order = ? WHERE lesson_id = ? AND module_id = ?", [$i + 1, $lessonId, $moduleId]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    jsonSuccess(null, 'Lessons reordered.');
}

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
    if (!in_array($lessonType, LESSON_TYPES, true)) jsonError('Invalid lesson_type.', 422);

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

// A multipart body bigger than post_max_size reaches PHP with $_POST and $_FILES both empty, so the
// request would otherwise "save" nothing and report success. Any multipart body PHP could not parse
// into a single field or file is answered the same way.
function _rejectUnparsedMultipart(bool $isMultipart): void {
    if (!$isMultipart || $_POST || $_FILES || (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) <= 0) return;
    while (ob_get_level() > 0) ob_end_clean();   // drops PHP's own "exceeds the limit" warning if it was buffered
    jsonError('File too large for this server.', 413);
}

// Delete an attachment only when it resolves to a file inside uploads/lessons/.
// media_url may be absolute (/anthropotomy/uploads/lessons/x.pdf) or page-relative
// (../uploads/lessons/x.pdf); resolve by basename inside the upload directory.
function _deleteLessonFile(?string $mediaUrl): void {
    if (!$mediaUrl) return;
    $base = realpath(UPLOAD_DIR);
    if ($base === false) return;
    $name = basename(str_replace('\\', '/', parse_url($mediaUrl, PHP_URL_PATH) ?? ''));
    if ($name === '' || $name === '.' || $name === '..') return;
    $path = realpath($base . DIRECTORY_SEPARATOR . $name);
    if ($path === false || !is_file($path)) return;
    if (strpos($path, $base . DIRECTORY_SEPARATOR) !== 0) return;
    @unlink($path);
}

// ── File Upload Helper ───────────────────────────────────────────
function _handleFileUpload(array $file, int $userId): string {
    $origExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (isset(OFFICE_SIGNATURES[$origExt])) {
        $signature = OFFICE_SIGNATURES[$origExt];
        if (file_get_contents($file['tmp_name'], false, null, 0, strlen($signature)) !== $signature) {
            jsonError('That file does not look like a real .' . $origExt . ' file.', 422);
        }
        return _storeLessonFile($file, $userId, $origExt);
    }

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
    if (!$ext && $origExt === 'glb') {
        $ext = $origExt;
    }

    if (!$ext) {
        jsonError('Unsupported file type: ' . $mimeType, 422);
    }

    if ($ext === 'glb' && file_get_contents($file['tmp_name'], false, null, 0, 4) !== 'glTF') jsonError('Upload a valid GLB model.', 422);
    return _storeLessonFile($file, $userId, $ext);
}

function _storeLessonFile(array $file, int $userId, string $ext): string {
    // Max 500 MB (videos); api/.htaccess raises PHP's own limits to match
    if ($file['size'] > 500 * 1024 * 1024) {
        jsonError('File too large. Maximum size is 500 MB.', 422);
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
    return rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME']))), '/') . '/uploads/lessons/' . $filename;
}
?>
