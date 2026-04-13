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
 *  4. Parses incoming DNS packets and answers DNS-SD queries for Cast
 *  5. Sends proactive announcements at startup and every 60 s
 */

const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDeviceId, getFriendlyName, getModelName, getInstanceId } = require('./device');
const { logLine, logError } = require('./logger');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const CAST_PORT = 8009;
const DEVICE_NAME = getFriendlyName();
const SERVICE_TYPE_FQDN = '_googlecast._tcp.local';
const SERVICE_ENUM_FQDN = '_services._dns-sd._udp.local';
const DNS_CLASS_IN = 0x0001;
const DNS_QU_MASK = 0x8000;
const DNS_TYPE_A = 1;
const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_AAAA = 28;
const DNS_TYPE_SRV = 33;
const DNS_TYPE_ANY = 255;
const ANNOUNCE_INTERVAL_MS = 5_000;

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

function buildQuestion(name, type, cls = DNS_CLASS_IN) {
  const nameBuf = encodeName(name);
  const tail = Buffer.allocUnsafe(4);
  writeU16(tail, 0, type);
  writeU16(tail, 2, cls);
  return Buffer.concat([nameBuf, tail]);
}

/**
 * Build the static DNS-SD records for the Cast receiver.
 */
function buildRecordSet({ deviceId, lanIp, certDigest }) {
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

  // PTR: _services._dns-sd._udp.local → _googlecast._tcp.local
  const serviceEnumPtrRR = buildRR(SERVICE_ENUM_FQDN, DNS_TYPE_PTR, TTL, buildPtrRdata(SERVICE_TYPE_FQDN));

  // PTR: _googlecast._tcp.local → "Chromecast-<id>._googlecast._tcp.local"
  const ptrRR = buildRR(SERVICE_TYPE_FQDN, DNS_TYPE_PTR, TTL, buildPtrRdata(instanceName));

  // SRV: "Chromecast-<id>._googlecast._tcp.local" → deviceId.local:8009
  const srvRR = buildRR(instanceName, DNS_TYPE_SRV, TTL, buildSrvRdata(0, 0, CAST_PORT, hostName), true);

  // TXT: key=value pairs
  const txtRR = buildRR(instanceName, DNS_TYPE_TXT, TTL, encodeTxt(txtRecord), true);

  // A: deviceId.local → 192.168.x.x
  const aRR = buildRR(hostName, DNS_TYPE_A, TTL_HOST, buildARecord(lanIp), true);

  return {
    deviceId,
    hostName,
    instanceName,
    serviceEnumPtrRR,
    ptrRR,
    srvRR,
    txtRR,
    aRR,
  };
}

function buildResponsePacket({ id = 0, questions = [], answers = [], additionals = [] }) {
  const header = Buffer.allocUnsafe(12);
  writeU16(header, 0, id);
  writeU16(header, 2, 0x8400); // QR=1, AA=1
  writeU16(header, 4, questions.length);
  writeU16(header, 6, answers.length);
  writeU16(header, 8, 0);
  writeU16(header, 10, additionals.length);

  const questionBufs = questions.map(q => buildQuestion(q.name, q.type, q.cls));
  return Buffer.concat([header, ...questionBufs, ...answers, ...additionals]);
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

function normalizeName(name) {
  return String(name || '').replace(/\.$/, '').toLowerCase();
}

function typeName(type) {
  switch (type) {
    case DNS_TYPE_A: return 'A';
    case DNS_TYPE_PTR: return 'PTR';
    case DNS_TYPE_TXT: return 'TXT';
    case DNS_TYPE_AAAA: return 'AAAA';
    case DNS_TYPE_SRV: return 'SRV';
    case DNS_TYPE_ANY: return 'ANY';
    default: return `TYPE${type}`;
  }
}

function isSupportedType(type) {
  return type === DNS_TYPE_PTR ||
    type === DNS_TYPE_SRV ||
    type === DNS_TYPE_TXT ||
    type === DNS_TYPE_A ||
    type === DNS_TYPE_ANY;
}

function pushUnique(target, record) {
  if (!record) return;
  if (!target.includes(record)) {
    target.push(record);
  }
}

function buildQueryResponse(msg, state) {
  if (msg.length < 12) return null;
  const id = (msg[0] << 8) | msg[1];
  const flags = (msg[2] << 8) | msg[3];
  const qr = (flags >> 15) & 1;
  if (qr !== 0) return null;

  const qdcount = (msg[4] << 8) | msg[5];
  const questions = parseQuestions(msg, qdcount, 12);
  if (!questions.length) return null;

  const answers = [];
  const additionals = [];
  const serviceType = normalizeName(SERVICE_TYPE_FQDN);
  const serviceEnum = normalizeName(SERVICE_ENUM_FQDN);
  const instanceName = normalizeName(state.instanceName);
  const hostName = normalizeName(state.hostName);
  const matchedQuestions = [];

  for (const question of questions) {
    const qname = normalizeName(question.name);
    const qtype = question.type;
    const qclass = question.cls & 0x7fff;
    if (qclass !== DNS_CLASS_IN || !isSupportedType(qtype)) {
      continue;
    }

    let matched = false;

    if (qname === serviceEnum && (qtype === DNS_TYPE_PTR || qtype === DNS_TYPE_ANY)) {
      pushUnique(answers, state.serviceEnumPtrRR);
      matched = true;
    }

    if (qname === serviceType && (qtype === DNS_TYPE_PTR || qtype === DNS_TYPE_ANY)) {
      pushUnique(answers, state.ptrRR);
      pushUnique(additionals, state.srvRR);
      pushUnique(additionals, state.txtRR);
      pushUnique(additionals, state.aRR);
      matched = true;
    }

    if (qname === instanceName && (qtype === DNS_TYPE_SRV || qtype === DNS_TYPE_ANY)) {
      pushUnique(answers, state.srvRR);
      pushUnique(additionals, state.aRR);
      matched = true;
    }

    if (qname === instanceName && (qtype === DNS_TYPE_TXT || qtype === DNS_TYPE_ANY)) {
      pushUnique(answers, state.txtRR);
      matched = true;
    }

    if (qname === hostName && (qtype === DNS_TYPE_A || qtype === DNS_TYPE_ANY)) {
      pushUnique(answers, state.aRR);
      matched = true;
    }

    if (matched) {
      matchedQuestions.push(question);
    }
  }

  if (!answers.length && !additionals.length) {
    return null;
  }

  const wantsUnicast = matchedQuestions.some(q => (q.cls & DNS_QU_MASK) !== 0);
  return {
    id,
    questions: matchedQuestions,
    answers,
    additionals,
    wantsUnicast,
    matchedQuestions,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

function startMdns() {
  const lanIp = getLanInterface();
  if (!lanIp) {
    logError('[mdns] Could not find LAN interface — mDNS disabled');
    return null;
  }
  logLine(`[mdns] LAN interface: ${lanIp}`);

  const deviceId = getDeviceId();
  const certDigest = getCertDigest();
  const state = buildRecordSet({ deviceId, lanIp, certDigest });
  logLine(`[mdns] Device ID: ${deviceId}, cert digest: ${certDigest}`);

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    logError(`[mdns] socket error: ${err.message}`);
  });

  socket.on('message', (msg, rinfo) => {
    // Ignore our own multicast
    if (rinfo.address === lanIp) return;

    const response = buildQueryResponse(msg, state);
    if (!response) return;

    const wantsUnicast = response.wantsUnicast || rinfo.port !== MDNS_PORT;
    const destinationAddress = wantsUnicast ? rinfo.address : MDNS_ADDR;
    const destinationPort = wantsUnicast ? rinfo.port : MDNS_PORT;
    const packet = buildResponsePacket({
      id: wantsUnicast ? response.id : 0,
      questions: wantsUnicast ? response.questions : [],
      answers: response.answers,
      additionals: response.additionals,
    });

    const summary = response.matchedQuestions
      .map(q => `${typeName(q.type)} ${normalizeName(q.name)}`)
      .join(', ');
    logLine(`[mdns] query from ${rinfo.address}:${rinfo.port} -> ${summary} (${wantsUnicast ? 'unicast' : 'multicast'} reply)`);

    socket.send(packet, 0, packet.length, destinationPort, destinationAddress, (err) => {
      if (err) {
        logError(`[mdns] send error: ${err.message}`);
      }
    });
  });

  // Bind to 0.0.0.0 so the socket receives multicast packets (which are addressed
  // to 224.0.0.251, not to our IP). Binding to the specific LAN IP causes Windows
  // to only deliver packets whose DESTINATION matches that IP — so multicast never
  // arrives. With reuseAddr, both Dnscache and our socket can coexist on port 5353
  // and both receive multicast.
  socket.bind(MDNS_PORT, () => {
    try {
      socket.addMembership(MDNS_ADDR, lanIp);
      logLine(`[mdns] Joined multicast group ${MDNS_ADDR} on ${lanIp}`);
    } catch (e) {
      logError(`[mdns] addMembership failed: ${e.message}`);
    }
    socket.setMulticastTTL(255);
    socket.setMulticastLoopback(false);
    socket.setMulticastInterface(lanIp);

    // Proactive announcement at startup
    announce();
  });

  function announce() {
    const pkt = buildResponsePacket({
      answers: [
        state.serviceEnumPtrRR,
        state.ptrRR,
        state.srvRR,
        state.txtRR,
        state.aRR,
      ],
    });
    socket.send(pkt, 0, pkt.length, MDNS_PORT, MDNS_ADDR, (err) => {
      if (err) {
        logError(`[mdns] announce error: ${err.message}`);
      } else {
        logLine(`[mdns] Announced "${DEVICE_NAME}" on ${lanIp}:${CAST_PORT}`);
      }
    });
  }

  setTimeout(announce, 250);
  setTimeout(announce, 1000);

  // Windows is still unreliable at receiving inbound mDNS queries on 5353 in this
  // environment, so discovery must not depend on active query/response. Keep
  // unsolicited announcements frequent enough that short-lived Cast pickers still
  // see the device while browsing.
  const interval = setInterval(announce, ANNOUNCE_INTERVAL_MS);

  return {
    stop() {
      clearInterval(interval);
      socket.close();
    },
  };
}

module.exports = { startMdns };
