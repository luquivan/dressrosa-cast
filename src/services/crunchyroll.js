'use strict';
/**
 * Crunchyroll Cast payload parser.
 * Payload format requires reverse engineering — placeholder until captured.
 * TODO: intercept real cast payload with mitmproxy to determine contentId format.
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && mediaInfo.contentId;
  if (!contentId) return null;
  if (contentId.startsWith('http')) return contentId;
  // Crunchyroll episode IDs — format TBD after capture
  return `https://www.crunchyroll.com/watch/${contentId}`;
}

module.exports = { appId: 'Crunchyroll', getUrl };
