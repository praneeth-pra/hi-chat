#!/bin/sh
# Runs the transcription relay in the background, restarting it if it exits.
(
  while true; do
    node /relay/server.mjs
    echo "transcription relay exited; restarting" >&2
    sleep 1
  done
) &
