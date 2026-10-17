#!/bin/sh
# One-time setup on the Mac. After this, jan-remote.lua updates itself:
# Hammerspoon loads it straight from a clone of the repo and pulls main
# every minute, rebuilding the mirror helper when it changes.
#
#   sh scripts/hammerspoon/install.sh        (from a clone of the repo)
#
# Set HI_CHAT_DIR to keep the clone somewhere other than ~/hi-chat.
set -e

REPO="${HI_CHAT_DIR:-$HOME/hi-chat}"
URL="https://github.com/praneeth-pra/hi-chat.git"
SCRIPT="$REPO/scripts/hammerspoon/jan-remote.lua"
INIT="$HOME/.hammerspoon/init.lua"
LINE="dofile(\"$SCRIPT\") -- Jan remote, auto-updated from the hi-chat repo"

if [ ! -d "$REPO/.git" ]; then
  echo "Cloning the repo to $REPO"
  git clone -q "$URL" "$REPO"
fi
git -C "$REPO" checkout -q main
git -C "$REPO" pull -q --ff-only origin main

mkdir -p "$HOME/.hammerspoon"
echo "Building the mirror helper"
/usr/bin/swiftc -O -parse-as-library "$REPO/scripts/hammerspoon/JanMirror.swift" \
  -o "$HOME/.hammerspoon/JanMirror"
pkill -x JanMirror 2>/dev/null || true

# Point Hammerspoon at the repo's script. A pasted copy of the script is
# replaced by the one line; any other config is kept, with the line added.
if [ -f "$INIT" ] && grep -qF "$LINE" "$INIT"; then
  echo "Hammerspoon already loads the repo's script"
else
  if [ -f "$INIT" ]; then
    cp "$INIT" "$INIT.before-auto-update"
    echo "Saved your old config as $INIT.before-auto-update"
  fi
  if [ -f "$INIT" ] && grep -q "Jan remote for Hammerspoon" "$INIT"; then
    printf '%s\n' "$LINE" > "$INIT"
  else
    # Any older line loading jan-remote.lua from elsewhere is switched off,
    # so the script never runs twice
    [ -f "$INIT" ] && sed -i '' '/jan-remote\.lua/s/^/-- (replaced by auto-update) /' "$INIT"
    printf '\n%s\n' "$LINE" >> "$INIT"
  fi
fi

# Restart Hammerspoon so it loads the new config
osascript -e 'quit app "Hammerspoon"' 2>/dev/null || true
sleep 1
open -a Hammerspoon
echo "Done. Hammerspoon now loads $SCRIPT and updates it by itself."
