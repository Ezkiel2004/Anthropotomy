<?php
/**
 * Anthropotomy – Shared API Helpers
 * Common utilities for all API endpoints: response formatting,
 * CORS headers, session management, authentication middleware.
 */

// ── Error Reporting (disable display in production) ─────────────
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// ── Include Database & Auth Classes ─────────────────────────────
require_once __DIR__ . '/../database/connection.php';

set_exception_handler(function (Throwable $error): void {
    error_log((string)$error);
    jsonError('The request could not be completed. Please try again or contact your teacher.', 500);
});

// Reject browser requests from another origin before any mutation.
if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD', 'OPTIONS'], true)) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $expected = ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site' || ($origin !== '' && $origin !== $expected)) {
        jsonError('Request origin is not allowed.', 403);
    }
}

function safeMediaUrl(string $url): bool {
    if ($url === '' || preg_match('/[\x00-\x20<>"\x27]/', $url) || str_starts_with($url, '//')) return false;
    if (str_starts_with($url, '/') || str_starts_with($url, '../')) return true;
    return in_array(strtolower(parse_url($url, PHP_URL_SCHEME) ?? ''), ['https', 'http'], true);
}

function schoolSettings(): array {
    return array_column(Database::getInstance()->fetchAll('SELECT setting_key, setting_value FROM app_settings'), 'setting_value', 'setting_key');
}

function gradingPolicy(): array {
    $settings = schoolSettings();
    $policy = [];
    foreach (['grade_a','grade_b','grade_c','grade_d','passing_score','support_score'] as $key) $policy[$key] = isset($settings[$key]) && $settings[$key] !== '' ? (float)$settings[$key] : null;
    return $policy;
}

function studentAudience(int $userId): string {
    $profile = Database::getInstance()->fetchOne('SELECT section FROM student_profiles WHERE user_id=?', [$userId]);
    return $profile ? 'section:' . $profile['section'] : '';
}

function validateAudience(string $audience): void {
    if ($audience === 'all') return;
    if (!str_starts_with($audience, 'section:') || !Database::getInstance()->fetchOne('SELECT profile_id FROM student_profiles WHERE section=? LIMIT 1', [substr($audience, 8)])) jsonError('Choose a section from the current student roster.', 422);
}

function studentQuestions(array $questions): array {
    foreach ($questions as &$question) {
        if (in_array($question['question_type'], ['identification', 'fill_blank'], true)) {
            $question['hotspot_data'] = null;
            $question['options'] = [];
        } elseif ($question['question_type'] === 'hotspot') {
            $data = is_array($question['hotspot_data']) ? $question['hotspot_data'] : (json_decode($question['hotspot_data'] ?? '{}', true) ?: []);
            // The target label is the prompt; the correct region stays on the server.
            $question['hotspot_data'] = array_intersect_key($data, array_flip(['target_label', 'image_url']));
        }
        foreach ($question['options'] ?? [] as &$option) unset($option['is_correct']);
    }
    return $questions;
}

function assertAssessmentEditable(int $assessmentId): void {
    if (Database::getInstance()->fetchOne('SELECT submission_id FROM assessment_submissions WHERE assessment_id = ? LIMIT 1', [$assessmentId])) {
        jsonError('This assessment has student attempts. Create a new assessment to change its questions and preserve past results.', 409);
    }
}

function validateQuestion(string $type, mixed $hotspot, mixed $options, float $points): void {
    if (!in_array($type, ['multiple_choice', 'true_false', 'identification', 'fill_blank', 'diagram', 'hotspot'], true) || !is_finite($points) || $points <= 0) jsonError('Choose a supported question type and positive points.', 422);
    $data = is_array($hotspot) ? $hotspot : (json_decode($hotspot ?? '{}', true) ?: []);
    if ($type === 'hotspot') {
        if (empty($data['image_url']) || !safeMediaUrl($data['image_url'])) jsonError('A valid diagram URL is required.', 422);
        foreach (['x','y','radius'] as $key) if (!isset($data[$key]) || !is_numeric($data[$key])) jsonError('Set the correct target location on the diagram.', 422);
        if ($data['x'] < 0 || $data['x'] > 1 || $data['y'] < 0 || $data['y'] > 1 || $data['radius'] < .01 || $data['radius'] > .25) jsonError('Invalid diagram target or tolerance.', 422);
    } elseif (in_array($type, ['identification','fill_blank'], true)) {
        if (empty(trim($data['target_label'] ?? ''))) jsonError('Enter the expected term.', 422);
    } elseif ($options !== null) {
        if (!is_array($options) || count($options) < 2 || count(array_filter($options, fn($o) => is_array($o) && !empty($o['is_correct']) && trim($o['option_text'] ?? '') !== '')) !== 1) jsonError('Provide at least two options and exactly one correct answer.', 422);
    }
}

// ── CORS & Content-Type Headers ─────────────────────────────────
function setCorsHeaders(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = ['http://localhost', 'http://127.0.0.1'];

    // Allow same-origin and common localhost origins
    foreach ($allowed as $ao) {
        if (in_array(parse_url($origin, PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
            header("Access-Control-Allow-Origin: {$origin}");
            break;
        }
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
    header('Access-Control-Allow-Credentials: true');
    header('Content-Type: application/json; charset=utf-8');
}

// Handle preflight OPTIONS requests
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    setCorsHeaders();
    http_response_code(204);
    exit;
}

setCorsHeaders();

// ── Start Secure Session ────────────────────────────────────────
Auth::startSecureSession();

// ── JSON Response Helpers ───────────────────────────────────────

/**
 * Send a JSON success response and exit.
 */
function jsonSuccess(mixed $data = null, string $message = 'Success', int $code = 200): never {
    http_response_code($code);
    echo json_encode([
        'success' => true,
        'message' => $message,
        'data'    => $data,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a JSON error response and exit.
 */
function jsonError(string $message = 'An error occurred', int $code = 400, mixed $errors = null): never {
    http_response_code($code);
    $response = [
        'success' => false,
        'message' => $message,
    ];
    if ($errors !== null) {
        $response['errors'] = $errors;
    }
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Auth Middleware ──────────────────────────────────────────────

/**
 * Require the user to be logged in. Returns user session data.
 * Sends 401 JSON error if not authenticated.
 */
function requireLogin(): array {
    $user = Auth::getCurrentUser();
    if (!$user) {
        jsonError('Authentication required. Please log in.', 401);
    }
    $fresh = Database::getInstance()->fetchOne('SELECT role, is_active, password_hash FROM users WHERE user_id = ?', [$user['user_id']]);
    if (!$fresh || !$fresh['is_active'] || !hash_equals($_SESSION['credential_stamp'] ?? '', hash('sha256', $fresh['password_hash']))) { $_SESSION = []; session_destroy(); jsonError('Account inactive or session expired.', 401); }
    $user['role'] = $fresh['role'];
    $_SESSION['role'] = $fresh['role'];
    return $user;
}

/**
 * Require the user to have a specific role.
 * Sends 403 JSON error if role doesn't match.
 */
function requireRole(string $role): array {
    $user = requireLogin();
    if ($user['role'] !== $role && $user['role'] !== 'admin') {
        jsonError('Access denied. Insufficient permissions.', 403);
    }
    return $user;
}

/**
 * Require the user to be a teacher or admin.
 */
function requireTeacher(): array {
    $user = requireLogin();
    if ($user['role'] !== 'teacher' && $user['role'] !== 'admin') {
        jsonError('Access denied. Teacher privileges required.', 403);
    }
    return $user;
}

/**
 * Require the user to be a student.
 */
function requireStudent(): array {
    $user = requireLogin();
    if ($user['role'] !== 'student') {
        jsonError('Access denied. Student account required.', 403);
    }
    return $user;
}

// ── Request Parsing Helpers ─────────────────────────────────────

/**
 * Enforce that the request uses the specified HTTP method.
 */
function requireMethod(string ...$methods): void {
    $current = $_SERVER['REQUEST_METHOD'];
    if (!in_array($current, $methods, true)) {
        jsonError("Method {$current} not allowed. Use: " . implode(', ', $methods), 405);
    }
}

/**
 * Get JSON body from POST/PUT request.
 */
function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return [];
    }
    $data = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Invalid JSON in request body.', 400);
    }
    if (!is_array($data) || (ltrim($raw)[0] ?? '') !== '{') jsonError('Request body must be a JSON object.', 422);
    return $data;
}

/**
 * Get a required field from an array, or send error.
 */
function requireField(array $data, string $field, string $label = ''): mixed {
    $label = $label ?: $field;
    if (!isset($data[$field]) || (is_string($data[$field]) && trim($data[$field]) === '')) {
        jsonError("{$label} is required.", 422);
    }
    return is_string($data[$field]) && !str_contains($field, 'password') ? trim($data[$field]) : $data[$field];
}

/**
 * Get an optional field from an array with a default value.
 */
function optionalField(array $data, string $field, mixed $default = null): mixed {
    if (!isset($data[$field])) {
        return $default;
    }
    return is_string($data[$field]) && !str_contains($field, 'password') ? trim($data[$field]) : $data[$field];
}

// ── Sanitization ────────────────────────────────────────────────

/**
 * Sanitize a string for safe output (HTML entity encoding).
 */
function sanitize(string $value): string {
    return htmlspecialchars(trim($value), ENT_QUOTES, 'UTF-8');
}

/**
 * Validate an integer ID from query parameter.
 */
function getIdParam(string $param = 'id'): int {
    $val = $_GET[$param] ?? null;
    $id = filter_var($val, FILTER_VALIDATE_INT);
    if (!$id || $id < 1) {
        jsonError("Invalid or missing {$param} parameter.", 400);
    }
    return (int) $id;
}

// ── Pagination Helper ───────────────────────────────────────────

/**
 * Get pagination parameters from query string.
 */
function getPagination(int $defaultLimit = 20, int $maxLimit = 100): array {
    $page  = max(1, (int) ($_GET['page'] ?? 1));
    $limit = min($maxLimit, max(1, (int) ($_GET['limit'] ?? $defaultLimit)));
    $offset = ($page - 1) * $limit;
    return ['page' => $page, 'limit' => $limit, 'offset' => $offset];
}

// ── Student Progress Calculation Helper ─────────────────────────

/**
 * Recalculates and caches student overall progress in student_progress_summary table.
 * All metrics are dynamically computed from live database records (zero hardcoded values).
 */
function _updateProgressSummary(int $studentId, Database $db): void {
    // 1. Dynamic count of all published lessons in published modules
    $totalLessonsRow = $db->fetchOne(
        "SELECT COUNT(*) AS total_lessons
         FROM lessons l
         JOIN modules m ON m.module_id = l.module_id AND m.status = 'published'
         WHERE l.status = 'published'"
    );
    $totalLessons = (int) ($totalLessonsRow['total_lessons'] ?? 0);

    // 2. Student lesson progress: completed count and study time
    $lessonStats = $db->fetchOne(
        "SELECT
            COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons,
            COALESCE(SUM(slp.time_spent_secs), 0) AS lesson_secs
         FROM student_lesson_progress slp
         JOIN lessons l ON l.lesson_id = slp.lesson_id AND l.status = 'published'
         JOIN modules m ON m.module_id = l.module_id AND m.status = 'published'
         WHERE slp.student_id = ?",
        [$studentId]
    );
    $completedLessons = (int) ($lessonStats['completed_lessons'] ?? 0);
    $lessonSecs       = (float) ($lessonStats['lesson_secs'] ?? 0);

    // 3. Quiz assessment submissions: average score, quizzes taken, quizzes passed
    $quizStats = $db->fetchOne(
        "SELECT
            COUNT(q.submission_id) AS quizzes_taken,
            COUNT(CASE WHEN q.score >= q.passing_score_calc THEN 1 END) AS quizzes_passed,
            AVG(q.score) AS avg_score
         FROM (
            SELECT sub.submission_id, sub.score, COALESCE(a.passing_score, 75) AS passing_score_calc
            FROM assessment_submissions sub
            JOIN assessments a ON a.assessment_id = sub.assessment_id
            WHERE sub.student_id = ? AND sub.status IN ('submitted', 'graded')
         ) q",
        [$studentId]
    );
    $quizzesTaken  = (int) ($quizStats['quizzes_taken'] ?? 0);
    $quizzesPassed = (int) ($quizStats['quizzes_passed'] ?? 0);
    $avgScore      = ($quizzesTaken > 0 && $quizStats['avg_score'] !== null)
        ? round((float) $quizStats['avg_score'], 2)
        : null;

    // 4. Systems explored count & 3D exploration time
    $systemsRow = $db->fetchOne(
        "SELECT
            COUNT(DISTINCT system_id) AS systems_explored,
            COALESCE(SUM(duration_secs), 0) AS exploration_secs
         FROM system_exploration_log
         WHERE student_id = ?",
        [$studentId]
    );
    $systemsExplored = (int) ($systemsRow['systems_explored'] ?? 0);
    $explorationSecs = (float) ($systemsRow['exploration_secs'] ?? 0);

    $totalHours = round(($lessonSecs + $explorationSecs) / 3600, 2);

    // 5. Upsert into student_progress_summary
    $db->query(
        "INSERT INTO student_progress_summary
             (student_id, total_lessons, completed_lessons, avg_quiz_score, quizzes_taken, quizzes_passed, systems_explored, total_time_hours)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             total_lessons     = VALUES(total_lessons),
             completed_lessons = VALUES(completed_lessons),
             avg_quiz_score    = VALUES(avg_quiz_score),
             quizzes_taken     = VALUES(quizzes_taken),
             quizzes_passed    = VALUES(quizzes_passed),
             systems_explored  = VALUES(systems_explored),
             total_time_hours  = VALUES(total_time_hours)",
        [
            $studentId,
            $totalLessons,
            $completedLessons,
            $avgScore,
            $quizzesTaken,
            $quizzesPassed,
            $systemsExplored,
            $totalHours,
        ]
    );
}
?>
