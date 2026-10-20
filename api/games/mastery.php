<?php
/**
 * Anthropotomy – Practice Game Mastery API
 * GET /api/games/mastery.php            students: their own {card_key: [seen, correct]}, used to weight which cards come up
 * GET /api/games/mastery.php?section=   teachers: the 20 most-missed terms in one section (a SECTIONS value),
 *                                       as [{term, seen, correct, miss_rate}], only terms seen at least 3 times
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireLogin();
$db = Database::getInstance();

if ($user['role'] === 'student') {
    $map = [];
    foreach ($db->fetchAll('SELECT card_key, seen, correct FROM game_card_stats WHERE user_id = ?', [$user['user_id']]) as $row) {
        $map[$row['card_key']] = [(int) $row['seen'], (int) $row['correct']];
    }
    jsonSuccess((object) $map); // an empty map must stay {} rather than become []
}

requireTeacher();
$section = $_GET['section'] ?? null;
if (!is_string($section) || !in_array($section, SECTIONS, true)) jsonError('Choose a section.', 422);

// Only students who are in the section now; the term is the grouping, so a term shared by several sets counts together.
$rows = $db->fetchAll(
    "SELECT cs.term, SUM(cs.seen) AS seen, SUM(cs.correct) AS correct
     FROM game_card_stats cs
     JOIN users u ON u.user_id = cs.user_id AND u.is_active = 1
     JOIN student_profiles sp ON sp.user_id = cs.user_id
     WHERE sp.section = ?
     GROUP BY cs.term
     HAVING SUM(cs.seen) >= 3
     ORDER BY 1 - SUM(cs.correct) / SUM(cs.seen) DESC, SUM(cs.seen) DESC, cs.term ASC
     LIMIT 20",
    [$section]
);
jsonSuccess(array_map(fn($row) => [
    'term'      => $row['term'],
    'seen'      => (int) $row['seen'],
    'correct'   => (int) $row['correct'],
    'miss_rate' => round(1 - (int) $row['correct'] / (int) $row['seen'], 2),
], $rows));
