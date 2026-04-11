'use strict';
/**
 * Opens a URL on Dressrosa.
 * In practice, handing the URL to explorer.exe is more reliable than
 * spawning chrome.exe directly in the user desktop session.
 */
const { spawn, spawnSync } = require('child_process');

let lastUrl = null;

function closeChrome() {
  try {
    const result = spawnSync('taskkill', ['/IM', 'chrome.exe', '/F', '/T'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function openUrl(url, options = {}) {
  if (!url) return;
  const replace = options.replace === true;

  if (replace) {
    closeChrome();
  }

  console.log(`[opener] Opening: ${url}`);
  lastUrl = url;

  const proc = spawn('explorer.exe', [url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  proc.on('error', (error) => {
    console.error('[opener] explorer launch error:', error.message);
  });
  proc.unref();
}

function getLastUrl() {
  return lastUrl;
}

module.exports = { openUrl, closeChrome, getLastUrl };
