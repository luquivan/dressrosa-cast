# dressrosa-cast

Chromecast receiver for Windows — replaces a broken Chromecast using a PC connected to the TV.

When you press Cast in Netflix, YouTube, Prime Video, Crunchyroll, or HBO Max, it opens the content in Chrome on the PC.

It also exposes a small HTTP control surface so another device on the network or Tailscale can open URLs, close Chrome, inspect state, and capture screenshots.

## How it works

1. Announces itself as `_googlecast._tcp` on the local network via mDNS
2. Accepts Cast connections on port 8009 (TLS)
3. Authenticates using pre-computed signatures (shanocast/AirReceiver method)
4. When a LOAD command is received, parses the content ID and opens Chrome

## Requirements

- Node.js 18+
- Windows 10/11

## Install

```bash
npm install
node scripts/install-service.js
```

This installs a hidden launcher into the Windows Startup folder for the logged-in user.

Then log off and back on, or run manually from Dressrosa's desktop session:
```bash
node src/index.js
```

## Remote Control From Skypiea

```bash
./scripts/screenshot.sh
./scripts/open-url.sh https://www.crunchyroll.com
```

Available endpoints on port `8010`:

```text
GET  /health
GET  /state
GET  /screenshot
GET  /open?url=...&replace=1&newWindow=1
POST /open         {"url":"https://...","replace":true,"newWindow":true}
GET  /close
POST /close
```

## Supported services

| Service | Status |
|---------|--------|
| YouTube | ✅ |
| Netflix | ✅ |
| Prime Video | ✅ |
| HBO Max | 🔧 (needs payload capture) |
| Crunchyroll | 🔧 (needs payload capture) |

## Credits

Auth bypass method from [shanocast](https://github.com/rgerganov/shanocast) by rgerganov.
