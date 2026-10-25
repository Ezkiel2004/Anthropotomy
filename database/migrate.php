<?php
/** Non-destructive, repeatable schema upgrades. Run from the command line. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/connection.php';
$pdo = Database::getInstance()->getConnection();
$pdo->exec("CREATE TABLE IF NOT EXISTS app_settings (setting_key VARCHAR(80) PRIMARY KEY, setting_value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("CREATE TABLE IF NOT EXISTS anatomy_content (
 system_id INT UNSIGNED PRIMARY KEY, model_url VARCHAR(500) NULL,
 key_facts LONGTEXT NULL, structures LONGTEXT NULL, source_text TEXT NULL,
 FOREIGN KEY (system_id) REFERENCES body_systems(system_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("CREATE TABLE IF NOT EXISTS achievement_rules (
 achievement_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL,
 metric VARCHAR(50) NOT NULL, threshold DECIMAL(10,2) NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
function addColumnIfMissing(PDO $pdo, string $table, string $column, string $definition): void {
 $check = $pdo->prepare('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
 $check->execute([$table, $column]);
 if (!$check->fetchColumn()) $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
}
foreach (['deadline_at' => 'DATETIME NULL', 'draft_answers' => 'LONGTEXT NULL'] as $column => $definition) addColumnIfMissing($pdo, 'assessment_submissions', $column, $definition);
$pdo->exec("ALTER TABLE student_profiles MODIFY grade_level VARCHAR(20) NOT NULL, MODIFY school_year VARCHAR(20) NOT NULL DEFAULT ''");
$pdo->exec("ALTER TABLE announcements MODIFY audience VARCHAR(200) NOT NULL DEFAULT 'all'");
$pdo->exec("CREATE TABLE IF NOT EXISTS notification_receipts (
 user_id INT UNSIGNED NOT NULL, notification_key VARCHAR(80) NOT NULL,
 read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, notification_key),
 FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
// Practice games: custom card sets and per-card recall (kept from the quiz games, no longer used), finished rounds and earned badges.
$pdo->exec("CREATE TABLE IF NOT EXISTS game_sets (
 set_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100) NOT NULL,
 system_id INT UNSIGNED NULL, cards LONGTEXT NOT NULL, is_active TINYINT(1) NOT NULL DEFAULT 1,
 created_by INT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(system_id) REFERENCES body_systems(system_id) ON DELETE SET NULL,
 FOREIGN KEY(created_by) REFERENCES users(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
$pdo->exec("CREATE TABLE IF NOT EXISTS game_plays (
 play_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, student_id INT UNSIGNED NOT NULL,
 game_key VARCHAR(40) NOT NULL, difficulty ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
 set_id INT UNSIGNED NULL, system_id INT UNSIGNED NULL,
 correct SMALLINT UNSIGNED NOT NULL, total SMALLINT UNSIGNED NOT NULL,
 best_streak SMALLINT UNSIGNED NOT NULL, points INT UNSIGNED NOT NULL,
 duration_sec SMALLINT UNSIGNED NOT NULL,
 played_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_game_plays_student (student_id, played_at), KEY idx_game_plays_played (played_at),
 FOREIGN KEY(student_id) REFERENCES users(user_id) ON DELETE CASCADE,
 FOREIGN KEY(set_id) REFERENCES game_sets(set_id) ON DELETE SET NULL,
 FOREIGN KEY(system_id) REFERENCES body_systems(system_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
addColumnIfMissing($pdo, 'game_plays', 'difficulty', "ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium'");
// The arcade score of a round (the quiz rounds before it have none, so 0).
addColumnIfMissing($pdo, 'game_plays', 'score', 'INT UNSIGNED NOT NULL DEFAULT 0');
$pdo->exec("CREATE TABLE IF NOT EXISTS game_card_stats (
 user_id INT UNSIGNED NOT NULL, card_key VARCHAR(200) NOT NULL, term VARCHAR(100) NOT NULL,
 seen INT UNSIGNED NOT NULL DEFAULT 0, correct INT UNSIGNED NOT NULL DEFAULT 0,
 last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, card_key),
 FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
addColumnIfMissing($pdo, 'achievement_rules', 'badge_key', 'VARCHAR(40) NULL UNIQUE');
addColumnIfMissing($pdo, 'achievement_rules', 'icon', "VARCHAR(40) NOT NULL DEFAULT 'medal'");
$pdo->exec("CREATE TABLE IF NOT EXISTS student_badges (
 user_id INT UNSIGNED NOT NULL, achievement_id INT UNSIGNED NOT NULL,
 earned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, achievement_id),
 FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE,
 FOREIGN KEY(achievement_id) REFERENCES achievement_rules(achievement_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
// Built-in badges. INSERT IGNORE on the unique badge_key keeps a teacher's later edits intact.
$seed = $pdo->prepare('INSERT IGNORE INTO achievement_rules (badge_key, title, metric, threshold, icon) VALUES (?, ?, ?, ?, ?)');
foreach ([
 ['first-game', 'First Game', 'games_played', 1, 'game-controller'],
 ['games-10', 'Regular', 'games_played', 10, 'game-controller'],
 ['games-50', 'Dedicated', 'games_played', 50, 'trophy'],
 ['perfect-1', 'Flawless', 'perfect_rounds', 1, 'check-circle'],
 ['streak-10', 'On a Roll', 'best_game_streak', 10, 'target'],
 ['streak-25', 'Unstoppable', 'best_game_streak', 25, 'target'],
 ['explorer-3', 'Explorer', 'game_systems_played', 3, 'flag'],
 ['explorer-6', 'Globetrotter', 'game_systems_played', 6, 'flag'],
 ['points-500', 'Rising Star', 'total_points', 500, 'medal'],
 ['points-2000', 'High Scorer', 'total_points', 2000, 'medal'],
 ['points-10000', 'Anatomy Ace', 'total_points', 10000, 'trophy'],
 ['combo-20', 'On a Roll', 'best_game_streak', 20, 'target'],
 ['combo-40', 'Unstoppable', 'best_game_streak', 40, 'target'],
 ['all-rounder', 'All-Rounder', 'games_variety', 3, 'flag'],
] as $badge) $seed->execute($badge);
// The arcade games replaced the quiz games, so the quiz-only badges are switched off, once. Nothing is deleted and earned
// badges stay in student_badges; the app_settings flag keeps a teacher who turns one back on from being overruled.
$retired = $pdo->query("SELECT setting_value FROM app_settings WHERE setting_key = 'games_v2_badges'")->fetchColumn();
if ($retired !== '1') {
 $pdo->beginTransaction();
 $pdo->exec("UPDATE achievement_rules SET is_active = 0 WHERE badge_key IN ('perfect-1', 'explorer-3', 'explorer-6', 'streak-10', 'streak-25') OR metric IN ('perfect_rounds', 'game_systems_played')");
 $pdo->exec("INSERT INTO app_settings (setting_key, setting_value) VALUES ('games_v2_badges', '1') ON DUPLICATE KEY UPDATE setting_value = '1'");
 $pdo->commit();
}
echo "Schema migration complete. Existing accounts and learning records preserved.\n";
