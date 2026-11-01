#!/bin/sh
# Container supervisor, run under tini (PID 1) by the Dockerfile:
#   ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "/usr/local/bin/supervise.sh"]
#   CMD ["nginx", "-g", "daemon off;"]
#
# - Starts the transcription relay (node /relay/server.mjs) and restarts it
#   when it exits, backing off 1s, 2s, 4s ... up to 30s. The backoff resets
#   once a run has stayed up for 60s. Every restart is logged with a count.
# - Starts nginx through the official image's /docker-entrypoint.sh, so the
#   templates in /etc/nginx/templates are still rendered with envsubst ($PORT).
# - Forwards SIGTERM/SIGINT to both (SIGQUIT goes to nginx as a graceful
#   stop; the relay gets SIGTERM), and exits with nginx's status when nginx
#   exits, stopping the relay first.
#
# RELAY_CMD and NGINX_ENTRYPOINT can be overridden (used by the tests).
set -u

RELAY_CMD=${RELAY_CMD:-node /relay/server.mjs}
NGINX_ENTRYPOINT=${NGINX_ENTRYPOINT:-/docker-entrypoint.sh}
RELAY_MAX_DELAY=30
RELAY_STABLE_SECS=60

log() { echo "supervise: $*" >&2; }

# Waits for a pid, retrying when a trapped signal interrupts `wait`.
# Sets $status to the child's exit status.
wait_for() {
  status=0
  wait "$1"; status=$?
  while kill -0 "$1" 2>/dev/null; do
    wait "$1"; status=$?
  done
}

relay_loop() {
  stopping=0
  child=
  trap 'stopping=1; [ -n "$child" ] && kill -TERM "$child" 2>/dev/null' TERM
  restarts=0
  delay=1
  while [ "$stopping" = 0 ]; do
    started=$(date +%s)
    $RELAY_CMD &
    child=$!
    wait_for "$child"
    child=
    [ "$stopping" = 1 ] && break
    up=$(( $(date +%s) - started ))
    [ "$up" -ge "$RELAY_STABLE_SECS" ] && delay=1
    restarts=$((restarts + 1))
    log "relay exited (status $status) after ${up}s; restart #$restarts in ${delay}s"
    sleep "$delay" &
    child=$!
    wait_for "$child"
    child=
    delay=$((delay * 2))
    [ "$delay" -gt "$RELAY_MAX_DELAY" ] && delay=$RELAY_MAX_DELAY
  done
  exit 0
}

relay_loop &
relay_pid=$!

"$NGINX_ENTRYPOINT" "$@" &
nginx_pid=$!

# Background jobs start with SIGINT/SIGQUIT ignored, so shells (the relay
# loop, the entrypoint before it execs nginx) can't act on them: send SIGTERM
# instead, except SIGQUIT to nginx itself, which it handles as a graceful stop.
forward() {
  log "received SIG$1; stopping nginx and relay"
  kill "-$2" "$nginx_pid" 2>/dev/null
  kill -TERM "$relay_pid" 2>/dev/null
}
trap 'forward TERM TERM' TERM
trap 'forward INT TERM' INT
trap 'forward QUIT QUIT' QUIT

wait_for "$nginx_pid"
nginx_status=$status
log "nginx exited (status $nginx_status); stopping relay"
kill -TERM "$relay_pid" 2>/dev/null
wait_for "$relay_pid"
exit "$nginx_status"
