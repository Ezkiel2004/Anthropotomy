<?php
/**
 * Anthropotomy – Teacher Dashboard Statistics API
 * GET /api/dashboard/teacher-stats.php
 *
 * Provides overview metrics for the teacher dashboard:
 * - Enrolled student counts & active status
 * - Class overall average quiz score
 * - Recent submissions needing grading or review
 * - How many students studied on each of the last 14 days
 * - Students needing attention
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireTeacher();

$db = Database::getInstance();
foreach ($db->fetchAll("SELECT user_id FROM users WHERE role='student'") as $studentRow) _updateProgressSummary((int)$studentRow['user_id'], $db);

// 1. Core summary stats
$totalStudents = (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM users WHERE role = 'student'")['c'] ?? 0);
$activeStudents = (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND is_active = 1")['c'] ?? 0);

$classAvg = $db->fetchOne("SELECT ROUND(AVG(avg_quiz_score), 1) AS avg_score FROM student_progress_summary WHERE avg_quiz_score IS NOT NULL");
$classAverageScore = $classAvg['avg_score'] !== null ? (float) $classAvg['avg_score'] : null;

$totalModules = (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM modules WHERE status = 'published'")['c'] ?? 0);
$totalLessons = (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM lessons WHERE status = 'published'")['c'] ?? 0);
$activeAssessments = (int) ($db->fetchOne("SELECT COUNT(*) AS c FROM assessments WHERE status = 'active'")['c'] ?? 0);

// 2. Recent student submissions
$recentSubmissions = $db->fetchAll(
    "SELECT sub.submission_id, sub.score, sub.submitted_at, sub.status,
            a.title AS assessment_title, a.passing_score,
            u.full_name AS student_name, sp.student_id AS school_id, sp.section
     FROM assessment_submissions sub
     JOIN assessments a ON a.assessment_id = sub.assessment_id
     JOIN users u ON u.user_id = sub.student_id
     JOIN student_profiles sp ON sp.user_id = sub.student_id
     WHERE sub.status IN ('submitted', 'graded')
     ORDER BY sub.submitted_at DESC
     LIMIT 6"
);

// 4. Students needing attention (average quiz < 75% or inactive)
$policy = gradingPolicy();
$atRiskStudents = $db->fetchAll(
    "SELECT u.user_id, u.full_name, sp.student_id AS school_id, sp.section,
            COALESCE(sps.avg_quiz_score, 0) AS avg_score,
            COALESCE(sps.study_days_week, 0) AS study_days_week
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.user_id
     LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
     WHERE u.role = 'student' AND (sps.avg_quiz_score < ? OR u.is_active = 0)
     ORDER BY sps.avg_quiz_score ASC, u.full_name ASC
     LIMIT 5",
    [$policy['passing_score']]
);

$scoreTrend = $db->fetchAll("SELECT DATE(submitted_at) AS day, ROUND(AVG(score),1) AS score FROM assessment_submissions WHERE status IN ('submitted','graded') GROUP BY DATE(submitted_at) ORDER BY day DESC LIMIT 14");
$scoreTrend = array_reverse($scoreTrend);
jsonSuccess([
    'score_trend' => $scoreTrend,
    'stats' => [
        'total_students'      => $totalStudents,
        'active_students'     => $activeStudents,
        'class_average_score' => $classAverageScore,
        'total_modules'       => $totalModules,
        'total_lessons'       => $totalLessons,
        'active_assessments'  => $activeAssessments,
    ],
    'recent_submissions' => $recentSubmissions,
    'study_activity'     => studyCalendar(null, 14),
    'at_risk_students'   => $atRiskStudents,
]);
?>
