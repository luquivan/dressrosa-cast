'use strict';
const NS = 'urn:x-cast:com.google.cast.receiver';

// Track the currently running app per session
const sessions = new Map();

function makeReceiverStatus(appId, displayName, sessionId) {
  const status = {
    type: 'RECEIVER_STATUS',
    status: {
      volume: { level: 1.0, muted: false },
    },
  };
  if (appId) {
    status.status.applications = [{
      appId,
      displayName: displayName || appId,
      sessionId: sessionId || 'cast-session-1',
      statusText: 'Ready',
      namespaces: [
        { name: 'urn:x-cast:com.google.cast.media' },
        { name: 'urn:x-cast:com.netflix.cast.media' },
      ],
      transportId: sessionId || 'cast-session-1',
      isIdleScreen: false,
    }];
  }
  return status;
}

function handle(session, msg) {
  let data;
  try { data = JSON.parse(msg.payloadUtf8 || '{}'); } catch { return; }

  const requestId = data.requestId || 0;
  const state = sessions.get(session.id) || {};

  if (data.type === 'GET_STATUS') {
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeReceiverStatus(state.appId, state.displayName, state.sessionId), requestId }));

  } else if (data.type === 'GET_APP_AVAILABILITY') {
    const appIds = Array.isArray(data.appId)
      ? data.appId
      : (typeof data.appId === 'string' ? [data.appId] : []);
    const availability = {};
    for (const appId of appIds) {
      availability[appId] = 'APP_AVAILABLE';
    }
    session.send(msg.destinationId, msg.sourceId, NS, JSON.stringify({
      requestId,
      responseType: 'GET_APP_AVAILABILITY',
      availability,
    }));

  } else if (data.type === 'LAUNCH') {
    const appId = data.appId;
    const sessionId = `cast-${Date.now()}`;
    sessions.set(session.id, { appId, sessionId, displayName: appId });
    console.log(`[receiver] LAUNCH app=${appId} session=${sessionId}`);
    session.setCurrentApp(appId, sessionId);
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeReceiverStatus(appId, appId, sessionId), requestId }));

  } else if (data.type === 'STOP') {
    sessions.delete(session.id);
    session.send(msg.destinationId, msg.sourceId, NS,
      JSON.stringify({ ...makeReceiverStatus(null), requestId }));
  }
}

module.exports = { NS, handle };
