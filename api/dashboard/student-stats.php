<?php
/**
 * Anthropotomy – Student Dashboard Statistics API
 * GET /api/dashboard/student-stats.php
 *
 * Provides real-time dashboard data for the authenticated student:
 * - Profile and section details
 * - Overall progress summary (lessons completed, % completed, quiz average)
 * - Next recommended lesson to resume
 * - Pending / upcoming assessments
 * - Recent learning activity stream
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireStudent();

$db = Database::getInstance();

// Ensure progress summary is freshly synced from live records
_updateProgressSummary($user['user_id'], $db);

// 1. Get student profile & summary
$profile = $db->fetchOne(
    "SELECT u.full_name, u.email, sp.student_id AS school_id, sp.section, sp.grade_level,
            COALESCE(sps.completed_lessons, 0) AS completed_lessons,
            COALESCE(sps.total_lessons, (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.module_id = l.module_id AND m.status = 'published' WHERE l.status = 'published')) AS total_lessons,
            sps.avg_quiz_score,
            COALESCE(sps.quizzes_taken, 0)     AS quizzes_taken,
            COALESCE(sps.quizzes_passed, 0)    AS quizzes_passed,
            COALESCE(sps.systems_explored, 0)  AS systems_explored,
            COALESCE(sps.total_time_hours, 0)  AS total_time_hours
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.user_id
     LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
     WHERE u.user_id = ?",
    [$user['user_id']]
);

$completedLessons = (int) ($profile['completed_lessons'] ?? 0);
$totalLessons     = (int) ($profile['total_lessons'] ?? 0);
$overallProgress  = $totalLessons > 0 ? round(($completedLessons / $totalLessons) * 100, 1) : 0.0;

// 2. Next recommended lesson (in-progress first, then first not-started)
$nextLesson = $db->fetchOne(
    "SELECT l.lesson_id, l.title, l.lesson_type, l.duration_mins,
            m.title AS module_title, bs.system_name, bs.system_code, bs.icon_emoji, bs.color_hex,
            COALESCE(slp.status, 'not_started') AS progress_status,
            COALESCE(slp.completion_pct, 0) AS completion_pct
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id AND m.status = 'published'
     JOIN body_systems bs ON bs.system_id = m.system_id
     LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ?
     WHERE l.status = 'published' AND (slp.status IS NULL OR slp.status != 'completed')
     ORDER BY (slp.status = 'in_progress') DESC, bs.sort_order ASC, m.sort_order ASC, l.sort_order ASC
     LIMIT 1",
    [$user['user_id']]
);

// 3. Pending & upcoming assessments
$upcomingAssessments = $db->fetchAll(
    "SELECT a.assessment_id, a.title, a.assessment_type, a.time_limit_mins, a.passing_score, a.max_attempts,
            a.due_date, bs.system_name, bs.icon_emoji, bs.color_hex,
            (SELECT COUNT(*) FROM assessment_submissions WHERE assessment_id = a.assessment_id AND student_id = ?) AS attempts_made
     FROM assessments a
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     WHERE a.status = 'active'
     HAVING attempts_made < a.max_attempts
     ORDER BY (a.due_date IS NOT NULL) DESC, a.due_date ASC, a.created_at DESC
     LIMIT 3",
    [$user['user_id']]
);

// Total pending assessments count (all active assessments student has not passed yet)
$pendingRow = $db->fetchOne(
    "SELECT COUNT(*) AS c
     FROM assessments a
     WHERE a.status = 'active'
       AND NOT EXISTS (
           SELECT 1 FROM assessment_submissions sub
           WHERE sub.assessment_id = a.assessment_id
             AND sub.student_id = ?
             AND sub.status IN ('submitted','graded')
             AND sub.score >= a.passing_score
       )",
    [$user['user_id']]
);
$pendingAssessmentsCount = (int) ($pendingRow['c'] ?? 0);

// 4. Recent learning activity (last 5 actions: completed lessons or quizzes)
$recentLessons = $db->fetchAll(
    "SELECT 'lesson' AS activity_type, l.title, bs.icon_emoji, bs.system_name, slp.completed_at AS timestamp, 100 AS score
     FROM student_lesson_progress slp
     JOIN lessons l ON l.lesson_id = slp.lesson_id
     JOIN modules m ON m.module_id = l.module_id
     JOIN body_systems bs ON bs.system_id = m.system_id
     WHERE slp.student_id = ? AND slp.status = 'completed' AND slp.completed_at IS NOT NULL
     ORDER BY slp.completed_at DESC LIMIT 5",
    [$user['user_id']]
);

$recentQuizzes = $db->fetchAll(
    "SELECT 'quiz' AS activity_type, a.title, bs.icon_emoji, bs.system_name, sub.submitted_at AS timestamp, sub.score
     FROM assessment_submissions sub
     JOIN assessments a ON a.assessment_id = sub.assessment_id
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     WHERE sub.student_id = ? AND sub.status IN ('submitted', 'graded') AND sub.submitted_at IS NOT NULL
     ORDER BY sub.submitted_at DESC LIMIT 5",
    [$user['user_id']]
);

$activities = array_merge($recentLessons, $recentQuizzes);
usort($activities, fn($a, $b) => strcmp($b['timestamp'], $a['timestamp']));
$activities = array_slice($activities, 0, 5);

// 5. System completion list for dashboard cards
$systems = $db->fetchAll(
    "SELECT bs.system_id, bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code,
            COUNT(DISTINCT l.lesson_id) AS total_lessons,
            COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons
     FROM body_systems bs
     LEFT JOIN modules m ON m.system_id = bs.system_id AND m.status = 'published'
     LEFT JOIN lessons l ON l.module_id = m.module_id AND l.status = 'published'
     LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ?
     WHERE bs.is_active = 1
     GROUP BY bs.system_id
     ORDER BY bs.sort_order ASC",
    [$user['user_id']]
);

foreach ($systems as &$sys) {
    $tot = (int) $sys['total_lessons'];
    $cmp = (int) $sys['completed_lessons'];
    $sys['pct'] = $tot > 0 ? round(($cmp / $tot) * 100) : 0;
}

$achievements = [];
foreach ($db->fetchAll('SELECT title, metric, threshold FROM achievement_rules WHERE is_active=1 ORDER BY achievement_id') as $rule) {
    $value = $rule['metric'] === 'overall_progress' ? $overallProgress : ($profile[$rule['metric']] ?? null);
    $achievements[] = ['name'=>$rule['title'], 'earned'=>$value !== null && (float)$value >= (float)$rule['threshold']];
}
jsonSuccess([
    'achievements' => $achievements,
    'profile' => [
        'full_name'         => $profile['full_name'],
        'school_id'         => $profile['school_id'],
        'section'           => $profile['section'],
        'grade_level'       => $profile['grade_level'],
        'completed_lessons' => $completedLessons,
        'total_lessons'     => $totalLessons,
        'overall_progress'  => $overallProgress,
        'avg_quiz_score'    => $profile['avg_quiz_score'] !== null ? round((float)$profile['avg_quiz_score'], 1) : null,
        'quizzes_taken'     => (int)$profile['quizzes_taken'],
        'quizzes_passed'    => (int)$profile['quizzes_passed'],
        'systems_explored'  => (int)$profile['systems_explored'],
        'total_time_hours'  => (float)$profile['total_time_hours'],
    ],
    'next_lesson'               => $nextLesson,
    'upcoming_assessments'      => $upcomingAssessments,
    'pending_assessments_count' => $pendingAssessmentsCount,
    'recent_activities'         => $activities,
    'systems'                   => $systems,
]);
?>
