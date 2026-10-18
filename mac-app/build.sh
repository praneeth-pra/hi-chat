#!/bin/bash
# Builds Hi-chat.app and Hi-chat.dmg into mac-app/build (needs a Mac with
# the Xcode Command Line Tools). GitHub Actions runs this on every change.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${VERSION:-1.0.0}"
OUT=build
APP="$OUT/Hi-chat.app"
rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for arch in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$arch-apple-macos14.0" HiChat.swift -o "$OUT/HiChat-$arch"
  swiftc -O -parse-as-library -target "$arch-apple-macos14.0" \
    ../scripts/hammerspoon/JanMirror.swift -o "$OUT/HiChatMirror-$arch"
done
lipo -create -output "$APP/Contents/MacOS/HiChat" "$OUT"/HiChat-arm64 "$OUT"/HiChat-x86_64
lipo -create -output "$APP/Contents/MacOS/HiChatMirror" "$OUT"/HiChatMirror-arm64 "$OUT"/HiChatMirror-x86_64
sed "s/__VERSION__/$VERSION/g" Info.plist > "$APP/Contents/Info.plist"
# App icon: every size macOS wants, from the 1024 px AppIcon.png
ICONSET="$OUT/AppIcon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size AppIcon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) AppIcon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
# Ad-hoc signed, with a requirement that names only the app's identifier, so
# macOS can keep the Accessibility and microphone permissions across updates.
codesign --force --sign - --identifier dev.hitechie.hichat.mirror \
  --requirements '=designated => identifier "dev.hitechie.hichat.mirror"' "$APP/Contents/MacOS/HiChatMirror"
codesign --force --sign - --identifier dev.hitechie.hichat \
  --requirements '=designated => identifier "dev.hitechie.hichat"' "$APP"
codesign --verify --verbose "$APP"
mkdir "$OUT/dmg"
cp -R "$APP" "$OUT/dmg/"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname Hi-chat -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/Hi-chat.dmg"
echo "Built $OUT/Hi-chat.dmg ($VERSION)"
