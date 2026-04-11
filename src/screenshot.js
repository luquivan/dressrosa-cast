'use strict';
/**
 * Control server — HTTP endpoint on port 8010.
 * Called from Skypiea to trigger a screenshot that runs IN Session 1
 * (since the receiver itself runs in the user's interactive session).
 * Routes:
 *   GET /health
 *   GET /state
 *   GET|POST /open
 *   GET|POST /close
 *   GET /screenshot
 */
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { openUrl, closeChrome, getLastUrl } = require('./opener');

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
    return fs.readFileSync(SCREENSHOT_PATH);
  } catch (e) {
    console.error('[screenshot] error:', e.message.slice(0, 200));
    return null;
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getState() {
  return {
    ok: true,
    service: 'dressrosa-cast',
    port: SCREENSHOT_PORT,
    lastUrl: getLastUrl(),
  };
}

function startScreenshotServer() {
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (requestUrl.pathname === '/health') {
      if (req.method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
      }
      sendJson(res, 200, getState());
      return;
    }

    if (requestUrl.pathname === '/state' && req.method === 'GET') {
      sendJson(res, 200, getState());
      return;
    }

    if (requestUrl.pathname === '/open' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        const payload = req.method === 'POST' ? await readJsonBody(req) : {};
        const targetUrl = payload.url || requestUrl.searchParams.get('url');

        if (!targetUrl) {
          sendJson(res, 400, { ok: false, error: 'Missing url' });
          return;
        }

        const replace = parseBool(payload.replace ?? requestUrl.searchParams.get('replace'), false);
        const newWindow = parseBool(payload.newWindow ?? requestUrl.searchParams.get('newWindow'), true);

        openUrl(targetUrl, { replace, newWindow });
        sendJson(res, 200, {
          ok: true,
          url: targetUrl,
          replace,
          newWindow,
          lastUrl: getLastUrl(),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
      return;
    }

    if (requestUrl.pathname === '/close' && (req.method === 'GET' || req.method === 'POST')) {
      const closed = closeChrome();
      sendJson(res, 200, { ok: true, closed, lastUrl: getLastUrl() });
      return;
    }

    if (requestUrl.pathname === '/screenshot' && req.method === 'GET') {
      const img = takeScreenshot();
      if (img) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(img);
      } else {
        res.writeHead(500);
        res.end('Screenshot failed');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(SCREENSHOT_PORT, '0.0.0.0', () => {
    console.log(`[control] HTTP server on port ${SCREENSHOT_PORT} — /health /state /open /close /screenshot`);
  });
}

module.exports = { startScreenshotServer, takeScreenshot };
