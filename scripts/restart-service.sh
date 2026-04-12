#!/bin/bash
# Restart the dressrosa-cast receiver on Dressrosa from Skypiea.
# Uses PsExec to launch node in Session 1 (interactive desktop) with log redirection.
# Usage: ./scripts/restart-service.sh

SSH_KEY="${HOME}/.ssh/id_ed25519"
HOST="Toronja Arenosa"@dressrosa
PSEXEC="C:\\Windows\\Temp\\PsExec64.exe"
NODE="C:\\nvm4w\\nodejs\\node.exe"
SCRIPT="C:\\Users\\Toronja Arenosa\\Projects\\dressrosa-cast\\src\\index.js"
LOG="C:\\Users\\Toronja Arenosa\\AppData\\Local\\DressrosaCast\\dressrosa-cast.log"
ERR="C:\\Users\\Toronja Arenosa\\AppData\\Local\\DressrosaCast\\dressrosa-cast.err"

echo "[restart] Stopping existing node processes..."
ssh -i "$SSH_KEY" "$HOST" "powershell -Command \"Stop-Process -Name node -Force -ErrorAction SilentlyContinue\"" 2>&1

echo "[restart] Starting node in Session 1 via launch.cmd..."
# Launch via the VBS → CMD wrapper so stdout/stderr are redirected to log files
ssh -i "$SSH_KEY" "$HOST" "\"${PSEXEC}\" -accepteula -i 1 -d wscript.exe \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Dressrosa Cast.vbs\"" 2>&1 || {
    echo "[restart] VBS launch failed, trying direct node launch..."
    ssh -i "$SSH_KEY" "$HOST" "\"${PSEXEC}\" -accepteula -i 1 -d \"${NODE}\" \"${SCRIPT}\"" 2>&1
}

echo "[restart] Waiting for startup..."
sleep 5

echo "[restart] Checking health..."
RESULT=$(curl -s --max-time 10 "http://100.83.60.48:8010/health")
if [ -n "$RESULT" ]; then
    echo "[restart] OK: $RESULT"
else
    echo "[restart] FAILED — not responding on port 8010"
    exit 1
fi
