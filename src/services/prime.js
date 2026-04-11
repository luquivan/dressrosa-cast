'use strict';
/**
 * Amazon Prime Video Cast payload parser.
 * contentId is usually an ASIN like "B00I3MPZUW"
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && mediaInfo.contentId;
  if (!contentId) return null;
  if (contentId.startsWith('http')) return contentId;
  // ASIN format
  return `https://www.amazon.com/dp/${contentId}`;
}

module.exports = { appId: 'PrimeVideo', getUrl };
