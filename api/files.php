<?php
/**
 * Anthropotomy – Teacher Files API
 *
 * GET    /api/files.php?kind=lesson_plan            → the teacher's own lesson plans
 * GET    /api/files.php?kind=material[&module_id=1] → module materials (students: one published module)
 * GET    /api/files.php?id=1                        → open/download one file (access checked)
 * POST   /api/files.php                             → upload (teacher, multipart: kind, title, module_id, file)
 * DELETE /api/files.php?id=1                        → delete (owner)
 *
 * Lesson plans are visible to their owner only, never to other teachers or admins.
 * Files sit in storage/files/, which Apache never serves, so every read goes through this check.
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../database/preview.php';
$user   = requireLogin();
$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];
$isTeacher = in_array($user['role'], ['teacher', 'admin'], true);

define('FILE_STORE', __DIR__ . '/../storage/files/');
const FILE_TYPES = [ // extension => [content type, first bytes]
    'pdf'  => ['application/pdf', '%PDF'],
    'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation', "PK\x03\x04"],
    'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', "PK\x03\x04"],
    'ppt'  => ['application/vnd.ms-powerpoint', "\xD0\xCF\x11\xE0"],
    'doc'  => ['application/msword', "\xD0\xCF\x11\xE0"],
];
const FILE_MAX_BYTES = 100 * 1024 * 1024;

function canOpenFile(array $file, array $user, bool $isTeacher, Database $db): bool {
    if ($file['kind'] === 'lesson_plan') return (int)$file['teacher_id'] === (int)$user['user_id'];
    if ($isTeacher) return true;
    return (bool)$db->fetchOne("SELECT 1 FROM modules WHERE module_id = ? AND status = 'published'", [(int)$file['module_id']]);
}

/** What this user may do with a PowerPoint or Word file: view its PDF preview, and get the original (see previewOriginalAllowed). */
function fileFlags(array $file, bool $isTeacher): array {
    $hasPreview = previewSupported($file['stored_name']) && is_file(previewPath(FILE_STORE . $file['stored_name']));
    $allow = !empty($file['allow_download']);
    return ['has_preview' => $hasPreview, 'allow_download' => $allow, 'can_download' => previewOriginalAllowed($isTeacher, $hasPreview, $allow)];
}

/** List rows with the flags added and the internal stored name taken out. */
function fileRows(array $rows, bool $isTeacher): array {
    return array_map(function (array $row) use ($isTeacher) {
        $flags = fileFlags($row, $isTeacher);
        unset($row['stored_name'], $row['allow_download']);   // the flags carry allow_download as a boolean
        return $row + $flags;
    }, $rows);
}

// ── GET: one file ───────────────────────────────────────────────
if ($method === 'GET' && isset($_GET['id'])) {
    $file = $db->fetchOne("SELECT * FROM teacher_files WHERE file_id = ?", [getIdParam()]);
    // Same answer for "missing" and "not yours" so private files cannot be probed.
    if (!$file || !canOpenFile($file, $user, $isTeacher, $db)) jsonError('File not found.', 404);
    $path = FILE_STORE . $file['stored_name'];
    if (!is_file($path)) jsonError('File not found.', 404);
    // ?preview=1: the PDF copy of a PowerPoint or Word file, opened in the viewer (never an attachment).
    if (isset($_GET['preview'])) {
        $preview = previewPath($path);
        if (!previewSupported($file['stored_name']) || !is_file($preview)) jsonError('File not found.', 404);
        streamFile($preview, 'application/pdf', true, pathinfo($file['original_name'], PATHINFO_FILENAME) . '.pdf');
    }
    if (!fileFlags($file, $isTeacher)['can_download']) jsonError('This file is view-only.', 403);
    $ext = pathinfo($file['stored_name'], PATHINFO_EXTENSION);
    streamFile($path, FILE_TYPES[$ext][0], $ext === 'pdf', $file['original_name']);
}

// ── GET: list ───────────────────────────────────────────────────
if ($method === 'GET') {
    $kind = $_GET['kind'] ?? '';
    $select = "SELECT f.file_id, f.kind, f.module_id, f.title, f.original_name, f.stored_name, f.allow_download, f.size_bytes, f.created_at, m.title AS module_title
               FROM teacher_files f LEFT JOIN modules m ON m.module_id = f.module_id";
    if ($kind === 'lesson_plan') {
        if (!$isTeacher) jsonError('Access denied. Teacher privileges required.', 403);
        jsonSuccess(fileRows($db->fetchAll("$select WHERE f.kind = 'lesson_plan' AND f.teacher_id = ? ORDER BY f.created_at DESC", [$user['user_id']]), $isTeacher));
    }
    if ($kind !== 'material') jsonError('kind must be material or lesson_plan.', 422);
    $moduleId = (int)($_GET['module_id'] ?? 0);
    if (!$isTeacher) {
        if (!$moduleId) jsonError('module_id is required.', 422);
        jsonSuccess(fileRows($db->fetchAll("$select WHERE f.kind = 'material' AND f.module_id = ? AND m.status = 'published' ORDER BY f.created_at", [$moduleId]), $isTeacher));
    }
    jsonSuccess(fileRows($moduleId
        ? $db->fetchAll("$select WHERE f.kind = 'material' AND f.module_id = ? ORDER BY f.created_at", [$moduleId])
        : $db->fetchAll("$select WHERE f.kind = 'material' ORDER BY m.title, f.created_at"), $isTeacher));
}

// ── POST: upload ────────────────────────────────────────────────
if ($method === 'POST') {
    if (!$isTeacher) jsonError('Access denied. Teacher privileges required.', 403);
    $upload = $_FILES['file'] ?? null;
    $error  = $upload['error'] ?? UPLOAD_ERR_NO_FILE;
    if ($error === UPLOAD_ERR_NO_FILE) jsonError('Choose a file to upload.', 422);
    if (in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $upload['size'] > FILE_MAX_BYTES) jsonError('File too large. Maximum size is 100 MB.', 422);
    if ($error !== UPLOAD_ERR_OK) jsonError('File upload failed. Please try again.', 500);

    $kind = $_POST['kind'] ?? '';
    if (!in_array($kind, ['material', 'lesson_plan'], true)) jsonError('kind must be material or lesson_plan.', 422);
    $moduleId = null;
    if ($kind === 'material') {
        $moduleId = (int)($_POST['module_id'] ?? 0);
        if (!$db->fetchOne("SELECT 1 FROM modules WHERE module_id = ?", [$moduleId])) jsonError('Choose the module these materials belong to.', 422);
    }

    $original = basename(str_replace('\\', '/', $upload['name']));
    $ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
    if (!isset(FILE_TYPES[$ext])) jsonError('Upload a PDF, PowerPoint (.ppt, .pptx) or Word (.doc, .docx) file.', 422);
    if (file_get_contents($upload['tmp_name'], false, null, 0, 4) !== FILE_TYPES[$ext][1]) jsonError('That file does not look like a real .' . $ext . ' file.', 422);

    $title = trim($_POST['title'] ?? '') ?: mb_substr(pathinfo($original, PATHINFO_FILENAME), 0, 200);
    if (mb_strlen($title) > 200) jsonError('Title must be 200 characters or fewer.', 422);
    if (!is_dir(FILE_STORE)) mkdir(FILE_STORE, 0755, true);
    $stored = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($upload['tmp_name'], FILE_STORE . $stored)) jsonError('File upload failed. Check server permissions.', 500);

    // A PowerPoint or Word file also gets a PDF copy for the viewer, made BEFORE the row is saved: converting can take a minute,
    // and a row listed with no preview yet would let a student download the original of a view-only file in the meantime.
    // The upload never fails because that copy could not be made.
    $preview = makePreview(FILE_STORE . $stored);
    try {
        $id = $db->insert('teacher_files', [
            'teacher_id' => $user['user_id'], 'kind' => $kind, 'module_id' => $moduleId, 'title' => $title,
            'original_name' => mb_substr($original, 0, 255), 'stored_name' => $stored, 'size_bytes' => $upload['size'],
            'allow_download' => ($_POST['allow_download'] ?? '0') === '1' ? 1 : 0,
        ]);
    } catch (Throwable $e) {
        removePreview(FILE_STORE . $stored);
        @unlink(FILE_STORE . $stored);
        throw $e;
    }
    $row = $db->fetchOne("SELECT file_id, kind, module_id, title, original_name, allow_download, size_bytes, created_at FROM teacher_files WHERE file_id = ?", [$id]);
    $row['allow_download'] = (bool)$row['allow_download'];
    jsonSuccess($row + ['preview' => $preview], 'File uploaded.', 201);
}

// ── PUT: let students download a PowerPoint or Word file, or make it view-only ──
if ($method === 'PUT') {
    if (!$isTeacher) jsonError('Access denied. Teacher privileges required.', 403);
    $file = $db->fetchOne("SELECT * FROM teacher_files WHERE file_id = ?", [getIdParam()]);
    if (!$file || (int)$file['teacher_id'] !== (int)$user['user_id']) jsonError('File not found.', 404);
    $body = getJsonBody();
    if (!array_key_exists('allow_download', $body)) jsonError('allow_download is required.', 422);
    $file['allow_download'] = filter_var($body['allow_download'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
    $db->query("UPDATE teacher_files SET allow_download = ? WHERE file_id = ?", [$file['allow_download'], $file['file_id']]);
    jsonSuccess(['file_id' => (int)$file['file_id']] + fileFlags($file, $isTeacher), 'Saved.');
}

// ── DELETE ──────────────────────────────────────────────────────
if ($method === 'DELETE') {
    if (!$isTeacher) jsonError('Access denied. Teacher privileges required.', 403);
    $file = $db->fetchOne("SELECT * FROM teacher_files WHERE file_id = ?", [getIdParam()]);
    if (!$file || (int)$file['teacher_id'] !== (int)$user['user_id']) jsonError('File not found.', 404);
    $db->query("DELETE FROM teacher_files WHERE file_id = ?", [$file['file_id']]);
    @unlink(FILE_STORE . $file['stored_name']);
    removePreview(FILE_STORE . $file['stored_name']);
    jsonSuccess(null, 'File deleted.');
}

jsonError('Method not supported.', 405);
