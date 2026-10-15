<?php
/** Explicit one-time cleanup requested by the project owner. */
if (PHP_SAPI !== 'cli' || !in_array('--confirm', $argv, true)) {
    if (PHP_SAPI !== 'cli') http_response_code(404);
    else fwrite(STDERR, "Use --confirm to remove student accounts and lessons after a backup.\n");
    exit(1);
}
require_once __DIR__ . '/connection.php';
$pdo = Database::getInstance()->getConnection();
$backupDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'Anthropotomy-backups';
if (!is_dir($backupDir) && !mkdir($backupDir, 0700, true)) throw new RuntimeException('Cannot create backup directory.');
$backup = $backupDir . DIRECTORY_SEPARATOR . 'before-cleanup-' . date('Ymd-His') . '.sql';
$handle = fopen($backup, 'xb');
if (!$handle) throw new RuntimeException('Cannot create backup file.');
function backupWrite($handle, string $text): void {
    if (fwrite($handle, $text) !== strlen($text)) throw new RuntimeException('Incomplete backup; cleanup cancelled.');
}
$pdo->beginTransaction();
try {
    backupWrite($handle, "SET FOREIGN_KEY_CHECKS=0;\n");
    foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) throw new RuntimeException('Unexpected table name.');
        $definition = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM)[1];
        backupWrite($handle, "DROP TABLE IF EXISTS `$table`;\n$definition;\n");
        foreach ($pdo->query("SELECT * FROM `$table`") as $row) {
            $values = array_map(fn($value) => $value === null ? 'NULL' : $pdo->quote((string)$value), array_values($row));
            backupWrite($handle, "INSERT INTO `$table` VALUES (" . implode(',', $values) . ");\n");
        }
    }
    backupWrite($handle, "SET FOREIGN_KEY_CHECKS=1;\n");
    if (!fflush($handle)) throw new RuntimeException('Unable to flush backup.');
    fclose($handle);
    $teachersBefore = $pdo->query("SELECT user_id, password_hash FROM users WHERE role IN ('teacher','admin') ORDER BY user_id")->fetchAll();
    $students = $pdo->exec("DELETE FROM users WHERE role='student'");
    $lessons = $pdo->exec('DELETE FROM lessons');
    $teachersAfter = $pdo->query("SELECT user_id, password_hash FROM users WHERE role IN ('teacher','admin') ORDER BY user_id")->fetchAll();
    if ($teachersBefore !== $teachersAfter) throw new RuntimeException('Teacher preservation check failed.');
    $pdo->commit();
    echo "Removed $students student accounts and $lessons lessons. Teacher/admin accounts preserved: " . count($teachersAfter) . ".\nBackup: $backup\n";
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $error;
}
