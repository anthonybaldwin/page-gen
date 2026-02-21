#!/bin/sh
# Restart-on-crash wrapper for bun --watch in dev containers.
# Gives up after MAX_CRASHES rapid failures. Resets the counter
# if the server stays up longer than STABLE_SECS.

MAX_CRASHES=5
STABLE_SECS=10
crashes=0

while true; do
  start=$(date +%s)
  bun --watch src/server/index.ts
  elapsed=$(( $(date +%s) - start ))

  if [ "$elapsed" -ge "$STABLE_SECS" ]; then
    crashes=0
  else
    crashes=$(( crashes + 1 ))
  fi

  if [ "$crashes" -ge "$MAX_CRASHES" ]; then
    echo "[dev] server crashed $MAX_CRASHES times in a row — giving up"
    exit 1
  fi

  echo "[dev] server exited (crash $crashes/$MAX_CRASHES), restarting in 2s..."
  sleep 2
done
