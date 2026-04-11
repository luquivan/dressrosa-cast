#!/bin/bash
# Take a screenshot of Dressrosa's screen via the receiver's HTTP endpoint.
# The receiver runs in Session 1 (user's desktop session), so this works.
# Usage: ./scripts/screenshot.sh [output.png]

OUTPUT="${1:-/tmp/dressrosa-screen.png}"
CONTROL_BASE="${DRESSROSA_CONTROL_BASE:-http://100.83.60.48:8010}"
SCREENSHOT_URL="${CONTROL_BASE}/screenshot"

echo "[screenshot] Fetching screenshot from Dressrosa..."
curl -fsS --max-time 15 "$SCREENSHOT_URL" -o "$OUTPUT"

if [ -s "$OUTPUT" ]; then
    echo "[screenshot] Saved to $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
    # Display
    if command -v eog &>/dev/null; then
        eog "$OUTPUT" &
    elif command -v feh &>/dev/null; then
        feh "$OUTPUT" &
    else
        xdg-open "$OUTPUT" 2>/dev/null &
    fi
else
    echo "[screenshot] Failed — is dressrosa-cast running in the desktop session?"
    exit 1
fi
