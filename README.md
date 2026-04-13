# dressrosa-cast

Chromecast receiver for Windows — replaces a broken Chromecast using a PC connected to the TV.

When you press Cast in Netflix, YouTube, Prime Video, Crunchyroll, or HBO Max, it opens the content in Chrome on the PC.

It also exposes a small HTTP control surface so another device on the network or Tailscale can open URLs, close Chrome, inspect state, and capture screenshots.

## How it works

1. Announces itself as `_googlecast._tcp` on the local network via mDNS
2. Exposes a minimal DIAL/SSDP surface on `8008` / `1900` for senders that still probe that path
3. Accepts Cast connections on port `8009` (TLS)
4. Authenticates using pre-computed signatures (shanocast/AirReceiver method)
5. When a LOAD command is received, parses the content ID and opens Chrome

## Requirements

- Node.js 18+
- Windows 10/11
- Optional: `PsExec64.exe` at `C:\Windows\Temp\PsExec64.exe` for reliable interactive UI bridging when managing Dressrosa remotely

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

Minimal DIAL endpoints on port `8008`:

```text
GET|HEAD /ssdp/device-desc.xml
GET|HEAD /setup/eureka_info
GET|HEAD /setup/icon.png
GET|HEAD /apps/<app>
POST      /apps/<app>
DELETE    /apps/<app>/<runId>
```

## Restart from Skypiea

If the receiver goes down, restart it without touching Dressrosa:

```bash
./scripts/restart-service.sh
```

Or manually via SSH:
```bash
ssh -i ~/.ssh/id_ed25519 "Toronja Arenosa"@dressrosa "powershell -Command \"Stop-Process -Name node -Force -ErrorAction SilentlyContinue\""
ssh -i ~/.ssh/id_ed25519 "Toronja Arenosa"@dressrosa 'C:\Windows\Temp\PsExec64.exe -accepteula -i 1 -d wscript.exe "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Dressrosa Cast.vbs"'
```

## Supported services

| Service | Status | URL format |
|---------|--------|------------|
| YouTube | ✅ | `youtube.com/watch?v=<videoId>` |
| Netflix | ✅ | `netflix.com/watch/<numericId>` |
| Prime Video | ✅ | `primevideo.com/detail/<ASIN>` |
| HBO Max / Max | ⚠️ | `play.max.com/video/watch/<id>` (best guess from urn format) |
| Crunchyroll | ⚠️ | `crunchyroll.com/watch/<episodeId>` (best guess) |

For HBO/Crunchyroll: check `%LOCALAPPDATA%\DressrosaCast\dressrosa-cast.log` for the real `[media] Full payload:` line after casting, then update the parser if needed.

## Discovery Notes

- Android / Google Play Services probes `urn:x-cast:com.google.cast.setup` from `gms_cast_prober-*`; the receiver now answers `eureka_info`
- The receiver also exposes `urn:x-cast:com.google.cast.receiver.discovery` (`GET_DEVICE_INFO`) and `GET_APP_AVAILABILITY`
- Some senders probe DIAL/SSDP instead of pure CastV2; the shim on `8008` / `1900` is there for that path
- DIAL requests are logged as `[dial] ...` in `%LOCALAPPDATA%\DressrosaCast\dressrosa-cast.log`

## Screenshot

- Works when TV is ON (uses PrtSc → clipboard, handles WDDM/hardware-accelerated rendering)
- Returns 500 when TV is off (WinDisc virtual display — clipboard capture fails)

## Credits

Auth bypass method from [shanocast](https://github.com/rgerganov/shanocast) by rgerganov.
