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

const NS = 'urn:x-cast:com.google.cast.setup';

function handle(session, msg) {
  let data = {};
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { /* empty payload */ }

  const requestId = data.request_id || 0;
  const type = data.type || '';
  console.log(`[setup] type=${type || '<empty>'} src=${msg.sourceId} req=${requestId}`);

  if (type === 'eureka_info' || type === '') {
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      type: 'eureka_info',
      request_id: requestId,
      response_code: 200,
      response_string: 'OK',
      data: {
        version: 12,
        name: getFriendlyName(),
        device_info: {
          manufacturer: 'google',
          product_name: getModelName(),
          ssdp_udn: getInstanceId(),
        },
        build_info: {
          build_type: 2,
          cast_build_revision: '1.0',
          system_build_number: 'BUILD_NUMBER',
        },
      },
    }));
    console.log(`[setup] Responded eureka_info to ${msg.sourceId}`);
  }
}

module.exports = { NS, handle };
