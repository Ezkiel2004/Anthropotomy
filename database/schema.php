<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/connection.php';
$pdo = Database::getInstance()->getConnection();
$pdo->exec(file_get_contents(__DIR__ . '/anthropotomy_db.sql'));
require __DIR__ . '/migrate.php';
echo "Empty schema ready. Existing records were not replaced.\n";
