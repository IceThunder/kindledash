<div align="center">

# KindleDash

**One dashboard for your jailbroken Kindle — over Wi‑Fi.**

📚 Library · 🖥️ Screen mirror · 📊 Performance · ⚙️ Processes · 📁 Files · ⌨️ Root terminal

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)
![UI](https://img.shields.io/badge/UI-English%20%7C%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87%20%7C%20%E6%97%A5%E6%9C%AC%E8%AA%9E%20%7C%20%ED%95%9C%EA%B5%AD%EC%96%B4-informational)
![Transport](https://img.shields.io/badge/transport-SSH%20over%20Wi--Fi-success)

**English** | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

<!-- TODO: add a screenshot / GIF here — a hero image helps a lot -->

</div>

---

KindleDash is a cross-platform (macOS / Windows) desktop manager for **jailbroken Kindle** devices. It talks to the device over SSH — no USB cable, no drivers — and gives you a library browser, a live view of the e-ink screen, performance monitoring, process management, a full file manager and a root terminal in one window.

Developed and verified on a real Kindle Paperwhite (firmware 5.6.1.1, kernel 2.6.31-rt11-lab126). See [device compatibility notes](docs/机型适配调研.md) (Chinese).

## ✨ Features

### 📚 Library
- Cover grid of every book on the device — title, author, ASIN, publisher, format and size
- Search, sort and filter by format
- Upload new books, download them to your computer, delete with automatic cleanup of `.sdr` sidecar folders
- Reads MOBI/AZW3 EXTH metadata and extracts embedded cover art; covers are cached locally, so the second scan opens instantly

### 🖥️ Screen mirror
- Live view of the e-ink display: adjustable polling (0.5–5 s), manual refresh, save screenshot
- Frames are only transferred when the screen actually changes — a static e-ink frame costs about 20 KB
- Keeps the last frame on disconnect, resizes with the window

### 📊 Overview & performance
- Device info: model, firmware, serial number, hardware / board
- Live CPU curve, memory breakdown, load average, battery (capacity / voltage / temperature / current) and storage per partition
- Ring gauges for battery, temperature and uptime
- Reboot the device

### 🧹 Junk cleanup
- Scans orphan `.sdr` annotation folders, system leftovers and temp files
- You tick, you confirm, it deletes — nothing is ever removed automatically

### ⚙️ Processes & threads
- Every process with CPU %, RSS, state and thread count
- Per-thread CPU usage (two-sample delta from `/proc`), kill processes

### 📁 File manager
- Full SFTP browser: upload, download, create, rename, recursive delete and text preview — with transfer progress

### ⌨️ Remote terminal
- A root shell on the device (xterm.js) for everything else

## 🔌 Highlights

- **Robust connection** — auto-reconnect (up to 30 tries × 5 s), serialised polling so channels never pile up, and the Kindle is kept awake while connected (can be turned off)
- **Multi-device** — save profiles for several Kindles and switch between them; each device gets its own library cache
- **Light on the device** — all polling is merged into a single SSH round-trip; connection settings are remembered and it auto-connects on launch
- **Four UI languages** — English, 简体中文, 日本語, 한국어, auto-detected from your system language

## 🚀 Getting started

### Requirements
- A jailbroken Kindle with SSH enabled (port 22) and root access (private key or password)
- The device and your computer on the same network
- For development: Node.js ≥ 18

### Connect
1. Launch KindleDash and open **Connection settings** (bottom-left).
2. Enter the Kindle's IP address (visible in the device's Wi-Fi settings).
3. Pick a private key or password — done. Settings are saved and it reconnects automatically on the next launch.

> Tip: Kindles don't answer `ping` (ICMP is blocked) — that's normal. KindleDash connects over TCP to the SSH port.

### Install / build

Grab a build from [Releases](https://github.com/IceThunder/kindledash/releases), or build it yourself:

```bash
npm install
npm run dev        # development with hot reload
npm run dist:mac   # macOS dmg (Apple Silicon)
npm run dist:win   # Windows x64 installer + portable (run on Windows)
```

<details>
<summary>Development extras</summary>

```bash
npm run typecheck  # TypeScript check
npm run build      # production build (out/)
```

Backend integration tests against a real device (no UI):

```bash
KINDLE_HOST=192.168.x.x KINDLE_KEY=~/.ssh/your-key.pem npx tsx src/test-integration.ts
```

**macOS XProtect note:** newer macOS may delete the unsigned Electron binary installed by npm (symptom: `node_modules/electron/dist/Electron.app` disappears, `npm run dev` fails with ENOENT or exits silently). Fix:

```bash
cd node_modules/electron && node install.js
codesign --force --deep --sign - dist/Electron.app
```

Project structure:

```
src/
├── main/               # Electron main process
│   ├── index.ts        #   window / IPC / polling scheduler / terminal channel
│   ├── kindle.ts       #   SSH connection (auto-reconnect / exec / SFTP / shell)
│   ├── stats.ts        #   /proc parsing (CPU / memory / processes / device info)
│   ├── screen.ts       #   screen capture (gzip → decode → crop → change detection)
│   ├── library.ts      #   library scan + metadata
│   ├── mobi.ts         #   MOBI/AZW3 EXTH parsing / cover extraction
│   ├── cleanup.ts      #   junk scan
│   ├── files.ts        #   SFTP file operations (upload / download / progress)
│   ├── settings.ts     #   app settings
│   └── i18n.ts         #   main-process i18n
├── preload/index.ts    # contextBridge
├── renderer/src/       # React UI
└── shared/             # shared types + four-language dictionaries
```

</details>

## 📱 Device compatibility

The screen mirror is tuned for 758×1024 @ 8bpp panels (Paperwhite-era); resolution and pixel format are constants at the top of `src/main/screen.ts` (PW3/Voyage use 1072×1448). Everything else reads generic `/proc` and SFTP, so it works across Kindle models. Field notes: [docs/机型适配调研.md](docs/机型适配调研.md) (Chinese).

## 🙏 Acknowledgements

Screen handling and device data build on the work of [FBInk](https://github.com/NiLuJe/FBInk), [KOReader](https://github.com/koreader/koreader) and the [MobileRead](https://www.mobileread.com/forums/) community.

## 📄 License

[MIT](LICENSE) — free to use, modify and distribute. This project is meant for managing jailbroken Kindle devices you own.

---

Found KindleDash useful? ⭐ Star the repo and share it — it helps other Kindle owners find it.
