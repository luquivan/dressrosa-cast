'use strict';
/**
 * Opens a URL in Chrome on Dressrosa.
 * When running as a startup task in the user's interactive session (Session 1),
 * spawn() works directly and the window is visible on the desktop.
 */
const { spawn } = require('child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_PROFILE = 'Default'; // cabezaghj@gmail.com = Toronja Arenosa

let lastUrl = null;

function openUrl(url) {
  if (!url) return;
  console.log(`[opener] Opening: ${url}`);
  lastUrl = url;

  const args = [
    `--profile-directory=${CHROME_PROFILE}`,
    '--start-maximized',
    '--new-window',
    url,
  ];

  const proc = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  proc.unref();
}

module.exports = { openUrl };
