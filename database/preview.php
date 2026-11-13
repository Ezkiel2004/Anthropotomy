<?php
/**
 * Preview copies of PowerPoint and Word files.
 *
 * Uploading a .ppt, .pptx, .doc or .docx file also makes a PDF copy next to it (<file>.preview.pdf) with LibreOffice,
 * so students can read the file inside the system. A library, not an endpoint: loaded with require_once from the
 * API and the maintenance scripts (database/ is blocked from the web by the root .htaccess).
 *
 * Finding LibreOffice: ANTHROPOTOMY_SOFFICE, then `soffice=` in storage/db.ini, then the usual install paths.
 * The environment variable is exclusive: set to something that is not a file it means "no converter", so a host or a
 * test can switch previews off. A `soffice=` line that points at nothing is ignored and the usual paths are tried,
 * because storage/ travels between machines (an export from a Windows PC reaches a Linux server with its path in it).
 * When there is no converter, or the host disables proc_open, every function here still works and makePreview()
 * simply returns false.
 */

const PREVIEW_FORMATS = ['ppt', 'pptx', 'doc', 'docx'];
const PREVIEW_DEFAULT_TIMEOUT = 90;   // seconds; ANTHROPOTOMY_PREVIEW_TIMEOUT overrides it (used by tests)

function previewFormats(): array {
    return PREVIEW_FORMATS;
}

/** Where the preview of $original lives: its full file name plus .preview.pdf, so it never collides with a real PDF. */
function previewPath(string $original): string {
    return $original . '.preview.pdf';
}

function previewSupported(string $path): bool {
    return in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), PREVIEW_FORMATS, true);
}

/** Scratch space for conversions; every run gets its own folder inside it. */
function previewWorkRoot(): string {
    return dirname(__DIR__) . '/storage/preview-work';
}

function previewCanRun(): bool {
    if (!function_exists('proc_open')) return false;
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    return !in_array('proc_open', $disabled, true);
}

/** Path of the LibreOffice command, or null when previews cannot be made on this machine. $iniFile and $defaults are test seams. */
function previewConverter(?string $iniFile = null, ?array $defaults = null): ?string {
    if (!previewCanRun()) return null;
    $env = getenv('ANTHROPOTOMY_SOFFICE');
    if ($env !== false && trim($env) !== '') return is_file(trim($env)) ? trim($env) : null;
    $iniFile ??= dirname(__DIR__) . '/storage/db.ini';
    if (is_file($iniFile)) {
        $ini = parse_ini_file($iniFile, false, INI_SCANNER_RAW) ?: [];
        $configured = trim((string) ($ini['soffice'] ?? ''), " \t\"'");
        if ($configured !== '' && is_file($configured)) return $configured;
    }
    foreach ($defaults ?? [
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        '/usr/bin/soffice',
        '/usr/bin/libreoffice',
    ] as $candidate) {
        if (is_file($candidate)) return $candidate;
    }
    return null;
}

/** The access rule for the original file: teachers always; students only when there is no preview or downloads are on. */
function previewOriginalAllowed(bool $isTeacher, bool $hasPreview, bool $allowDownload): bool {
    return $isTeacher || !$hasPreview || $allowDownload;
}

function removePreview(string $original): void {
    $preview = previewPath($original);
    if (is_file($preview)) @unlink($preview);
}

/**
 * Makes previewPath($original) from the original with LibreOffice and returns whether a valid preview now exists.
 * Never throws. The converter runs on a copy inside its own work folder (its own profile, so two runs never block
 * each other) and is killed after the timeout (90 seconds unless a shorter one is given).
 */
function makePreview(string $original, ?int $timeoutSeconds = null): bool {
    $work = null;
    try {
        if (!previewSupported($original) || !is_file($original)) return false;
        $converter = previewConverter();
        if ($converter === null) return false;
        $timeout = $timeoutSeconds ?? ((int) getenv('ANTHROPOTOMY_PREVIEW_TIMEOUT') ?: PREVIEW_DEFAULT_TIMEOUT);

        $work = previewWorkRoot() . '/' . bin2hex(random_bytes(8));
        foreach (['', '/in', '/out', '/profile'] as $sub) {
            if (!is_dir($work . $sub) && !mkdir($work . $sub, 0755, true)) throw new RuntimeException('cannot create ' . $work . $sub);
        }
        // Paths handed to the converter use the platform's own separator (a mixed C:\...\x/out path breaks batch-file converters).
        $work = realpath($work) ?: $work;
        $sep = DIRECTORY_SEPARATOR;
        $outDir = $work . $sep . 'out';
        $input = $work . $sep . 'in' . $sep . 'input.' . strtolower(pathinfo($original, PATHINFO_EXTENSION));
        if (!copy($original, $input)) throw new RuntimeException('cannot copy the file into the work folder');
        $profileUrl = 'file:///' . ltrim(str_replace(' ', '%20', str_replace('\\', '/', $work . '/profile')), '/');

        $command = previewCommand($converter, $profileUrl, $outDir, $input, $timeout);
        $wrapped = $command[0] !== $converter;   // under `timeout`, which ends the run itself; our own deadline is only a backstop
        $process = proc_open(
            $command,
            [0 => ['pipe', 'r'], 1 => ['file', $work . '/stdout.txt', 'w'], 2 => ['file', $work . '/stderr.txt', 'w']],
            $pipes,
            $work
        );
        if (!is_resource($process)) throw new RuntimeException('cannot start the converter');
        fclose($pipes[0]);

        $deadline = microtime(true) + $timeout + ($wrapped ? 10 : 0);
        $timedOut = false;
        $exitCode = -1;
        while (true) {
            $status = proc_get_status($process);
            if (!$status['running']) { $exitCode = $status['exitcode']; break; }
            if (microtime(true) >= $deadline) { $timedOut = true; previewKill($process, (int) $status['pid']); break; }
            usleep(100000);
        }
        proc_close($process);
        if ($wrapped && in_array($exitCode, [124, 137], true)) $timedOut = true;   // timeout's own "ran too long" exit codes
        if ($timedOut) { error_log("preview: converter timed out after {$timeout}s for " . basename($original)); return false; }

        $produced = $outDir . $sep . 'input.pdf';
        if (!is_file($produced) || filesize($produced) < 5 || file_get_contents($produced, false, null, 0, 4) !== '%PDF') {
            error_log("preview: no valid PDF made for " . basename($original) . " (converter exit $exitCode)");
            return false;
        }
        $target = previewPath($original);
        $staging = $target . '.tmp' . bin2hex(random_bytes(3));
        if (!copy($produced, $staging)) throw new RuntimeException('cannot write ' . $staging);
        if (is_file($target)) @unlink($target);
        if (!rename($staging, $target)) { @unlink($staging); throw new RuntimeException('cannot place ' . $target); }
        return true;
    } catch (Throwable $error) {
        error_log('preview: ' . $error->getMessage());
        return false;
    } finally {
        if ($work !== null) previewRemoveTree($work);
    }
}

/**
 * The command line for one conversion. On Linux and macOS /usr/bin/soffice is a wrapper script that starts the real
 * program, so stopping only the process we started would leave that child running on the server: when a `timeout` command
 * exists the converter runs under it (it stops the whole process group, with a 5 second grace). On Windows previewKill
 * stops the process tree instead. $os and $timeoutBin are test seams.
 */
function previewCommand(string $converter, string $profileUrl, string $outDir, string $input, int $timeout, string $os = PHP_OS_FAMILY, ?string $timeoutBin = null): array {
    $command = [$converter, '--headless', '--norestore', '-env:UserInstallation=' . $profileUrl, '--convert-to', 'pdf', '--outdir', $outDir, $input];
    if ($os === 'Windows') return $command;
    foreach ($timeoutBin !== null ? [$timeoutBin] : ['/usr/bin/timeout', '/bin/timeout'] as $candidate) {
        if (is_file($candidate)) return [$candidate, '--kill-after=5', (string) $timeout, ...$command];
    }
    return $command;
}

function previewKill($process, int $pid): void {
    if (PHP_OS_FAMILY === 'Windows' && $pid > 0) @exec('taskkill /F /T /PID ' . $pid . ' 2>&1');   // the whole tree: the converter starts child processes
    @proc_terminate($process);
}

/** Deletes a work folder. A just-killed process can hold a file for a moment, so it retries briefly. */
function previewRemoveTree(string $dir): void {
    for ($attempt = 0; $attempt < 20 && is_dir($dir); $attempt++) {
        $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($items as $item) { $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname()); }
        @rmdir($dir);
        if (is_dir($dir)) usleep(150000);
    }
}
