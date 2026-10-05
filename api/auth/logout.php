<?php
/**
 * Anthropotomy – Logout API Endpoint
 * POST /api/auth/logout.php
 *
 * Destroys the current server-side session.
 *
 * Success Response (200):
 *   { "success": true, "message": "Logged out successfully." }
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('POST');

// Destroy the PHP session
if (session_status() === PHP_SESSION_ACTIVE) {
    $_SESSION = [];

    // Delete the session cookie
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }

    session_destroy();
}

jsonSuccess(null, 'Logged out successfully.');
?>
