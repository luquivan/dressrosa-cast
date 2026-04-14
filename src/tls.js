'use strict';
/**
 * TLS certificate generation matching AirReceiver/Shanocast's peer certificate.
 *
 * The current TLS cert changes every 48 hours, but some fields stay fixed:
 * - serial = 0x051c9ac9
 * - subject/issuer CN = 4aa9ca2e-c340-11ea-8000-18ba395587df
 * - CN is encoded as UTF8String
 * - no keyUsage extension
 * - self-signed with SHA-1 using the extracted peer RSA key
 */
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const PEER_KEY_DER = fs.readFileSync(path.join(__dirname, '../data/peer_key.der'));
const DEVICE_CN = '4aa9ca2e-c340-11ea-8000-18ba395587df';
const START_DATE_SEC = 1692057600; // 2023-08-15 00:00:00 UTC
const TWO_DAYS_SEC = 2 * 24 * 60 * 60;
const TLS_SERIAL = 0x51c9ac9;

let _cachedCert = null;
let _cachedIndex = -1;

function getWindowIndex() {
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.floor((nowSec - START_DATE_SEC) / TWO_DAYS_SEC);
}

function getCertDate(index) {
  return new Date((START_DATE_SEC + index * TWO_DAYS_SEC) * 1000);
}

/**
 * Generate the TLS certificate for the current 48-hour window.
 * Returns { cert, key } as node-forge objects.
 */
function generateTlsCert(index) {
  if (_cachedIndex === index && _cachedCert) return _cachedCert;

  const certDate = getCertDate(index);
  const notAfter = new Date(certDate.getTime() + TWO_DAYS_SEC * 1000);

  // Import the fixed peer RSA key from DER
  const asn1Key = forge.asn1.fromDer(forge.util.createBuffer(PEER_KEY_DER));
  const privateKey = forge.pki.privateKeyFromAsn1(asn1Key);
  const publicKey = forge.pki.rsa.setPublicKey(privateKey.n, privateKey.e);

  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;

  cert.serialNumber = TLS_SERIAL.toString(16);

  cert.validity.notBefore = certDate;
  cert.validity.notAfter = notAfter;

  const attrs = [{
    name: 'commonName',
    value: DEVICE_CN,
    valueTagClass: forge.asn1.Type.UTF8,
  }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Sign with SHA-1 exactly like AirReceiver/Shanocast.
  cert.sign(privateKey, forge.md.sha1.create());

  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');

  _cachedCert = { cert, privateKey, certDer };
  _cachedIndex = index;
  return _cachedCert;
}

/**
 * Get TLS server options (key + cert) for the current window.
 */
function getTlsCredentials() {
  const index = getWindowIndex();
  const { cert, privateKey, certDer } = generateTlsCert(index);

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(privateKey);

  return { certPem, keyPem, certDer, index };
}

module.exports = { getTlsCredentials, getWindowIndex, generateTlsCert };
