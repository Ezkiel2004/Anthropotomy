<?php
/**
 * Anthropotomy – Login API Endpoint
 * POST /api/auth/login.php
 *
 * Authenticates a user against the database using bcrypt password verification.
 *
 * Request Body (JSON):
 *   { "username": "string", "password": "string" }
 *
 * Success Response (200):
 *   { "success": true, "data": { user_id, username, role, full_name, ... } }
 *
 * Error Responses:
 *   422 – Missing fields
 *   401 – Invalid credentials
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('POST');

$body = getJsonBody();

$username = requireField($body, 'username', 'Username');
$password = requireField($body, 'password', 'Password');
if (!is_string($username) || !is_string($password) || mb_strlen($username) > 50 || strlen($password) > 4096) {
    jsonError('Enter a valid student ID or username and password.', 422);
}

// Attempt authentication via the Auth class (uses bcrypt + PDO)
$user = Auth::login($username, $password);

if (!$user) {
    jsonError('Invalid username or password.', 401);
}

// Build the response data (exclude sensitive fields)
$responseData = [
    'user_id'   => (int) $user['user_id'],
    'username'  => $user['username'],
    'role'      => $user['role'],
    'full_name' => $user['full_name'],
    'email'     => $user['email'] ?? null,
    'context'   => $user['context_info'] ?? null,
    'role_id'   => $user['role_id'] ?? null,
];

jsonSuccess($responseData, 'Login successful.');
?>
