'use strict';
/**
 * mDNS announcement — makes Dressrosa visible as a Chromecast on the local network.
 *
 * Uses raw dgram UDP with explicit multicast JOIN on the LAN interface.
 * bonjour-service/multicast-dns failed because they JOIN on the wrong interface
 * (Tailscale 100.x instead of LAN 192.168.x.x), so they can send multicast
 * but never receive queries from the phone.
 *
 * This implementation:
 *  1. Creates a UDP4 socket with reuseAddr
 *  2. Binds to 0.0.0.0:5353
 *  3. Joins 224.0.0.251 explicitly on the LAN IP
 *  4. Parses incoming DNS packets and responds to PTR queries
 *  5. Sends a proactive announcement at startup and every 60 s
 */

const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDeviceId, getFriendlyName, getModelName, getInstanceId } = require('./device');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const CAST_PORT = 8009;
const DEVICE_NAME = getFriendlyName();
const SERVICE_TYPE = '_googlecast._tcp.local';
const SERVICE_TYPE_FQDN = '_googlecast._tcp.local';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the LAN IPv4 address — the real local network interface.
 * Skips loopback, Tailscale (100.x), VirtualBox (192.168.56.x), Docker (172.x).
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
  const lan = candidates.find(ip => ip.startsWith('192.168.'));
  return lan || candidates[0];
}

function getCertDigest() {
  const authCrt = fs.readFileSync(path.join(__dirname, '../data/auth_crt.der'));
  return crypto.createHash('sha1').update(authCrt).digest('hex').substring(0, 16).toUpperCase();
}

// ── DNS packet building ───────────────────────────────────────────────────────

/**
 * Encode a DNS name to wire format (labels + 0x00).
 * e.g. "_googlecast._tcp.local" → [0x0b,"_googlecast",0x04,"_tcp",0x05,"local",0x00]
 */
function encodeName(name) {
  const parts = name.split('.');
  const bufs = [];
  for (const part of parts) {
    if (!part) continue;
    const label = Buffer.from(part, 'utf8');
    bufs.push(Buffer.from([label.length]), label);
  }
  bufs.push(Buffer.from([0])); // root
  return Buffer.concat(bufs);
}

/**
 * Encode a DNS TXT record value (array of key=value strings → wire format).
 */
function encodeTxt(kv) {
  const parts = Object.entries(kv).map(([k, v]) => Buffer.from(`${k}=${v}`, 'utf8'));
  const bufs = [];
  for (const p of parts) {
    bufs.push(Buffer.from([p.length]), p);
  }
  return Buffer.concat(bufs);
}

/**
 * Write a 16-bit big-endian integer to a buffer at offset.
 */
function writeU16(buf, offset, val) {
  buf[offset] = (val >> 8) & 0xff;
  buf[offset + 1] = val & 0xff;
}

function writeU32(buf, offset, val) {
  buf[offset] = (val >> 24) & 0xff;
  buf[offset + 1] = (val >> 16) & 0xff;
  buf[offset + 2] = (val >> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

/**
 * Build a single DNS resource record.
 * @param {string} name  - owner name
 * @param {number} type  - RR type (1=A, 12=PTR, 16=TXT, 33=SRV)
 * @param {number} ttl
 * @param {Buffer} rdata
 * @param {boolean} cacheFlush - set the cache-flush bit (class |= 0x8000)
 */
function buildRR(name, type, ttl, rdata, cacheFlush = false) {
  const nameBuf = encodeName(name);
  const cls = cacheFlush ? 0x8001 : 0x0001; // IN class + optional flush
  const hdr = Buffer.allocUnsafe(10);
  writeU16(hdr, 0, type);
  writeU16(hdr, 2, cls);
  writeU32(hdr, 4, ttl);
  writeU16(hdr, 8, rdata.length);
  return Buffer.concat([nameBuf, hdr, rdata]);
}

function buildPtrRdata(target) {
  return encodeName(target);
}

function buildSrvRdata(priority, weight, port, target) {
  const nameBuf = encodeName(target);
  const hdr = Buffer.allocUnsafe(6);
  writeU16(hdr, 0, priority);
  writeU16(hdr, 2, weight);
  writeU16(hdr, 4, port);
  return Buffer.concat([hdr, nameBuf]);
}

function buildARecord(ip) {
  return Buffer.from(ip.split('.').map(Number));
}

/**
 * Build a full mDNS response packet announcing the Chromecast service.
 * @param {object} opts
 * @param {string} opts.deviceId
 * @param {string} opts.lanIp
 * @param {string} opts.certDigest
 * @param {boolean} opts.isProbe - true for proactive announcements (QR=0)
 */
function buildAnnouncement({ deviceId, lanIp, certDigest, isProbe = false }) {
  const instanceName = `${getInstanceId()}._googlecast._tcp.local`;
  const hostName = `${deviceId}.local`;

  const txtRecord = {
    id: deviceId,
    cd: certDigest,
    rm: '',
    ve: '05',
    md: getModelName(),
    ic: '/setup/icon.png',
    fn: DEVICE_NAME,
    ca: '4101',
    st: '0',
    bs: deviceId.substring(0, 12),
    nf: '1',
    rs: '',
  };

  const TTL = 4500;
  const TTL_HOST = 120;

  // PTR: _googlecast._tcp.local → "Dressrosa Cast._googlecast._tcp.local"
  const ptrRR = buildRR(SERVICE_TYPE_FQDN, 12, TTL, buildPtrRdata(instanceName));

  // SRV: "Dressrosa Cast._googlecast._tcp.local" → deviceId.local:8009
  const srvRR = buildRR(instanceName, 33, TTL, buildSrvRdata(0, 0, CAST_PORT, hostName), true);

  // TXT: key=value pairs
  const txtRR = buildRR(instanceName, 16, TTL, encodeTxt(txtRecord), true);

  // A: deviceId.local → 192.168.x.x
  const aRR = buildRR(hostName, 1, TTL_HOST, buildARecord(lanIp), true);

  // DNS message header (response, authoritative)
  // Flags: QR=1, AA=1 → 0x8400
  const answers = [ptrRR, srvRR, txtRR, aRR];
  const ancount = answers.length;

  const header = Buffer.allocUnsafe(12);
  writeU16(header, 0, 0); // ID = 0 for mDNS
  writeU16(header, 2, 0x8400); // QR=1, AA=1
  writeU16(header, 4, 0); // QDCOUNT
  writeU16(header, 6, ancount); // ANCOUNT
  writeU16(header, 8, 0); // NSCOUNT
  writeU16(header, 10, 0); // ARCOUNT

  return Buffer.concat([header, ...answers]);
}

// ── DNS query parser ──────────────────────────────────────────────────────────

/**
 * Parse a DNS name from a buffer starting at offset.
 * Handles pointer compression.
 * Returns { name: string, end: number }
 */
function parseName(buf, offset) {
  const parts = [];
  let jumped = false;
  let end = offset;
  let safety = 64;

  while (offset < buf.length && safety-- > 0) {
    const len = buf[offset];
    if (len === 0) {
      if (!jumped) end = offset + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      // pointer
      const ptr = ((len & 0x3f) << 8) | buf[offset + 1];
      if (!jumped) end = offset + 2;
      jumped = true;
      offset = ptr;
      continue;
    }
    offset++;
    parts.push(buf.slice(offset, offset + len).toString('utf8'));
    offset += len;
    if (!jumped) end = offset;
  }

  return { name: parts.join('.'), end };
}

/**
 * Parse DNS questions section.
 * Returns array of { name, type, cls }
 */
function parseQuestions(buf, qdcount, offset) {
  const questions = [];
  for (let i = 0; i < qdcount; i++) {
    if (offset >= buf.length) break;
    const { name, end } = parseName(buf, offset);
    offset = end;
    if (offset + 4 > buf.length) break;
    const type = (buf[offset] << 8) | buf[offset + 1];
    const cls = (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 4;
    questions.push({ name, type, cls });
  }
  return questions;
}

/**
 * Determine whether this DNS message contains a PTR query
 * for _googlecast._tcp.local.
 */
function isGooglecastQuery(msg) {
  if (msg.length < 12) return false;
  const flags = (msg[2] << 8) | msg[3];
  const qr = (flags >> 15) & 1;
  if (qr !== 0) return false; // only queries (QR=0)

  const qdcount = (msg[4] << 8) | msg[5];
  const questions = parseQuestions(msg, qdcount, 12);
  return questions.some(q =>
    q.type === 12 && // PTR
    (q.name.toLowerCase() === '_googlecast._tcp.local' ||
     q.name.toLowerCase() === '_googlecast._tcp')
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

function startMdns() {
  const lanIp = getLanInterface();
  if (!lanIp) {
    console.error('[mdns] Could not find LAN interface — mDNS disabled');
    return null;
  }
  console.log(`[mdns] LAN interface: ${lanIp}`);

  const deviceId = getDeviceId();
  const certDigest = getCertDigest();
  console.log(`[mdns] Device ID: ${deviceId}, cert digest: ${certDigest}`);

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[mdns] socket error:', err);
  });

  socket.on('message', (msg, rinfo) => {
    // Log all incoming UDP (debug — remove after confirmed working)
    const flags = msg.length >= 4 ? (msg[2] << 8) | msg[3] : 0;
    const qr = (flags >> 15) & 1;
    console.log(`[mdns] rx ${msg.length}B from ${rinfo.address}:${rinfo.port} QR=${qr}`);

    // Ignore our own multicast
    if (rinfo.address === lanIp) return;

    if (isGooglecastQuery(msg)) {
      console.log(`[mdns] PTR query from ${rinfo.address} — responding`);
      const response = buildAnnouncement({ deviceId, lanIp, certDigest });
      socket.send(response, 0, response.length, MDNS_PORT, MDNS_ADDR, (err) => {
        if (err) console.error('[mdns] send error:', err);
      });
    }
  });

  // Bind to 0.0.0.0 so the socket receives multicast packets (which are addressed
  // to 224.0.0.251, not to our IP). Binding to the specific LAN IP causes Windows
  // to only deliver packets whose DESTINATION matches that IP — so multicast never
  // arrives. With reuseAddr, both Dnscache and our socket can coexist on port 5353
  // and both receive multicast.
  socket.bind(MDNS_PORT, () => {
    try {
      socket.addMembership(MDNS_ADDR, lanIp);
      console.log(`[mdns] Joined multicast group ${MDNS_ADDR} on ${lanIp}`);
    } catch (e) {
      console.error('[mdns] addMembership failed:', e.message);
    }
    socket.setMulticastTTL(255);
    socket.setMulticastLoopback(false);
    socket.setMulticastInterface(lanIp);

    // Proactive announcement at startup
    announce();
  });

  function announce() {
    const pkt = buildAnnouncement({ deviceId, lanIp, certDigest, isProbe: true });
    socket.send(pkt, 0, pkt.length, MDNS_PORT, MDNS_ADDR, (err) => {
      if (err) console.error('[mdns] announce error:', err);
      else console.log(`[mdns] Announced "${DEVICE_NAME}" on ${lanIp}:${CAST_PORT}`);
    });
  }

  // Re-announce every 60 seconds so devices that just joined the network find us
  const interval = setInterval(announce, 60_000);

  return {
    stop() {
      clearInterval(interval);
      socket.close();
    },
  };
}

module.exports = { startMdns };
