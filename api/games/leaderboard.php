<?php
/**
 * Anthropotomy – Arcade Game Leaderboard API
 * GET /api/games/leaderboard.php            students: the board for their own section (any section parameter is ignored)
 * GET /api/games/leaderboard.php?section=   teachers: the board for one section; it must be one of SECTIONS
 * GET /api/games/leaderboard.php?game=<key> the same two rules, ranking one game's best scores instead
 *
 * Covers the current week (from Monday 00:00 in the database's time zone).
 *
 * Without game: {section, week_start, top: [{rank, user_id, full_name, points}], me: {rank, points}|null}:
 * the 10 best by total points (ties go to whoever reached the score first, judged by the last round that
 * scored, so a later round worth nothing never costs a place) and, for a student with points this
 * week, their own rank and points.
 *
 * With game (it must be one of GAMES, otherwise 422):
 * {section, week_start, game, top: [{rank, user_id, full_name, score}], me: {rank, score}|null, best: {all_time, week}|null}:
 * the 10 best by each student's best single score this week (ties go to whoever reached that score first)
 * and, for a student with a score above 0 this week, their own rank and score. best is the student's
 * highest score ever (0 before their first round) and this week's highest (null when they have not played
 * this week). Both are for students only.
 *
 * Teachers get me = null (and best = null). Only active students are ranked; scores of 0 are not.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireLogin();
$isStudent = $user['role'] === 'student';
$db = Database::getInstance();

$game = null;
if (array_key_exists('game', $_GET)) {
    $game = $_GET['game'];
    if (!is_string($game) || !array_key_exists($game, GAMES)) jsonError('Unknown game.', 422);
}

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

if ($game !== null) {
    // Each student's best score this week, and when they first reached it. A section holds one class, so one query is enough.
    $rows = $db->fetchAll(
        "SELECT u.user_id, u.full_name, b.best AS score
         FROM (
             SELECT student_id, MAX(score) AS best
             FROM game_plays
             WHERE game_key = ? AND played_at >= ?
             GROUP BY student_id
         ) b
         JOIN game_plays g ON g.student_id = b.student_id AND g.game_key = ? AND g.played_at >= ? AND g.score = b.best
         JOIN users u ON u.user_id = b.student_id AND u.is_active = 1
         JOIN student_profiles sp ON sp.user_id = b.student_id
         WHERE sp.section = ? AND b.best > 0
         GROUP BY u.user_id, u.full_name, b.best
         ORDER BY b.best DESC, MIN(g.played_at) ASC, u.user_id ASC",
        [$game, $weekStart, $game, $weekStart, $section]
    );

    $top = [];
    foreach (array_slice($rows, 0, 10) as $index => $row) {
        $top[] = [
            'rank'      => $index + 1,
            'user_id'   => (int) $row['user_id'],
            'full_name' => $row['full_name'],
            'score'     => (int) $row['score'],
        ];
    }

    // A student's own place: one more than the number of classmates with a strictly higher score, so ties share a rank.
    $me = null;
    $best = null;
    if ($isStudent) {
        foreach ($rows as $row) {
            if ((int) $row['user_id'] !== (int) $user['user_id']) continue;
            $score = (int) $row['score'];
            $me = [
                'rank'  => 1 + count(array_filter($rows, fn($other) => (int) $other['score'] > $score)),
                'score' => $score,
            ];
            break;
        }
        $mine = $db->fetchOne(
            'SELECT MAX(score) AS all_time, MAX(CASE WHEN played_at >= ? THEN score END) AS week
             FROM game_plays
             WHERE student_id = ? AND game_key = ?',
            [$weekStart, $user['user_id'], $game]
        );
        $best = [
            'all_time' => (int) ($mine['all_time'] ?? 0),
            'week'     => isset($mine['week']) ? (int) $mine['week'] : null,
        ];
    }

    jsonSuccess(['section' => $section, 'week_start' => $weekStart, 'game' => $game, 'top' => $top, 'me' => $me, 'best' => $best]);
}

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
