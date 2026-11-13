<?php
/** Plain CLI test for database/preview.php. Run: C:/xampp/php/php.exe tests/preview.php
 *  Uses the stub converter in tests/fixtures (never LibreOffice), so it runs anywhere. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root = dirname(__DIR__);
require_once $root . '/database/preview.php';

$stub = $root . '/tests/fixtures/' . (PHP_OS_FAMILY === 'Windows' ? 'fake-soffice.cmd' : 'fake-soffice.sh');

// Worker mode for the concurrency check: convert one file and print the result.
if (($argv[1] ?? '') === 'worker') { echo makePreview($argv[2]) ? 'OK' : 'FAIL'; exit(0); }

$passed = 0;
function check(bool $condition, string $message): void {
    global $passed;
    if (!$condition) { fwrite(STDERR, "FAIL: $message\n"); exit(1); }
    $passed++;
    echo "ok - $message\n";
}
function workEntries(string $root): array {
    $dir = $root . '/storage/preview-work';
    return is_dir($dir) ? array_values(array_diff(scandir($dir), ['.', '..'])) : [];
}

$tmp = sys_get_temp_dir() . '/anthropotomy-preview-' . bin2hex(random_bytes(4));
mkdir($tmp);
ini_set('log_errors', '1');
ini_set('error_log', $tmp . '/errors.log');   // keeps the library's log lines out of the test output
function deck(string $dir, string $name, ?string $bytes = null): string {
    $path = $dir . '/' . $name;
    file_put_contents($path, $bytes ?? file_get_contents(dirname(__DIR__) . '/tests/fixtures/sample.pptx'));
    return $path;
}
putenv('ANTHROPOTOMY_SOFFICE=' . $stub);

// Names and formats
check(previewPath('/x/a.pptx') === '/x/a.pptx.preview.pdf', 'previewPath appends .preview.pdf to the full file name');
check(previewFormats() === ['ppt', 'pptx', 'doc', 'docx'], 'previewFormats lists the four Office formats');
check(previewSupported('Deck.PPTX') && previewSupported('a.doc') && !previewSupported('a.pdf') && !previewSupported('a.txt'), 'previewSupported checks the extension, ignoring case');

// Finding the converter
check(previewConverter() === $stub, 'ANTHROPOTOMY_SOFFICE pointing at a file is used');
putenv('ANTHROPOTOMY_SOFFICE=' . $tmp . '/missing.exe');
check(previewConverter() === null, 'ANTHROPOTOMY_SOFFICE pointing at nothing means no converter');
putenv('ANTHROPOTOMY_SOFFICE');
$ini = $tmp . '/db.ini';
file_put_contents($ini, "soffice=\"$stub\"\n");
check(previewConverter($ini) === $stub, 'soffice= in the ini file is used when the environment variable is not set');
// A soffice= line copied from another machine (this PC's Windows path in an export that reaches a Linux server) must not switch previews off.
file_put_contents($ini, "soffice=" . $tmp . "/missing.exe\n");
check(previewConverter($ini, [$tmp . '/nowhere', $stub]) === $stub, 'an ini soffice= that points at nothing is ignored and the usual locations are tried');
check(previewConverter($ini, [$tmp . '/nowhere']) === null, 'with nothing at the usual locations either there is no converter');
putenv('ANTHROPOTOMY_SOFFICE=' . $stub);

// The command that is run. On Linux and macOS /usr/bin/soffice is a wrapper script that starts the real program, so stopping
// only the process we started would leave that child running: the converter runs under `timeout` (which stops its whole
// process group) when it exists. On Windows previewKill stops the process tree instead. (The wrapper itself can only be
// exercised on a Linux machine: run this test there with tests/fixtures/fake-soffice.sh.)
$tail = ['--headless', '--norestore', '-env:UserInstallation=file:///p', '--convert-to', 'pdf', '--outdir', '/o', '/i.pptx'];
$timeoutStandIn = __FILE__;   // any file that exists stands in for the `timeout` command
$linux = previewCommand('/usr/bin/soffice', 'file:///p', '/o', '/i.pptx', 30, 'Linux', $timeoutStandIn);
check(array_slice($linux, 0, 4) === [$timeoutStandIn, '--kill-after=5', '30', '/usr/bin/soffice'] && array_slice($linux, 4) === $tail, 'on Linux the converter runs under timeout --kill-after=5 with the timeout in seconds');
check(previewCommand('/usr/bin/soffice', 'file:///p', '/o', '/i.pptx', 30, 'Linux', $tmp . '/no-timeout') === ['/usr/bin/soffice', ...$tail], 'without a timeout command the converter runs on its own');
check(previewCommand('C:/x/soffice.exe', 'file:///p', '/o', '/i.pptx', 30, 'Windows', $timeoutStandIn) === ['C:/x/soffice.exe', ...$tail], 'on Windows there is no timeout wrapper');

// Converting
$good = deck($tmp, 'good.pptx');
$before = md5_file($good);
check(makePreview($good) === true, 'a real-looking deck converts');
check(is_file(previewPath($good)) && file_get_contents(previewPath($good), false, null, 0, 4) === '%PDF', 'the preview exists and is a PDF');
check(md5_file($good) === $before, 'the original file is left untouched');
check(workEntries($root) === [], 'the work folder is removed afterwards');

$bad = deck($tmp, 'bad.pptx', "PK\x03\x04FAIL-CONVERT");
check(makePreview($bad) === false && !is_file(previewPath($bad)), 'a deck the converter rejects gives no preview');
check(workEntries($root) === [], 'a failed run leaves no work folder');
$text = deck($tmp, 'notes.txt', 'hello');
check(makePreview($text) === false && !is_file(previewPath($text)), 'an unsupported extension is never converted');
check(makePreview($tmp . '/nothing.pptx') === false, 'a missing file gives false, not an error');

$hang = deck($tmp, 'hang.pptx', "PK\x03\x04HANG-CONVERT");
$started = microtime(true);
$result = makePreview($hang, 2);
$elapsed = microtime(true) - $started;
check($result === false && $elapsed < 8, 'a converter that hangs is stopped at the timeout (took ' . round($elapsed, 1) . 's)');
check(!is_file(previewPath($hang)), 'a hung run leaves no preview');
check(str_contains((string) @file_get_contents($tmp . '/errors.log'), 'timed out'), 'a timeout is written to the error log');
check(workEntries($root) === [], 'a hung run leaves no work folder (the process was killed, so nothing holds it open)');

putenv('ANTHROPOTOMY_SOFFICE=' . $tmp . '/missing.exe');
$none = deck($tmp, 'none.pptx');
check(makePreview($none) === false && !is_file(previewPath($none)), 'no converter: false and no preview');
putenv('ANTHROPOTOMY_SOFFICE=' . $stub);

// Two conversions at once
$a = deck($tmp, 'one.pptx');
$b = deck($tmp, 'two.docx');
$workers = [];
foreach ([$a, $b] as $file) {
    $workers[$file] = proc_open([PHP_BINARY, __FILE__, 'worker', $file], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $workers[$file] = [$workers[$file], $pipes];
}
$answers = [];
foreach ($workers as $file => [$process, $pipes]) { $answers[$file] = stream_get_contents($pipes[1]); proc_close($process); }
check($answers[$a] === 'OK' && $answers[$b] === 'OK' && is_file(previewPath($a)) && is_file(previewPath($b)), 'two conversions at the same time both succeed');

// Removing
removePreview($good);
check(!is_file(previewPath($good)), 'removePreview deletes the preview');
removePreview($good);
check(true, 'removePreview is harmless when there is no preview');

// The access rule
check(previewOriginalAllowed(true, true, false), 'teacher may always get the original');
check(!previewOriginalAllowed(false, true, false), 'student with a preview and downloads off may not');
check(previewOriginalAllowed(false, false, false), 'student with no preview may (otherwise the file could not be opened)');
check(previewOriginalAllowed(false, true, true), 'student with a preview and downloads on may');

// The backfill script (database/convert_previews.php) on a throwaway copy of the upload folders.
// ANTHROPOTOMY_PREVIEW_ROOT replaces the project root for it, so it never touches real files.
$site = $tmp . '/site';
foreach (['uploads/lessons', 'storage/files'] as $folder) mkdir($site . '/' . $folder, 0777, true);
deck($site . '/uploads/lessons', 'a.pptx');
file_put_contents($site . '/uploads/lessons/c.pdf', file_get_contents($root . '/tests/fixtures/sample.pdf'));
deck($site . '/storage/files', 'b.docx');
deck($site . '/storage/files', 'd.pptx', "PK\x03\x04FAIL-CONVERT");
function backfill(string $site, array $args = [], ?string $converter = null): array {
    global $root, $stub;
    $env = array_merge(getenv(), ['ANTHROPOTOMY_PREVIEW_ROOT' => $site, 'ANTHROPOTOMY_SOFFICE' => $converter ?? $stub]);
    $process = proc_open([PHP_BINARY, $root . '/database/convert_previews.php', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    return [proc_close($process), $out, $err];
}
[$code, $out] = backfill($site, ['--dry-run']);
check($code === 0 && str_contains($out, 'made 0, skipped 1, failed 0') && str_contains($out, 'would make 3'), 'backfill --dry-run reports what it would do and makes nothing');
check(glob($site . '/*/*/*.preview.pdf') === [], 'a dry run creates no preview');
[$code, $out] = backfill($site);
check($code === 0 && str_contains($out, 'made 2, skipped 1, failed 1'), 'backfill makes the previews it can and counts the PDF as skipped and the bad deck as failed');
check(is_file(previewPath($site . '/uploads/lessons/a.pptx')) && is_file(previewPath($site . '/storage/files/b.docx')) && !is_file(previewPath($site . '/storage/files/d.pptx')), 'backfill made previews for the good decks only');
[$code, $out] = backfill($site);
check($code === 0 && str_contains($out, 'made 0, skipped 3, failed 1'), 'running backfill again makes nothing new (previews are not counted as files)');
[$code, , $err] = backfill($site, [], $tmp . '/missing.exe');
check($code === 1 && str_contains($err, 'No converter'), 'backfill with no converter exits 1 and says so');

previewRemoveTree($tmp);
echo "\nAll $passed checks passed.\n";
