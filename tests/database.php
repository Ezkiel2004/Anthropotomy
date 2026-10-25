<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$name = getenv('ANTHROPOTOMY_DB_NAME') ?: '';
if (!preg_match('/^anthropotomy_test_[a-z0-9_]+$/', $name)) throw new RuntimeException('An isolated test database is required.');
$root = new PDO('mysql:host=127.0.0.1;charset=utf8mb4', getenv('ANTHROPOTOMY_DB_USER') ?: 'root', getenv('ANTHROPOTOMY_DB_PASS') ?: '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$action = $argv[1] ?? 'setup';
if ($action === 'cleanup') { $root->exec("DROP DATABASE IF EXISTS `$name`"); echo "Test database removed.\n"; exit; }
if ($action === 'expire') { $root->exec("UPDATE `$name`.assessment_submissions SET deadline_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE status='in_progress'"); exit; }
if ($action === 'legacy-section') { $move = $root->prepare("UPDATE `$name`.student_profiles SET section = ? WHERE student_id='TEST-STUDENT'"); $move->execute([$argv[2] ?? '']); exit; }
if ($action === 'backdate-plays') { $age = $root->prepare("UPDATE `$name`.game_plays SET played_at = DATE_SUB(played_at, INTERVAL ? DAY) WHERE student_id = (SELECT user_id FROM `$name`.users WHERE username = ?)"); $age->execute([(int) ($argv[3] ?? 0), $argv[2] ?? '']); exit; }
if ($action === 'legacy-play') { $add = $root->prepare("INSERT INTO `$name`.game_plays (student_id, game_key, difficulty, correct, total, best_streak, points, duration_sec) SELECT user_id, ?, 'easy', 5, 6, ?, ?, 30 FROM `$name`.users WHERE username = ?"); $add->execute([$argv[3] ?? '', (int) ($argv[4] ?? 0), (int) ($argv[5] ?? 0), $argv[2] ?? '']); exit; }
if ($action === 'last-play') { $last = $root->prepare("SELECT * FROM `$name`.game_plays WHERE student_id = ? ORDER BY play_id DESC LIMIT 1"); $last->execute([(int) ($argv[2] ?? 0)]); echo json_encode($last->fetch(PDO::FETCH_ASSOC)); exit; }
$root->exec("CREATE DATABASE `$name` CHARACTER SET utf8mb4");
require __DIR__ . '/../database/schema.php';
$db = Database::getInstance();
$password = bin2hex(random_bytes(16));
$id = $db->insert('users', ['username'=>'fixture-teacher','password_hash'=>password_hash($password,PASSWORD_BCRYPT),'role'=>'teacher','full_name'=>'Test Teacher']);
$db->insert('teacher_profiles', ['user_id'=>$id,'teacher_id'=>'TEST-TEACHER','subject'=>'Test Subject']);
file_put_contents(__DIR__ . '/../.runtime/test-access.json', json_encode(['username'=>'fixture-teacher','password'=>$password]));
echo "Isolated test database ready.\n";
