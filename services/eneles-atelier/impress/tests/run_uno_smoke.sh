#!/bin/sh
# Runs the UNO tests under LibreOffice's own Python.
#
#   sh tests/run_uno_smoke.sh          insert path   (tests/uno_smoke.py)
#   sh tests/run_uno_smoke.sh dialog   full window    (tests/uno_dialog_smoke.py; build first)
#
# - Snap LibreOffice: starts the helper on the host (the snap can't see TeX),
#   then runs the test inside the snap, compiling through the helper.
#   That exercises exactly the path a snap user gets.
# - Otherwise: set SOFFICE_PYTHON to a python that can `import uno` and
#   LO_PROGRAM to LibreOffice's program/ folder.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
TEST="$HERE/uno_smoke.py"
[ "${1:-}" = "dialog" ] && TEST="$HERE/uno_dialog_smoke.py"

if command -v snap >/dev/null 2>&1 && snap list libreoffice >/dev/null 2>&1 && [ -z "${SOFFICE_PYTHON:-}" ]; then
  PORT=${TEXER_IMP_PORT:-47823}
  STARTED=""
  if ! python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/health', timeout=1)" 2>/dev/null; then
    python3 "$HERE/../helper/texer_imp_helper.py" --port "$PORT" >/dev/null 2>&1 &
    STARTED=$!
    sleep 1
  fi
  trap '[ -n "$STARTED" ] && kill $STARTED 2>/dev/null || true' EXIT
  snap run --shell libreoffice -c "
    export LO_PROGRAM=\$SNAP/lib/libreoffice/program
    export PYTHONPATH=\$LO_PROGRAM
    export URE_BOOTSTRAP=vnd.sun.star.pathname:\$LO_PROGRAM/fundamentalrc
    export SOFFICE=\$LO_PROGRAM/soffice
    export TEXER_HELPER_URL=http://127.0.0.1:$PORT
    python3 "${TEST_OVERRIDE:-$TEST}"
  "
else
  ${SOFFICE_PYTHON:-python3} "$TEST"
fi
