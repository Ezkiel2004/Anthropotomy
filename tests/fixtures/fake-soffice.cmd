@echo off
rem Stand-in for LibreOffice's soffice in tests. Same arguments: ... --outdir <dir> ... <input>
rem   input contains FAIL-CONVERT -> exit 1, no output
rem   input contains HANG-CONVERT -> keep running (holding the output folder open) until killed
rem   input contains PROBE-ROWS  -> first write the number of "Probe deck" materials in the test database to %TEMP%\anthropotomy-probe.txt
rem                                 (see probe-rows.php), then convert as below
rem   anything else               -> write <input name>.pdf into <dir> (a copy of sample.pdf)
setlocal
rem shift also shifts %0, so keep this script's folder before the argument loop
set "HERE=%~dp0"
set "OUT="
set "IN="
:loop
if "%~1"=="" goto done
if /I "%~1"=="--outdir" (
  set "OUT=%~2"
  shift
  shift
  goto loop
)
set "IN=%~1"
shift
goto loop
:done
findstr /C:"FAIL-CONVERT" "%IN%" >nul && exit /b 1
findstr /C:"HANG-CONVERT" "%IN%" >nul && (
  cd /d "%OUT%"
  ping -n 300 127.0.0.1 >nul
  exit /b 0
)
findstr /C:"PROBE-ROWS" "%IN%" >nul && php "%HERE%probe-rows.php" > "%TEMP%\anthropotomy-probe.txt"
for %%F in ("%IN%") do set "BASE=%%~nF"
copy /Y "%HERE%sample.pdf" "%OUT%\%BASE%.pdf" >nul
exit /b 0
