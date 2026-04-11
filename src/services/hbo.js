'use strict';
/**
 * HBO Max Cast payload parser.
 * Payload format requires reverse engineering — placeholder until captured.
 * TODO: intercept real cast payload with mitmproxy to determine contentId format.
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && mediaInfo.contentId;
  if (!contentId) return null;
  if (contentId.startsWith('http')) return contentId;
  // HBO Max content IDs look like: urn:hbo:episode:xxx or just UUIDs
  // Fallback: open HBO homepage
  return `https://www.hbomax.com`;
}

module.exports = { appId: 'HBO', getUrl };
