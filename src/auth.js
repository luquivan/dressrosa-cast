'use strict';
/**
 * Handles DeviceAuthChallenge.
 *
 * If the challenge contains a sender_nonce (Android GMS always does),
 * we compute the real RSA signature over (tls_cert_der || sender_nonce).
 * If the challenge has no nonce (Chrome desktop), we use the pre-computed
 * signature from signatures.bin (shanocast approach).
 *
 * The signature covers the TLS cert (the one presented during the TLS handshake),
 * not the auth cert. Both certs use the same private key (peer_key.der).
 */
const fs = require('fs');
const path = require('path');
const { getWindowIndex, signWithPeerKey } = require('./tls');
const { logLine, logError } = require('./logger');

const AUTH_CRT = fs.readFileSync(path.join(__dirname, '../data/auth_crt.der'));
const INTERMEDIATE_CRT = fs.readFileSync(path.join(__dirname, '../data/intermediate_crt.der'));
const SIGNATURES = fs.readFileSync(path.join(__dirname, '../data/signatures.bin'));
const SIG_SIZE = 256;
const MAX_SIG_INDEX = Math.floor(SIGNATURES.length / SIG_SIZE) - 1;

function getPrecomputedSignature(index) {
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
 * @param {Buffer} tlsCertDer  - DER bytes of the receiver's current TLS cert
 */
function buildAuthResponse(castProto, challengeBinary, tlsCertDer) {
  const DeviceAuthMessage = castProto.lookupType('extensions.api.cast_channel.DeviceAuthMessage');
  const AuthResponse = castProto.lookupType('extensions.api.cast_channel.AuthResponse');

  // Parse challenge to extract sender_nonce and requested algorithm
  let senderNonce = null;
  let hashAlgorithm = 0; // SHA1 default
  if (challengeBinary && challengeBinary.length > 0) {
    try {
      const challengeMsg = DeviceAuthMessage.decode(challengeBinary);
      if (challengeMsg.challenge) {
        const ch = challengeMsg.challenge;
        if (ch.senderNonce && ch.senderNonce.length > 0) {
          senderNonce = Buffer.from(ch.senderNonce);
        }
        if (ch.hashAlgorithm != null) hashAlgorithm = ch.hashAlgorithm;
      }
    } catch (e) {
      logError(`[auth] Failed to parse challenge: ${e.message}`);
    }
  }

  let signature;
  if (senderNonce && tlsCertDer) {
    // Dynamic signature for GMS: RSA(sha1|sha256)(tls_cert_der || sender_nonce)
    const algo = hashAlgorithm === 1 ? 'sha256' : 'sha1';
    const dataToSign = Buffer.concat([tlsCertDer, senderNonce]);
    try {
      signature = signWithPeerKey(dataToSign, algo);
      logLine(`[auth] Signed with ${algo.toUpperCase()} + nonce (${senderNonce.length}B) → ${signature.length}B sig`);
    } catch (e) {
      logError(`[auth] Signing failed: ${e.message}`);
      signature = getPrecomputedSignature(getWindowIndex());
    }
  } else {
    // Pre-computed for no-nonce senders (Chrome desktop)
    const index = getWindowIndex();
    signature = getPrecomputedSignature(index);
    logLine(`[auth] Using pre-computed sig for window ${index}`);
  }

  const response = DeviceAuthMessage.create({
    response: AuthResponse.create({
      signature,
      clientAuthCertificate: AUTH_CRT,
      intermediateCertificate: [INTERMEDIATE_CRT],
      signatureAlgorithm: 0, // RSASSA_PKCS1v15
      hashAlgorithm,
      senderNonce: senderNonce || undefined,
    }),
  });

  return DeviceAuthMessage.encode(response).finish();
}

module.exports = { buildAuthResponse };
