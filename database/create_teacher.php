<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/connection.php';
$username = getenv('ANTHROPOTOMY_BOOTSTRAP_USERNAME');
$name = getenv('ANTHROPOTOMY_BOOTSTRAP_NAME');
$teacherId = getenv('ANTHROPOTOMY_BOOTSTRAP_TEACHER_ID');
$password = getenv('ANTHROPOTOMY_BOOTSTRAP_PASSWORD');
if (!$username || !$name || !$teacherId || !$password || strlen($password) < 8) {
    fwrite(STDERR, "Set ANTHROPOTOMY_BOOTSTRAP_USERNAME, ANTHROPOTOMY_BOOTSTRAP_NAME, ANTHROPOTOMY_BOOTSTRAP_TEACHER_ID and ANTHROPOTOMY_BOOTSTRAP_PASSWORD (at least 8 characters).\n");
    exit(1);
}
$db = Database::getInstance(); $pdo = $db->getConnection();
$pdo->beginTransaction();
try {
    $id = $db->insert('users', ['username'=>$username,'full_name'=>$name,'password_hash'=>password_hash($password,PASSWORD_BCRYPT),'role'=>'teacher']);
    $db->insert('teacher_profiles', ['user_id'=>$id,'teacher_id'=>$teacherId,'subject'=>'']);
    $pdo->commit();
    echo "Teacher account created. No demo credentials were installed.\n";
} catch (Throwable $error) { $pdo->rollBack(); fwrite(STDERR, "Teacher creation failed; no partial account saved. Check that the username and teacher ID are unique.\n"); exit(1); }
