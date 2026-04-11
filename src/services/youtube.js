'use strict';
/**
 * YouTube Cast payload parser.
 * contentId is the video ID (e.g. "dQw4w9WgXcQ")
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && mediaInfo.contentId;
  if (!contentId) return null;
  // Could be a full URL or just a video ID
  if (contentId.startsWith('http')) return contentId;
  return `https://www.youtube.com/watch?v=${contentId}`;
}

module.exports = { appId: 'YouTube', getUrl };
