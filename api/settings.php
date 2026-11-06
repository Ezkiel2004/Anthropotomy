<?php
/**
 * Anthropotomy – User Profile API
 *
 * GET  /api/settings.php         → Get current user profile details
 * PUT  /api/settings.php         → Update profile (name, email, password)
 * POST /api/settings.php         → Upload a profile photo (multipart field "photo")
 */

require_once __DIR__ . '/helpers.php';
$user = requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $profile = $db->fetchOne(
        "SELECT u.user_id, u.username, u.role, u.full_name, u.email, u.profile_pic, u.created_at, u.last_login,
                tp.teacher_id, tp.subject, tp.department,
                sp.student_id, sp.section, sp.grade_level, sp.school_year
         FROM users u
         LEFT JOIN teacher_profiles tp ON tp.user_id = u.user_id
         LEFT JOIN student_profiles sp ON sp.user_id = u.user_id
         WHERE u.user_id = ?",
        [$user['user_id']]
    );

    jsonSuccess(['profile' => $profile]);
}

if ($method === 'POST') {
    $file = $_FILES['photo'] ?? null;
    // A body over post_max_size arrives with no files at all, so that is a size error, not a missing photo.
    if (!$file && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) jsonError('Photo must be an image under 5 MB.', 422);
    if (!$file || !is_int($file['error']) || $file['error'] === UPLOAD_ERR_NO_FILE) jsonError('Choose a photo to upload.', 422);
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > 5 * 1024 * 1024) jsonError('Photo must be an image under 5 MB.', 422);
    $ext = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name'])] ?? null;
    if (!$ext || !getimagesize($file['tmp_name'])) jsonError('Upload a JPG, PNG or WebP photo.', 422);

    $dir = dirname(__DIR__) . '/uploads/avatars/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $name = 'u' . $user['user_id'] . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], $dir . $name)) jsonError('Photo upload failed. Check server permissions.', 500);

    $old = $db->fetchOne("SELECT profile_pic FROM users WHERE user_id = ?", [$user['user_id']])['profile_pic'] ?? '';
    $url = rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/') . '/uploads/avatars/' . $name;
    $db->query("UPDATE users SET profile_pic = ? WHERE user_id = ?", [$url, $user['user_id']]);
    if ($old && is_file($dir . basename($old))) unlink($dir . basename($old));

    jsonSuccess(['profile_pic' => $url], 'Profile photo updated.');
}

if ($method === 'PUT') {
    $body = getJsonBody();

    $fullName = optionalField($body, 'full_name');
    $email    = optionalField($body, 'email');
    $curPass  = optionalField($body, 'current_password');
    $newPass  = optionalField($body, 'new_password');

    $currentUser = $db->fetchOne("SELECT * FROM users WHERE user_id = ?", [$user['user_id']]);

    // Handle password change if requested
    if (!empty($newPass)) {
        if (empty($curPass)) {
            jsonError('Current password is required to set a new password.', 422);
        }
        if (!password_verify($curPass, $currentUser['password_hash'])) {
            jsonError('Current password does not match.', 422);
        }
        if (strlen($newPass) < 8) {
            jsonError('New password must be at least 8 characters long.', 422);
        }

        $newHash = password_hash($newPass, PASSWORD_BCRYPT, ['cost' => 12]);
        $db->query("UPDATE users SET password_hash = ? WHERE user_id = ?", [$newHash, $user['user_id']]);
        $_SESSION['credential_stamp'] = hash('sha256', $newHash);
        session_regenerate_id(true);
    }

    // Update basic info
    if ($fullName !== null) {
        $db->query("UPDATE users SET full_name = ? WHERE user_id = ?", [trim($fullName), $user['user_id']]);
        $_SESSION['full_name'] = trim($fullName);
    }
    if ($email !== null) {
        $db->query("UPDATE users SET email = ? WHERE user_id = ?", [trim($email), $user['user_id']]);
    }

    // Teacher profile specific updates
    if ($user['role'] === 'teacher' || $user['role'] === 'admin') {
        $department = optionalField($body, 'department');
        $subject    = optionalField($body, 'subject');
        if ($department !== null || $subject !== null) {
            $db->query(
                "UPDATE teacher_profiles
                 SET department = COALESCE(?, department), subject = COALESCE(?, subject)
                 WHERE user_id = ?",
                [$department, $subject, $user['user_id']]
            );
        }
    }

    jsonSuccess(null, 'Profile updated successfully.');
}

jsonError('Method not allowed.', 405);
?>
