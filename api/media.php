<?php
/**
 * Anthropotomy – Media Library API
 *
 * GET    /api/media.php              → list media files (teacher)
 * GET    /api/media.php?id=1         → single media file info
 * POST   /api/media.php              → upload media file (multipart)
 * DELETE /api/media.php?id=1         → delete media file
 *
 * Supported query params for GET list:
 *   ?type=image|video|model_3d|pdf
 *   ?system=skeletal
 *   ?search=keyword
 */

require_once __DIR__ . '/helpers.php';

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

define('MEDIA_UPLOAD_DIR', __DIR__ . '/../uploads/media/');
define('MEDIA_URL_BASE',   rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/') . '/uploads/media/');

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    requireLogin();

    if (isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $file = $db->fetchOne(
            "SELECT mf.*, bs.system_name, u.full_name AS uploader_name
             FROM media_files mf
             LEFT JOIN body_systems bs ON bs.system_id = mf.system_id
             LEFT JOIN users u         ON u.user_id    = mf.uploader_id
             WHERE mf.media_id = ?",
            [$id]
        );
        if (!$file) jsonError('Media file not found.', 404);
        $file['media_id'] = (int) $file['media_id'];
        jsonSuccess($file);
    }

    // Build filters
    $where  = ['1=1'];
    $params = [];

    if (!empty($_GET['type'])) {
        $where[]  = 'mf.file_type = ?';
        $params[] = $_GET['type'];
    }
    if (!empty($_GET['system'])) {
        $where[]  = 'bs.system_code = ?';
        $params[] = $_GET['system'];
    }
    if (!empty($_GET['search'])) {
        $where[]  = '(mf.original_name LIKE ? OR mf.description LIKE ? OR mf.tags LIKE ?)';
        $term     = '%' . $_GET['search'] . '%';
        $params   = array_merge($params, [$term, $term, $term]);
    }

    $whereStr = implode(' AND ', $where);
    $files = $db->fetchAll(
        "SELECT mf.media_id, mf.original_name, mf.file_type, mf.file_size_kb,
                mf.file_path, mf.thumbnail_url, mf.description, mf.tags, mf.created_at,
                bs.system_name, bs.system_code, u.full_name AS uploader_name
         FROM media_files mf
         LEFT JOIN body_systems bs ON bs.system_id = mf.system_id
         LEFT JOIN users u         ON u.user_id    = mf.uploader_id
         WHERE {$whereStr}
         ORDER BY mf.created_at DESC
         LIMIT 100",
        $params
    );

    foreach ($files as &$f) {
        $f['media_id']     = (int) $f['media_id'];
        $f['file_size_kb'] = (int) $f['file_size_kb'];
    }
    jsonSuccess($files, 'Media library loaded.');
}

// ── POST (Upload) ────────────────────────────────────────────────
if ($method === 'POST') {
    $user = requireTeacher();

    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $errCode = $_FILES['file']['error'] ?? -1;
        jsonError('No file received or upload error (code: ' . $errCode . ').', 400);
    }

    $file      = $_FILES['file'];
    $systemId  = !empty($_POST['system_id'])  ? (int) $_POST['system_id']  : null;
    $desc      = trim($_POST['description'] ?? '');
    $tags      = trim($_POST['tags']        ?? '');

    // Detect file type category
    $allowedMimes = [
        'image/jpeg'        => 'image',
        'image/png'         => 'image',
        'image/gif'         => 'image',
        'image/webp'        => 'image',
        'application/pdf'   => 'pdf',
        'video/mp4'         => 'video',
        'video/webm'        => 'video',
        'audio/mpeg'        => 'audio',
        'audio/ogg'         => 'audio',
        'model/gltf-binary' => 'model_3d',
        'application/octet-stream' => 'model_3d',
    ];

    $finfo    = new finfo(FILEINFO_MIME_TYPE);
    $mimeType = $finfo->file($file['tmp_name']);
    $fileType = $allowedMimes[$mimeType] ?? null;

    // Extension fallback for 3D models
    $origExt = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!$fileType && $origExt === 'glb') {
        $fileType = 'model_3d';
    }

    if (!$fileType) {
        jsonError('Unsupported file type: ' . $mimeType . '. Allowed: images, PDF, MP4, WebM, GLB, OBJ.', 422);
    }

    if ($fileType === 'model_3d' && ($origExt !== 'glb' || file_get_contents($file['tmp_name'], false, null, 0, 4) !== 'glTF')) jsonError('Upload a valid GLB model.', 422);
    // Size limit: 100 MB for 3D models, 50 MB otherwise
    $maxSize = $fileType === 'model_3d' ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
    if ($file['size'] > $maxSize) {
        jsonError('File too large. Limit: ' . ($maxSize / 1024 / 1024) . ' MB.', 422);
    }

    // Create directory
    if (!is_dir(MEDIA_UPLOAD_DIR)) {
        mkdir(MEDIA_UPLOAD_DIR, 0755, true);
    }

    // Safe filename
    $extensions = ['image/jpeg'=>'jpg','image/png'=>'png','image/gif'=>'gif','image/webp'=>'webp','application/pdf'=>'pdf','video/mp4'=>'mp4','video/webm'=>'webm','audio/mpeg'=>'mp3','audio/ogg'=>'ogg'];
    $ext = $fileType === 'model_3d' ? 'glb' : $extensions[$mimeType];
    $filename = 'media_' . $user['user_id'] . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
    $destPath = MEDIA_UPLOAD_DIR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $destPath)) {
        jsonError('Failed to save file. Check directory permissions.', 500);
    }

    $filePath    = MEDIA_URL_BASE . $filename;
    $fileSizeKb  = (int) ceil($file['size'] / 1024);

    // Insert record
    $db->query(
        "INSERT INTO media_files (uploader_id, system_id, file_name, original_name, file_type, file_size_kb, file_path, description, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [$user['user_id'], $systemId, $filename, $file['name'], $fileType, $fileSizeKb, $filePath, $desc, $tags]
    );
    $mediaId = (int) $db->getConnection()->lastInsertId();

    jsonSuccess([
        'media_id'      => $mediaId,
        'file_name'     => $filename,
        'original_name' => $file['name'],
        'file_type'     => $fileType,
        'file_size_kb'  => $fileSizeKb,
        'file_path'     => $filePath,
    ], 'File uploaded successfully.', 201);
}

// ── DELETE ───────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id   = getIdParam();
    $file = $db->fetchOne("SELECT * FROM media_files WHERE media_id = ?", [$id]);
    if (!$file) jsonError('Media file not found.', 404);

    // Remove physical file
    $diskPath = __DIR__ . '/../uploads/media/' . $file['file_name'];
    if (file_exists($diskPath)) {
        unlink($diskPath);
    }

    $db->query("DELETE FROM media_files WHERE media_id = ?", [$id]);
    jsonSuccess(null, 'Media file deleted.');
}

jsonError('Method not supported.', 405);
?>
