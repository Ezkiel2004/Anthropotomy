<?php
/**
 * Anthropotomy – Study time
 *
 * POST /api/study.php  → one minute of active use by the signed-in student
 *
 * Every student page sends this once a minute while it is visible and in use (assets/js/app.js).
 * A beat less than 50 seconds after the last one, such as from a second open tab, adds nothing.
 */

require_once __DIR__ . '/helpers.php';
requireMethod('POST');
$user = requireStudent();

Database::getInstance()->query(
    "INSERT INTO study_days (student_id, study_date, active_secs, last_beat_at)
     VALUES (?, CURDATE(), 60, NOW())
     ON DUPLICATE KEY UPDATE
         active_secs  = IF(last_beat_at IS NULL OR last_beat_at < NOW() - INTERVAL 50 SECOND, active_secs + 60, active_secs),
         last_beat_at = IF(last_beat_at IS NULL OR last_beat_at < NOW() - INTERVAL 50 SECOND, NOW(), last_beat_at)",
    [$user['user_id']]
);

jsonSuccess(null, 'Study time recorded.');
?>
