<?php
/**
 * Anthropotomy – Arcade Game Rounds API
 * POST /api/games/plays.php   students only
 *
 * Body: {game_key, difficulty, score, duration_sec, stats: {hits, misses, friendly_hits, best_combo}}
 * Saves the finished round, works out its points on the server (score x 1, 1.5 or 2 for easy, medium or hard)
 * and awards any badge the student now meets. Returns {score, points, new_badges: [{title, icon}]}.
 * A round that is impossible (unknown game, score or length outside the game's limits, bad stats) gets a 422.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('POST');
$user = requireStudent();
$body = getJsonBody();
$db = Database::getInstance();

// ── Validate the round (422 on anything impossible) ─────────────
$gameKey = $body['game_key'] ?? null;
if (!is_string($gameKey) || !array_key_exists($gameKey, GAMES)) jsonError('Unknown game.', 422);
$game = GAMES[$gameKey];

$difficulty = $body['difficulty'] ?? null;
if (!is_string($difficulty) || !in_array($difficulty, ['easy', 'medium', 'hard'], true)) jsonError('Choose easy, medium or hard.', 422);

$score = $body['score'] ?? null;
if (!is_int($score) || $score < 0 || $score > $game['max_score']) jsonError('That score is not possible.', 422);

$duration = $body['duration_sec'] ?? null;
if (!is_int($duration) || $duration < $game['min_sec'] || $duration > $game['max_sec']) jsonError('That round length is not possible.', 422);

$stats = $body['stats'] ?? null;
if (!is_array($stats)) jsonError('The round needs its stats.', 422);
foreach (['hits', 'misses', 'friendly_hits', 'best_combo'] as $field) {
    if (!is_int($stats[$field] ?? null) || $stats[$field] < 0) jsonError('Each stat must be a whole number from 0 up.', 422);
}
if ($stats['best_combo'] > $stats['hits']) jsonError('The best combo cannot be longer than the hits.', 422);
$taps = $stats['hits'] + $stats['misses'] + $stats['friendly_hits'];
if ($taps > 65535) jsonError('Those stats are not possible.', 422); // game_plays.total is a SMALLINT

// ── Save ─────────────────────────────────────────────────────────
$points = gamePoints($score, $difficulty);
$db->insert('game_plays', [
    'student_id'   => $user['user_id'],
    'game_key'     => $gameKey,
    'difficulty'   => $difficulty,
    'set_id'       => null,
    'system_id'    => null,
    'correct'      => $stats['hits'],
    'total'        => $taps,
    'best_streak'  => $stats['best_combo'],
    'points'       => $points,
    'score'        => $score,
    'duration_sec' => $duration,
]);

// After the insert, so the new round counts. awardBadges only reports rows this call inserted,
// which keeps the answer right when two rounds finish at the same moment.
$newBadges = array_map(fn($badge) => ['title' => $badge['title'], 'icon' => $badge['icon']], awardBadges($user['user_id']));

jsonSuccess(['score' => $score, 'points' => $points, 'new_badges' => $newBadges], 'Round saved.', 201);
