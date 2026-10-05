#!/bin/sh
# Compile the Icon Composer document (src-tauri/TermInk.icon) with Apple's actool.
# Produces the Liquid Glass asset catalog (light, dark, tinted) for macOS 26+, plus
# Apple's own flattened .icns fallback (up to 256px), then the PNG sizes from it.
# Requires Xcode 26. Edit the icon in Icon Composer, then run: sh tools/build_icon.sh
set -e
cd "$(dirname "$0")/.."
out=$(mktemp -d)
xcrun actool src-tauri/TermInk.icon --compile "$out" --platform macosx \
  --minimum-deployment-target 11.0 --app-icon TermInk \
  --output-partial-info-plist "$out/partial.plist" >/dev/null
cp "$out/Assets.car" src-tauri/icons/Assets.car
cp "$out/TermInk.icns" src-tauri/icons/icon.icns
iconutil -c iconset -o "$out/TermInk.iconset" "$out/TermInk.icns"
pnpm -s tauri icon "$out/TermInk.iconset/icon_128x128@2x.png" -o "$out/gen" >/dev/null 2>&1
for f in 32x32.png 64x64.png 128x128.png 128x128@2x.png icon.png; do cp "$out/gen/$f" src-tauri/icons/; done
rm -rf "$out"
echo "icons updated"
