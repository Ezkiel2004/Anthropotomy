# Export this PC's Anthropotomy data for the Oracle server (docs/deploy-oracle.md, step 5):
# the database, and the files people uploaded (photos, lesson media, teacher files, mail settings).
# Writes to C:\xampp\anthropotomy-export\, outside the web folder. MySQL must be running in XAMPP.
# The export holds password hashes and student records: copy it to the server, then delete it.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
$out = 'C:\xampp\anthropotomy-export'
New-Item -ItemType Directory -Force $out | Out-Null

& C:\xampp\mysql\bin\mysqldump.exe -u root --single-transaction --default-character-set=utf8mb4 --result-file="$out\anthropotomy.sql" anthropotomy_db
if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed. Is MySQL running in XAMPP?' }

# tar (built into Windows 10 and 11) keeps forward-slash paths that Linux unpacks as they are.
tar -czf "$out\anthropotomy-files.tar.gz" -C $app uploads storage
if ($LASTEXITCODE -ne 0) { throw 'Packing uploads and storage failed.' }

Get-ChildItem $out | Select-Object Name, @{ n = 'Size (MB)'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
"Export ready in $out"
