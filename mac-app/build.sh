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
done
lipo -create -output "$APP/Contents/MacOS/HiChat" "$OUT"/HiChat-arm64 "$OUT"/HiChat-x86_64
sed "s/__VERSION__/$VERSION/g" Info.plist > "$APP/Contents/Info.plist"
# Ad-hoc signed, with a requirement that names only the app's identifier, so
# macOS can keep the Accessibility and microphone permissions across updates.
codesign --force --sign - --identifier dev.hitechie.hichat \
  --requirements '=designated => identifier "dev.hitechie.hichat"' "$APP"
codesign --verify --verbose "$APP"
mkdir "$OUT/dmg"
cp -R "$APP" "$OUT/dmg/"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname Hi-chat -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/Hi-chat.dmg"
echo "Built $OUT/Hi-chat.dmg ($VERSION)"
