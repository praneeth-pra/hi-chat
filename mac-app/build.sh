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
    HiChatMirror.swift -o "$OUT/HiChatMirror-$arch"
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
# Signed with Hi-chat's own certificate when the release build has it (the
# HICHAT_SIGNING secret, see .github/workflows/mac-app.yml), and the
# requirement names that certificate: macOS keeps Accessibility, Screen
# Recording and the microphone across updates, and no other program can claim
# them by taking Hi-chat's name. Without it (a local build) it is ad-hoc signed.
CERT=682B9625A09A73286A019832714DCD49A6F2E034
if [ -n "${HICHAT_SIGNING:-}" ]; then
  KEYS=$(mktemp -d)
  echo "$HICHAT_SIGNING" | base64 --decode | tar -xzf - -C "$KEYS"
  KEYCHAIN="$KEYS/signing.keychain-db"
  KEYPASS=$(openssl rand -hex 16)
  security create-keychain -p "$KEYPASS" "$KEYCHAIN"
  security set-keychain-settings "$KEYCHAIN"
  security unlock-keychain -p "$KEYPASS" "$KEYCHAIN"
  security import "$KEYS/mac.p12" -k "$KEYCHAIN" -P "$(cat "$KEYS/p12pass")" -T /usr/bin/codesign
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYPASS" "$KEYCHAIN" >/dev/null
  security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | tr -d '"')
  SIGN=(--sign "$CERT" --keychain "$KEYCHAIN")
  PIN=" and certificate leaf = H\"$CERT\""
else
  SIGN=(--sign -)
  PIN=""
fi
codesign --force "${SIGN[@]}" --identifier dev.hitechie.hichat.mirror \
  --requirements "=designated => identifier \"dev.hitechie.hichat.mirror\"$PIN" "$APP/Contents/MacOS/HiChatMirror"
codesign --force "${SIGN[@]}" --identifier dev.hitechie.hichat \
  --requirements "=designated => identifier \"dev.hitechie.hichat\"$PIN" "$APP"
if [ -n "${KEYS:-}" ]; then
  codesign --verify --deep --strict -R="identifier \"dev.hitechie.hichat\"$PIN" "$APP"
  security delete-keychain "$KEYCHAIN"
  rm -rf "$KEYS"
fi
codesign --verify --verbose "$APP"
mkdir "$OUT/dmg"
cp -R "$APP" "$OUT/dmg/"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname Hi-chat -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/Hi-chat.dmg"
echo "Built $OUT/Hi-chat.dmg ($VERSION)"
