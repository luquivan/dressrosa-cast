#!/usr/bin/env node
'use strict';
/**
 * Installs Dressrosa Cast as a user-session autostart on Windows.
 * Task Scheduler proved brittle for long-running interactive processes,
 * so we use a Startup-folder VBS launcher that starts Node hidden at logon.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const APP_NAME = 'Dressrosa Cast';
const LEGACY_TASK_NAME = 'DressrosaCast';
const NODE_PATH = process.execPath;
const REPO_ROOT = path.resolve(__dirname, '..');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const STARTUP_DIR = path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const INSTALL_DIR = path.join(LOCALAPPDATA, 'DressrosaCast');
const CMD_PATH = path.join(INSTALL_DIR, 'launch.cmd');
const VBS_PATH = path.join(STARTUP_DIR, `${APP_NAME}.vbs`);
const LOG_PATH = path.join(INSTALL_DIR, 'dressrosa-cast.log');
const ERR_PATH = path.join(INSTALL_DIR, 'dressrosa-cast.err');
const FIREWALL_RULES = [
  { name: 'Dressrosa Cast mDNS', protocol: 'UDP', localPort: '5353' },
  { name: 'Dressrosa Cast SSDP', protocol: 'UDP', localPort: '1900' },
  { name: 'Dressrosa Cast TCP', protocol: 'TCP', localPort: '8008-8010' },
];

if (process.platform !== 'win32') {
  console.error('This installer only works on Windows.');
  process.exit(1);
}

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const stdout = error.stdout ? String(error.stdout).trim() : '';
    const message = stderr || stdout || error.message;
    console.error(message);
    return '';
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Wrote ${filePath}`);
}

function toWindowsPath(filePath) {
  return filePath.replace(/\//g, '\\');
}

function escapeVbs(value) {
  return value.replace(/"/g, '""');
}

ensureDir(INSTALL_DIR);
ensureDir(STARTUP_DIR);

const launcherCmd = [
  '@echo off',
  'setlocal',
  `cd /d "${toWindowsPath(REPO_ROOT)}"`,
  `"${toWindowsPath(NODE_PATH)}" "src\\index.js" 1>> "${toWindowsPath(LOG_PATH)}" 2>> "${toWindowsPath(ERR_PATH)}"`,
  '',
].join('\r\n');

const launcherVbs = [
  'Set shell = CreateObject("WScript.Shell")',
  `shell.CurrentDirectory = "${escapeVbs(toWindowsPath(REPO_ROOT))}"`,
  `shell.Run Chr(34) & "${escapeVbs(toWindowsPath(CMD_PATH))}" & Chr(34), 0, False`,
  '',
].join('\r\n');

writeFile(CMD_PATH, launcherCmd);
writeFile(VBS_PATH, launcherVbs);

// Best-effort cleanup of the legacy task-based installer to avoid duplicate launches.
run(`cmd /c schtasks /delete /f /tn "${LEGACY_TASK_NAME}" >nul 2>nul`);

for (const rule of FIREWALL_RULES) {
  run(`cmd /c netsh advfirewall firewall delete rule name="${rule.name}" >nul 2>nul`);
  run(`netsh advfirewall firewall add rule name="${rule.name}" dir=in action=allow protocol=${rule.protocol} localport=${rule.localPort} profile=private`);
}

console.log(`\n${APP_NAME} will now start from the Startup folder at user logon.`);
console.log(`Startup launcher: ${VBS_PATH}`);
console.log(`Command wrapper:  ${CMD_PATH}`);
console.log(`Stdout log:       ${LOG_PATH}`);
console.log(`Stderr log:       ${ERR_PATH}`);
console.log('\nFirewall rules refreshed:');
for (const rule of FIREWALL_RULES) {
  console.log(`- ${rule.name} (${rule.protocol} ${rule.localPort}, Private profile)`);
}
console.log('\nTo apply now: log off and back on to Dressrosa, or run the VBS launcher from the desktop session.');
