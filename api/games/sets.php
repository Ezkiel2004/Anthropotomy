<?php
/**
 * Anthropotomy – Game Sets API (teacher-made card sets for the practice games)
 *
 * GET    /api/games/sets.php        students: active sets; teachers: every set
 * POST   /api/games/sets.php        teachers: create a set
 * PUT    /api/games/sets.php?id=    teachers: change any of title, system_id, cards, is_active
 * DELETE /api/games/sets.php?id=    teachers: delete a set
 *
 * A set is {set_id, title, system_id, system_name, cards: [{term, clue, group?, mesh?}], is_active}.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET', 'POST', 'PUT', 'DELETE');
$method = $_SERVER['REQUEST_METHOD'];
$user = $method === 'GET' ? requireLogin() : requireTeacher();
$db = Database::getInstance();

/** Checks every card against the set rules and returns the cleaned list; sends a 422 on the first problem. */
function cleanCards(mixed $cards): array {
    if (!is_array($cards) || !array_is_list($cards) || count($cards) < 4 || count($cards) > 200) {
        jsonError('A set needs 4 to 200 cards.', 422);
    }
    $clean = [];
    $terms = [];
    foreach ($cards as $index => $card) {
        $number = $index + 1;
        if (!is_array($card)) jsonError("Card {$number} is not valid.", 422);
        $text = [];
        foreach (['term' => [1, 100], 'clue' => [1, 300], 'group' => [0, 60], 'mesh' => [0, 150]] as $field => [$min, $max]) {
            $value = $card[$field] ?? '';
            if (!is_string($value)) jsonError("Card {$number}: the {$field} must be text.", 422);
            $value = trim($value);
            if (mb_strlen($value) < $min || mb_strlen($value) > $max) {
                jsonError("Card {$number}: the {$field} must be " . ($min > 0 ? "{$min} to {$max}" : "up to {$max}") . ' characters.', 422);
            }
            $text[$field] = $value;
        }
        $key = mb_strtolower($text['term']);
        if (isset($terms[$key])) jsonError("Card {$number}: \"{$text['term']}\" is already in this set. Terms must differ, ignoring capitals.", 422);
        $terms[$key] = true;
        $entry = ['term' => $text['term'], 'clue' => $text['clue']];
        foreach (['group', 'mesh'] as $optional) {
            if ($text[$optional] !== '') $entry[$optional] = $text[$optional];
        }
        $clean[] = $entry;
    }
    return $clean;
}

if ($method === 'GET') {
    $rows = $db->fetchAll(
        'SELECT s.set_id, s.title, s.system_id, bs.system_name, s.cards, s.is_active
         FROM game_sets s
         LEFT JOIN body_systems bs ON bs.system_id = s.system_id'
        . ($user['role'] === 'student' ? ' WHERE s.is_active = 1' : '')
        . ' ORDER BY s.title, s.set_id'
    );
    jsonSuccess(array_map(fn($row) => [
        'set_id'      => (int) $row['set_id'],
        'title'       => $row['title'],
        'system_id'   => $row['system_id'] === null ? null : (int) $row['system_id'],
        'system_name' => $row['system_name'],
        'cards'       => json_decode($row['cards'], true) ?: [],
        'is_active'   => (bool) $row['is_active'],
    ], $rows));
}

if ($method === 'DELETE') {
    if ($db->query('DELETE FROM game_sets WHERE set_id = ?', [getIdParam()])->rowCount() === 0) jsonError('Game set not found.', 404);
    jsonSuccess(null, 'Game set deleted.');
}

// POST and PUT: validate every field that was sent, then write once.
$body = getJsonBody();
$creating = $method === 'POST';
$id = $creating ? 0 : getIdParam();
if (!$creating && !$db->fetchOne('SELECT set_id FROM game_sets WHERE set_id = ?', [$id])) jsonError('Game set not found.', 404);

$changes = [];
if ($creating || array_key_exists('title', $body)) {
    $title = $body['title'] ?? null;
    if (!is_string($title) || trim($title) === '' || mb_strlen(trim($title)) > 100) jsonError('Give the set a title of 1 to 100 characters.', 422);
    $changes['title'] = trim($title);
}
if (array_key_exists('system_id', $body)) {
    $systemId = $body['system_id'];
    if ($systemId === null || $systemId === '') {
        $changes['system_id'] = null;
    } else {
        $systemId = is_bool($systemId) ? false : filter_var($systemId, FILTER_VALIDATE_INT);
        if ($systemId === false || $systemId < 1 || !$db->fetchOne('SELECT system_id FROM body_systems WHERE system_id = ?', [$systemId])) {
            jsonError('Choose a body system from the list, or none.', 422);
        }
        $changes['system_id'] = $systemId;
    }
}
if ($creating || array_key_exists('cards', $body)) {
    $changes['cards'] = json_encode(cleanCards($body['cards'] ?? null), JSON_UNESCAPED_UNICODE);
}
if (array_key_exists('is_active', $body)) {
    if (!is_bool($body['is_active']) && $body['is_active'] !== 0 && $body['is_active'] !== 1) jsonError('Active must be true or false.', 422);
    $changes['is_active'] = (int) $body['is_active'];
}

if ($creating) {
    $id = $db->insert('game_sets', $changes + ['created_by' => $user['user_id']]);
    jsonSuccess(['set_id' => $id], 'Game set created.', 201);
}
if (!$changes) jsonError('Nothing to update.', 422);
$db->query('UPDATE game_sets SET ' . implode(', ', array_map(fn($column) => "`{$column}` = ?", array_keys($changes))) . ' WHERE set_id = ?', [...array_values($changes), $id]);
jsonSuccess(['set_id' => $id], 'Game set updated.');
