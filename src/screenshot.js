'use strict';
/**
 * Screenshot utility for Dressrosa.
 * Captures the primary screen and saves to a temp file accessible via SSH.
 * Uses PowerShell (no extra dependencies needed).
 */
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const SCREENSHOT_PATH = path.join(os.tmpdir(), 'dressrosa-cast-screen.png');

function takeScreenshot() {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bmp.Save('${SCREENSHOT_PATH.replace(/\\/g, '\\\\')}')
$graphics.Dispose()
$bmp.Dispose()
Write-Output "OK:${SCREENSHOT_PATH.replace(/\\/g, '\\\\')}"
`.trim();

  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ';')}"`, { timeout: 10000 }).toString().trim();
    console.log('[screenshot]', out);
    return SCREENSHOT_PATH;
  } catch (e) {
    console.error('[screenshot] error:', e.message);
    return null;
  }
}

module.exports = { takeScreenshot, SCREENSHOT_PATH };
