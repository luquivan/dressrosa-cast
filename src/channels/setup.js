'use strict';
/**
 * urn:x-cast:com.google.cast.setup
 *
 * Openscreen handles "eureka_info" on this namespace and GET_DEVICE_INFO on
 * "urn:x-cast:com.google.cast.receiver.discovery". We also accept the empty
 * payload observed from gms_cast_prober and answer with eureka_info, which is
 * enough to keep the validation path moving instead of treating the device as
 * an unknown receiver.
 */
const { getFriendlyName, getInstanceId, getModelName } = require('../device');
const { logLine } = require('../logger');

const NS = 'urn:x-cast:com.google.cast.setup';

function handle(session, msg) {
  let data = {};
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { /* empty payload */ }

  const requestId = data.request_id || 0;
  const type = data.type || '';
  logLine(`[setup] type=${type || '<empty>'} src=${msg.sourceId} req=${requestId}`);

  if (type === 'eureka_info' || type === '') {
    // Fields at top level (not nested under 'data') — matches real Chromecast behavior.
    // setup_state: 60 = fully set up. Without this GMS treats the device as unconfigured.
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      type: 'eureka_info',
      request_id: requestId,
      response_code: 200,
      response_string: 'OK',
      version: 12,
      name: getFriendlyName(),
      setup_state: 60,
      locale: 'en-US',
      device_info: {
        manufacturer: 'Google Inc.',
        product_name: getModelName(),
        ssdp_udn: getInstanceId(),
        model_name: getModelName(),
        extended_device_status: 0,
        device_status: 0,
        netif_status: 1,
      },
      build_info: {
        build_type: 0,
        cast_build_revision: '1.56.235556',
        system_build_number: '235556',
        release_track: 'stable-channel',
        version: 12,
      },
      net: {
        connected: true,
      },
    }));
    logLine(`[setup] Responded eureka_info to ${msg.sourceId}`);
  }
}

module.exports = { NS, handle };
