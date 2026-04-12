'use strict';
/**
 * HBO Max / Max Cast payload parser.
 *
 * Known contentId formats:
 *   urn:hbo:episode:GVU2cggagVoNJjhsJAXh-   → episode
 *   urn:hbo:feature:GXkR2QgagVoLhjhsJAcYG   → movie
 *   urn:hbo:series:GXkR2QgagVoLhjhsJAcYG    → series (opens show page)
 *   https://play.max.com/...                → full URL (pass through)
 *
 * If the format changes or doesn't match, check [media] Full payload: in the node log.
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && (
    mediaInfo.contentId ||
    (mediaInfo.customData && mediaInfo.customData.content_id)
  );
  if (!contentId) {
    console.log('[hbo] No contentId, falling back to Max homepage');
    return 'https://play.max.com';
  }
  if (contentId.startsWith('http')) return contentId;

  // urn:hbo:<type>:<id> → extract the id part only
  const urnMatch = contentId.match(/^urn:hbo:[^:]+:(.+)$/);
  if (urnMatch) {
    return `https://play.max.com/video/watch/${urnMatch[1]}`;
  }

  return `https://play.max.com/video/watch/${contentId}`;
}

module.exports = { appId: 'HBO', getUrl };
