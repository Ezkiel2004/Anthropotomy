<?php
/**
 * Anthropotomy – Questions API
 *
 * GET    /api/questions.php?assessment_id=1  → List all questions & options for an assessment
 * POST   /api/questions.php                  → Create question with options or hotspot data
 * PUT    /api/questions.php?id=1             → Update question and its options
 * DELETE /api/questions.php?id=1             → Delete question (and options)
 */

require_once __DIR__ . '/helpers.php';
requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];
$user   = Auth::getCurrentUser();

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    $assessmentId = getIdParam('assessment_id');

    if ($user['role'] === 'student' && !$db->fetchOne("SELECT assessment_id FROM assessments WHERE assessment_id = ? AND status = 'active'", [$assessmentId])) jsonError('Assessment unavailable.', 403);
    $questions = $db->fetchAll(
        "SELECT question_id, assessment_id, question_text, question_type,
                image_url, hotspot_data, points, sort_order
         FROM questions
         WHERE assessment_id = ?
         ORDER BY sort_order ASC, question_id ASC",
        [$assessmentId]
    );

    if (!empty($questions)) {
        $qIds = array_column($questions, 'question_id');
        $inClause = implode(',', array_fill(0, count($qIds), '?'));
        
        $isStudent = ($user['role'] === 'student');
        $correctCol = $isStudent ? "0 AS is_correct" : "is_correct";

        $options = $db->fetchAll(
            "SELECT option_id, question_id, option_text, {$correctCol}, sort_order
             FROM answer_options
             WHERE question_id IN ({$inClause})
             ORDER BY sort_order ASC",
            $qIds
        );

        $optionsMap = [];
        foreach ($options as $opt) {
            $opt['option_id']  = (int) $opt['option_id'];
            $opt['is_correct'] = (bool) $opt['is_correct'];
            $optionsMap[$opt['question_id']][] = $opt;
        }

        foreach ($questions as &$q) {
            $q['question_id'] = (int) $q['question_id'];
            $q['points']      = (float) $q['points'];
            $q['options']     = $optionsMap[$q['question_id']] ?? [];
            if (!empty($q['hotspot_data']) && is_string($q['hotspot_data'])) {
                $q['hotspot_data'] = json_decode($q['hotspot_data'], true);
            }
        }
    }

    jsonSuccess($user['role'] === 'student' ? studentQuestions($questions) : $questions);
}

// ── POST: Create question ───────────────────────────────────────
if ($method === 'POST') {
    requireTeacher();
    $body = getJsonBody();

    $assessmentId = (int) requireField($body, 'assessment_id', 'Assessment ID');
    assertAssessmentEditable($assessmentId);
    $questionText = requireField($body, 'question_text', 'Question text');
    $questionType = optionalField($body, 'question_type', 'multiple_choice');
    $imageUrl     = optionalField($body, 'image_url', null);
    $hotspotData  = optionalField($body, 'hotspot_data', null);
    $points       = (float) optionalField($body, 'points', 1.00);
    $sortOrder    = (int) optionalField($body, 'sort_order', 0);
    $options      = optionalField($body, 'options', []);

    validateQuestion($questionType, $hotspotData, $options, $points);
    if ($imageUrl && !safeMediaUrl($imageUrl)) jsonError('Invalid image URL.', 422);
    if (is_array($hotspotData)) {
        $hotspotData = json_encode($hotspotData, JSON_UNESCAPED_UNICODE);
    }

    $pdo = $db->getConnection();
    $pdo->beginTransaction();
    try {
        $db->query(
            "INSERT INTO questions
                (assessment_id, question_text, question_type, image_url, hotspot_data, points, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$assessmentId, $questionText, $questionType, $imageUrl, $hotspotData, $points, $sortOrder]
        );
        $questionId = (int) $pdo->lastInsertId();

        // Insert answer options if provided
        if (!empty($options) && is_array($options)) {
            foreach ($options as $idx => $opt) {
                $optText = is_array($opt) ? ($opt['option_text'] ?? '') : (string)$opt;
                $isCorrect = is_array($opt) ? (!empty($opt['is_correct']) ? 1 : 0) : 0;
                $optOrder  = is_array($opt) ? (int)($opt['sort_order'] ?? ($idx + 1)) : ($idx + 1);

                if (trim($optText) !== '') {
                    $db->query(
                        "INSERT INTO answer_options (question_id, option_text, is_correct, sort_order)
                         VALUES (?, ?, ?, ?)",
                        [$questionId, trim($optText), $isCorrect, $optOrder]
                    );
                }
            }
        }

        $pdo->commit();
        jsonSuccess(['question_id' => $questionId], 'Question created successfully.', 201);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonError('Failed to create question: ' . $e->getMessage(), 500);
    }
}

// ── PUT: Update question ────────────────────────────────────────
if ($method === 'PUT') {
    requireTeacher();
    $id   = getIdParam();
    $body = getJsonBody();

    $existing = $db->fetchOne("SELECT * FROM questions WHERE question_id = ?", [$id]);
    if (!$existing) {
        jsonError('Question not found.', 404);
    }

    assertAssessmentEditable((int)$existing['assessment_id']);
    $questionText = optionalField($body, 'question_text', $existing['question_text']);
    $questionType = optionalField($body, 'question_type', $existing['question_type']);
    $imageUrl     = optionalField($body, 'image_url',     $existing['image_url']);
    $hotspotData  = optionalField($body, 'hotspot_data',  $existing['hotspot_data']);
    $points       = (float) optionalField($body, 'points', $existing['points']);
    $sortOrder    = (int) optionalField($body, 'sort_order', $existing['sort_order']);
    $options      = optionalField($body, 'options', null);

    validateQuestion($questionType, $hotspotData, $options, $points);
    if ($imageUrl && !safeMediaUrl($imageUrl)) jsonError('Invalid image URL.', 422);
    if (is_array($hotspotData)) {
        $hotspotData = json_encode($hotspotData, JSON_UNESCAPED_UNICODE);
    }

    $pdo = $db->getConnection();
    $pdo->beginTransaction();
    try {
        $db->query(
            "UPDATE questions SET
                question_text = ?, question_type = ?, image_url = ?,
                hotspot_data = ?, points = ?, sort_order = ?
             WHERE question_id = ?",
            [$questionText, $questionType, $imageUrl, $hotspotData, $points, $sortOrder, $id]
        );

        // If options are explicitly provided, replace existing options
        if ($options !== null && is_array($options)) {
            $db->query("DELETE FROM answer_options WHERE question_id = ?", [$id]);

            foreach ($options as $idx => $opt) {
                $optText   = is_array($opt) ? ($opt['option_text'] ?? '') : (string)$opt;
                $isCorrect = is_array($opt) ? (!empty($opt['is_correct']) ? 1 : 0) : 0;
                $optOrder  = is_array($opt) ? (int)($opt['sort_order'] ?? ($idx + 1)) : ($idx + 1);

                if (trim($optText) !== '') {
                    $db->query(
                        "INSERT INTO answer_options (question_id, option_text, is_correct, sort_order)
                         VALUES (?, ?, ?, ?)",
                        [$id, trim($optText), $isCorrect, $optOrder]
                    );
                }
            }
        }

        $pdo->commit();
        jsonSuccess(null, 'Question updated successfully.');
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonError('Failed to update question: ' . $e->getMessage(), 500);
    }
}

// ── DELETE: Delete question ─────────────────────────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id = getIdParam();

    $existing = $db->fetchOne("SELECT question_id, assessment_id FROM questions WHERE question_id = ?", [$id]);
    if (!$existing) {
        jsonError('Question not found.', 404);
    }

    assertAssessmentEditable((int)$existing['assessment_id']);
    $db->query("DELETE FROM questions WHERE question_id = ?", [$id]);
    jsonSuccess(null, 'Question deleted successfully.');
}

jsonError('Method not allowed.', 405);
?>
