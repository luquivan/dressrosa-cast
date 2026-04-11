#!/usr/bin/env node
'use strict';
/**
 * Registers dressrosa-cast as a Windows startup Task Scheduler task.
 * Must run on Dressrosa with the correct node path.
 * Runs at logon in the user's interactive session (not Session 0).
 */
const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const TASK_NAME = 'DressrosaCast';
const NODE_PATH = process.execPath; // path to node.exe
const SCRIPT_PATH = path.resolve(__dirname, '../src/index.js');
const USERNAME = os.userInfo().username;

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    console.log(out.trim());
  } catch (e) {
    console.error(e.message);
  }
}

// Delete existing task
run(`schtasks /delete /f /tn "${TASK_NAME}" 2>nul`);

// Create new task: runs at logon, in user's interactive session
const tr = `"${NODE_PATH}" "${SCRIPT_PATH}"`;
const cmd = `schtasks /create /f /tn "${TASK_NAME}" /tr "${tr}" /sc onlogon /ru "${USERNAME}" /it /rl limited`;
run(cmd);

console.log(`\nTask "${TASK_NAME}" registered.`);
console.log('To start now: schtasks /run /tn DressrosaCast');
console.log('To check:     schtasks /query /tn DressrosaCast /fo LIST /v');
