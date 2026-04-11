'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const DEFAULT_PSEXEC_PATH = 'C:\\Windows\\Temp\\PsExec64.exe';
const DEFAULT_SESSION_ID = process.env.DRESSROSA_SESSION_ID || '1';

function getPsExecPath() {
  const configured = process.env.PSEXEC_PATH || DEFAULT_PSEXEC_PATH;
  return fs.existsSync(configured) ? configured : null;
}

function buildPsExecArgs(command, args = [], detached = false) {
  const psexecArgs = ['-accepteula', '-i', String(DEFAULT_SESSION_ID)];
  if (detached) psexecArgs.push('-d');
  psexecArgs.push(command, ...args);
  return psexecArgs;
}

function runInteractiveDetached(command, args = []) {
  const psexecPath = getPsExecPath();
  if (!psexecPath) return false;

  const proc = spawn(psexecPath, buildPsExecArgs(command, args, true), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  proc.on('error', (error) => {
    console.error('[interactive] detached launch error:', error.message);
  });
  proc.unref();
  return true;
}

function runInteractivePowerShell(script, timeout = 15000) {
  const psexecPath = getPsExecPath();
  if (!psexecPath) return false;

  const scriptPath = path.join(os.tmpdir(), `dressrosa-cast-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, script, 'utf8');

  try {
    execFileSync(
      psexecPath,
      buildPsExecArgs('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]),
      { stdio: 'ignore', windowsHide: true, timeout }
    );
    return true;
  } catch (error) {
    console.error('[interactive] powershell error:', error.message);
    return false;
  } finally {
    fs.rmSync(scriptPath, { force: true });
  }
}

module.exports = {
  getPsExecPath,
  runInteractiveDetached,
  runInteractivePowerShell,
};
