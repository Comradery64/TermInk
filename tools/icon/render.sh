#!/bin/sh
# Render tools/icon/icon.html to full-bleed 1024px PNGs (plain and bezel) with headless Chrome.
set -e
cd "$(dirname "$0")"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for v in plain bezel; do
  q=""; [ $v = bezel ] && q="?bezel=1"
  "$chrome" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --default-background-color=00000000 --window-size=1024,1024 --virtual-time-budget=2000 \
    --screenshot="$PWD/icon-$v.png" "file://$PWD/icon.html$q" >/dev/null 2>&1
done
echo "rendered icon-plain.png icon-bezel.png"
