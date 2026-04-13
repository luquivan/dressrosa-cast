'use strict';
const {
  getDeviceCapabilities,
  getFriendlyName,
  getInstanceId,
  getModelName,
} = require('../device');

const NS = 'urn:x-cast:com.google.cast.receiver.discovery';

function handle(session, msg) {
  let data = {};
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { /* empty payload */ }

  const requestId = data.requestId || 0;
  const type = data.type || '';
  console.log(`[discovery] type=${type || '<empty>'} src=${msg.sourceId} req=${requestId}`);

  if (type === 'GET_DEVICE_INFO' || type === '') {
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      type: 'GET_DEVICE_INFO',
      requestId,
      controlNotifications: 1,
      deviceCapabilities: getDeviceCapabilities(),
      deviceId: getInstanceId(),
      deviceModel: getModelName(),
      friendlyName: getFriendlyName(),
    }));
    console.log(`[discovery] Responded GET_DEVICE_INFO to ${msg.sourceId}`);
  }
}

module.exports = { NS, handle };
