<?php
/**
 * Anthropotomy – Practice Game Badges API
 * GET /api/games/badges.php   students: every active badge as
 *                             [{achievement_id, title, icon, metric, threshold, value, earned_at}]
 *
 * value is the student's current figure for the badge's metric (null when it has none yet, such as
 * an average quiz score before any quiz); earned_at is null until the badge is earned.
 */

require_once __DIR__ . '/../helpers.php';
requireMethod('GET');
$user = requireStudent();
$db = Database::getInstance();

$metrics = badgeMetrics($user['user_id']);
$rows = $db->fetchAll(
    'SELECT r.achievement_id, r.title, r.icon, r.metric, r.threshold, sb.earned_at
     FROM achievement_rules r
     LEFT JOIN student_badges sb ON sb.achievement_id = r.achievement_id AND sb.user_id = ?
     WHERE r.is_active = 1
     ORDER BY r.achievement_id',
    [$user['user_id']]
);
jsonSuccess(array_map(fn($row) => [
    'achievement_id' => (int) $row['achievement_id'],
    'title'          => $row['title'],
    'icon'           => $row['icon'],
    'metric'         => $row['metric'],
    'threshold'      => (float) $row['threshold'],
    'value'          => $metrics[$row['metric']] ?? null,
    'earned_at'      => $row['earned_at'],
], $rows));
