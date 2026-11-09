<?php
/**
 * Anthropotomy – Gmail sender for announcement emails.
 *
 * Settings come from storage/mail.ini (copy storage/mail.example.ini). Without that file email is off.
 * Talks SMTP to Gmail directly over TLS, so no mail library or php.ini/sendmail setup is needed.
 */

function mailConfig(): ?array {
    $file = getenv('ANTHROPOTOMY_MAIL_CONFIG') ?: __DIR__ . '/../storage/mail.ini';
    $ini = is_file($file) ? parse_ini_file($file) : false;
    if (!$ini || empty($ini['gmail_address']) || empty($ini['app_password'])) return null;
    return [
        'address'  => trim($ini['gmail_address']),
        'password' => str_replace(' ', '', $ini['app_password']), // Google shows app passwords in groups of four
        'name'     => trim($ini['from_name'] ?? '') ?: 'Anthropotomy',
        'host'     => $ini['smtp_host'] ?? 'ssl://smtp.gmail.com',
        'port'     => (int)($ini['smtp_port'] ?? 465),
    ];
}

/**
 * Send one plain-text email to every address in $bcc (recipients never see each other).
 * Throws RuntimeException with Gmail's reply when something fails.
 */
function sendMail(array $config, array $bcc, string $subject, string $text): void {
    $smtp = @stream_socket_client("{$config['host']}:{$config['port']}", $errno, $error, 15);
    if (!$smtp) throw new RuntimeException("Could not reach the mail server ($error).");
    stream_set_timeout($smtp, 30);
    $expect = function (string $code) use ($smtp): void {
        $reply = '';
        while (($line = fgets($smtp)) !== false) { $reply .= $line; if (($line[3] ?? ' ') === ' ') break; }
        if (!str_starts_with($reply, $code)) throw new RuntimeException('Mail server said: ' . trim($reply ?: 'no reply'));
    };
    $send = function (string $command, string $code) use ($smtp, $expect): void { fwrite($smtp, $command . "\r\n"); $expect($code); };

    try {
        $expect('220');
        $send('EHLO anthropotomy', '250');
        $send('AUTH LOGIN', '334');
        $send(base64_encode($config['address']), '334');
        $send(base64_encode($config['password']), '235');
        // ponytail: 50 recipients per message keeps under Gmail's per-message cap; a personal Gmail account
        // still stops at about 500 recipients a day, so a bigger school needs Google Workspace.
        foreach (array_chunk(array_values(array_unique($bcc)), 50) as $batch) {
            $send("MAIL FROM:<{$config['address']}>", '250');
            foreach ($batch as $to) $send("RCPT TO:<$to>", '250');
            $send('DATA', '354');
            $headers = [
                'From: =?UTF-8?B?' . base64_encode($config['name']) . "?= <{$config['address']}>",
                'To: undisclosed-recipients:;',
                'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
                'Date: ' . date(DATE_RFC2822),
                'Message-ID: <' . bin2hex(random_bytes(12)) . '@anthropotomy>',
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
            ];
            // Base64 lines never start with "." so the body needs no SMTP dot-escaping.
            $send(implode("\r\n", $headers) . "\r\n\r\n" . rtrim(chunk_split(base64_encode($text), 76, "\r\n")) . "\r\n.", '250');
        }
        fwrite($smtp, "QUIT\r\n");
    } finally {
        fclose($smtp);
    }
}

/** Email a just-published announcement to the active students in its audience who have an email address. */
function emailAnnouncement(int $announcementId): string {
    $config = mailConfig();
    if (!$config) return '';
    $db = Database::getInstance();
    $a = $db->fetchOne("SELECT a.*, u.full_name AS teacher_name FROM announcements a JOIN users u ON u.user_id = a.teacher_id WHERE a.announcement_id = ?", [$announcementId]);
    if (!$a || !$a['is_published'] || $a['emailed_at']) return '';

    $sql = "SELECT u.email FROM users u JOIN student_profiles sp ON sp.user_id = u.user_id
            WHERE u.role = 'student' AND u.is_active = 1 AND u.email IS NOT NULL AND u.email <> ''";
    $params = [];
    if ($a['audience'] !== 'all') { $sql .= " AND sp.section = ?"; $params[] = substr($a['audience'], 8); }
    $emails = array_filter(array_column($db->fetchAll($sql, $params), 'email'), fn($e) => filter_var($e, FILTER_VALIDATE_EMAIL));
    if (!$emails) return ' No students in this audience have an email address yet.';

    $scheme = requestIsHttps() ? 'https://' : 'http://';
    $link = $scheme . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/') . '/student/notifications.html';
    $text = "{$a['title']}\n\n{$a['body']}\n\n- {$a['teacher_name']}\n\nSee all announcements: $link\n";
    session_write_close(); // sending can take seconds; don't hold the teacher's session lock meanwhile
    try {
        sendMail($config, $emails, 'Anthropotomy: ' . $a['title'], $text);
    } catch (Throwable $e) {
        error_log('Announcement email failed: ' . $e->getMessage());
        return ' The email could not be sent. ' . $e->getMessage();
    }
    $db->query("UPDATE announcements SET emailed_at = NOW() WHERE announcement_id = ?", [$announcementId]);
    return ' Emailed ' . count($emails) . ' student' . (count($emails) === 1 ? '' : 's') . '.';
}
