'use strict';

const os = require('os');
const crypto = require('crypto');

const FRIENDLY_NAME = 'Dressrosa Cast';
const MODEL_NAME = 'Chromecast';
const DEVICE_CAPABILITIES = 6149;

function getDeviceId() {
  const host = os.hostname();
  return crypto.createHash('md5').update(host).digest('hex').substring(0, 12).toUpperCase();
}

function getFriendlyName() {
  return FRIENDLY_NAME;
}

function getModelName() {
  return MODEL_NAME;
}

function getDeviceCapabilities() {
  return DEVICE_CAPABILITIES;
}

function getInstanceId() {
  return `${MODEL_NAME}-${getDeviceId()}`;
}

module.exports = {
  getDeviceId,
  getFriendlyName,
  getModelName,
  getDeviceCapabilities,
  getInstanceId,
};
