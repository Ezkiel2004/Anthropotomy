#!/bin/sh
# Stand-in for LibreOffice's soffice in tests (Linux/macOS twin of fake-soffice.cmd; not run on the Windows dev PC).
#   input contains FAIL-CONVERT -> exit 1, no output
#   input contains HANG-CONVERT -> keep running (holding the output folder open) until killed
#   input contains PROBE-ROWS  -> first write the number of "Probe deck" materials in the test database to ${TMPDIR:-/tmp}/anthropotomy-probe.txt
#                                 (see probe-rows.php), then convert as below
#   anything else               -> write <input name>.pdf into the --outdir folder (a copy of sample.pdf)
out=""; in=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--outdir" ]; then out="$2"; shift 2; else in="$1"; shift; fi
done
grep -q "FAIL-CONVERT" "$in" && exit 1
if grep -q "HANG-CONVERT" "$in"; then cd "$out" && sleep 300; exit 0; fi
grep -q "PROBE-ROWS" "$in" && php "$(dirname "$0")/probe-rows.php" > "${TMPDIR:-/tmp}/anthropotomy-probe.txt"
base=$(basename "$in"); base="${base%.*}"
cp "$(dirname "$0")/sample.pdf" "$out/$base.pdf"
