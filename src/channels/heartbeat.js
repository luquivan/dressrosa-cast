'use strict';
const NS = 'urn:x-cast:com.google.cast.tp.heartbeat';

function handle(session, msg) {
  const data = JSON.parse(msg.payloadUtf8 || '{}');
  if (data.type === 'PING') {
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({ type: 'PONG' }));
  }
}

module.exports = { NS, handle };
