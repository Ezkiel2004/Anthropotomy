<?php
/**
 * Anthropotomy – Scores & Assessment History API
 * GET /api/scores.php
 *
 * Provides student score records, performance summaries, and detailed submission reviews.
 * Teachers can optionally query by student_id or section.
 */

require_once __DIR__ . '/helpers.php';
requireMethod('GET');
$user = requireLogin();

$db = Database::getInstance();

// ── Single Submission Review ────────────────────────────────────
if (isset($_GET['id'])) {
    $subId = (int) $_GET['id'];
    $sub = $db->fetchOne(
        "SELECT sub.*, a.title AS assessment_title, a.assessment_type, a.passing_score,
                bs.system_name, bs.icon_emoji, bs.color_hex, u.full_name AS student_name
         FROM assessment_submissions sub
         JOIN assessments a ON a.assessment_id = sub.assessment_id
         LEFT JOIN body_systems bs ON bs.system_id = a.system_id
         JOIN users u ON u.user_id = sub.student_id
         WHERE sub.submission_id = ?",
        [$subId]
    );

    if (!$sub) {
        jsonError('Submission not found.', 404);
    }

    if ($user['role'] === 'student' && (int)$sub['student_id'] !== (int)$user['user_id']) {
        jsonError('Unauthorized.', 403);
    }

    $responses = $db->fetchAll(
        "SELECT ar.*, q.question_text, q.question_type, q.points,
                ao.option_text AS selected_option_text,
                ao_c.option_text AS correct_option_text
         FROM answer_responses ar
         JOIN questions q ON q.question_id = ar.question_id
         LEFT JOIN answer_options ao ON ao.option_id = ar.selected_option
         LEFT JOIN answer_options ao_c ON ao_c.question_id = q.question_id AND ao_c.is_correct = 1
         WHERE ar.submission_id = ?
         ORDER BY q.sort_order ASC, q.question_id ASC",
        [$subId]
    );

    $sub['responses'] = $responses;
    jsonSuccess($sub);
}

// ── Score History List ──────────────────────────────────────────
$targetStudentId = $user['user_id'];

if ($user['role'] === 'teacher' || $user['role'] === 'admin') {
    if (isset($_GET['student_id'])) {
        $targetStudentId = (int) $_GET['student_id'];
    } else {
        // Teacher viewing all recent submissions
        $allSubs = $db->fetchAll(
            "SELECT sub.*, a.title AS assessment_title, a.assessment_type, a.passing_score,
                    bs.system_name, bs.icon_emoji, bs.color_hex,
                    u.full_name AS student_name, sp.student_id AS school_id, sp.section
             FROM assessment_submissions sub
             JOIN assessments a ON a.assessment_id = sub.assessment_id
             LEFT JOIN body_systems bs ON bs.system_id = a.system_id
             JOIN users u ON u.user_id = sub.student_id
             JOIN student_profiles sp ON sp.user_id = sub.student_id
             WHERE sub.status IN ('submitted', 'graded')
             ORDER BY sub.submitted_at DESC
             LIMIT 100"
        );

        foreach ($allSubs as &$s) {
            $s['score']         = round((float) $s['score'], 1);
            $s['passing_score'] = (float) $s['passing_score'];
            $s['passed']        = ($s['score'] >= $s['passing_score']);
        }

        jsonSuccess(['submissions' => $allSubs]);
    }
}

// Student's submissions
$submissions = $db->fetchAll(
    "SELECT sub.submission_id, sub.assessment_id, sub.score, sub.raw_score, sub.max_score,
            sub.attempt_number, sub.time_taken_secs, sub.submitted_at, sub.status,
            a.title AS assessment_title, a.assessment_type, a.passing_score,
            bs.system_name, bs.icon_emoji, bs.color_hex
     FROM assessment_submissions sub
     JOIN assessments a ON a.assessment_id = sub.assessment_id
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     WHERE sub.student_id = ? AND sub.status IN ('submitted', 'graded')
     ORDER BY sub.submitted_at DESC",
    [$targetStudentId]
);

$totalSubmissions = count($submissions);
$passedCount      = 0;
$totalScore       = 0.0;
$highestScore     = 0.0;

foreach ($submissions as &$sub) {
    $score = round((float) $sub['score'], 1);
    $passScore = (float) $sub['passing_score'];
    $passed = ($score >= $passScore);

    if ($passed) $passedCount++;
    $totalScore += $score;
    if ($score > $highestScore) $highestScore = $score;

    $sub['score']         = $score;
    $sub['passing_score'] = $passScore;
    $sub['passed']        = $passed;
}

$avgScore     = $totalSubmissions > 0 ? round($totalScore / $totalSubmissions, 1) : null;
$highestScore = $totalSubmissions > 0 ? $highestScore : null;

jsonSuccess([
    'summary' => [
        'total_submissions' => $totalSubmissions,
        'passed_count'      => $passedCount,
        'failed_count'      => $totalSubmissions - $passedCount,
        'average_score'     => $avgScore,
        'highest_score'     => $highestScore,
    ],
    'submissions' => $submissions
]);
?>
