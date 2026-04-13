'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { URL } = require('url');
const { logLine, logError } = require('./logger');
const {
  getFriendlyName,
  getInstanceId,
  getModelName,
} = require('./device');

const DIAL_HTTP_PORT = 8008;
const SSDP_PORT = 1900;
const SSDP_ADDR = '239.255.255.250';
const DIAL_SERVICE_TYPE = 'urn:dial-multiscreen-org:service:dial:1';
const DIAL_DEVICE_TYPE = 'urn:dial-multiscreen-org:device:dial:1';
const APP_NAMESPACE = 'urn:dial-multiscreen-org:schemas:dial';
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0r4AAAAASUVORK5CYII=',
  'base64',
);

function getLanInterface() {
  const ifaces = os.networkInterfaces();
  const candidates = [];
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (ip.startsWith('100.')) continue;
      if (ip.startsWith('192.168.56.')) continue;
      if (ip.startsWith('172.')) continue;
      if (ip.startsWith('169.254.')) continue;
      candidates.push(ip);
    }
  }
  const lan = candidates.find(ip => ip.startsWith('192.168.'));
  return lan || candidates[0];
}

function xmlEscape(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildDeviceDescXml(baseUrl) {
  const udn = `uuid:${getInstanceId()}`;
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <URLBase>${xmlEscape(baseUrl)}</URLBase>
  <device>
    <deviceType>${DIAL_DEVICE_TYPE}</deviceType>
    <friendlyName>${xmlEscape(getFriendlyName())}</friendlyName>
    <manufacturer>Google Inc.</manufacturer>
    <modelName>${xmlEscape(getModelName())}</modelName>
    <UDN>${xmlEscape(udn)}</UDN>
    <serviceList>
      <service>
        <serviceType>${DIAL_SERVICE_TYPE}</serviceType>
        <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>
        <controlURL>/ssdp/not-used</controlURL>
        <eventSubURL>/ssdp/not-used</eventSubURL>
        <SCPDURL>/ssdp/not-used</SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

function buildDialAppXml(appName, state) {
  return `<?xml version="1.0"?>
<service xmlns="${APP_NAMESPACE}" dialVer="1.7">
  <name>${xmlEscape(appName)}</name>
  <options allowStop="true"/>
  <state>${xmlEscape(state)}</state>
</service>`;
}

function buildEurekaInfo(baseUrl) {
  return JSON.stringify({
    version: 12,
    name: getFriendlyName(),
    setup_state: 60,
    locale: 'en-US',
    ssdp_udn: getInstanceId(),
    detail_icon_url: `${baseUrl}/setup/icon.png`,
    device_info: {
      manufacturer: 'Google Inc.',
      product_name: getModelName(),
      ssdp_udn: getInstanceId(),
      model_name: getModelName(),
      extended_device_status: 0,
      device_status: 0,
    },
    build_info: {
      build_type: 0,
      cast_build_revision: '1.56.235556',
      system_build_number: '235556',
      release_track: 'stable-channel',
    },
    net: {
      connected: true,
    },
  });
}

function getSsdpResponseTarget(text) {
  const upper = text.toUpperCase();
  if (upper.includes(`ST: ${DIAL_SERVICE_TYPE.toUpperCase()}`)) {
    return { st: DIAL_SERVICE_TYPE, usn: `uuid:${getInstanceId()}::${DIAL_SERVICE_TYPE}` };
  }
  if (upper.includes(`ST: ${DIAL_DEVICE_TYPE.toUpperCase()}`)) {
    return { st: DIAL_DEVICE_TYPE, usn: `uuid:${getInstanceId()}::${DIAL_DEVICE_TYPE}` };
  }
  if (upper.includes('ST: UPNP:ROOTDEVICE')) {
    return { st: 'upnp:rootdevice', usn: `uuid:${getInstanceId()}::upnp:rootdevice` };
  }
  if (upper.includes('ST: SSDP:ALL')) {
    return { st: DIAL_SERVICE_TYPE, usn: `uuid:${getInstanceId()}::${DIAL_SERVICE_TYPE}` };
  }
  return null;
}

function startDialServer() {
  const lanIp = getLanInterface();
  if (!lanIp) {
    logError('[dial] Could not find LAN interface — DIAL disabled');
    return null;
  }

  const baseUrl = `http://${lanIp}:${DIAL_HTTP_PORT}`;
  const appStates = new Map();

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;
    const remote = req.socket.remoteAddress;
    logLine(`[dial] HTTP ${req.method} ${pathname}${url.search} from ${remote}`);
    res.setHeader('Application-URL', `${baseUrl}/apps`);

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/ssdp/device-desc.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(req.method === 'HEAD' ? '' : buildDeviceDescXml(baseUrl));
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/setup/eureka_info') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? '' : buildEurekaInfo(baseUrl));
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/setup/icon.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? '' : TRANSPARENT_PNG);
      return;
    }

    if (pathname.startsWith('/apps/')) {
      const appName = decodeURIComponent(pathname.split('/')[2] || '');
      const runId = pathname.split('/')[3] || 'run';
      const currentState = appStates.get(appName) || 'stopped';

      if ((req.method === 'GET' || req.method === 'HEAD') && appName) {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(req.method === 'HEAD' ? '' : buildDialAppXml(appName, currentState));
        return;
      }

      if (req.method === 'POST' && appName) {
        appStates.set(appName, 'running');
        logLine(`[dial] POST /apps/${appName} -> running`);
        res.writeHead(201, {
          'Content-Type': 'text/xml; charset=utf-8',
          Location: `${baseUrl}/apps/${encodeURIComponent(appName)}/${runId}`,
        });
        res.end(buildDialAppXml(appName, 'running'));
        return;
      }

      if (req.method === 'DELETE' && appName) {
        appStates.set(appName, 'stopped');
        logLine(`[dial] DELETE /apps/${appName}/${runId} -> stopped`);
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(buildDialAppXml(appName, 'stopped'));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  httpServer.on('error', (err) => {
    logError(`[dial] HTTP error: ${err.message}`);
  });

  httpServer.listen(DIAL_HTTP_PORT, '0.0.0.0', () => {
    logLine(`[dial] HTTP server on ${baseUrl}`);
  });

  const ssdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  ssdpSocket.on('error', (err) => {
    logError(`[dial] SSDP error: ${err.message}`);
  });

  ssdpSocket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (!text.startsWith('M-SEARCH * HTTP/1.1')) return;
    const stLine = text.split('\r\n').find(line => line.toUpperCase().startsWith('ST:')) || '';
    logLine(`[dial] SSDP M-SEARCH from ${rinfo.address}:${rinfo.port} ${stLine}`);

    const target = getSsdpResponseTarget(text);
    if (!target) return;

    const response = [
      'HTTP/1.1 200 OK',
      'CACHE-CONTROL: max-age=1800',
      `DATE: ${new Date().toUTCString()}`,
      'EXT:',
      `LOCATION: ${baseUrl}/ssdp/device-desc.xml`,
      'OPT: "http://schemas.upnp.org/upnp/1/0/"; ns=01',
      '01-NLS: 1',
      'BOOTID.UPNP.ORG: 1',
      'CONFIGID.UPNP.ORG: 1',
      `SERVER: Windows/10.0 UPnP/1.0 DressrosaCast/1.0`,
      `ST: ${target.st}`,
      `USN: ${target.usn}`,
      '',
      '',
    ].join('\r\n');

    ssdpSocket.send(Buffer.from(response, 'utf8'), rinfo.port, rinfo.address, (err) => {
      if (err) logError(`[dial] SSDP send error: ${err.message}`);
      else logLine(`[dial] SSDP response to ${rinfo.address}:${rinfo.port}`);
    });
  });

  ssdpSocket.bind(SSDP_PORT, () => {
    try {
      ssdpSocket.addMembership(SSDP_ADDR, lanIp);
      logLine(`[dial] Joined SSDP multicast ${SSDP_ADDR} on ${lanIp}`);
    } catch (err) {
      logError(`[dial] addMembership failed: ${err.message}`);
    }
  });

  return {
    stop() {
      httpServer.close();
      ssdpSocket.close();
    },
  };
}

module.exports = { startDialServer };
