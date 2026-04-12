'use strict';
/**
 * mDNS announcement — makes Dressrosa visible as a Chromecast on the local network.
 * Uses bonjour-service (pure JS, works on Windows without native dependencies).
 *
 * IMPORTANT: Must specify the LAN interface explicitly.
 * multicast-dns picks the first/default interface which may be Tailscale or VirtualBox,
 * meaning the mDNS multicast never reaches the actual LAN and devices don't see us.
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

/**
 * Find the LAN IPv4 address — the real local network interface.
 * Skips loopback, Tailscale (100.x), VirtualBox (192.168.56.x), Docker (172.x).
 * Returns undefined to let multicast-dns choose if nothing matches.
 */
function getLanInterface() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (ip.startsWith('100.')) continue;         // Tailscale
      if (ip.startsWith('192.168.56.')) continue;  // VirtualBox host-only
      if (ip.startsWith('172.')) continue;          // Docker/VM bridges
      if (ip.startsWith('169.254.')) continue;      // APIPA
      candidates.push(ip);
    }
  }
  // Prefer 192.168.x.x (typical home LAN)
  const lan = candidates.find(ip => ip.startsWith('192.168.'));
  const result = lan || candidates[0];
  return result;
}

function startMdns() {
  const iface = getLanInterface();
  console.log(`[mdns] Using interface: ${iface || 'default (auto)'}`);

  const bonjour = new Bonjour.Bonjour(iface ? { interface: iface } : {});
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
