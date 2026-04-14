'use strict';
/**
 * Handles DeviceAuthChallenge.
 *
 * Matches Shanocast/AirReceiver behavior:
 * - always use the public Google Cast auth cert chain
 * - always reply with the precomputed signature for the current 48-hour window
 * - never echo sender_nonce in the response
 *
 * Modern senders may include sender_nonce in the challenge, but Chrome's Cast
 * stack tolerates nonce-less responses. This replay behavior is the basis of
 * Shanocast's auth bypass.
 */
const fs = require('fs');
const path = require('path');
const { getWindowIndex } = require('./tls');
const { logLine, logError } = require('./logger');

const AUTH_CRT = fs.readFileSync(path.join(__dirname, '../data/auth_crt.der'));
const INTERMEDIATE_CRT = fs.readFileSync(path.join(__dirname, '../data/intermediate_crt.der'));
const SIGNATURES = fs.readFileSync(path.join(__dirname, '../data/signatures.bin'));
const SIG_SIZE = 256;
const SIG_COUNT = Math.floor(SIGNATURES.length / SIG_SIZE);
const MAX_SIG_INDEX = SIG_COUNT - 1;
const EXTRA_SIG_BYTES = SIGNATURES.length - SIG_COUNT * SIG_SIZE;
const RESPONSE_HASH_ALGORITHM = 1; // SHA256
let warnedExtraSigBytes = false;

function getPrecomputedSignature(index) {
  if (EXTRA_SIG_BYTES && !warnedExtraSigBytes) {
    warnedExtraSigBytes = true;
    logLine(`[auth] signatures.bin has ${EXTRA_SIG_BYTES} trailing bytes; ignoring them`);
  }
  if (index < 0 || index > MAX_SIG_INDEX) {
    logError(`[auth] Signature index ${index} out of range (0-${MAX_SIG_INDEX}), using last`);
    return SIGNATURES.slice(MAX_SIG_INDEX * SIG_SIZE, (MAX_SIG_INDEX + 1) * SIG_SIZE);
  }
  return SIGNATURES.slice(index * SIG_SIZE, (index + 1) * SIG_SIZE);
}

/**
 * Build a serialized DeviceAuthMessage response.
 * @param {object} castProto   - protobufjs root
 * @param {Buffer} challengeBinary - raw bytes of the DeviceAuthMessage(challenge)
 */
function buildAuthResponse(castProto, challengeBinary) {
  const DeviceAuthMessage = castProto.lookupType('extensions.api.cast_channel.DeviceAuthMessage');
  const AuthResponse = castProto.lookupType('extensions.api.cast_channel.AuthResponse');

  // Parse challenge for logging/diagnostics only. The response deliberately
  // omits sender_nonce to mirror Shanocast.
  let senderNonce = null;
  let requestedHashAlgorithm = 0;
  if (challengeBinary && challengeBinary.length > 0) {
    try {
      const challengeMsg = DeviceAuthMessage.decode(challengeBinary);
      if (challengeMsg.challenge) {
        const ch = challengeMsg.challenge;
        if (ch.senderNonce && ch.senderNonce.length > 0) {
          senderNonce = Buffer.from(ch.senderNonce);
        }
        if (ch.hashAlgorithm != null) requestedHashAlgorithm = ch.hashAlgorithm;
      }
    } catch (e) {
      logError(`[auth] Failed to parse challenge: ${e.message}`);
    }
  }

  const index = getWindowIndex();
  const signature = getPrecomputedSignature(index);
  const requestedAlgoName = requestedHashAlgorithm === 1 ? 'SHA256' : 'SHA1';
  const nonceInfo = senderNonce ? `${senderNonce.length}B` : 'none';
  logLine(`[auth] challenge nonce=${nonceInfo} requested=${requestedAlgoName}; replying with pre-computed SHA256 sig for window ${index}`);

  const response = DeviceAuthMessage.create({
    response: AuthResponse.create({
      signature,
      clientAuthCertificate: AUTH_CRT,
      intermediateCertificate: [INTERMEDIATE_CRT],
      signatureAlgorithm: 0, // RSASSA_PKCS1v15
      hashAlgorithm: RESPONSE_HASH_ALGORITHM,
    }),
  });

  return DeviceAuthMessage.encode(response).finish();
}

module.exports = { buildAuthResponse };
