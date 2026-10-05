<?php
/**
 * Anthropotomy – Assessments API
 *
 * GET    /api/assessments.php          → List assessments with question counts & stats
 * GET    /api/assessments.php?id=1     → Single assessment with full question bank
 * POST   /api/assessments.php          → Create new assessment (teacher/admin)
 * PUT    /api/assessments.php?id=1     → Update assessment settings (teacher/admin)
 * DELETE /api/assessments.php?id=1     → Delete or archive assessment (teacher/admin)
 */

require_once __DIR__ . '/helpers.php';
requireLogin();

$db     = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];
$user   = Auth::getCurrentUser();

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    // Single assessment with full question bank
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $assessment = $db->fetchOne(
            "SELECT a.*, bs.system_name, bs.system_code, bs.icon_emoji, bs.color_hex,
                    m.title AS module_title, u.full_name AS teacher_name
             FROM assessments a
             LEFT JOIN body_systems bs ON bs.system_id = a.system_id
             LEFT JOIN modules m       ON m.module_id   = a.module_id
             LEFT JOIN users u         ON u.user_id     = a.teacher_id
             WHERE a.assessment_id = ?",
            [$id]
        );

        if (!$assessment) {
            jsonError('Assessment not found.', 404);
        }

        // Students can only access active assessments (unless viewing their own past submission)
        if ($user['role'] === 'student' && $assessment['status'] !== 'active') {
            jsonError('This assessment is not currently active.', 403);
        }

        // Fetch questions
        $questions = $db->fetchAll(
            "SELECT question_id, assessment_id, question_text, question_type,
                    image_url, hotspot_data, points, sort_order
             FROM questions
             WHERE assessment_id = ?
             ORDER BY sort_order ASC, question_id ASC",
            [$id]
        );

        // Fetch options for each question
        if (!empty($questions)) {
            $qIds = array_column($questions, 'question_id');
            $inClause = implode(',', array_fill(0, count($qIds), '?'));
            
            // For students taking a quiz, do NOT leak is_correct
            $isStudent = ($user['role'] === 'student');
            $correctCol = $isStudent ? "0 AS is_correct" : "is_correct";

            $options = $db->fetchAll(
                "SELECT option_id, question_id, option_text, {$correctCol}, sort_order
                 FROM answer_options
                 WHERE question_id IN ({$inClause})
                 ORDER BY sort_order ASC, option_id ASC",
                $qIds
            );

            $optionsByQuestion = [];
            foreach ($options as $opt) {
                $opt['option_id']  = (int) $opt['option_id'];
                $opt['is_correct'] = (bool) $opt['is_correct'];
                $optionsByQuestion[$opt['question_id']][] = $opt;
            }

            foreach ($questions as &$q) {
                $q['question_id'] = (int) $q['question_id'];
                $q['points']      = (float) $q['points'];
                $q['options']     = $optionsByQuestion[$q['question_id']] ?? [];
                if (!empty($q['hotspot_data']) && is_string($q['hotspot_data'])) {
                    $q['hotspot_data'] = json_decode($q['hotspot_data'], true);
                }
            }
        }

        $assessment['assessment_id']   = (int) $assessment['assessment_id'];
        $assessment['time_limit_mins'] = $assessment['time_limit_mins'] ? (int) $assessment['time_limit_mins'] : null;
        $assessment['passing_score']   = (float) $assessment['passing_score'];
        $assessment['max_attempts']    = (int) $assessment['max_attempts'];
        $assessment['questions']       = $user['role'] === 'student' ? studentQuestions($questions) : $questions;

        // For student, check their submission count
        if ($user['role'] === 'student') {
            $mySubs = $db->fetchAll(
                "SELECT submission_id, attempt_number, score, status, started_at, submitted_at
                 FROM assessment_submissions
                 WHERE student_id = ? AND assessment_id = ?
                 ORDER BY attempt_number DESC",
                [$user['user_id'], $id]
            );
            $assessment['my_attempts'] = count($mySubs);
            $assessment['my_submissions'] = $mySubs;
            $assessment['can_attempt'] = count(array_filter($mySubs, fn($s) => $s['status'] !== 'in_progress')) < $assessment['max_attempts'];
        }

        jsonSuccess($assessment);
    }

    // List assessments
    $where  = ['1=1'];
    $params = [];

    // Filter by body system code
    if (!empty($_GET['system'])) {
        $where[]  = 'bs.system_code = ?';
        $params[] = $_GET['system'];
    }

    // Filter by assessment type
    if (!empty($_GET['type']) && $_GET['type'] !== 'all') {
        $where[]  = 'a.assessment_type = ?';
        $params[] = $_GET['type'];
    }

    // Filter by status
    if ($user['role'] !== 'student' && !empty($_GET['status']) && $_GET['status'] !== 'all') {
        $where[]  = 'a.status = ?';
        $params[] = $_GET['status'];
    } elseif ($user['role'] === 'student') {
        // Students only see active assessments by default
        $where[] = "a.status = 'active'";
    }

    $whereSql = implode(' AND ', $where);

    $studentId = ($user['role'] === 'student') ? (int) $user['user_id'] : 0;
    $studentJoin = "";
    $studentSelect = ", 0 AS my_attempts, NULL AS my_best_score, 0 AS my_passed, 'not_started' AS my_status";
    if ($studentId > 0) {
        $studentJoin = "LEFT JOIN assessment_submissions mysub ON mysub.assessment_id = a.assessment_id AND mysub.student_id = ?";
        array_unshift($params, $studentId);
        $studentSelect = ",
            COUNT(DISTINCT mysub.submission_id) AS my_attempts,
            MAX(CASE WHEN mysub.status IN ('submitted','graded') THEN mysub.score END) AS my_best_score,
            MAX(CASE WHEN mysub.status IN ('submitted','graded') AND mysub.score >= a.passing_score THEN 1 ELSE 0 END) AS my_passed,
            CASE
                WHEN MAX(CASE WHEN mysub.status IN ('submitted','graded') AND mysub.score >= a.passing_score THEN 1 ELSE 0 END) = 1 THEN 'completed'
                WHEN MAX(CASE WHEN mysub.status = 'in_progress' THEN 1 ELSE 0 END) = 1 THEN 'in_progress'
                WHEN COUNT(DISTINCT mysub.submission_id) > 0 THEN 'attempted'
                ELSE 'not_started'
            END AS my_status";
    }

    $assessments = $db->fetchAll(
        "SELECT a.assessment_id, a.title, a.assessment_type, a.instructions,
                a.time_limit_mins, a.passing_score, a.max_attempts, a.status, a.due_date,
                a.created_at,
                bs.system_name, bs.system_code, bs.icon_emoji, bs.color_hex,
                COUNT(DISTINCT q.question_id) AS question_count,
                COUNT(DISTINCT sub.submission_id) AS submission_count,
                ROUND(AVG(CASE WHEN sub.status IN ('submitted','graded') THEN sub.score END), 1) AS avg_score
                {$studentSelect}
         FROM assessments a
         LEFT JOIN body_systems bs ON bs.system_id = a.system_id
         LEFT JOIN questions q     ON q.assessment_id = a.assessment_id
         LEFT JOIN assessment_submissions sub ON sub.assessment_id = a.assessment_id
         {$studentJoin}
         WHERE {$whereSql}
         GROUP BY a.assessment_id
         ORDER BY a.created_at DESC",
        $params
    );

    foreach ($assessments as &$a) {
        $a['assessment_id']    = (int) $a['assessment_id'];
        $a['time_limit_mins']  = $a['time_limit_mins'] ? (int) $a['time_limit_mins'] : null;
        $a['passing_score']    = (float) $a['passing_score'];
        $a['question_count']   = (int) $a['question_count'];
        $a['submission_count'] = (int) $a['submission_count'];
        $a['avg_score']        = $a['avg_score'] !== null ? (float) $a['avg_score'] : 0;
        $a['my_attempts']      = (int) ($a['my_attempts'] ?? 0);
        $a['my_best_score']    = $a['my_best_score'] !== null ? (float) $a['my_best_score'] : null;
        $a['my_passed']        = !empty($a['my_passed']);
        $a['my_status']        = $a['my_status'] ?? 'not_started';
    }

    jsonSuccess($assessments);
}

// ── POST: Create assessment ─────────────────────────────────────
if ($method === 'POST') {
    requireTeacher();
    $body = getJsonBody();

    $title       = requireField($body, 'title', 'Assessment title');
    $type        = optionalField($body, 'assessment_type', 'quiz');
    $systemId    = optionalField($body, 'system_id', null);
    $moduleId    = optionalField($body, 'module_id', null);
    $instructions= optionalField($body, 'instructions', '');
    $timeLimit   = optionalField($body, 'time_limit_mins', 30);
    $passingScore= optionalField($body, 'passing_score', 75.00);
    $maxAttempts = optionalField($body, 'max_attempts', 3);
    $status      = optionalField($body, 'status', 'draft');
    $dueDate     = optionalField($body, 'due_date', null);

    if ($systemId) {
        $systemId = (int) $systemId;
    }
    if ($moduleId) {
        $moduleId = (int) $moduleId;
    }

    $db->query(
        "INSERT INTO assessments
            (teacher_id, system_id, module_id, title, assessment_type, instructions,
             time_limit_mins, passing_score, max_attempts, status, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            $user['user_id'],
            $systemId,
            $moduleId,
            $title,
            $type,
            $instructions,
            $timeLimit ? (int) $timeLimit : null,
            (float) $passingScore,
            (int) $maxAttempts,
            $status,
            $dueDate ?: null
        ]
    );

    $newId = (int) $db->getConnection()->lastInsertId();
    $newAssess = $db->fetchOne("SELECT * FROM assessments WHERE assessment_id = ?", [$newId]);

    jsonSuccess($newAssess, 'Assessment created successfully.', 201);
}

// ── PUT: Update assessment ──────────────────────────────────────
if ($method === 'PUT') {
    requireTeacher();
    $id   = getIdParam();
    $body = getJsonBody();

    $existing = $db->fetchOne("SELECT * FROM assessments WHERE assessment_id = ?", [$id]);
    if (!$existing) {
        jsonError('Assessment not found.', 404);
    }

    if ($db->fetchOne('SELECT submission_id FROM assessment_submissions WHERE assessment_id=? LIMIT 1', [$id])) {
        foreach (['passing_score','time_limit_mins','max_attempts','assessment_type'] as $field) {
            if (isset($body[$field]) && (string)$body[$field] !== (string)$existing[$field]) jsonError('Grading rules are locked after the first attempt. Create another assessment to change them.', 409);
        }
    }
    $title        = optionalField($body, 'title',           $existing['title']);
    $type         = optionalField($body, 'assessment_type', $existing['assessment_type']);
    $systemId     = optionalField($body, 'system_id',       $existing['system_id']);
    $instructions = optionalField($body, 'instructions',    $existing['instructions']);
    $timeLimit    = optionalField($body, 'time_limit_mins', $existing['time_limit_mins']);
    $passingScore = optionalField($body, 'passing_score',   $existing['passing_score']);
    $maxAttempts  = optionalField($body, 'max_attempts',    $existing['max_attempts']);
    $status       = optionalField($body, 'status',          $existing['status']);
    $dueDate      = optionalField($body, 'due_date',        $existing['due_date']);

    $db->query(
        "UPDATE assessments SET
            title = ?, assessment_type = ?, system_id = ?, instructions = ?,
            time_limit_mins = ?, passing_score = ?, max_attempts = ?,
            status = ?, due_date = ?, updated_at = NOW()
         WHERE assessment_id = ?",
        [
            $title,
            $type,
            $systemId ? (int)$systemId : null,
            $instructions,
            $timeLimit ? (int)$timeLimit : null,
            (float)$passingScore,
            (int)$maxAttempts,
            $status,
            $dueDate ?: null,
            $id
        ]
    );

    jsonSuccess(null, 'Assessment updated successfully.');
}

// ── DELETE: Archive or delete assessment ────────────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id = getIdParam();

    $existing = $db->fetchOne("SELECT assessment_id, status FROM assessments WHERE assessment_id = ?", [$id]);
    if (!$existing) {
        jsonError('Assessment not found.', 404);
    }

    // Check if any student submissions exist — if so, soft-archive to preserve grade data
    $submissionCount = $db->fetchOne(
        "SELECT COUNT(*) AS c FROM assessment_submissions WHERE assessment_id = ?",
        [$id]
    );

    if ((int)($submissionCount['c'] ?? 0) > 0) {
        // Soft-archive: preserve all questions, submissions, and scores
        $db->query("UPDATE assessments SET status = 'closed', updated_at = NOW() WHERE assessment_id = ?", [$id]);
        jsonSuccess(null, 'Assessment archived (student submissions preserved).');
    } else {
        // No submissions — safe to hard delete
        $db->query("DELETE FROM assessments WHERE assessment_id = ?", [$id]);
        jsonSuccess(null, 'Assessment deleted permanently (no submissions existed).');
    }
}

jsonError('Method not allowed.', 405);
?>
