'use strict';
const NS = 'urn:x-cast:com.google.cast.tp.connection';
const { logLine } = require('../logger');

function handle(session, msg) {
  let data = {};
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { return; }

  if (data.type === 'CONNECT') {
    logLine(`[conn] CONNECT from ${msg.sourceId}`);
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      type: 'CONNECTED',
      protocolVersion: 0,
    }));
  } else if (data.type === 'CLOSE') {
    // CLOSE means the virtual app session is ending — NOT the TLS connection.
    // Real Chromecasts keep the underlying socket open for reconnection.
    // Destroying the socket here breaks multi-cast workflows.
    logLine(`[conn] CLOSE from ${msg.sourceId} (virtual session end)`);
  }
}

module.exports = { NS, handle };
