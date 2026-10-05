<?php
/**
 * Anthropotomy – Reset Student Progress & Recalculate Dynamic Summaries
 *
 * This script:
 * 1. Resets all progress data: student_lesson_progress, assessment_submissions,
 *    answer_responses, and system_exploration_log.
 * 2. Clears student_progress_summary table.
 * 3. Dynamically reinitializes student_progress_summary for all students
 *    using live database metrics (0 completed, 261 total lessons, null avg score).
 *
 * Safe to run from CLI (php database/reset_student_progress.php) or web browser.
 */

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/../api/helpers.php';

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html><head><title>Reset Student Progress</title><style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 900px; margin: 0 auto; line-height: 1.5; }
        h1 { color: #38bdf8; font-size: 1.5rem; }
        .box { background: #1e293b; padding: 1.25rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #334155; }
        .success { color: #4ade80; font-weight: bold; }
        .info { color: #93c5fd; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.875rem; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #334155; }
        th { background: #0f172a; color: #94a3b8; }
    </style></head><body>';
    echo '<h1>Anthropotomy – Student Progress Reset</h1>';
}

function out(string $msg, string $type = 'info'): void {
    global $isCli;
    if ($isCli) {
        $prefix = match($type) {
            'success' => '[OK] ',
            'warn'    => '[WARN] ',
            'error'   => '[ERROR] ',
            default   => '[INFO] '
        };
        echo $prefix . $msg . PHP_EOL;
    } else {
        $class = match($type) {
            'success' => 'success',
            'warn'    => 'warn',
            'error'   => 'error',
            default   => 'info'
        };
        echo "<div class=\"{$class}\">{$msg}</div>";
    }
}

try {
    $db = Database::getInstance();
    $pdo = $db->getConnection();

    out('Starting student progress reset...', 'info');

    // 1. Truncate / clear student progress tables
    $pdo->exec("SET FOREIGN_KEY_CHECKS = 0;");
    $tablesToClear = [
        'answer_responses',
        'assessment_submissions',
        'student_lesson_progress',
        'system_exploration_log',
        'student_progress_summary',
    ];

    foreach ($tablesToClear as $table) {
        $pdo->exec("TRUNCATE TABLE `{$table}`;");
        out("Truncated table: {$table}", 'info');
    }
    $pdo->exec("SET FOREIGN_KEY_CHECKS = 1;");
    out('All student progress & assessment submission tables cleared.', 'success');

    // 2. Fetch all student users
    $students = $db->fetchAll(
        "SELECT u.user_id, u.username, u.full_name, sp.student_id AS school_id, sp.section
         FROM users u
         JOIN student_profiles sp ON sp.user_id = u.user_id
         WHERE u.role = 'student'
         ORDER BY u.user_id ASC"
    );

    $studentCount = count($students);
    out("Found {$studentCount} student accounts to initialize.", 'info');

    // 3. Rebuild student_progress_summary dynamically for each student
    foreach ($students as $student) {
        _updateProgressSummary((int)$student['user_id'], $db);
    }
    out('Recomputed student_progress_summary for all students dynamically.', 'success');

    // 4. Verify results
    $summaries = $db->fetchAll(
        "SELECT sps.*, u.username, u.full_name, sp.section
         FROM student_progress_summary sps
         JOIN users u ON u.user_id = sps.student_id
         JOIN student_profiles sp ON sp.user_id = sps.student_id
         ORDER BY u.user_id ASC"
    );

    if ($isCli) {
        echo PHP_EOL . str_repeat('=', 80) . PHP_EOL;
        printf("%-10s | %-18s | %-12s | %-12s | %-10s | %-10s\n",
            "User ID", "Full Name", "Total Lessons", "Completed", "Avg Score", "Quizzes Done");
        echo str_repeat('-', 80) . PHP_EOL;
        foreach ($summaries as $s) {
            printf("%-10s | %-18s | %-12s | %-12s | %-10s | %-10s\n",
                $s['student_id'],
                substr($s['full_name'], 0, 18),
                $s['total_lessons'],
                $s['completed_lessons'],
                $s['avg_quiz_score'] !== null ? $s['avg_quiz_score'] . '%' : 'NULL',
                $s['quizzes_taken']
            );
        }
        echo str_repeat('=', 80) . PHP_EOL;
        out("Total students reinitialized: " . count($summaries), 'success');
        out("Reset complete! No hardcoded progress metrics remain.", 'success');
    } else {
        echo '<div class="box">';
        echo '<h3>Initialized Student Progress Summaries</h3>';
        echo '<table><thead><tr>
            <th>User ID</th><th>Student</th><th>Section</th><th>Total Lessons</th><th>Completed</th><th>Avg Score</th><th>Quizzes</th><th>Study Hours</th>
        </tr></thead><tbody>';
        foreach ($summaries as $s) {
            $avg = $s['avg_quiz_score'] !== null ? $s['avg_quiz_score'] . '%' : '<span style="color:#64748b;">None</span>';
            echo "<tr>
                <td>{$s['student_id']}</td>
                <td><strong>{$s['full_name']}</strong> ({$s['username']})</td>
                <td>{$s['section']}</td>
                <td>{$s['total_lessons']}</td>
                <td>{$s['completed_lessons']}</td>
                <td>{$avg}</td>
                <td>{$s['quizzes_taken']}</td>
                <td>{$s['total_time_hours']}h</td>
            </tr>";
        }
        echo '</tbody></table></div>';
        echo '<p class="success">✓ Reset successfully executed. All metrics are 100% dynamic.</p>';
        echo '</body></html>';
    }

} catch (Throwable $e) {
    out("Error resetting student progress: " . $e->getMessage(), 'error');
    if (!$isCli) {
        echo '<pre>' . htmlspecialchars($e->getTraceAsString()) . '</pre></body></html>';
    }
    exit(1);
}
