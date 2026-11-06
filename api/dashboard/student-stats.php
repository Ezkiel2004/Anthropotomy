<?php
/**
 * Anthropotomy – Student Dashboard Statistics API
 * GET /api/dashboard/student-stats.php
 *
 * Provides real-time dashboard data for the authenticated student:
 * - Profile and section details
 * - How often the student studies (days this week and month, study time)
 * - The newest published lesson
 * - Pending / upcoming assessments
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
            (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.module_id = l.module_id AND m.status = 'published' WHERE l.status = 'published') AS total_lessons,
            sps.avg_quiz_score,
            COALESCE(sps.quizzes_taken, 0)     AS quizzes_taken,
            COALESCE(sps.quizzes_passed, 0)    AS quizzes_passed,
            COALESCE(sps.systems_explored, 0)  AS systems_explored,
            COALESCE(sps.total_time_hours, 0)  AS total_time_hours,
            " . STUDY_COLUMNS . "
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.user_id
     LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
     WHERE u.user_id = ?",
    [$user['user_id']]
);

// 2. The newest published lesson
$newestLesson = $db->fetchOne(
    "SELECT l.lesson_id, l.title, l.lesson_type, l.duration_mins,
            m.title AS module_title, bs.system_name, bs.system_code
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id AND m.status = 'published'
     JOIN body_systems bs ON bs.system_id = m.system_id
     WHERE l.status = 'published'
     ORDER BY l.created_at DESC, l.lesson_id DESC
     LIMIT 1"
);

// 3. Pending & upcoming assessments
$upcomingAssessments = $db->fetchAll(
    "SELECT a.assessment_id, a.title, a.assessment_type, a.time_limit_mins, a.passing_score, a.max_attempts,
            a.due_date, bs.system_name, bs.icon_emoji, bs.color_hex,
            (SELECT COUNT(*) FROM assessment_submissions WHERE assessment_id = a.assessment_id AND student_id = ?) AS attempts_made
     FROM assessments a
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     WHERE a.status = 'active' AND EXISTS (SELECT 1 FROM questions qq WHERE qq.assessment_id = a.assessment_id)
     HAVING attempts_made < a.max_attempts
     ORDER BY (a.due_date IS NOT NULL) DESC, a.due_date ASC, a.created_at DESC
     LIMIT 3",
    [$user['user_id']]
);

// Total pending assessments count (all active assessments student has not passed yet)
$pendingRow = $db->fetchOne(
    "SELECT COUNT(*) AS c
     FROM assessments a
     WHERE a.status = 'active' AND EXISTS (SELECT 1 FROM questions qq WHERE qq.assessment_id = a.assessment_id)
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

// 4. Body systems and their published lesson counts, for the dashboard cards
$systems = $db->fetchAll(
    "SELECT bs.system_id, bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code,
            COUNT(DISTINCT l.lesson_id) AS total_lessons
     FROM body_systems bs
     LEFT JOIN modules m ON m.system_id = bs.system_id AND m.status = 'published'
     LEFT JOIN lessons l ON l.module_id = m.module_id AND l.status = 'published'
     WHERE bs.is_active = 1
     GROUP BY bs.system_id
     ORDER BY bs.sort_order ASC"
);

// Badges: award anything newly met (the summary was refreshed above), then list active badges
// from what the student actually holds, so an earned badge never disappears.
awardBadges($user['user_id']);
$achievements = array_map(
    fn($badge) => ['name'=>$badge['title'], 'icon'=>$badge['icon'], 'earned'=>$badge['earned_at'] !== null, 'earned_at'=>$badge['earned_at']],
    $db->fetchAll(
        'SELECT r.title, r.icon, sb.earned_at
         FROM achievement_rules r
         LEFT JOIN student_badges sb ON sb.achievement_id = r.achievement_id AND sb.user_id = ?
         WHERE r.is_active = 1
         ORDER BY r.achievement_id',
        [$user['user_id']]
    )
);
jsonSuccess([
    'achievements' => $achievements,
    'profile' => [
        'full_name'         => $profile['full_name'],
        'school_id'         => $profile['school_id'],
        'section'           => $profile['section'],
        'grade_level'       => $profile['grade_level'],
        'total_lessons'     => (int)$profile['total_lessons'],
        'avg_quiz_score'    => $profile['avg_quiz_score'] !== null ? round((float)$profile['avg_quiz_score'], 1) : null,
        'quizzes_taken'     => (int)$profile['quizzes_taken'],
        'quizzes_passed'    => (int)$profile['quizzes_passed'],
        'systems_explored'  => (int)$profile['systems_explored'],
        'total_time_hours'  => (float)$profile['total_time_hours'],
        'study_days_week'   => (int)$profile['study_days_week'],
        'study_days_month'  => (int)$profile['study_days_month'],
        'last_studied_on'   => $profile['last_studied_on'],
    ],
    'newest_lesson'             => $newestLesson,
    'upcoming_assessments'      => $upcomingAssessments,
    'pending_assessments_count' => $pendingAssessmentsCount,
    'systems'                   => $systems,
]);
?>
