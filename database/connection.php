<?php
/**
 * Anthropotomy – Database Connection Configuration
 */

define('DB_HOST', getenv('ANATOMIQ_DB_HOST') ?: '127.0.0.1');
define('DB_NAME', getenv('ANATOMIQ_DB_NAME') ?: 'anatomiq_db');
define('DB_USER', getenv('ANATOMIQ_DB_USER') ?: 'root');       // Change to your MySQL username
define('DB_PASS', getenv('ANATOMIQ_DB_PASS') ?: '');           // Change to your MySQL password
define('DB_CHARSET',  'utf8mb4');

class Database {
    private static $instance = null;
    private $pdo;

    private function __construct() {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $this->pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            throw new RuntimeException('Database unavailable. Check the database service and configuration.', 0, $e);
        }
    }

    public static function getInstance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getConnection(): PDO {
        return $this->pdo;
    }

    public function query(string $sql, array $params = []): PDOStatement {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public function fetchAll(string $sql, array $params = []): array {
        return $this->query($sql, $params)->fetchAll();
    }

    public function fetchOne(string $sql, array $params = []): ?array {
        $result = $this->query($sql, $params)->fetch();
        return $result ?: null;
    }

    public function insert(string $table, array $data): int {
        if (!preg_match('/^[a-zA-Z0-9_]+$/', $table)) {
            throw new InvalidArgumentException("Invalid table name: {$table}");
        }
        $escapedCols = [];
        foreach (array_keys($data) as $col) {
            if (!preg_match('/^[a-zA-Z0-9_]+$/', $col)) {
                throw new InvalidArgumentException("Invalid column name: {$col}");
            }
            $escapedCols[] = "`{$col}`";
        }
        $cols   = implode(', ', $escapedCols);
        $places = implode(', ', array_fill(0, count($data), '?'));
        $this->query("INSERT INTO `{$table}` ({$cols}) VALUES ({$places})", array_values($data));
        return (int) $this->pdo->lastInsertId();
    }

    /** Returns the ID of the last inserted row. */
    public function lastInsertId(): int {
        return (int) $this->pdo->lastInsertId();
    }
}

// ── Auth Helper ──────────────────────────────────────────────────
class Auth {
    public static function startSecureSession(): void {
        if (session_status() === PHP_SESSION_NONE) {
            session_set_cookie_params([
                'lifetime' => 0,
                'path'     => '/',
                'secure'   => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', // Set true in production with HTTPS
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            session_start();
        }
    }

    public static function login(string $username, string $password): array|false {
        self::startSecureSession();
        $db = Database::getInstance();
        $user = $db->fetchOne(
            "SELECT u.*, 
                    COALESCE(sp.section, tp.subject) as context_info,
                    COALESCE(sp.student_id, tp.teacher_id) as role_id
             FROM users u
             LEFT JOIN student_profiles sp ON u.user_id = sp.user_id
             LEFT JOIN teacher_profiles tp ON u.user_id = tp.user_id
             WHERE (u.username = ? OR (u.role = 'student' AND sp.student_id = ?)) AND u.is_active = 1
             ORDER BY (u.username = ?) DESC LIMIT 1",
            [$username, $username, $username]
        );

        if ($user && password_verify($password, $user['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['user_id']   = $user['user_id'];
            $_SESSION['credential_stamp'] = hash('sha256', $user['password_hash']);
            $_SESSION['username']  = $user['username'];
            $_SESSION['role']      = $user['role'];
            $_SESSION['full_name'] = $user['full_name'];
            $_SESSION['context']   = $user['context_info'];
            $_SESSION['role_id']   = $user['role_id'];

            // Update last login
            $db->query("UPDATE users SET last_login = NOW() WHERE user_id = ?", [$user['user_id']]);
            return $user;
        }
        return false;
    }

    public static function requireRole(string $role): void {
        self::startSecureSession();
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== $role) {
            header('Location: ../login.html');
            exit;
        }
    }

    public static function logout(): void {
        self::startSecureSession();
        session_destroy();
        header('Location: ../login.html');
        exit;
    }

    public static function isLoggedIn(): bool {
        self::startSecureSession();
        return isset($_SESSION['user_id']);
    }

    public static function getCurrentUser(): ?array {
        if (!self::isLoggedIn()) return null;
        return [
            'user_id'   => $_SESSION['user_id'],
            'username'  => $_SESSION['username'],
            'role'      => $_SESSION['role'],
            'full_name' => $_SESSION['full_name'],
            'context'   => $_SESSION['context'],
            'role_id'   => $_SESSION['role_id'],
        ];
    }
}
?>
