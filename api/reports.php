<?php
/**
 * Anthropotomy – Reports & Academic Analytics API
 *
 * GET /api/reports.php              → JSON metrics, score distribution, section averages, student roster
 * GET /api/reports.php?format=csv   → Direct CSV stream of full academic report from database
 */

require_once __DIR__ . '/helpers.php';
requireTeacher();

$db = Database::getInstance();
foreach ($db->fetchAll("SELECT user_id FROM users WHERE role='student'") as $studentRow) _updateProgressSummary((int)$studentRow['user_id'], $db);

// ── 1. Fetch Students with Cached & Computed Stats ──────────────────
$students = $db->fetchAll(
    "SELECT u.user_id, u.full_name, u.email, u.is_active,
            sp.student_id AS school_id, sp.section, sp.grade_level,
            COALESCE(sps.total_lessons, (SELECT COUNT(*) FROM lessons WHERE status = 'published')) AS total_lessons,
            COALESCE(sps.completed_lessons, 0) AS completed_lessons,
            sps.avg_quiz_score,
            COALESCE(sps.quizzes_taken, 0) AS quizzes_taken,
            COALESCE(sps.quizzes_passed, 0) AS quizzes_passed,
            COALESCE(sps.systems_explored, 0) AS systems_explored,
            COALESCE(sps.total_time_hours, 0.00) AS total_time_hours
     FROM users u
     JOIN student_profiles sp ON sp.user_id = u.user_id
     LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
     WHERE u.role = 'student'
     ORDER BY (sps.avg_quiz_score IS NOT NULL) DESC, sps.avg_quiz_score DESC, sps.completed_lessons DESC, u.full_name ASC"
);

$totalStudents = count($students);
$policy = gradingPolicy();

// Assign ranks, letter grades, and academic statuses
$rank = 1;
foreach ($students as &$s) {
    $s['rank'] = $rank++;
    $quizzesTaken = (int)$s['quizzes_taken'];
    $hasScore = ($quizzesTaken > 0 && $s['avg_quiz_score'] !== null);
    $score = $hasScore ? (float)$s['avg_quiz_score'] : null;

    if ($score === null) {
        $s['grade'] = '—';
        $s['status_label'] = 'Not Started';
    } elseif ($policy['grade_a'] === null || $policy['grade_b'] === null || $policy['grade_c'] === null || $policy['grade_d'] === null) {
        $s['grade'] = '—';
    } elseif ($score >= $policy['grade_a']) {
        $s['grade'] = 'A';
    } elseif ($score >= $policy['grade_b']) {
        $s['grade'] = 'B';
    } elseif ($score >= $policy['grade_c']) {
        $s['grade'] = 'C';
    } elseif ($score >= $policy['grade_d']) {
        $s['grade'] = 'D';
    } else {
        $s['grade'] = 'F';
    }

    if ($score !== null) {
        if ($policy['passing_score'] === null || $policy['support_score'] === null) {
            $s['status_label'] = 'Policy not configured';
        } elseif ($score >= $policy['passing_score']) {
            $s['status_label'] = 'Passed';
        } elseif ($score >= $policy['support_score']) {
            $s['status_label'] = 'At Risk';
        } else {
            $s['status_label'] = 'Needs Support';
        }
    }

    $s['section_short'] = $s['section'];
}
unset($s);

// ── CSV Export Mode ─────────────────────────────────────────────────
if (isset($_GET['format']) && strtolower($_GET['format']) === 'csv') {
    $filename = 'Anthropotomy_Class_Report_' . date('Ymd_His') . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Pragma: no-cache');
    header('Expires: 0');

    $out = fopen('php://output', 'w');
    // UTF-8 BOM for Excel compatibility
    fprintf($out, chr(0xEF).chr(0xBB).chr(0xBF));

    // Headers
    fputcsv($out, [
        'Rank',
        'Student ID',
        'Full Name',
        'Section',
        'Grade Level',
        'Average Quiz Score (%)',
        'Letter Grade',
        'Academic Status',
        'Quizzes Taken',
        'Quizzes Passed',
        'Completed Lessons',
        'Total Lessons',
        '3D Systems Explored',
        'Total Study Hours',
        'Account Status'
    ]);

    // Data rows
    foreach ($students as $row) {
        fputcsv($out, [
            $row['rank'],
            $row['school_id'],
            $row['full_name'],
            $row['section'],
            $row['grade_level'],
            $row['avg_quiz_score'] !== null ? number_format((float)$row['avg_quiz_score'], 1) : 'N/A',
            $row['grade'],
            $row['status_label'],
            $row['quizzes_taken'],
            $row['quizzes_passed'],
            $row['completed_lessons'],
            $row['total_lessons'],
            $row['systems_explored'],
            number_format((float)$row['total_time_hours'], 2),
            $row['is_active'] ? 'Active' : 'Inactive'
        ]);
    }

    fclose($out);
    exit;
}

// ── JSON Analytics Mode ─────────────────────────────────────────────

// 1. Overall Metrics
$totalQuizzes = (int)($db->fetchOne("SELECT COUNT(*) AS c FROM assessments WHERE status = 'active'")['c'] ?? 0);
$totalSubmissions = (int)($db->fetchOne("SELECT COUNT(DISTINCT sub.student_id, sub.assessment_id) AS c FROM assessment_submissions sub JOIN assessments a ON a.assessment_id=sub.assessment_id JOIN users u ON u.user_id=sub.student_id WHERE sub.status IN ('submitted','graded') AND a.status='active' AND u.is_active=1")['c'] ?? 0);
$possibleSubmissions = max(1, $totalQuizzes * max(1, $totalStudents));
$submissionRate = round(($totalSubmissions / $possibleSubmissions) * 100, 1);

$avgScoreRow = $db->fetchOne("SELECT AVG(avg_quiz_score) AS avg_s FROM student_progress_summary WHERE avg_quiz_score IS NOT NULL");
$classAvgScore = $avgScoreRow['avg_s'] !== null ? round((float)$avgScoreRow['avg_s'], 1) : null;

$passedCount = 0;
$atRiskCount = 0;
$gradeCounts = ['A' => 0, 'B' => 0, 'C' => 0, 'D' => 0, 'F' => 0];

foreach ($students as $st) {
    if ($st['status_label'] === 'Passed') $passedCount++;
    if ($st['status_label'] === 'At Risk' || $st['status_label'] === 'Needs Support') $atRiskCount++;
    if (isset($gradeCounts[$st['grade']])) {
        $gradeCounts[$st['grade']]++;
    }
}

// 2. Section Comparison
$sectionStats = [];
$sections = $db->fetchAll(
    "SELECT sp.section,
            COUNT(DISTINCT u.user_id) AS student_count,
            COALESCE(AVG(sps.avg_quiz_score), 0) AS avg_score,
            COALESCE(AVG(sps.completed_lessons), 0) AS avg_lessons
     FROM student_profiles sp
     JOIN users u ON u.user_id = sp.user_id
     LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
     WHERE u.role = 'student'
     GROUP BY sp.section
     ORDER BY avg_score DESC"
);

foreach ($sections as $sec) {
    $sectionStats[] = [
        'section'       => $sec['section'],
        'short_name'    => $sec['section'],
        'student_count' => (int)$sec['student_count'],
        'avg_score'     => round((float)$sec['avg_score'], 1),
        'avg_lessons'   => round((float)$sec['avg_lessons'], 1)
    ];
}

// 3. System Averages
$systemScores = $db->fetchAll(
    "SELECT bs.system_code, bs.system_name, bs.icon_emoji, bs.color_hex,
            COALESCE(ROUND(AVG(sub.score), 1), 0.0) AS avg_score,
            COUNT(sub.submission_id) AS total_attempts
     FROM body_systems bs
     LEFT JOIN assessments a ON a.system_id = bs.system_id
     LEFT JOIN assessment_submissions sub ON sub.assessment_id = a.assessment_id AND sub.status IN ('submitted','graded')
     WHERE bs.is_active = 1
     GROUP BY bs.system_id
     ORDER BY bs.sort_order ASC"
);

$scoreTrend = $db->fetchAll("SELECT DATE(submitted_at) AS day, ROUND(AVG(score),1) AS score FROM assessment_submissions WHERE status IN ('submitted','graded') GROUP BY DATE(submitted_at) ORDER BY day DESC LIMIT 14");
$scoreTrend = array_reverse($scoreTrend);
jsonSuccess([
    'score_trend' => $scoreTrend,
    'grading_policy' => $policy,
    'summary' => [
        'class_average_score'    => $classAvgScore,
        'submission_rate_pct'    => min(100.0, $submissionRate),
        'students_passed_count'  => $passedCount,
        'passed_pct'             => $totalStudents > 0 ? round(($passedCount / $totalStudents) * 100, 1) : 0,
        'needs_attention_count'  => $atRiskCount,
        'total_students'         => $totalStudents
    ],
    'grade_distribution' => $gradeCounts,
    'sections'           => $sectionStats,
    'system_scores'      => $systemScores,
    'students'           => $students
]);
