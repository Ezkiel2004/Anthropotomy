<?php
/** Public student registration; teacher accounts cannot be created here. */
require_once __DIR__ . '/../helpers.php';
requireMethod('POST');
$body = getJsonBody();
$limits = ['full_name'=>120, 'school_id'=>20, 'email'=>150, 'contact_no'=>20, 'section'=>60, 'username'=>50];
$data = [];
foreach ($limits as $key => $limit) {
    if (!isset($body[$key]) || !is_string($body[$key]) || trim($body[$key]) === '' || mb_strlen(trim($body[$key])) > $limit) {
        jsonError('Please provide a valid ' . str_replace('_', ' ', $key) . ' (up to ' . $limit . ' characters).', 422);
    }
    $data[$key] = trim($body[$key]);
}
if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) jsonError('Enter a valid email address.', 422);
if (!preg_match('/^[A-Za-z0-9_.-]{3,50}$/D', $data['username'])) jsonError('Username must use 3–50 letters, numbers, periods, underscores or hyphens.', 422);
if (!preg_match('/^[+0-9\s().-]+$/D', $data['contact_no']) || strlen(preg_replace('/\D/', '', $data['contact_no'])) < 7) jsonError('Enter a valid contact number with at least 7 digits.', 422);
$password = $body['password'] ?? null;
if (!is_string($password) || mb_strlen($password) < 8 || strlen($password) > 72) jsonError('Password must have at least 8 characters and no more than 72 bytes.', 422);
if (!is_string($body['confirm_password'] ?? null) || $password !== $body['confirm_password']) jsonError('Your passwords do not match.', 422);
if (($body['terms'] ?? false) !== true) jsonError('Please agree to the Terms and Conditions.', 422);
$db = Database::getInstance();
$settings = schoolSettings();
if (!in_array($data['section'], SECTIONS, true)) jsonError('Select your section.', 422);
$schoolYear = trim($settings['academic_year'] ?? '') ?: currentSchoolYear();
if ($schoolYear === '' || mb_strlen($schoolYear) > 20) jsonError('Registration is not ready yet. Ask your teacher to configure the school academic year.', 409);
// Prevent ambiguous student-ID/username identifiers. Existing usernames retain login priority.
if ($db->fetchOne('SELECT user_id FROM users WHERE username IN (?, ?)', [$data['username'], $data['school_id']]) ||
    $db->fetchOne('SELECT user_id FROM student_profiles WHERE student_id IN (?, ?)', [$data['school_id'], $data['username']])) {
    jsonError('That username or student ID is already registered. Try signing in or contact your teacher.', 409);
}
$pdo = $db->getConnection();
try {
    $pdo->beginTransaction();
    $id = $db->insert('users', ['username'=>$data['username'], 'password_hash'=>password_hash($password, PASSWORD_BCRYPT, ['cost'=>12]), 'role'=>'student', 'full_name'=>$data['full_name'], 'email'=>$data['email'], 'is_active'=>1]);
    $db->insert('student_profiles', ['user_id'=>$id, 'student_id'=>$data['school_id'], 'section'=>$data['section'], 'grade_level'=>GRADE_LEVEL, 'contact_no'=>$data['contact_no'], 'school_year'=>$schoolYear]);
    _updateProgressSummary($id, $db);
    $pdo->commit();
    jsonSuccess(null, 'Your student account has been created. You can now sign in.', 201);
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($error instanceof PDOException && $error->getCode() === '23000') jsonError('That username or student ID is already registered.', 409);
    error_log((string)$error);
    jsonError('We could not create your account. Please try again or contact your teacher.', 500);
}
