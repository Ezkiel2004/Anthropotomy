<?php
/**
 * Anthropotomy – Student Progress API
 *
 * GET  /api/progress.php              → student's full progress summary
 * POST /api/progress.php              → update lesson progress
 *
 * POST Body:
 *   { "lesson_id": 1, "status": "completed", "completion_pct": 100, "time_spent_secs": 300 }
 */

require_once __DIR__ . '/helpers.php';
requireMethod('GET', 'POST');

$user = requireStudent();
$db   = Database::getInstance();

// ── POST: Update lesson progress ────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body          = getJsonBody();
    $lessonId      = (int) requireField($body, 'lesson_id', 'Lesson ID');
    $status        = optionalField($body, 'status', 'in_progress');
    $completionPct = (float) optionalField($body, 'completion_pct', 0);
    $timeSpent     = (int) optionalField($body, 'time_spent_secs', 0);

    if (!in_array($status, ['not_started', 'in_progress', 'completed'])) {
        jsonError('Invalid status. Use: not_started, in_progress, completed.', 422);
    }

    if (!$db->fetchOne("SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id=l.module_id WHERE l.lesson_id=? AND l.status='published' AND m.status='published'", [$lessonId])) jsonError('Lesson unavailable.', 403);
    if ($completionPct < 0 || $completionPct > 100 || $timeSpent < 0) jsonError('Progress values are outside the allowed range.', 422);
    if ($status === 'completed') $completionPct = 100;
    $elapsed = max(0, time() - ($_SESSION['lesson_checkpoints'][$lessonId] ?? time()));
    $timeSpent = min($timeSpent, $elapsed, 3600);
    $_SESSION['lesson_checkpoints'][$lessonId] = time();
    $completedAt = $status === 'completed' ? date('Y-m-d H:i:s') : null;

    $db->query(
        "INSERT INTO student_lesson_progress
             (student_id, lesson_id, status, completion_pct, time_spent_secs, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
             status          = IF(status = 'completed', 'completed', VALUES(status)),
             completion_pct  = GREATEST(completion_pct, VALUES(completion_pct)),
             time_spent_secs = time_spent_secs + VALUES(time_spent_secs),
             completed_at    = COALESCE(completed_at, VALUES(completed_at))",
        [$user['user_id'], $lessonId, $status, $completionPct, $timeSpent, $completedAt]
    );

    // Rebuild progress summary
    _updateProgressSummary($user['user_id'], $db);

    jsonSuccess(['status' => $status, 'completion_pct' => $completionPct], 'Progress saved.');
}

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

// Per-system breakdown
$systemProgress = $db->fetchAll(
    "SELECT bs.system_id, bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code,
            COUNT(DISTINCT l.lesson_id)    AS total_lessons,
            COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons,
            COALESCE(AVG(CASE WHEN slp.status = 'completed' THEN slp.completion_pct END), 0) AS avg_completion
     FROM body_systems bs
     LEFT JOIN modules m  ON m.system_id  = bs.system_id AND m.status = 'published'
     LEFT JOIN lessons l  ON l.module_id  = m.module_id  AND l.status = 'published'
     LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ?
     WHERE bs.is_active = 1
     GROUP BY bs.system_id
     ORDER BY bs.sort_order",
    [$user['user_id']]
);

// Recent lesson completions (for streak)
$recentActivity = $db->fetchAll(
    "SELECT DATE(slp.completed_at) AS activity_date, COUNT(*) AS lessons_done
     FROM student_lesson_progress slp
     WHERE slp.student_id = ? AND slp.status = 'completed'
       AND slp.completed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY DATE(slp.completed_at)
     ORDER BY activity_date DESC",
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

// Cast types
foreach ($systemProgress as &$sp) {
    $sp['system_id']         = (int) $sp['system_id'];
    $sp['total_lessons']     = (int) $sp['total_lessons'];
    $sp['completed_lessons'] = (int) $sp['completed_lessons'];
    $sp['avg_completion']    = round((float) $sp['avg_completion'], 1);
    $sp['pct']               = $sp['total_lessons'] > 0
        ? round(($sp['completed_lessons'] / $sp['total_lessons']) * 100, 1)
        : 0;
}

jsonSuccess([
    'summary'          => $summary,
    'system_progress'  => $systemProgress,
    'recent_activity'  => $recentActivity,
    'score_trend'      => $scoreTrend,
]);
?>
