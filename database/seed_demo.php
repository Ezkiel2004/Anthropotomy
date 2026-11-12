<?php
/**
 * Demo content for design reviews: four modules with every lesson type, module materials, and
 * five assessments covering every question type, plus one graded attempt by student01.
 *
 *   php database/seed_demo.php           add the demo (removes an earlier demo first)
 *   php database/seed_demo.php --remove  remove the demo and its files
 *
 * Everything it creates is recorded in app_settings under demo_seed, so --remove deletes exactly
 * those rows and files and never touches content made by teachers. Media comes from database/demo/.
 * Remove the demo before exporting the database for hosting.
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
require_once __DIR__ . '/connection.php';

const DEMO_KEY = 'demo_seed';
$root   = dirname(__DIR__);
$db     = Database::getInstance();
$pdo    = $db->getConnection();

function removeDemo(Database $db, string $root): void {
    $row = $db->fetchOne('SELECT setting_value FROM app_settings WHERE setting_key = ?', [DEMO_KEY]);
    if (!$row) { echo "No demo content recorded.\n"; return; }
    $seed = json_decode($row['setting_value'], true) ?: [];
    $in = fn(array $ids) => implode(',', array_map('intval', $ids ?: [0]));
    // Submissions and answers go with their assessment; questions and options too (foreign keys cascade).
    $db->query('DELETE FROM answer_responses WHERE submission_id IN (SELECT submission_id FROM assessment_submissions WHERE assessment_id IN (' . $in($seed['assessments'] ?? []) . '))');
    $db->query('DELETE FROM assessment_submissions WHERE assessment_id IN (' . $in($seed['assessments'] ?? []) . ')');
    $db->query('DELETE FROM answer_options WHERE question_id IN (SELECT question_id FROM questions WHERE assessment_id IN (' . $in($seed['assessments'] ?? []) . '))');
    $db->query('DELETE FROM questions WHERE assessment_id IN (' . $in($seed['assessments'] ?? []) . ')');
    $db->query('DELETE FROM assessments WHERE assessment_id IN (' . $in($seed['assessments'] ?? []) . ')');
    $db->query('DELETE FROM teacher_files WHERE file_id IN (' . $in($seed['files'] ?? []) . ')');
    $db->query('DELETE FROM lessons WHERE lesson_id IN (' . $in($seed['lessons'] ?? []) . ')');
    $db->query('DELETE FROM modules WHERE module_id IN (' . $in($seed['modules'] ?? []) . ')');
    foreach ($seed['paths'] ?? [] as $path) {
        $full = $root . '/' . $path;
        if (is_file($full) && str_contains(basename($full), 'demo-')) unlink($full);
    }
    $db->query('DELETE FROM app_settings WHERE setting_key = ?', [DEMO_KEY]);
    echo 'Removed demo: ' . count($seed['modules'] ?? []) . ' modules, ' . count($seed['lessons'] ?? []) . ' lessons, '
        . count($seed['assessments'] ?? []) . " assessments.\n";
}

if (in_array('--remove', $argv, true)) { removeDemo($db, $root); exit(0); }
if ($db->fetchOne('SELECT 1 FROM app_settings WHERE setting_key = ?', [DEMO_KEY])) removeDemo($db, $root);

$teacher = $db->fetchOne("SELECT user_id FROM users WHERE username = 'admin'")
    ?? $db->fetchOne("SELECT user_id FROM users WHERE role IN ('admin','teacher') ORDER BY user_id LIMIT 1");
if (!$teacher) { fwrite(STDERR, "No teacher account to own the demo.\n"); exit(1); }
$tid = (int)$teacher['user_id'];
$sys = array_column($db->fetchAll('SELECT system_id, system_code FROM body_systems'), 'system_id', 'system_code');
$seed = ['modules' => [], 'lessons' => [], 'files' => [], 'assessments' => [], 'paths' => []];

/** Copies a demo media file into uploads/lessons and returns its page-relative URL. */
function lessonMedia(string $name, string $root, array &$seed): string {
    $dir = $root . '/uploads/lessons';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    copy($root . '/database/demo/' . $name, "$dir/demo-$name") || throw new RuntimeException("Cannot copy $name");
    $seed['paths'][] = "uploads/lessons/demo-$name";
    return "../uploads/lessons/demo-$name";
}

$modules = [
    ['skeletal', 'Bones of the Body', 'published', 'How the 206 bones of the adult skeleton are grouped, shaped and built, from the skull to the toes.', [
        ['What the skeleton does', 'reading', 8, 'published', null, "The skeleton is the body's frame. It holds you upright, gives muscles something to pull on and keeps soft organs safe.\n\nSupport\nBones carry the weight of the body. The vertebral column holds the head and trunk; the legs carry everything above them.\n\nProtection\nThe skull surrounds the brain. The ribs and sternum form a cage around the heart and lungs. The vertebrae wrap the spinal cord.\n\nMovement\nMuscles attach to bones by tendons. When a muscle shortens it pulls the bone, and the joint acts as a pivot.\n\nStorage and blood\nBone stores calcium and phosphate. Red marrow inside some bones makes red blood cells, white blood cells and platelets."],
        ['Parts of a long bone', 'reading', 6, 'published', ['image', '../assets/img/hero/skeletal.webp'], "A long bone such as the femur has a shaft, the diaphysis, and two wider ends, the epiphyses.\n\nThe shaft is compact bone around a hollow medullary cavity filled with yellow marrow. The ends are spongy bone holding red marrow. In children a growth plate of cartilage separates each end from the shaft; it hardens into bone when growth stops.\n\nA tough membrane, the periosteum, covers the outside. Smooth articular cartilage caps the ends where the bone meets a joint."],
        ['Axial and appendicular skeleton', 'reading', 12, 'published', ['file', 'skeletal-handout.pdf'], "Read the handout, then answer the three Check yourself questions on its last page."],
        ['Bone labeling worksheet', 'reading', 10, 'published', ['file', 'bone-labeling-worksheet.docx'], "Print it or fill it in on screen, then bring it to class."],
        ['Explore the skeleton in 3D', '3d_model', 10, 'published', ['url', '../system_model/layers/skeletal.glb'], "Open the 3D model. Find the skull, the sternum, a rib, the humerus and the femur. Click each one and read its description."],
        ['Review: key bone terms', 'quiz_prep', 5, 'published', null, "Osteoblast: a cell that builds bone.\nOsteoclast: a cell that breaks bone down.\nOsteocyte: a mature bone cell.\nDiaphysis: the shaft of a long bone.\nEpiphysis: the end of a long bone.\nPeriosteum: the membrane that covers bone."],
        ['Joints and ligaments', 'reading', null, 'draft', null, "Draft: joints are where two bones meet. Ligaments join bone to bone."],
    ], [['Skeletal system reviewer', 'skeletal-reviewer.pdf'], ['Bone labeling worksheet', 'bone-labeling-worksheet.docx']]],
    ['circulatory', 'The Heart and Blood Vessels', 'published', 'The four-chambered heart, the vessels that carry blood and the two circuits blood travels every minute.', [
        ['How blood flows through the heart', 'video', 4, 'published', ['file', 'heart-flow.mp4'], "Watch the short video. Blood returning from the body enters the right atrium, passes to the right ventricle and is pumped to the lungs. It comes back to the left atrium, moves to the left ventricle and leaves through the aorta."],
        ['Arteries, veins and capillaries', 'reading', 10, 'published', null, "Arteries carry blood away from the heart. Their walls are thick and elastic to handle high pressure.\n\nVeins return blood to the heart. Their walls are thinner and many have valves that stop blood flowing backwards.\n\nCapillaries are the smallest vessels, one cell thick. Oxygen, nutrients and wastes pass through their walls to and from the tissues."],
        ['The cardiac cycle', 'reading', 12, 'published', ['file', 'cardiac-cycle.pdf'], "Read the notes on systole and diastole. Listen for lub and dub in the heart-sound clip your teacher plays in class."],
        ['Trace a drop of blood', 'interactive', 15, 'published', null, "Work with a partner. Start a drop of blood in the right atrium and name every chamber, valve and vessel it passes until it returns. Check your path in the 3D explorer with the circulatory system switched on."],
    ], [['Circulatory system slides', 'circulatory-slides.pdf']]],
    ['respiratory', 'Breathing and the Lungs', 'draft', 'From the nose to the alveoli: how air reaches the blood.', [
        ['The airway from nose to alveoli', 'reading', 9, 'published', null, "Air enters through the nose, where it is warmed and filtered. It passes the pharynx and larynx, then travels down the trachea, which splits into two bronchi. The bronchi branch into bronchioles that end in tiny air sacs, the alveoli."],
        ['How we breathe', 'reading', 7, 'draft', null, "Draft: the diaphragm contracts and flattens, the chest gets bigger and air flows in."],
    ], []],
    ['nervous', 'The Brain and Nerves', 'published', '', [], []],
];

$pdo->beginTransaction();
try {
    foreach ($modules as $mi => [$code, $title, $status, $desc, $lessons, $materials]) {
        $mid = $db->insert('modules', ['system_id' => $sys[$code], 'teacher_id' => $tid, 'title' => $title, 'description' => $desc ?: null,
            'status' => $status, 'sort_order' => $mi + 1, 'published_at' => $status === 'published' ? date('Y-m-d H:i:s') : null]);
        $seed['modules'][] = $mid;
        $moduleIds[$code] = $mid;
        foreach ($lessons as $li => [$ltitle, $type, $mins, $lstatus, $media, $text]) {
            $url = match ($media[0] ?? null) { 'file' => lessonMedia($media[1], $root, $seed), 'image', 'url' => $media[1], default => null };
            $seed['lessons'][] = $db->insert('lessons', ['module_id' => $mid, 'teacher_id' => $tid, 'title' => $ltitle, 'lesson_type' => $type,
                'content_text' => $text, 'media_url' => $url, 'duration_mins' => $mins, 'sort_order' => $li + 1, 'status' => $lstatus]);
        }
        foreach ($materials as [$ftitle, $file]) {
            $stored = 'demo-' . bin2hex(random_bytes(8)) . '.' . pathinfo($file, PATHINFO_EXTENSION);
            if (!is_dir("$root/storage/files")) mkdir("$root/storage/files", 0755, true);
            copy("$root/database/demo/$file", "$root/storage/files/$stored") || throw new RuntimeException("Cannot copy $file");
            $seed['paths'][] = "storage/files/$stored";
            $seed['files'][] = $db->insert('teacher_files', ['teacher_id' => $tid, 'kind' => 'material', 'module_id' => $mid, 'title' => $ftitle,
                'original_name' => $file, 'stored_name' => $stored, 'size_bytes' => filesize("$root/database/demo/$file")]);
        }
    }

    $mc = fn(string $q, array $opts, int $correct) => ['multiple_choice', $q, array_map(fn($o, $i) => [$o, $i === $correct], $opts, array_keys($opts)), null];
    $tf = fn(string $q, bool $answer) => ['true_false', $q, [['True', $answer], ['False', !$answer]], null];
    $id = fn(string $q, string $term) => ['identification', $q, [], ['target_label' => $term]];
    $hs = fn(string $q, string $label, string $img, float $x, float $y, float $r) => ['hotspot', $q, [], ['target_label' => $label, 'image_url' => "../assets/img/hero/$img.webp", 'x' => $x, 'y' => $y, 'radius' => $r]];
    $due = fn(string $mod) => date('Y-m-d 23:59:00', strtotime($mod));

    $assessments = [
        ['Skeletal System Basics', 'skeletal', 'Choose the best answer. You can go back to any question before you submit.', 15, 75, 3, 'active', null, [
            $mc('How many bones are in the adult human skeleton?', ['106', '206', '256', '306'], 1),
            $mc('Which bone protects the brain?', ['Sternum', 'Pelvis', 'Skull', 'Scapula'], 2),
            $mc('Red bone marrow makes', ['Blood cells', 'Bile', 'Hormones', 'Cartilage'], 0),
            $mc('Which of these is a long bone?', ['Carpal', 'Femur', 'Vertebra', 'Patella'], 1),
            $tf('The sternum is part of the appendicular skeleton.', false),
            $tf('Osteoblasts are cells that build new bone.', true),
        ]],
        ['Name That Bone', 'skeletal', 'Type the anatomical name of each bone. Spelling counts.', 10, 70, 2, 'active', '+5 days', [
            $id('The thigh bone, the longest bone in the body', 'Femur'),
            $id('The kneecap', 'Patella'),
            $id('The collarbone', 'Clavicle'),
            $id('The upper arm bone', 'Humerus'),
        ]],
        ['Find the Structure', null, 'Click the structure named in each question on the picture.', 8, 67, 3, 'active', '+2 days', [
            $hs('Click the heart.', 'Heart', 'circulatory', .54, .555, .08),
            $hs('Click the sternum (breastbone).', 'Sternum', 'skeletal', .46, .58, .07),
            $hs('Click the trachea (windpipe).', 'Trachea', 'respiratory', .50, .23, .05),
        ]],
        ['Heart and Vessels Check', 'circulatory', 'A mix of question types on the heart and blood vessels.', 20, 75, 2, 'draft', '+10 days', [
            $mc('Which chamber pumps blood to the whole body?', ['Right atrium', 'Right ventricle', 'Left atrium', 'Left ventricle'], 3),
            $tf('Veins carry blood away from the heart.', false),
            $id('The largest artery in the body', 'Aorta'),
            $hs('Click the heart.', 'Heart', 'circulatory', .54, .555, .08),
        ]],
        ['Breathing Review', 'respiratory', 'Closed review from the last unit.', 10, 75, 1, 'closed', '-3 days', [
            $mc('Gas exchange happens in the', ['Trachea', 'Bronchi', 'Alveoli', 'Larynx'], 2),
            $mc('The main muscle of breathing is the', ['Diaphragm', 'Biceps', 'Heart', 'Stomach'], 0),
            $tf('The trachea splits into two bronchi.', true),
        ]],
    ];
    $questionIds = [];
    foreach ($assessments as $ai => [$title, $code, $instructions, $mins, $pass, $attempts, $status, $dueMod, $questions]) {
        $aid = $db->insert('assessments', ['teacher_id' => $tid, 'system_id' => $code ? $sys[$code] : null, 'module_id' => $code ? ($moduleIds[$code] ?? null) : null,
            'title' => $title, 'instructions' => $instructions, 'time_limit_mins' => $mins, 'passing_score' => $pass,
            'max_attempts' => $attempts, 'status' => $status, 'due_date' => $dueMod ? $due($dueMod) : null]);
        $seed['assessments'][] = $aid;
        foreach ($questions as $qi => [$qtype, $text, $options, $data]) {
            $qid = $db->insert('questions', ['assessment_id' => $aid, 'question_text' => $text, 'question_type' => $qtype,
                'hotspot_data' => $data ? json_encode($data) : null, 'points' => 1, 'sort_order' => $qi + 1]);
            $optionIds = [];
            foreach ($options as $oi => [$otext, $correct]) $optionIds[] = [$db->insert('answer_options', ['question_id' => $qid, 'option_text' => $otext, 'is_correct' => $correct ? 1 : 0, 'sort_order' => $oi + 1]), $correct];
            $questionIds[$ai][] = [$qid, $qtype, $optionIds];
        }
    }

    // One graded attempt by student01 on the first quiz: five of six right, so the teacher list shows results.
    $student = $db->fetchOne("SELECT user_id FROM users WHERE username = 'student01'");
    if ($student) {
        $sid = $db->insert('assessment_submissions', ['student_id' => $student['user_id'], 'assessment_id' => $seed['assessments'][0], 'attempt_number' => 1,
            'score' => 83.33, 'raw_score' => 5, 'max_score' => 6, 'time_taken_secs' => 412, 'status' => 'graded',
            'started_at' => date('Y-m-d H:i:s', time() - 86400 - 412), 'submitted_at' => date('Y-m-d H:i:s', time() - 86400), 'graded_at' => date('Y-m-d H:i:s', time() - 86400)]);
        foreach ($questionIds[0] as $qi => [$qid, , $options]) {
            $right = $qi !== 3;
            $pick = array_values(array_filter($options, fn($o) => $o[1] === $right))[0][0];
            $db->insert('answer_responses', ['submission_id' => $sid, 'question_id' => $qid, 'selected_option' => $pick, 'is_correct' => $right ? 1 : 0, 'points_earned' => $right ? 1 : 0]);
        }
    }

    $db->query('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', [DEMO_KEY, json_encode($seed)]);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    foreach ($seed['paths'] as $path) @unlink("$root/$path");
    fwrite(STDERR, 'Demo seed failed: ' . $e->getMessage() . "\n");
    exit(1);
}
echo 'Demo added: ' . count($seed['modules']) . ' modules, ' . count($seed['lessons']) . ' lessons, ' . count($seed['files'])
    . ' materials, ' . count($seed['assessments']) . " assessments. Remove with: php database/seed_demo.php --remove\n";
