'use strict';
const NS = 'urn:x-cast:com.google.cast.media';
const { getUrlFromLoad } = require('../services');
const { openUrl } = require('../opener');

let mediaSessionId = 1;

function makeMediaStatus(mediaInfo, playerState, mediaSessionId) {
  return {
    type: 'MEDIA_STATUS',
    status: [{
      mediaSessionId,
      playbackRate: 1,
      playerState: playerState || 'PLAYING',
      currentTime: 0,
      supportedMediaCommands: 15,
      volume: { level: 1.0, muted: false },
      media: mediaInfo || {},
      idleReason: null,
    }],
  };
}

function handle(session, msg) {
  let data;
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { return; }

  const requestId = data.requestId || 0;
  const currentApp = session.getCurrentApp();

  if (data.type === 'LOAD') {
    const media = data.media || {};
    console.log(`[media] LOAD app=${currentApp} contentId=${media.contentId}`);
    console.log(`[media] Full payload:`, JSON.stringify(data).slice(0, 500));

    const url = getUrlFromLoad(currentApp, media);
    // replace=true closes existing Chrome before opening — avoids stacking windows
    if (url) openUrl(url, { replace: true });

    const msId = mediaSessionId++;
    session.setMediaSession(msId);
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeMediaStatus(media, 'PLAYING', msId), requestId }));

  } else if (data.type === 'GET_STATUS') {
    const msId = session.getMediaSession() || 0;
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeMediaStatus({}, 'IDLE', msId), requestId }));

  } else if (data.type === 'PAUSE') {
    const msId = session.getMediaSession() || 0;
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeMediaStatus({}, 'PAUSED', msId), requestId }));

  } else if (data.type === 'PLAY') {
    const msId = session.getMediaSession() || 0;
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeMediaStatus({}, 'PLAYING', msId), requestId }));

  } else if (data.type === 'STOP') {
    const msId = session.getMediaSession() || 0;
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeMediaStatus({}, 'IDLE', msId), requestId }));
  }
}

module.exports = { NS, handle };
