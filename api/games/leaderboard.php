<?php
/**
 * Anthropotomy – Practice Game Leaderboard API
 * GET /api/games/leaderboard.php            students: the board for their own section (any section parameter is ignored)
 * GET /api/games/leaderboard.php?section=   teachers: the board for one section; it must be one of SECTIONS
 *
 * Covers the current week (from Monday 00:00 in the database's time zone). Returns
 * {section, week_start, top: [{rank, user_id, full_name, points}], me: {rank, points}|null}:
 * the 10 best by points (ties go to whoever reached the score first, judged by the last round that
 * scored, so a later round worth nothing never costs a place) and, for a student with points this
 * week, their own rank and points. Teachers get me = null.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireLogin();
$isStudent = $user['role'] === 'student';
$db = Database::getInstance();

if ($isStudent) {
    // The student's own section, whatever it is (older records may hold a name outside SECTIONS).
    $profile = $db->fetchOne('SELECT section FROM student_profiles WHERE user_id = ?', [$user['user_id']]);
    $section = (string) ($profile['section'] ?? '');
} else {
    requireTeacher();
    $section = $_GET['section'] ?? null;
    if (!is_string($section) || !in_array($section, SECTIONS, true)) jsonError('Choose a section.', 422);
}

// Monday 00:00 of this week in the database's time zone, the same clock that stamps played_at.
$weekStart = $db->fetchOne(
    "SELECT DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), '%Y-%m-%d 00:00:00') AS week_start"
)['week_start'];

// Everyone in the section who scored this week, best first. A section holds one class, so one query is enough.
$rows = $db->fetchAll(
    "SELECT u.user_id, u.full_name, SUM(g.points) AS points
     FROM game_plays g
     JOIN users u ON u.user_id = g.student_id AND u.is_active = 1
     JOIN student_profiles sp ON sp.user_id = g.student_id
     WHERE sp.section = ? AND g.played_at >= ?
     GROUP BY u.user_id, u.full_name
     HAVING SUM(g.points) > 0
     ORDER BY SUM(g.points) DESC, MAX(CASE WHEN g.points > 0 THEN g.played_at END) ASC, u.user_id ASC",
    [$section, $weekStart]
);

$top = [];
foreach (array_slice($rows, 0, 10) as $index => $row) {
    $top[] = [
        'rank'      => $index + 1,
        'user_id'   => (int) $row['user_id'],
        'full_name' => $row['full_name'],
        'points'    => (int) $row['points'],
    ];
}

// A student's own place: one more than the number of classmates with strictly more points, so ties share a rank.
$me = null;
if ($isStudent) {
    foreach ($rows as $row) {
        if ((int) $row['user_id'] !== (int) $user['user_id']) continue;
        $points = (int) $row['points'];
        $me = [
            'rank'   => 1 + count(array_filter($rows, fn($other) => (int) $other['points'] > $points)),
            'points' => $points,
        ];
        break;
    }
}

jsonSuccess(['section' => $section, 'week_start' => $weekStart, 'top' => $top, 'me' => $me]);
