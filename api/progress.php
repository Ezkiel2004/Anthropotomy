<?php
/**
 * Anthropotomy – Student Progress API
 *
 * GET /api/progress.php → the student's summary, minutes studied per day for 28 days and recent scores.
 * Study time itself is recorded by api/study.php.
 */

require_once __DIR__ . '/helpers.php';
requireMethod('GET');

$user = requireStudent();
$db   = Database::getInstance();

// ── GET: Full progress summary ──────────────────────────────────
// Ensure summary is synced and exists
_updateProgressSummary($user['user_id'], $db);

$summary = $db->fetchOne(
    "SELECT sps.*,
            u.full_name, sp.section, sp.grade_level, sp.student_id AS school_id
     FROM student_progress_summary sps
     JOIN users u             ON u.user_id  = sps.student_id
     JOIN student_profiles sp ON sp.user_id = sps.student_id
     WHERE sps.student_id = ?",
    [$user['user_id']]
);

// Score trend (last 10 quiz submissions)
$scoreTrend = $db->fetchAll(
    "SELECT sub.score, sub.submitted_at, a.title AS assessment_title, bs.system_name
     FROM assessment_submissions sub
     JOIN assessments a    ON a.assessment_id = sub.assessment_id
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     WHERE sub.student_id = ? AND sub.status IN ('submitted','graded')
     ORDER BY sub.submitted_at DESC
     LIMIT 10",
    [$user['user_id']]
);

jsonSuccess([
    'summary'          => $summary,
    'system_count'     => (int) ($db->fetchOne('SELECT COUNT(*) AS c FROM body_systems WHERE is_active = 1')['c'] ?? 0),
    'study_calendar'   => studyCalendar($user['user_id']),
    'score_trend'      => $scoreTrend,
]);
?>
