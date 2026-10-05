<?php
/**
 * Anthropotomy – User Profile & System Settings API
 *
 * GET  /api/settings.php         → Get current user profile details & system health
 * PUT  /api/settings.php         → Update profile (name, email, password)
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

    // Get system health info
    $counts = [
        'users'       => (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM users")['c'] ?? 0),
        'modules'     => (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM modules")['c'] ?? 0),
        'lessons'     => (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM lessons")['c'] ?? 0),
        'assessments' => (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM assessments")['c'] ?? 0),
        'media'       => (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM media_files")['c'] ?? 0),
    ];

    $settings = schoolSettings();
    $systemInfo = [
        'php_version'   => PHP_VERSION,
        'server_time'   => date('Y-m-d H:i:s'),
        'school_name'   => $settings['school_name'] ?? '',
        'academic_year' => $settings['academic_year'] ?? '',
        'database'      => 'MySQL / MariaDB (Connected)',
        'counts'        => $counts,
    ];

    jsonSuccess([
        'profile'     => $profile,
        'system_info' => $systemInfo
    ]);
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
