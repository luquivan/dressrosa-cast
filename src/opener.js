'use strict';
/**
 * Opens a URL in Chrome on Dressrosa.
 * When running from a user-session autostart in the interactive session,
 * spawn() works directly and the window is visible on the desktop.
 */
const { spawn, spawnSync } = require('child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_PROFILE = 'Default'; // cabezaghj@gmail.com = Toronja Arenosa

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
  const newWindow = options.newWindow !== false;

  if (replace) {
    closeChrome();
  }

  console.log(`[opener] Opening: ${url}`);
  lastUrl = url;

  const args = [
    `--profile-directory=${CHROME_PROFILE}`,
    '--start-maximized',
  ];
  if (newWindow) args.push('--new-window');
  args.push(url);

  const proc = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  proc.unref();
}

function getLastUrl() {
  return lastUrl;
}

module.exports = { openUrl, closeChrome, getLastUrl };
