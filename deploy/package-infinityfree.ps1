# Build what goes to InfinityFree (docs/deploy-infinityfree.md, step 4), in C:\xampp\anthropotomy-infinityfree\:
#   htdocs\            upload its contents to the htdocs folder on InfinityFree
#   anthropotomy.sql   import it with InfinityFree's phpMyAdmin
# htdocs\ holds only what the site needs: the committed app files (so docs, tests, sources and
# "demo users account.txt" never go), this PC's uploads and teacher files, and storage\db.ini with
# the InfinityFree database login. Run it with no arguments and it asks for each value.
# Both outputs hold private data (password hashes, the database password): delete the folder after uploading.
param(
    [Parameter(Mandatory, HelpMessage = 'MySQL Host Name, e.g. sql123.infinityfree.com')][string]$DbHost,
    [Parameter(Mandatory, HelpMessage = 'MySQL Database Name, e.g. if0_12345678_anthropotomy')][string]$DbName,
    [Parameter(Mandatory, HelpMessage = 'MySQL User Name, e.g. if0_12345678')][string]$DbUser,
    [Parameter(Mandatory, HelpMessage = 'MySQL Password (your hosting account password)')][string]$DbPass
)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$out = 'C:\xampp\anthropotomy-infinityfree'
$site = Join-Path $out 'htdocs'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
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
& C:\xampp\mysql\bin\mysqldump.exe -u root --single-transaction --skip-add-locks --no-tablespaces --default-character-set=utf8mb4 --result-file="$out\anthropotomy.sql" anthropotomy_db
if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed. Is MySQL running in XAMPP?' }

$files = Get-ChildItem -Recurse -File $site
$largest = $files | Sort-Object Length -Descending | Select-Object -First 1
"Ready in $out"
"  htdocs\: $($files.Count) files, $([math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)) MB (largest: $($largest.Name), $([math]::Round($largest.Length / 1MB, 1)) MB; InfinityFree allows 10 MB per file)"
"  anthropotomy.sql: $([math]::Round((Get-Item "$out\anthropotomy.sql").Length / 1KB)) KB"
