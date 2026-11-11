# Build what goes to InfinityFree (docs/deploy-infinityfree.md, step 4), in C:\xampp\anthropotomy-infinityfree\:
#   htdocs\            upload its contents to the htdocs folder on InfinityFree
#   anthropotomy.sql   import it with InfinityFree's phpMyAdmin
# htdocs\ holds only what the site needs: the committed app files (so docs, tests, sources and
# "demo users account.txt" never go), this PC's uploads and teacher files, and storage\db.ini with
# the InfinityFree database login. Run it with no arguments and it asks for each value.
# Both outputs hold private data (password hashes, the database password): delete the folder after uploading.
# It stops while the demo content (database/seed_demo.php) is in the database. It exports the database
# named by ANTHROPOTOMY_DB_NAME when that is set (as the app does), otherwise anthropotomy_db;
# -OutDir builds somewhere else. The folder is emptied first, so it must be new, empty or an earlier
# package: one holding only htdocs\, anthropotomy.sql and app.tar, the names this script writes.
param(
    [Parameter(Mandatory, HelpMessage = 'MySQL Host Name, e.g. sql123.infinityfree.com')][string]$DbHost,
    [Parameter(Mandatory, HelpMessage = 'MySQL Database Name, e.g. if0_12345678_anthropotomy')][string]$DbName,
    [Parameter(Mandatory, HelpMessage = 'MySQL User Name, e.g. if0_12345678')][string]$DbUser,
    [Parameter(Mandatory, HelpMessage = 'MySQL Password (your hosting account password)')][string]$DbPass,
    [string]$OutDir = 'C:\xampp\anthropotomy-infinityfree'
)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$database = if ($env:ANTHROPOTOMY_DB_NAME) { $env:ANTHROPOTOMY_DB_NAME } else { 'anthropotomy_db' }

# 0. Demo content is for design reviews only and must never reach hosting.
$demo = & C:\xampp\mysql\bin\mysql.exe -u root -N -B -e "SELECT 1 FROM app_settings WHERE setting_key = 'demo_seed'" $database
if ($LASTEXITCODE -ne 0) { throw 'Could not read the database. Is MySQL running in XAMPP?' }
if ($demo) { throw 'Demo content is still in the database. Run php database/seed_demo.php --remove first.' }

$out = $OutDir
$site = Join-Path $out 'htdocs'
if (Test-Path -LiteralPath $out) {
    $foreign = @(Get-ChildItem -Force -LiteralPath $out | Where-Object { $_.Name -notin 'htdocs', 'anthropotomy.sql', 'app.tar' })
    if ($foreign.Count) { throw "$out holds files this script did not make (for example $($foreign[0].Name)), so it will not empty it. Pick a new or empty folder for -OutDir." }
    Remove-Item -Recurse -Force -LiteralPath $out
}
New-Item -ItemType Directory -Force $site | Out-Null

# 1. App files, exactly as committed
$tar = Join-Path $out 'app.tar'
git -C $app archive --format=tar -o $tar HEAD -- .htaccess index.html login.html favicon.ico manifest.json api assets student teacher system_model database/connection.php
if ($LASTEXITCODE -ne 0) { throw 'git archive failed.' }
tar -xf $tar -C $site
Remove-Item $tar

# 2. People's files from this PC: photos, lesson media, teacher files and mail settings
Copy-Item -Recurse (Join-Path $app 'uploads') $site
Copy-Item -Recurse (Join-Path $app 'storage') $site
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $site 'storage\db.ini')

# 3. Database login for the host (storage\ is never served: storage\.htaccess denies it)
@"
; InfinityFree database login, read by database/connection.php
host = "$DbHost"
name = "$DbName"
user = "$DbUser"
pass = "$DbPass"
"@ | Set-Content -Encoding ascii (Join-Path $site 'storage\db.ini')

# 4. Database, without LOCK TABLES (shared hosting does not allow it)
& C:\xampp\mysql\bin\mysqldump.exe -u root --single-transaction --skip-add-locks --no-tablespaces --default-character-set=utf8mb4 --result-file="$out\anthropotomy.sql" $database
if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed. Is MySQL running in XAMPP?' }

$files = Get-ChildItem -Recurse -File $site
$largest = $files | Sort-Object Length -Descending | Select-Object -First 1
"Ready in $out"
"  htdocs\: $($files.Count) files, $([math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)) MB (largest: $($largest.Name), $([math]::Round($largest.Length / 1MB, 1)) MB; InfinityFree allows 10 MB per file)"
"  anthropotomy.sql: $([math]::Round((Get-Item "$out\anthropotomy.sql").Length / 1KB)) KB"
