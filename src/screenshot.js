'use strict';
/**
 * Screenshot server — HTTP endpoint on port 8010.
 * Called from Skypiea to trigger a screenshot that runs IN Session 1
 * (since the receiver itself runs in the user's interactive session).
 * GET /screenshot → captures screen, saves PNG, returns it as binary.
 */
const http = require('http');
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const SCREENSHOT_PORT = 8010;
const SCREENSHOT_PATH = path.join(os.tmpdir(), 'dressrosa-cast-screen.png');

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bmp.Save('${SCREENSHOT_PATH.replace(/\\/g, '\\\\')}')
$g.Dispose(); $bmp.Dispose()
`.trim();

function takeScreenshot() {
  try {
    execSync(`powershell -NoProfile -NonInteractive -Command "${PS_SCRIPT.replace(/\n/g, '; ')}"`, { timeout: 10000 });
    return require('fs').readFileSync(SCREENSHOT_PATH);
  } catch (e) {
    console.error('[screenshot] error:', e.message.slice(0, 200));
    return null;
  }
}

function startScreenshotServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/screenshot') {
      const img = takeScreenshot();
      if (img) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(img);
      } else {
        res.writeHead(500);
        res.end('Screenshot failed');
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(SCREENSHOT_PORT, '0.0.0.0', () => {
    console.log(`[screenshot] HTTP server on port ${SCREENSHOT_PORT} — GET /screenshot`);
  });
}

module.exports = { startScreenshotServer, takeScreenshot };
