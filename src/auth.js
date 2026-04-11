'use strict';
/**
 * Handles DeviceAuthChallenge using pre-computed signatures from shanocast.
 * Returns a valid AuthResponse using the AirReceiver-derived device certificate.
 */
const fs = require('fs');
const path = require('path');
const { getWindowIndex } = require('./tls');

const AUTH_CRT = fs.readFileSync(path.join(__dirname, '../data/auth_crt.der'));
const INTERMEDIATE_CRT = fs.readFileSync(path.join(__dirname, '../data/intermediate_crt.der'));
const SIGNATURES = fs.readFileSync(path.join(__dirname, '../data/signatures.bin'));
const START_DATE_SEC = 1692057600;
const TWO_DAYS_SEC = 2 * 24 * 60 * 60;
const SIG_SIZE = 256;
const MAX_SIG_INDEX = Math.floor(SIGNATURES.length / SIG_SIZE) - 1;

function getSignature(index) {
  if (index < 0 || index > MAX_SIG_INDEX) {
    console.error(`[auth] Signature index ${index} out of range (0-${MAX_SIG_INDEX})`);
    // Return last available signature as fallback
    return SIGNATURES.slice(MAX_SIG_INDEX * SIG_SIZE, (MAX_SIG_INDEX + 1) * SIG_SIZE);
  }
  return SIGNATURES.slice(index * SIG_SIZE, (index + 1) * SIG_SIZE);
}

/**
 * Build a serialized DeviceAuthMessage response for the given protobuf roots.
 */
function buildAuthResponse(castProto) {
  const index = getWindowIndex();
  const sig = getSignature(index);

  const AuthResponse = castProto.lookupType('extensions.api.cast_channel.AuthResponse');
  const DeviceAuthMessage = castProto.lookupType('extensions.api.cast_channel.DeviceAuthMessage');

  const response = DeviceAuthMessage.create({
    response: AuthResponse.create({
      signature: sig,
      clientAuthCertificate: AUTH_CRT,
      intermediateCertificate: [INTERMEDIATE_CRT],
      signatureAlgorithm: 0, // RSASSA_PKCS1v15
      hashAlgorithm: 0,      // SHA1
      // sender_nonce intentionally omitted (matches shanocast behavior)
    }),
  });

  return DeviceAuthMessage.encode(response).finish();
}

module.exports = { buildAuthResponse };
