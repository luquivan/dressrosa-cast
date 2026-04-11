'use strict';
const tls = require('tls');
const protobuf = require('protobufjs');
const path = require('path');
const { getTlsCredentials } = require('./tls');
const { buildAuthResponse } = require('./auth');
const connCh = require('./channels/connection');
const heartbeatCh = require('./channels/heartbeat');
const receiverCh = require('./channels/receiver');
const mediaCh = require('./channels/media');

const CAST_PORT = 8009;
const AUTH_NS = 'urn:x-cast:com.google.cast.tp.deviceauth';

let castProto = null;

async function loadProto() {
  const root = await protobuf.load(path.join(__dirname, '../proto/cast_channel.proto'));
  castProto = root;
  return root;
}

// Minimal session object per connection
class CastSession {
  constructor(id, socket) {
    this.id = id;
    this.socket = socket;
    this._appId = null;
    this._sessionId = null;
    this._mediaSessionId = null;
  }
  setCurrentApp(appId, sessionId) { this._appId = appId; this._sessionId = sessionId; }
  getCurrentApp() { return this._appId; }
  setMediaSession(id) { this._mediaSessionId = id; }
  getMediaSession() { return this._mediaSessionId; }
  close() { this.socket.destroy(); }

  send(sourceId, destId, ns, payloadUtf8) {
    const CastMessage = castProto.lookupType('extensions.api.cast_channel.CastMessage');
    const msg = CastMessage.create({
      protocolVersion: 0,
      sourceId,
      destinationId: destId,
      namespace: ns,
      payloadType: 0, // STRING
      payloadUtf8,
    });
    const buf = CastMessage.encode(msg).finish();
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(buf.length, 0);
    try {
      this.socket.write(Buffer.concat([lenBuf, buf]));
    } catch (e) {
      console.error('[session] write error:', e.message);
    }
  }
}

function handleMessage(session, msg) {
  const ns = msg.namespace;

  if (ns === AUTH_NS) {
    // DeviceAuthChallenge — respond with pre-computed auth
    const authBytes = buildAuthResponse(castProto);
    const CastMessage = castProto.lookupType('extensions.api.cast_channel.CastMessage');
    const response = CastMessage.create({
      protocolVersion: 0,
      sourceId: msg.destinationId,
      destinationId: msg.sourceId,
      namespace: AUTH_NS,
      payloadType: 1, // BINARY
      payloadBinary: authBytes,
    });
    const buf = CastMessage.encode(response).finish();
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(buf.length, 0);
    session.socket.write(Buffer.concat([lenBuf, buf]));
    return;
  }

  if (ns === connCh.NS) return connCh.handle(session, msg);
  if (ns === heartbeatCh.NS) return heartbeatCh.handle(session, msg);
  if (ns === receiverCh.NS) return receiverCh.handle(session, msg);
  if (ns === mediaCh.NS) return mediaCh.handle(session, msg);

  console.log(`[recv] Unhandled namespace: ${ns}`, (msg.payloadUtf8 || '').slice(0, 200));
}

function parseMessages(socket, session) {
  const CastMessage = castProto.lookupType('extensions.api.cast_channel.CastMessage');
  let buf = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const msgLen = buf.readUInt32BE(0);
      if (buf.length < 4 + msgLen) break;
      const msgBuf = buf.slice(4, 4 + msgLen);
      buf = buf.slice(4 + msgLen);
      try {
        const msg = CastMessage.decode(msgBuf);
        handleMessage(session, msg);
      } catch (e) {
        console.error('[recv] decode error:', e.message);
      }
    }
  });
}

let sessionCounter = 0;

async function startReceiver() {
  await loadProto();
  const { certPem, keyPem, certDer } = getTlsCredentials();

  const server = tls.createServer({
    cert: certPem,
    key: keyPem,
    requestCert: false,
    rejectUnauthorized: false,
  });

  server.on('secureConnection', (socket) => {
    const id = ++sessionCounter;
    console.log(`[recv] New connection #${id} from ${socket.remoteAddress}`);
    const session = new CastSession(id, socket);

    socket.on('error', (e) => console.error(`[recv] socket #${id} error:`, e.message));
    socket.on('close', () => console.log(`[recv] connection #${id} closed`));

    parseMessages(socket, session);
  });

  server.listen(CAST_PORT, '0.0.0.0', () => {
    console.log(`[recv] Cast receiver listening on port ${CAST_PORT}`);
  });

  server.on('error', (e) => console.error('[recv] server error:', e));
  return server;
}

module.exports = { startReceiver };
