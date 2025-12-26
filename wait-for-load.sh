#!/bin/bash
# Wait for page to signal it's loaded

TIMEOUT=30
ELAPSED=0

echo "Waiting for page to load..."

while [ $ELAPSED -lt $TIMEOUT ]; do
  # Check console for [PAGE_LOADED] marker
  if node "$(dirname "$0")/browser-client.js" console 2>/dev/null | grep -q "\[PAGE_LOADED\]"; then
    echo "Page loaded after ${ELAPSED}s"
    exit 0
  fi

  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

echo "Timeout waiting for page load after ${TIMEOUT}s"
exit 1
