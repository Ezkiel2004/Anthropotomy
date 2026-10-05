<?php
/**
 * Anthropotomy – Announcements API Endpoint
 *
 * GET    /api/announcements.php          → List announcements (with audience filtering & read stats)
 * POST   /api/announcements.php          → Create new announcement (Teacher only)
 * PUT    /api/announcements.php          → Update announcement or toggle pin/publish (Teacher only)
 * DELETE /api/announcements.php?id={id}  → Delete announcement (Teacher only)
 */

require_once __DIR__ . '/helpers.php';

$user = requireLogin();
$db   = Database::getInstance();
$method = $_SERVER['REQUEST_METHOD'];

// ── GET: List Announcements ─────────────────────────────────────
if ($method === 'GET') {
    $category = $_GET['category'] ?? null;
    $audience = $_GET['audience'] ?? null;
    $pinned   = isset($_GET['pinned']) ? (int)$_GET['pinned'] : null;

    if ($user['role'] === 'student') {
        // Students see only published announcements intended for them
        $secCode = studentAudience((int)$user['user_id']);

        $sql = "SELECT a.announcement_id, a.teacher_id, a.title, a.body, a.category, a.audience,
                       a.is_pinned, a.is_published, a.created_at, a.updated_at,
                       u.full_name AS teacher_name,
                       (ar.read_id IS NULL) AS is_unread
                FROM announcements a
                JOIN users u ON u.user_id = a.teacher_id
                LEFT JOIN announcement_reads ar ON ar.announcement_id = a.announcement_id AND ar.user_id = ?
                WHERE a.is_published = 1
                  AND (a.audience = 'all' OR a.audience = ?) ";
        $params = [$user['user_id'], $secCode];

        if ($category) {
            $sql .= " AND a.category = ? ";
            $params[] = $category;
        }
        if ($pinned !== null) {
            $sql .= " AND a.is_pinned = ? ";
            $params[] = $pinned;
        }

        $sql .= " ORDER BY a.is_pinned DESC, a.created_at DESC";
        $announcements = $db->fetchAll($sql, $params);

        jsonSuccess([
            'announcements' => $announcements
        ]);
    } else {
        // Teacher/Admin view with statistics
        $sql = "SELECT a.announcement_id, a.teacher_id, a.title, a.body, a.category, a.audience,
                       a.is_pinned, a.is_published, a.created_at, a.updated_at,
                       u.full_name AS teacher_name,
                       (SELECT COUNT(DISTINCT ar.user_id) FROM announcement_reads ar WHERE ar.announcement_id = a.announcement_id) AS reads_count
                FROM announcements a
                JOIN users u ON u.user_id = a.teacher_id
                WHERE 1=1 ";
        $params = [];

        if ($category) {
            $sql .= " AND a.category = ? ";
            $params[] = $category;
        }
        if ($audience) {
            $sql .= " AND a.audience = ? ";
            $params[] = $audience;
        }
        if ($pinned !== null) {
            $sql .= " AND a.is_pinned = ? ";
            $params[] = $pinned;
        }

        $sql .= " ORDER BY a.is_pinned DESC, a.created_at DESC";
        $announcements = $db->fetchAll($sql, $params);

        // Overall statistics
        $totalStudents = (int)($db->fetchOne("SELECT COUNT(*) AS c FROM student_profiles")['c'] ?? 0);
        $totalAnnouncements = count($announcements);
        $pinnedCount = 0;
        $totalReads = 0;

        foreach ($announcements as &$ann) {
            $ann['announcement_id'] = (int)$ann['announcement_id'];
            $ann['teacher_id']       = (int)$ann['teacher_id'];
            $ann['is_pinned']        = (bool)$ann['is_pinned'];
            $ann['is_published']     = (bool)$ann['is_published'];
            $ann['reads_count']      = (int)$ann['reads_count'];

            // Target students count for this specific audience
            if ($ann['audience'] === 'all') {
                $ann['target_count'] = $totalStudents;
            } else {
                // Match the exact section name stored in the audience key.
                $secSuffix = str_starts_with($ann['audience'], 'section:') ? substr($ann['audience'], 8) : '';
                $ann['target_count'] = (int)($db->fetchOne(
                    "SELECT COUNT(*) AS c FROM student_profiles WHERE section = ?",
                    [$secSuffix]
                )['c'] ?? 0);
            }

            if ($ann['is_pinned']) $pinnedCount++;
            $totalReads += $ann['reads_count'];
        }
        unset($ann);

        $possibleReads = $totalAnnouncements * ($totalStudents ?: 1);
        $readRate = $possibleReads > 0 ? round(($totalReads / $possibleReads) * 100) : 0;

        jsonSuccess([
            'announcements' => $announcements,
            'stats' => [
                'total_announcements' => $totalAnnouncements,
                'pinned_count'        => $pinnedCount,
                'read_rate_pct'       => $readRate,
                'total_students'      => $totalStudents
            ]
        ]);
    }
}

// ── POST: Create Announcement (Teacher Only) ────────────────────
if ($method === 'POST') {
    requireTeacher();
    $body = getJsonBody();

    $title    = trim(requireField($body, 'title', 'Announcement title'));
    $bodyText = trim(requireField($body, 'body', 'Announcement content'));
    $category = $body['category'] ?? 'general';
    $audience = $body['audience'] ?? 'all';
    $isPinned = !empty($body['is_pinned']) ? 1 : 0;
    $isPub    = isset($body['is_published']) ? (int)(bool)$body['is_published'] : 1;

    $validCats = ['general', 'lesson', 'quiz', 'urgent', 'event'];
    if (!in_array($category, $validCats)) $category = 'general';

    // Audience: 'all' or 'section_<name>' (dynamically generated from student sections in DB)
    validateAudience($audience);

    $db->query(
        "INSERT INTO announcements (teacher_id, title, body, category, audience, is_pinned, is_published, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())",
        [$user['user_id'], $title, $bodyText, $category, $audience, $isPinned, $isPub]
    );

    $newId = (int)$db->lastInsertId();

    jsonSuccess([
        'announcement_id' => $newId,
        'title'           => $title,
        'category'        => $category,
        'audience'        => $audience,
        'is_pinned'       => (bool)$isPinned,
        'is_published'    => (bool)$isPub
    ], 'Announcement published successfully!', 201);
}

// ── PUT: Update Announcement (Teacher Only) ─────────────────────
if ($method === 'PUT') {
    requireTeacher();
    $body = getJsonBody();

    $id = (int)requireField($body, 'announcement_id', 'Announcement ID');
    $existing = $db->fetchOne("SELECT * FROM announcements WHERE announcement_id = ?", [$id]);
    if (!$existing) {
        jsonError('Announcement not found.', 404);
    }

    // Allow partial updates
    $title    = isset($body['title']) ? trim($body['title']) : $existing['title'];
    $bodyText = isset($body['body']) ? trim($body['body']) : $existing['body'];
    $category = $body['category'] ?? $existing['category'];
    $audience = $body['audience'] ?? $existing['audience'];
    if (isset($body['audience']) && $body['audience'] !== $existing['audience']) validateAudience($audience);
    $isPinned = isset($body['is_pinned']) ? (int)(bool)$body['is_pinned'] : (int)$existing['is_pinned'];
    $isPub    = isset($body['is_published']) ? (int)(bool)$body['is_published'] : (int)$existing['is_published'];

    $db->query(
        "UPDATE announcements
         SET title = ?, body = ?, category = ?, audience = ?, is_pinned = ?, is_published = ?, updated_at = NOW()
         WHERE announcement_id = ?",
        [$title, $bodyText, $category, $audience, $isPinned, $isPub, $id]
    );

    jsonSuccess([
        'announcement_id' => $id,
        'title'           => $title,
        'is_pinned'       => (bool)$isPinned,
        'is_published'    => (bool)$isPub
    ], 'Announcement updated successfully.');
}

// ── DELETE: Remove Announcement (Teacher Only) ──────────────────
if ($method === 'DELETE') {
    requireTeacher();
    $id = (int)($_GET['id'] ?? 0);
    if (!$id) {
        $body = getJsonBody();
        $id = (int)($body['announcement_id'] ?? 0);
    }

    if (!$id) {
        jsonError('Valid Announcement ID required.', 422);
    }

    $db->query("DELETE FROM announcements WHERE announcement_id = ?", [$id]);

    jsonSuccess(['deleted_id' => $id], 'Announcement deleted successfully.');
}

jsonError('Unsupported request method.', 405);
