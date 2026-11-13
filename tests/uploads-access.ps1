# Checks that Apache refuses direct requests for PowerPoint and Word lesson files and their PDF previews, and still serves
# everything else in uploads/lessons/. It must run against the XAMPP Apache site (the PHP test server ignores .htaccess).
#   powershell -File tests/uploads-access.ps1 [-Base http://localhost/Anthropotomy]
param([string]$Base = 'http://localhost/Anthropotomy')
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'uploads\lessons'
New-Item -ItemType Directory -Force $dir | Out-Null
# @(name, expected status). The four Office extensions (also in capitals, which has its own file name because Windows
# treats .pptx and .PPTX as one file) and the preview copy are refused; other files are served.
$expect = @(
    @('zz-access-check.pptx', 403), @('zz-access-check.ppt', 403), @('zz-access-check.docx', 403), @('zz-access-check.doc', 403),
    @('zz-access-capitals.PPTX', 403), @('zz-access-check.pptx.preview.pdf', 403),
    @('zz-access-check.pdf', 200), @('zz-access-check.png', 200), @('zz-access-check.mp4', 200)
)
$failed = 0
try {
    foreach ($case in $expect) { Set-Content -Path (Join-Path $dir $case[0]) -Value 'access check' -Encoding ascii }
    foreach ($case in $expect) {
        $name = $case[0]
        try { $status = [int](Invoke-WebRequest -Uri "$Base/uploads/lessons/$name" -UseBasicParsing -Method Get).StatusCode }
        catch { $status = [int]$_.Exception.Response.StatusCode.value__ }
        $good = $status -eq $case[1]
        if (-not $good) { $failed++ }
        '{0,-5} {1,-36} expected {2}, got {3}' -f ($(if ($good) { 'ok' } else { 'FAIL' })), $name, $case[1], $status
    }
} finally {
    foreach ($case in $expect) { Remove-Item -LiteralPath (Join-Path $dir $case[0]) -Force -ErrorAction SilentlyContinue }
}
if ($failed) { Write-Error "$failed direct-link check(s) failed."; exit 1 }
'All direct-link checks passed.'
