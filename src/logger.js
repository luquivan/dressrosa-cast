'use strict';

const fs = require('fs');
const path = require('path');

function getLogPath() {
  const root = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'DressrosaCast')
    : process.cwd();
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // Ignore log dir failures; console logging still works.
  }
  return path.join(root, 'dressrosa-cast.log');
}

function logLine(message) {
  const line = String(message);
  console.log(line);
  try {
    fs.appendFileSync(getLogPath(), `${line}\n`);
  } catch {
    // Ignore log write failures; console logging still works.
  }
}

function logError(message) {
  const line = String(message);
  console.error(line);
  try {
    fs.appendFileSync(getLogPath(), `${line}\n`);
  } catch {
    // Ignore log write failures; console logging still works.
  }
}

module.exports = { logLine, logError };
