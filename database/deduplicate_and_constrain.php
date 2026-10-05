<?php
/**
 * Anthropotomy – Database Deduplication & Schema Constraint Migration
 * Cleans up duplicated modules, lessons, and announcements,
 * applies UNIQUE integrity constraints, and recalculates progress summaries.
 */

declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require_once __DIR__ . '/connection.php';
require_once __DIR__ . '/../api/helpers.php';

$isCli = (php_sapi_name() === 'cli');
$db = Database::getInstance();
$pdo = $db->getConnection();

function logMsg(string $msg): void {
    global $isCli;
    echo ($isCli ? "[MIGRATION] " : "<div>") . $msg . ($isCli ? PHP_EOL : "</div>");
}

try {
    logMsg("Starting Database Deduplication & Constraint Migration...");

    // ── 1. DEDUPLICATE ANNOUNCEMENTS ──────────────────────────────
    logMsg("Deduplicating announcements...");
    $annGroups = $db->fetchAll(
        "SELECT teacher_id, title, MIN(announcement_id) AS keep_id, GROUP_CONCAT(announcement_id) AS all_ids, COUNT(*) AS cnt
         FROM announcements
         GROUP BY teacher_id, title
         HAVING cnt > 1"
    );

    foreach ($annGroups as $group) {
        $keepId = (int)$group['keep_id'];
        $allIds = array_map('intval', explode(',', $group['all_ids']));
        $dupIds = array_diff($allIds, [$keepId]);

        if (!empty($dupIds)) {
            $inList = implode(',', $dupIds);
            // Re-point or clean announcement_reads
            $pdo->exec("DELETE FROM announcement_reads WHERE announcement_id IN ({$inList}) AND user_id IN (SELECT user_id FROM (SELECT user_id FROM announcement_reads WHERE announcement_id = {$keepId}) AS existing_reads)");
            $pdo->exec("UPDATE IGNORE announcement_reads SET announcement_id = {$keepId} WHERE announcement_id IN ({$inList})");
            $pdo->exec("DELETE FROM announcement_reads WHERE announcement_id IN ({$inList})");
            $pdo->exec("DELETE FROM announcements WHERE announcement_id IN ({$inList})");
            logMsg("  Merged duplicates for announcement '{$group['title']}' -> kept ID {$keepId}");
        }
    }

    // Add unique constraint to announcements if not exists
    $idx = $db->fetchOne("SHOW INDEX FROM announcements WHERE Key_name = 'uq_teacher_title'");
    if (!$idx) {
        $pdo->exec("ALTER TABLE announcements ADD UNIQUE KEY uq_teacher_title (teacher_id, title)");
        logMsg("  Added UNIQUE KEY uq_teacher_title on announcements(teacher_id, title).");
    }

    // ── 2. DEDUPLICATE MODULES ────────────────────────────────────
    logMsg("Deduplicating modules...");
    $modGroups = $db->fetchAll(
        "SELECT system_id, title, MIN(module_id) AS keep_id, GROUP_CONCAT(module_id) AS all_ids, COUNT(*) AS cnt
         FROM modules
         GROUP BY system_id, title
         HAVING cnt > 1"
    );

    foreach ($modGroups as $group) {
        $keepId = (int)$group['keep_id'];
        $allIds = array_map('intval', explode(',', $group['all_ids']));
        $dupIds = array_diff($allIds, [$keepId]);

        if (!empty($dupIds)) {
            $inList = implode(',', $dupIds);
            // Re-point lessons
            $pdo->exec("UPDATE lessons SET module_id = {$keepId} WHERE module_id IN ({$inList})");
            // Re-point assessments
            $pdo->exec("UPDATE assessments SET module_id = {$keepId} WHERE module_id IN ({$inList})");
            // Delete duplicate modules
            $pdo->exec("DELETE FROM modules WHERE module_id IN ({$inList})");
            logMsg("  Merged duplicate modules for '{$group['title']}' -> kept ID {$keepId}");
        }
    }

    // Add unique constraint to modules if not exists
    $idx = $db->fetchOne("SHOW INDEX FROM modules WHERE Key_name = 'uq_system_title'");
    if (!$idx) {
        $pdo->exec("ALTER TABLE modules ADD UNIQUE KEY uq_system_title (system_id, title)");
        logMsg("  Added UNIQUE KEY uq_system_title on modules(system_id, title).");
    }

    // ── 3. DEDUPLICATE LESSONS ────────────────────────────────────
    logMsg("Deduplicating lessons...");
    $lessonGroups = $db->fetchAll(
        "SELECT module_id, title, MIN(lesson_id) AS keep_id, GROUP_CONCAT(lesson_id) AS all_ids, COUNT(*) AS cnt
         FROM lessons
         GROUP BY module_id, title
         HAVING cnt > 1"
    );

    foreach ($lessonGroups as $group) {
        $keepId = (int)$group['keep_id'];
        $allIds = array_map('intval', explode(',', $group['all_ids']));
        $dupIds = array_diff($allIds, [$keepId]);

        if (!empty($dupIds)) {
            $inList = implode(',', $dupIds);
            // Re-point student_lesson_progress
            $pdo->exec("DELETE FROM student_lesson_progress WHERE lesson_id IN ({$inList}) AND student_id IN (SELECT student_id FROM (SELECT student_id FROM student_lesson_progress WHERE lesson_id = {$keepId}) AS existing_prog)");
            $pdo->exec("UPDATE IGNORE student_lesson_progress SET lesson_id = {$keepId} WHERE lesson_id IN ({$inList})");
            $pdo->exec("DELETE FROM student_lesson_progress WHERE lesson_id IN ({$inList})");
            $pdo->exec("DELETE FROM lessons WHERE lesson_id IN ({$inList})");
            logMsg("  Merged duplicate lessons for '{$group['title']}' -> kept ID {$keepId}");
        }
    }

    // Add unique constraint to lessons if not exists
    $idx = $db->fetchOne("SHOW INDEX FROM lessons WHERE Key_name = 'uq_module_title'");
    if (!$idx) {
        $pdo->exec("ALTER TABLE lessons ADD UNIQUE KEY uq_module_title (module_id, title)");
        logMsg("  Added UNIQUE KEY uq_module_title on lessons(module_id, title).");
    }

    // ── 4. RECALCULATE PROGRESS SUMMARIES ─────────────────────────
    logMsg("Recalculating progress summaries for all students...");
    $students = $db->fetchAll("SELECT user_id FROM users WHERE role = 'student'");
    foreach ($students as $s) {
        _updateProgressSummary((int)$s['user_id'], $db);
    }

    // ── 5. VERIFY FINAL COUNTS ────────────────────────────────────
    $finalModules = $db->fetchOne("SELECT COUNT(*) AS c FROM modules")['c'];
    $finalLessons = $db->fetchOne("SELECT COUNT(*) AS c FROM lessons")['c'];
    $finalAnnouncements = $db->fetchOne("SELECT COUNT(*) AS c FROM announcements")['c'];
    $sampleSummary = $db->fetchOne("SELECT * FROM student_progress_summary LIMIT 1");

    logMsg("=== MIGRATION COMPLETE ===");
    logMsg("Active Modules: {$finalModules} (Expected: 18)");
    logMsg("Active Lessons: {$finalLessons} (Expected: 36)");
    logMsg("Active Announcements: {$finalAnnouncements}");
    logMsg("Sample Student Total Lessons: " . ($sampleSummary['total_lessons'] ?? 'N/A') . " (Expected: 36)");

} catch (Throwable $e) {
    logMsg("ERROR during migration: " . $e->getMessage());
    exit(1);
}
