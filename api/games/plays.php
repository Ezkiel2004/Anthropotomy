<?php
/**
 * Anthropotomy – Practice Game Rounds API
 * POST /api/games/plays.php
 *
 * Body: {game_key, difficulty, set_id?, system_code?, duration_sec, results: [{card_key, term, correct}]}
 * Saves the round, scores it on the server, updates the student's per-card stats and awards badges.
 * Returns {points, correct, total, best_streak, new_badges: [{title, icon}]}.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('POST');
$user = requireStudent();
$body = getJsonBody();
$db = Database::getInstance();

// ── Validate the round (422 on anything impossible) ─────────────
$gameKey = $body['game_key'] ?? null;
if (!is_string($gameKey) || !preg_match('/^[a-z0-9-]{2,40}$/D', $gameKey)) jsonError('Unknown game.', 422);

$difficulty = $body['difficulty'] ?? null;
if (!is_string($difficulty) || !in_array($difficulty, ['easy', 'medium', 'hard'], true)) jsonError('Choose easy, medium or hard.', 422);

$rawResults = $body['results'] ?? null;
if (!is_array($rawResults) || !array_is_list($rawResults) || count($rawResults) < 1 || count($rawResults) > 50) jsonError('A round has 1 to 50 results.', 422);

$duration = $body['duration_sec'] ?? null;
if (!is_int($duration) && !is_float($duration)) jsonError('The round needs a duration in seconds.', 422);
$duration = (int) round($duration);
if ($duration < count($rawResults) || $duration > 3600) jsonError('That round length is not possible.', 422);

$results = [];
foreach ($rawResults as $row) {
    $key = is_array($row) ? ($row['card_key'] ?? null) : null;
    $term = is_array($row) ? ($row['term'] ?? null) : null;
    if (!is_string($key) || trim($key) === '' || !is_string($term) || trim($term) === '') jsonError('Each result needs a card key and a term.', 422);
    $results[] = [
        'card_key' => mb_substr($key, 0, 200),
        'term'     => mb_substr($term, 0, 100),
        'correct'  => filter_var($row['correct'] ?? false, FILTER_VALIDATE_BOOLEAN) ? 1 : 0,
    ];
}

$setId = null;
if (isset($body['set_id'])) {
    $setId = is_bool($body['set_id']) ? false : filter_var($body['set_id'], FILTER_VALIDATE_INT);
    if ($setId === false || !$db->fetchOne('SELECT set_id FROM game_sets WHERE set_id = ?', [$setId])) jsonError('That game set does not exist.', 422);
}

$systemId = null;
if (isset($body['system_code'])) {
    $system = is_string($body['system_code']) ? $db->fetchOne('SELECT system_id FROM body_systems WHERE system_code = ?', [$body['system_code']]) : null;
    if (!$system) jsonError('That body system does not exist.', 422);
    $systemId = (int) $system['system_id'];
}

// ── Score and save ───────────────────────────────────────────────
$score = scoreRound($results, $difficulty);

// Upsert the cards in key order, so two rounds from the same student never lock rows in opposite orders.
$cardRows = $results;
usort($cardRows, fn($a, $b) => strcmp($a['card_key'], $b['card_key']));

$pdo = $db->getConnection();
$pdo->beginTransaction();
try {
    $db->insert('game_plays', [
        'student_id'   => $user['user_id'],
        'game_key'     => $gameKey,
        'difficulty'   => $difficulty,
        'set_id'       => $setId,
        'system_id'    => $systemId,
        'correct'      => $score['correct'],
        'total'        => $score['total'],
        'best_streak'  => $score['best_streak'],
        'points'       => $score['points'],
        'duration_sec' => $duration,
    ]);
    $upsert = $pdo->prepare(
        'INSERT INTO game_card_stats (user_id, card_key, term, seen, correct) VALUES (?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE seen = seen + 1, correct = correct + VALUES(correct), last_seen = NOW()'
    );
    foreach ($cardRows as $card) $upsert->execute([$user['user_id'], $card['card_key'], $card['term'], $card['correct']]);
    $pdo->commit();
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $error;
}

// After the commit, so the new round counts. awardBadges only reports rows this call inserted,
// which keeps the answer right when two rounds finish at the same moment.
$newBadges = array_map(fn($badge) => ['title' => $badge['title'], 'icon' => $badge['icon']], awardBadges($user['user_id']));

jsonSuccess($score + ['new_badges' => $newBadges], 'Round saved.', 201);
