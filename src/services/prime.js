'use strict';
/**
 * Amazon Prime Video Cast payload parser.
 *
 * Known contentId formats:
 *   B00I3MPZUW              → ASIN (movie/show)
 *   amzn1.dv.gti.xxx        → Prime Video GID format
 *   https://...             → full URL (pass through)
 *
 * Prime Video watch URL: https://www.primevideo.com/detail/<ASIN>/ref=atv_dp_watch_now
 * If format doesn't match, check [media] Full payload: in the node log.
 */
function getUrl(mediaInfo) {
  const contentId = mediaInfo && (
    mediaInfo.contentId ||
    (mediaInfo.customData && (mediaInfo.customData.videoMaterialType || mediaInfo.customData.playbackId))
  );
  if (!contentId) return 'https://www.primevideo.com';
  if (contentId.startsWith('http')) return contentId;

  // amzn1.dv.gti.* format
  if (contentId.startsWith('amzn1.')) {
    return `https://www.amazon.com/gp/video/detail/${contentId}`;
  }

  // Standard ASIN (B0xxxxxxxxx or similar)
  return `https://www.primevideo.com/detail/${contentId}`;
}

module.exports = { appId: 'PrimeVideo', getUrl };
