'use strict';
/**
 * Netflix Cast payload parser.
 * contentId is the Netflix title URL or numeric ID.
 * Namespace: urn:x-cast:com.netflix.cast.media
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && mediaInfo.contentId;
  if (!contentId) return null;
  if (contentId.startsWith('http')) return contentId;
  // Numeric ID → direct watch URL
  if (/^\d+$/.test(contentId)) return `https://www.netflix.com/watch/${contentId}`;
  // netflix.com/title/xxx or netflix.com/watch/xxx
  if (contentId.includes('netflix.com')) return contentId;
  return `https://www.netflix.com/watch/${contentId}`;
}

module.exports = { appId: 'Netflix', getUrl };
