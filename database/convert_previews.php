<?php
/**
 * Makes the PDF previews of PowerPoint and Word files that were uploaded before previews existed, or while no converter was
 * installed (see database/preview.php). Safe to run again: a file that already has a preview is left alone.
 *
 *   php database/convert_previews.php             convert every lesson file and material that has no preview
 *   php database/convert_previews.php --dry-run   only say what would be converted
 *
 * Prints "made N, skipped N, failed N". Skipped files are the ones with a preview already and those that are not PowerPoint or
 * Word files; preview PDFs themselves are not counted. Exits 1 when no converter is found, 0 otherwise (a file that cannot be
 * converted counts as failed and does not stop the run). ANTHROPOTOMY_PREVIEW_ROOT replaces the project folder (used by tests).
 */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/preview.php';

$root = rtrim(getenv('ANTHROPOTOMY_PREVIEW_ROOT') ?: dirname(__DIR__), '/\\');
$dryRun = in_array('--dry-run', $argv, true);
if (previewConverter() === null) {
    fwrite(STDERR, "No converter found. Install LibreOffice, or set ANTHROPOTOMY_SOFFICE or soffice= in storage/db.ini.\n");
    exit(1);
}

$made = $skipped = $failed = $pending = 0;
foreach (['uploads/lessons', 'storage/files'] as $folder) {
    foreach (glob($root . '/' . $folder . '/*') ?: [] as $file) {
        if (!is_file($file) || str_ends_with($file, '.preview.pdf')) continue;
        if (!previewSupported($file) || is_file(previewPath($file))) { $skipped++; continue; }
        if ($dryRun) { echo "would convert: $folder/" . basename($file) . "\n"; $pending++; continue; }
        if (makePreview($file)) { $made++; echo "made: $folder/" . basename($file) . "\n"; }
        else { $failed++; echo "failed: $folder/" . basename($file) . "\n"; }
    }
}
if ($dryRun) echo "dry run: would make $pending preview" . ($pending === 1 ? '' : 's') . "\n";
echo "made $made, skipped $skipped, failed $failed\n";
