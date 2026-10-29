<?php
/**
 * Anthropotomy – Arcade Game Rounds API
 * POST /api/games/plays.php   students only
 *
 * Body: {game_key, difficulty, score, duration_sec, stats: {hits, misses, friendly_hits, best_combo}, round_id?}
 * round_id (16-64 lowercase hex, made once per round) makes a resend safe: the same round is answered, not saved twice.
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
$roundId = $body['round_id'] ?? null;
if ($roundId !== null && (!is_string($roundId) || !preg_match('/^[a-f0-9]{16,64}$/D', $roundId))) jsonError('That round id is not valid.', 422);

// A resend of a round already on record gets the first save's answer.
$saved = fn() => $roundId === null ? null : $db->fetchOne('SELECT score, points FROM game_plays WHERE student_id = ? AND round_uid = ?', [$user['user_id'], $roundId]);
$replay = fn(array $row) => jsonSuccess(['score' => (int) $row['score'], 'points' => (int) $row['points'], 'new_badges' => []], 'Round already saved.');
if ($row = $saved()) $replay($row);

// ── Save ─────────────────────────────────────────────────────────
$points = gamePoints($score, $difficulty);
try {
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
        'round_uid'    => $roundId,
    ]);
} catch (PDOException $error) {
    // Two copies of one round racing: the other copy won, so answer with its save.
    if ($error->getCode() === '23000' && ($row = $saved())) $replay($row);
    throw $error;
}

// After the insert, so the new round counts. awardBadges only reports rows this call inserted,
// which keeps the answer right when two rounds finish at the same moment.
// The round is already stored, so a badge problem must not turn this into an error the client would retry.
try {
    $newBadges = array_map(fn($badge) => ['title' => $badge['title'], 'icon' => $badge['icon']], awardBadges($user['user_id']));
} catch (Throwable $error) {
    error_log((string) $error);
    $newBadges = [];   // games/badges.php awards them on its next load
}

jsonSuccess(['score' => $score, 'points' => $points, 'new_badges' => $newBadges], 'Round saved.', 201);
