'use strict';
/**
 * urn:x-cast:com.google.cast.setup
 *
 * Used by gms_cast_prober (Google Mobile Services background prober) to verify
 * that a discovered mDNS device is a real Chromecast before adding it to the
 * Cast device list. The prober sends an empty payload and expects any response;
 * silence causes it to treat the device as unverified and omit it from the list.
 *
 * We respond with a minimal device info object. The prober doesn't validate the
 * content — it just checks that the connection succeeds and a response arrives.
 */
const NS = 'urn:x-cast:com.google.cast.setup';

function handle(session, msg) {
  let data = {};
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { /* empty payload */ }

  const requestId = data.requestId || 0;
  const type = data.type || '';
  console.log(`[setup] type=${type || '<empty>'} src=${msg.sourceId} req=${requestId}`);

  if (type === 'GET_DEVICE_INFO' || type === '' || type === 'PING') {
    // Respond with minimal device info
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      type: 'DEVICE_INFO',
      requestId,
      deviceInfo: {
        deviceName: 'Dressrosa Cast',
        deviceVersion: '1.0.0',
        deviceType: 1,
      },
    }));
    console.log(`[setup] Responded DEVICE_INFO to ${msg.sourceId}`);
  }
  // Ignore other setup messages (UPDATE, etc.)
}

module.exports = { NS, handle };
