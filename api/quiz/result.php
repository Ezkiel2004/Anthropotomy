<?php
/**
 * Anthropotomy – Quiz Result Review API
 * GET /api/quiz/result.php?submission_id=1
 *
 * Fetches graded results with full question breakdown and correct answer keys.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireLogin();

$db = Database::getInstance();
$submissionId = getIdParam('submission_id');

$submission = $db->fetchOne(
    "SELECT sub.*, a.title AS assessment_title, a.passing_score, a.assessment_type,
            bs.system_name, bs.icon_emoji, u.full_name AS student_name
     FROM assessment_submissions sub
     JOIN assessments a ON a.assessment_id = sub.assessment_id
     LEFT JOIN body_systems bs ON bs.system_id = a.system_id
     JOIN users u ON u.user_id = sub.student_id
     WHERE sub.submission_id = ?",
    [$submissionId]
);

if (!$submission) {
    jsonError('Submission not found.', 404);
}

// Students can only view their own submissions
if ($user['role'] === 'student' && (int)$submission['student_id'] !== (int)$user['user_id']) {
    jsonError('Unauthorized to view this submission.', 403);
}

// Fetch question responses
$responses = $db->fetchAll(
    "SELECT ar.*, q.question_text, q.question_type, q.image_url, q.hotspot_data, q.points,
            ao_selected.option_text AS selected_option_text,
            ao_correct.option_text  AS correct_option_text,
            ao_correct.option_id    AS correct_option_id
     FROM answer_responses ar
     JOIN questions q ON q.question_id = ar.question_id
     LEFT JOIN answer_options ao_selected ON ao_selected.option_id = ar.selected_option
     LEFT JOIN answer_options ao_correct  ON ao_correct.question_id = q.question_id AND ao_correct.is_correct = 1
     WHERE ar.submission_id = ?
     ORDER BY q.sort_order ASC, q.question_id ASC",
    [$submissionId]
);

foreach ($responses as &$r) {
    $r['response_id']    = (int) $r['response_id'];
    $r['question_id']    = (int) $r['question_id'];
    $r['is_correct']     = (bool) $r['is_correct'];
    $r['points_earned']  = (float) $r['points_earned'];
    $r['points']         = (float) $r['points'];
    if (!empty($r['hotspot_clicked']) && is_string($r['hotspot_clicked'])) {
        $r['hotspot_clicked'] = json_decode($r['hotspot_clicked'], true);
    }
    if (!empty($r['hotspot_data']) && is_string($r['hotspot_data'])) {
        $r['hotspot_data'] = json_decode($r['hotspot_data'], true);
    }
}

$submission['submission_id'] = (int) $submission['submission_id'];
$submission['score']         = $submission['score'] !== null ? (float) $submission['score'] : null;
$submission['passing_score'] = (float) $submission['passing_score'];
$submission['passed']        = ($submission['score'] !== null && $submission['score'] >= $submission['passing_score']);
$submission['responses']     = $responses;

jsonSuccess($submission);
?>
