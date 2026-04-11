'use strict';
/**
 * Maps Cast app IDs to service handlers.
 * App IDs sourced from Google Cast documentation and community resources.
 */
const youtube = require('./youtube');
const netflix = require('./netflix');
const prime = require('./prime');
const hbo = require('./hbo');
const crunchyroll = require('./crunchyroll');

// Known Chromecast app IDs
const APP_ID_MAP = {
  // YouTube
  '233637DE': youtube,
  'YouTube': youtube,
  // Netflix
  'CA5E8412': netflix,
  'Netflix': netflix,
  // Amazon Prime Video
  'D3925776': prime,
  'PrimeVideo': prime,
  // HBO Max
  'E8C28D3C': hbo,
  'HBO': hbo,
  'HBOMax': hbo,
  // Crunchyroll
  'CC1AD845': crunchyroll,
  'Crunchyroll': crunchyroll,
};

function getServiceForApp(appId) {
  return APP_ID_MAP[appId] || null;
}

function getUrlFromLoad(appId, mediaInfo) {
  const service = getServiceForApp(appId);
  if (!service) {
    console.log(`[services] Unknown app: ${appId}, logging payload:`, JSON.stringify(mediaInfo));
    return null;
  }
  const url = service.getUrl(mediaInfo);
  console.log(`[services] ${service.appId} → ${url}`);
  return url;
}

module.exports = { getUrlFromLoad, getServiceForApp };
