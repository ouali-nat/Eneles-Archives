#!/bin/sh
# Installs the TeXeR IMP helper as a systemd --user service that starts at
# login. Only needed for snap/flatpak LibreOffice. Run from the folder that
# contains TeXeR-IMP-helper.pyz (release/) or from impress/helper/ after a build.
#
#   sh install-helper.sh            install + start
#   sh install-helper.sh --remove   stop + uninstall
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
DEST="$HOME/.local/share/texer-imp"
UNIT_DIR="$HOME/.config/systemd/user"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now texer-imp-helper.service 2>/dev/null || true
  rm -f "$UNIT_DIR/texer-imp-helper.service"
  rm -rf "$DEST"
  systemctl --user daemon-reload
  echo "TeXeR IMP helper removed."
  exit 0
fi

PYZ=""
for c in "$HERE/TeXeR-IMP-helper.pyz" "$HERE/../release/TeXeR-IMP-helper.pyz"; do
  [ -f "$c" ] && PYZ="$c" && break
done
[ -n "$PYZ" ] || { echo "TeXeR-IMP-helper.pyz not found next to this script (run scripts/build.py first)." >&2; exit 1; }

UNIT=""
for c in "$HERE/texer-imp-helper.service" "$HERE/../helper/texer-imp-helper.service"; do
  [ -f "$c" ] && UNIT="$c" && break
done
[ -n "$UNIT" ] || { echo "texer-imp-helper.service not found." >&2; exit 1; }

mkdir -p "$DEST" "$UNIT_DIR"
cp "$PYZ" "$DEST/TeXeR-IMP-helper.pyz"
cp "$UNIT" "$UNIT_DIR/texer-imp-helper.service"

sh -lc "python3 '$DEST/TeXeR-IMP-helper.pyz' --check" || echo "Warning: the helper can't see a TeX engine yet."

systemctl --user daemon-reload
systemctl --user enable --now texer-imp-helper.service
echo "TeXeR IMP helper installed and running on http://127.0.0.1:47823 (starts at login)."
