'use strict';
/**
 * mDNS announcement — makes Dressrosa visible as a Chromecast on the local network.
 * Uses bonjour-service (pure JS, works on Windows without native dependencies).
 */
const Bonjour = require('bonjour-service');
const os = require('os');
const crypto = require('crypto');

const CAST_PORT = 8009;
const DEVICE_NAME = 'Dressrosa Cast';

// Stable device ID derived from hostname (consistent across restarts)
function getDeviceId() {
  const host = os.hostname();
  return crypto.createHash('md5').update(host).digest('hex').substring(0, 12).toUpperCase();
}

function startMdns() {
  const bonjour = new Bonjour.Bonjour();
  const deviceId = getDeviceId();

  // Cert digest (first 8 bytes of auth_crt SHA-1 hash, hex) — used by Chromecast protocol
  const fs = require('fs');
  const path = require('path');
  const authCrt = fs.readFileSync(path.join(__dirname, '../data/auth_crt.der'));
  const certDigest = crypto.createHash('sha1').update(authCrt).digest('hex').substring(0, 16).toUpperCase();

  const txtRecord = {
    id: deviceId,
    cd: certDigest,
    rm: '',
    ve: '05',
    md: 'Chromecast',
    ic: '/setup/icon.png',
    fn: DEVICE_NAME,
    ca: '4101',
    st: '0',
    bs: deviceId.substring(0, 12),
    nf: '1',
    rs: '',
  };

  const service = bonjour.publish({
    name: DEVICE_NAME,
    type: 'googlecast',
    port: CAST_PORT,
    txt: txtRecord,
    protocol: 'tcp',
  });

  console.log(`[mdns] Announced as "${DEVICE_NAME}" (id=${deviceId}) on port ${CAST_PORT}`);
  console.log(`[mdns] TXT:`, txtRecord);

  service.on('error', (e) => console.error('[mdns] error:', e));

  return service;
}

module.exports = { startMdns };
