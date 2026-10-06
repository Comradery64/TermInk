#!/bin/sh
# Render tools/icon/icon.html with headless Chrome: full-bleed 1024px art for Icon Composer
# (icon-plain.png, icon-bezel.png), and masked dock icons for each variant and panel mode,
# which the app swaps in at runtime (src-tauri/icons/dock/).
set -e
cd "$(dirname "$0")"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
dock=../../src-tauri/icons/dock
mkdir -p "$dock"
shot() {
  "$chrome" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --default-background-color=00000000 --window-size=1024,1024 --virtual-time-budget=2000 \
    --screenshot="$1" "file://$PWD/icon.html$2" >/dev/null 2>&1
}
for v in plain bezel; do
  b=""; [ $v = bezel ] && b="bezel=1&"
  shot "$PWD/icon-$v.png" "?$b"
  for m in eink kaleido; do
    shot /tmp/termink-icon.png "?${b}mode=$m"
    # macOS grid: 824px rounded square centred on a 1024 canvas, with a soft drop shadow
    magick /tmp/termink-icon.png -resize 824x824 \
      \( -size 824x824 xc:none -fill white -draw "roundrectangle 0,0 823,823 185,185" \) -compose DstIn -composite \
      \( +clone -background black -shadow 35x10+0+10 \) +swap -background none -compose Over -layers merge +repage \
      -gravity center -background none -extent 1024x1024 -resize 512x512 "$dock/$v-$m.png"
  done
done
echo "rendered"
