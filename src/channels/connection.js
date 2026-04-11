'use strict';
const NS = 'urn:x-cast:com.google.cast.tp.connection';

function handle(session, msg) {
  const data = JSON.parse(msg.payloadUtf8 || '{}');
  if (data.type === 'CONNECT') {
    console.log(`[conn] CONNECT from ${msg.sourceId}`);
  } else if (data.type === 'CLOSE') {
    console.log(`[conn] CLOSE from ${msg.sourceId}`);
    session.close();
  }
}

module.exports = { NS, handle };
