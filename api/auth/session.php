<?php
/**
 * Anthropotomy – Session Check API Endpoint
 * GET /api/auth/session.php
 *
 * Validates the current session and returns the logged-in user's data.
 * Used by the frontend to verify authentication on page load.
 *
 * Success Response (200):
 *   { "success": true, "data": { user_id, username, role, full_name, context, role_id } }
 *
 * Error Response (401):
 *   { "success": false, "message": "Not authenticated." }
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');

$user = requireLogin();

if (!$user) {
    jsonError('Not authenticated. Please log in.', 401);
}

// Optionally refresh user data from the database for accuracy
$db = Database::getInstance();
$fresh = $db->fetchOne(
    "SELECT u.user_id, u.username, u.role, u.full_name, u.email, u.profile_pic,
            COALESCE(sp.section, tp.subject) as context_info,
            COALESCE(sp.student_id, tp.teacher_id) as role_id,
            COALESCE(sp.grade_level, '') as grade_level
     FROM users u
     LEFT JOIN student_profiles sp ON u.user_id = sp.user_id
     LEFT JOIN teacher_profiles tp ON u.user_id = tp.user_id
     WHERE u.user_id = ? AND u.is_active = 1",
    [$user['user_id']]
);

if (!$fresh) {
    // User was deleted or deactivated since session started
    session_destroy();
    jsonError('Session expired. Please log in again.', 401);
}

$responseData = [
    'user_id'     => (int) $fresh['user_id'],
    'username'    => $fresh['username'],
    'role'        => $fresh['role'],
    'full_name'   => $fresh['full_name'],
    'email'       => $fresh['email'],
    'profile_pic' => $fresh['profile_pic'],
    'context'     => $fresh['context_info'],
    'role_id'     => $fresh['role_id'],
    'grade_level' => $fresh['grade_level'],
];

jsonSuccess($responseData, 'Session valid.');
?>
