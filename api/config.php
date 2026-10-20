<?php
require_once __DIR__ . '/helpers.php';
requireMethod('GET', 'PUT');
$db = Database::getInstance();
$keys = ['school_name', 'academic_year', 'department', 'subject', 'grade_level', 'recovery_contact', 'grade_a', 'grade_b', 'grade_c', 'grade_d', 'passing_score', 'support_score'];
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    requireTeacher();
    $body = getJsonBody();
    $combined = array_replace(schoolSettings(), $body);
    $previous = 101;
    foreach (['grade_a','grade_b','grade_c','grade_d'] as $key) {
        if (!isset($combined[$key]) || $combined[$key] === '') continue;
        if (!is_numeric($combined[$key]) || (float)$combined[$key] >= $previous) jsonError('Grade minimums must decrease from A through D.', 422);
        $previous = (float)$combined[$key];
    }
    if (($combined['passing_score'] ?? '') !== '' && ($combined['support_score'] ?? '') !== '' && (float)$combined['support_score'] > (float)$combined['passing_score']) jsonError('The support threshold cannot exceed the passing threshold.', 422);
    $pdo = $db->getConnection();
    $pdo->beginTransaction();
    try {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $body)) continue;
            if (!is_string($body[$key]) || mb_strlen($body[$key]) > 250) jsonError('Settings must be text up to 250 characters.', 422);
            if (in_array($key, ['grade_a','grade_b','grade_c','grade_d','passing_score','support_score'], true) && $body[$key] !== '' && (!is_numeric($body[$key]) || (float)$body[$key] < 0 || (float)$body[$key] > 100)) jsonError('Grade thresholds must be percentages from 0 to 100.', 422);
            $db->query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [$key, trim($body[$key])]);
        }
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}
$settings = array_fill_keys($keys, '');
foreach ($db->fetchAll('SELECT setting_key, setting_value FROM app_settings') as $row) {
    if (array_key_exists($row['setting_key'], $settings)) $settings[$row['setting_key']] = $row['setting_value'];
}
if ($settings['academic_year'] === '') $settings['academic_year'] = currentSchoolYear();
foreach (gradingPolicy() as $key => $value) if ($settings[$key] === '') $settings[$key] = (string)(0 + $value);
$settings['sections'] = SECTIONS;
$settings['system_count'] = (int)$db->fetchOne('SELECT COUNT(*) AS n FROM body_systems WHERE is_active = 1')['n'];
jsonSuccess($settings);
