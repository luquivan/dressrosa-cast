#!/bin/bash
# Take a screenshot on Dressrosa and display it locally.
# Usage: ./scripts/screenshot.sh [output.png]
# Requires: ssh access to Dressrosa, imagemagick or eog locally

OUTPUT="${1:-/tmp/dressrosa-screen.png}"
REMOTE_PATH='C:\Windows\Temp\dressrosa-cast-screen.png'

echo "[screenshot] Requesting screenshot from Dressrosa..."

ssh -i ~/.ssh/id_ed25519 "Toronja Arenosa"@dressrosa "powershell -NoProfile -NonInteractive -Command \"\
Add-Type -AssemblyName System.Windows.Forms,System.Drawing;\
\$s=[System.Windows.Forms.Screen]::PrimaryScreen;\
\$b=New-Object System.Drawing.Bitmap(\$s.Bounds.Width,\$s.Bounds.Height);\
\$g=[System.Drawing.Graphics]::FromImage(\$b);\
\$g.CopyFromScreen(\$s.Bounds.Location,[System.Drawing.Point]::Empty,\$s.Bounds.Size);\
\$b.Save('$REMOTE_PATH');\$g.Dispose();\$b.Dispose();\
Write-Output 'OK'\""

echo "[screenshot] Downloading..."
scp -i ~/.ssh/id_ed25519 "Toronja Arenosa@dressrosa:$REMOTE_PATH" "$OUTPUT" 2>/dev/null

if [ -f "$OUTPUT" ]; then
    echo "[screenshot] Saved to $OUTPUT"
    # Display if running in X/Wayland
    if command -v eog &>/dev/null; then
        eog "$OUTPUT" &
    elif command -v feh &>/dev/null; then
        feh "$OUTPUT" &
    else
        echo "[screenshot] View with: xdg-open $OUTPUT"
    fi
else
    echo "[screenshot] Failed to download screenshot"
    exit 1
fi
