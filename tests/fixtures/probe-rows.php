<?php
// Test helper for the fake converter (fake-soffice.cmd / .sh): prints how many materials titled "Probe deck" the test database
// holds right now, so a test can tell whether an upload saved its row before or after the converter ran.
require_once __DIR__ . '/../../database/connection.php';
echo (int) Database::getInstance()->fetchOne("SELECT COUNT(*) AS c FROM teacher_files WHERE title = 'Probe deck'")['c'];
