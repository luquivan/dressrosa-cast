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
const { getPsExecPath, runInteractivePowerShell } = require('./interactive');

const SCREENSHOT_PORT = 8010;
const SCREENSHOT_PATH = path.join(os.tmpdir(), 'dressrosa-cast-screen.png');

// PrtSc+clipboard method: handles WDDM hardware-accelerated rendering (Chrome, DirectX)
// CopyFromScreen (GDI) only captures GDI layer on Windows 10/11 — leaves Chrome windows white.
// Note: returns null when no real display is connected (WinDisc/TV off), better than a white PNG.
const PS_SCRIPT = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinInput {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern int SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    public const byte VK_SNAPSHOT = 0x2C;
    public const int KEYEVENTF_KEYUP = 2;
    public static void WakeDisplay() {
        POINT p;
        GetCursorPos(out p);
        SetCursorPos(p.X + 1, p.Y);
        SetCursorPos(p.X, p.Y);
    }
    public static void SendPrintScreen() {
        keybd_event(VK_SNAPSHOT, 0, 0, 0);
        keybd_event(VK_SNAPSHOT, 0, KEYEVENTF_KEYUP, 0);
    }
}
'@
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[WinInput]::WakeDisplay()
Start-Sleep -Milliseconds 300
[WinInput]::SendPrintScreen()
Start-Sleep -Milliseconds 500
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
    $img.Save('${SCREENSHOT_PATH.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    exit 0
}
exit 1
`.trim();

function takeScreenshot() {
  // node runs in Session 1 (interactive desktop) — execute PS directly without PsExec
  const scriptPath = path.join(os.tmpdir(), `dressrosa-shot-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
    execSync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: 15000 }
    );
    return fs.readFileSync(SCREENSHOT_PATH);
  } catch (e) {
    console.error('[screenshot] error:', e.message.slice(0, 300));
    return null;
  } finally {
    fs.rmSync(scriptPath, { force: true });
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
