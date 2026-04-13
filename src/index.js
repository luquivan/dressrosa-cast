'use strict';
const { startReceiver } = require('./receiver');
const { startMdns } = require('./mdns');
const { startDialServer } = require('./dial');
const { startScreenshotServer } = require('./screenshot');

async function main() {
  console.log('=== Dressrosa Cast ===');
  console.log('Starting Cast receiver...');

  try {
    await startReceiver();
    startMdns();
    startDialServer();
    startScreenshotServer();
    console.log('Ready. Waiting for cast requests...');
  } catch (e) {
    console.error('Fatal error:', e);
    process.exit(1);
  }
}

main();
