<?php
/**
 * Anthropotomy – Students Management API
 *
 * GET    /api/students.php           → List students with progress summary & section filters
 * GET    /api/students.php?id=1      → Single student profile with detailed progress & history
 * POST   /api/students.php           → Create a new student (teacher/admin)
 * PUT    /api/students.php?id=1      → Update student profile or toggle active status
 * DELETE /api/students.php?id=1      → Deactivate student account
 */

require_once __DIR__ . '/helpers.php';
requireTeacher();

$db     = Database::getInstance();
foreach ($db->fetchAll("SELECT user_id FROM users WHERE role='student'") as $studentRow) _updateProgressSummary((int)$studentRow['user_id'], $db);
$method = $_SERVER['REQUEST_METHOD'];

// ── GET ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    // Single student details
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $student = $db->fetchOne(
            "SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.created_at, u.last_login,
                    sp.student_id AS school_id, sp.section, sp.grade_level, sp.school_year,
                    sp.guardian_name, sp.contact_no, sp.address,
                    COALESCE(sps.total_lessons, (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.module_id = l.module_id AND m.status = 'published' WHERE l.status = 'published')) AS total_lessons,
                    COALESCE(sps.completed_lessons, 0) AS completed_lessons,
                    sps.avg_quiz_score,
                    COALESCE(sps.quizzes_taken, 0) AS quizzes_taken,
                    COALESCE(sps.quizzes_passed, 0) AS quizzes_passed,
                    COALESCE(sps.systems_explored, 0) AS systems_explored,
                    COALESCE(sps.total_time_hours, 0.00) AS total_time_hours
             FROM users u
             JOIN student_profiles sp ON sp.user_id = u.user_id
             LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
             WHERE u.user_id = ? AND u.role = 'student'",
            [$id]
        );

        if (!$student) {
            jsonError('Student not found.', 404);
        }

        // Fetch system progress breakdown
        $systemProgress = $db->fetchAll(
            "SELECT bs.system_name, bs.icon_emoji, bs.color_hex, bs.system_code,
                    COUNT(DISTINCT l.lesson_id) AS total_lessons,
                    COUNT(DISTINCT CASE WHEN slp.status = 'completed' THEN slp.lesson_id END) AS completed_lessons
             FROM body_systems bs
             LEFT JOIN modules m ON m.system_id = bs.system_id AND m.status = 'published'
             LEFT JOIN lessons l ON l.module_id = m.module_id AND l.status = 'published'
             LEFT JOIN student_lesson_progress slp ON slp.lesson_id = l.lesson_id AND slp.student_id = ?
             WHERE bs.is_active = 1
             GROUP BY bs.system_id
             ORDER BY bs.sort_order",
            [$id]
        );

        // Fetch recent quiz submissions
        $submissions = $db->fetchAll(
            "SELECT sub.submission_id, sub.score, sub.raw_score, sub.max_score, sub.time_taken_secs,
                    sub.status, sub.submitted_at, a.title AS assessment_title, a.passing_score
             FROM assessment_submissions sub
             JOIN assessments a ON a.assessment_id = sub.assessment_id
             WHERE sub.student_id = ?
             ORDER BY sub.started_at DESC
             LIMIT 10",
            [$id]
        );

        $student['system_progress'] = $systemProgress;
        $student['submissions']     = $submissions;

        jsonSuccess($student);
    }

    // Filter list
    $where  = ["u.role = 'student'"];
    $params = [];

    if (!empty($_GET['section'])) {
        $where[]  = "sp.section = ?";
        $params[] = $_GET['section'];
    }

    if (!empty($_GET['status'])) {
        if ($_GET['status'] === 'active') {
            $where[] = "u.is_active = 1";
        } elseif ($_GET['status'] === 'inactive') {
            $where[] = "u.is_active = 0";
        }
    }

    if (!empty($_GET['search'])) {
        $where[]  = "(u.full_name LIKE ? OR u.username LIKE ? OR sp.student_id LIKE ? OR u.email LIKE ?)";
        $term     = '%' . $_GET['search'] . '%';
        $params   = array_merge($params, [$term, $term, $term, $term]);
    }

    $whereSql = implode(' AND ', $where);

    $students = $db->fetchAll(
        "SELECT u.user_id, u.username, u.full_name, u.email, u.is_active, u.last_login,
                sp.student_id AS school_id, sp.section, sp.grade_level, sp.school_year,
                COALESCE(sps.completed_lessons, 0) AS completed_lessons,
                COALESCE(sps.total_lessons, (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.module_id = l.module_id AND m.status = 'published' WHERE l.status = 'published')) AS total_lessons,
                sps.avg_quiz_score,
                COALESCE(sps.quizzes_taken, 0)     AS quizzes_taken,
                COALESCE(sps.quizzes_passed, 0)    AS quizzes_passed,
                COALESCE(sps.total_time_hours, 0)  AS total_time_hours
         FROM users u
         JOIN student_profiles sp ON sp.user_id = u.user_id
         LEFT JOIN student_progress_summary sps ON sps.student_id = u.user_id
         WHERE {$whereSql}
         ORDER BY sp.section ASC, u.full_name ASC",
        $params
    );

    $policy = gradingPolicy();
    // Calculate percentage and status for each student
    foreach ($students as &$s) {
        $s['user_id']           = (int) $s['user_id'];
        $s['is_active']         = (bool) $s['is_active'];
        $s['completed_lessons'] = (int) $s['completed_lessons'];
        $s['total_lessons']     = (int) $s['total_lessons'];
        $s['avg_quiz_score']    = $s['avg_quiz_score'] !== null ? round((float) $s['avg_quiz_score'], 1) : null;
        $s['progress_pct']      = $s['total_lessons'] > 0
            ? round(($s['completed_lessons'] / $s['total_lessons']) * 100, 1)
            : 0;

        // Determine risk / performance status
        if (!$s['is_active']) {
            $s['performance_status'] = 'inactive';
        } elseif ($s['avg_quiz_score'] !== null && $policy['grade_a'] !== null && $s['avg_quiz_score'] >= $policy['grade_a']) {
            $s['performance_status'] = 'top';
        } elseif ($s['avg_quiz_score'] !== null && $policy['passing_score'] !== null && $s['avg_quiz_score'] < $policy['passing_score']) {
            $s['performance_status'] = 'at-risk';
        } else {
            $s['performance_status'] = 'normal';
        }
    }

    // Available sections for filter dropdowns
    $sections = $db->fetchAll(
        "SELECT DISTINCT section FROM student_profiles WHERE section IS NOT NULL AND section != '' ORDER BY section"
    );

    jsonSuccess([
        'students' => $students,
        'sections' => array_column($sections, 'section')
    ]);
}

// ── POST: Create new student ────────────────────────────────────
if ($method === 'POST') {
    $body = getJsonBody();

    $username  = requireField($body, 'username', 'Username');
    $fullName  = requireField($body, 'full_name', 'Full name');
    $schoolId  = requireField($body, 'school_id', 'Student ID number');
    $section   = requireField($body, 'section', 'Section');
    $password  = requireField($body, 'password', 'Password');
    $email     = optionalField($body, 'email', null);
    $grade     = requireField($body, 'grade_level', 'Grade level');
    $guardian  = optionalField($body, 'guardian_name', null);
    $contact   = optionalField($body, 'contact_no', null);

    if (!is_string($password) || strlen($password) < 8) jsonError('Password must contain at least 8 characters.', 422);
    $schoolYear = requireField($body, 'school_year', 'School year');
    if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) jsonError('Enter a valid email address.', 422);

    // Check unique username and student_id
    $exist = $db->fetchOne("SELECT user_id FROM users WHERE username = ?", [$username]);
    if ($exist) jsonError('Username is already taken.', 422);

    $existId = $db->fetchOne("SELECT profile_id FROM student_profiles WHERE student_id = ?", [$schoolId]);
    if ($existId) jsonError('Student ID is already registered.', 422);

    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);

    $pdo = $db->getConnection();
    $pdo->beginTransaction();
    try {
        $db->query(
            "INSERT INTO users (username, password_hash, role, full_name, email, is_active)
             VALUES (?, ?, 'student', ?, ?, 1)",
            [$username, $hash, $fullName, $email]
        );
        $userId = (int) $pdo->lastInsertId();

        $db->query(
            "INSERT INTO student_profiles (user_id, student_id, section, grade_level, guardian_name, contact_no, school_year)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$userId, $schoolId, $section, $grade, $guardian, $contact, $schoolYear]
        );

        // Initialize progress summary record dynamically
        _updateProgressSummary($userId, $db);

        $pdo->commit();
        jsonSuccess(['user_id' => $userId], 'Student created successfully.', 201);
    } catch (Exception $e) {
        $pdo->rollBack();
        jsonError('Failed to create student: ' . $e->getMessage(), 500);
    }
}

// ── PUT: Update student ─────────────────────────────────────────
if ($method === 'PUT') {
    $id   = getIdParam();
    $body = getJsonBody();

    $student = $db->fetchOne("SELECT * FROM users WHERE user_id = ? AND role = 'student'", [$id]);
    if (!$student) jsonError('Student not found.', 404);

    if (isset($body['is_active'])) {
        $isActive = $body['is_active'] ? 1 : 0;
        $db->query("UPDATE users SET is_active = ? WHERE user_id = ?", [$isActive, $id]);
        jsonSuccess(null, 'Student status updated.');
    }

    $fullName = optionalField($body, 'full_name', $student['full_name']);
    $email    = optionalField($body, 'email', $student['email']);
    $section  = optionalField($body, 'section', null);
    $grade    = optionalField($body, 'grade_level', null);
    $guardian = optionalField($body, 'guardian_name', null);
    $contact  = optionalField($body, 'contact_no', null);

    $db->query("UPDATE users SET full_name = ?, email = ? WHERE user_id = ?", [$fullName, $email, $id]);

    if ($section !== null || $grade !== null || $guardian !== null || $contact !== null) {
        $profile = $db->fetchOne("SELECT * FROM student_profiles WHERE user_id = ?", [$id]);
        if ($profile) {
            $db->query(
                "UPDATE student_profiles SET section = COALESCE(?, section),
                                             grade_level = COALESCE(?, grade_level),
                                             guardian_name = COALESCE(?, guardian_name),
                                             contact_no = COALESCE(?, contact_no)
                 WHERE user_id = ?",
                [$section, $grade, $guardian, $contact, $id]
            );
        }
    }

    jsonSuccess(null, 'Student updated successfully.');
}

// ── DELETE: Deactivate student ──────────────────────────────────
if ($method === 'DELETE') {
    $id = getIdParam();
    $db->query("UPDATE users SET is_active = 0 WHERE user_id = ? AND role = 'student'", [$id]);
    jsonSuccess(null, 'Student deactivated successfully.');
}

jsonError('Method not allowed.', 405);
?>
