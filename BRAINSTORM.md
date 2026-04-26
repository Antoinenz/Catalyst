# Catalyst — Brainstorm & Vision

> A better video downloader. yt-dlp as the engine, everything else rebuilt from scratch.

---

## The Problem

Existing tools are bad in predictable ways:
- **Web-based downloaders**: sketchy, ads, paywalls, slow, unreliable, often break
- **ClipGrab**: decent but closed-source, inconsistent experience, limited
- **yt-dlp directly**: the best engine out there — fast, open source, reliable, lightweight — but terrible UX
  - Can never remember params
  - No queue management
  - Multi-download = multiple terminals
  - No progress overview
  - No persistent history

**The insight**: yt-dlp doesn't need to be replaced. It needs a better face.

---

## The Goal

Build **Catalyst** — a cross-platform desktop app powered by yt-dlp, with a polished interface that makes downloading simple for anyone while giving power users full control. Like qBittorrent: primarily a desktop app, but with an optional web UI for remote access and self-hosting.

---

## Architecture Decision: Why Tauri (not Electron)

### Electron — ruled out
- Bundles an entire Chromium instance (~150MB binary, ~300–500MB RAM idle)
- This is why Discord, Spotify, VS Code feel heavy
- Unacceptable for a tool that should feel lightweight

### Tauri — chosen ✓
- Uses the **OS's native WebView** instead of bundling Chromium
  - Windows: WebView2 (ships pre-installed on Win10/11)
  - macOS: WebKit (built-in)
  - Linux: WebKitGTK
- Result: ~5–10MB binary, RAM usage comparable to a native app
- UI is still written in web tech (React + TypeScript) — no sacrifice on frontend DX
- Rust backend: fast, memory-safe, ideal for process management and queue logic
- Optional HTTP server in Rust for remote/web UI access (the qBittorrent mode)

### Why not a pure web app?
- Remote access is a *feature*, not the *product* — the desktop experience is primary
- Desktop app means: system tray, OS notifications, native file picker, launch at startup
- Users shouldn't need a browser to use their download manager

---

## Proposed Architecture

```
catalyst/
├── src-tauri/           # Rust backend (Tauri)
│   ├── src/
│   │   ├── main.rs      # Tauri app entry point
│   │   ├── queue.rs     # Download queue + thread pool
│   │   ├── worker.rs    # yt-dlp sidecar process management
│   │   ├── config.rs    # Settings persistence
│   │   └── server.rs    # Optional HTTP/WebSocket server for remote access
│   └── Cargo.toml
├── src/                 # React + TypeScript frontend
│   ├── components/
│   │   ├── Queue/       # Queue list, items, controls
│   │   ├── AddURL/      # URL input, format picker
│   │   └── Settings/
│   ├── pages/
│   └── hooks/
├── sidecars/            # Bundled yt-dlp binaries per platform
│   ├── yt-dlp-x86_64-pc-windows-msvc.exe
│   ├── yt-dlp-x86_64-apple-darwin
│   └── yt-dlp-x86_64-unknown-linux-gnu
├── docs/
└── BRAINSTORM.md
```

### The yt-dlp sidecar approach
yt-dlp ships prebuilt standalone binaries with every release — no Python runtime needed on the user's machine. Tauri has first-class sidecar support: bundle the binary, Tauri handles permissions and path resolution. The Rust backend spawns yt-dlp with the right args, reads stdout/stderr for progress, and streams updates to the frontend via Tauri's event system.

### Data flow
```
User pastes URL
  → React frontend sends Tauri command
  → Rust queue assigns to worker slot
  → Worker spawns yt-dlp sidecar with args
  → yt-dlp stdout parsed for progress (%, speed, ETA)
  → Progress events emitted to frontend via Tauri events
  → UI updates in real time
  → On complete: write to history DB (SQLite)
```

---

## Core Features (Phase 1 — MVP)

### Download Queue
- Add URLs one at a time or in bulk (paste a list)
- Queue displays: title, thumbnail, format, status, progress bar, speed, ETA
- Reorder, pause, cancel individual items
- Configurable concurrent download slots (1–8 threads)

### Format & Quality Selection
- Per-download or global default
- Video: best, 4K, 1080p, 720p, 480p
- Audio only: mp3, m4a, opus, flac
- Smart default: "best video + audio" just works for new users

### Settings
- Output directory (global or per-category)
- Default format/quality
- Max concurrent downloads
- Speed throttle
- Filename template (yt-dlp `--output` syntax with live preview)
- Cookie file import (for members-only / age-gated content)
- Proxy support
- Auto-update yt-dlp sidecar

### History
- SQLite log of all completed downloads
- Re-download from history
- Search, filter, sort

---

## Core Features (Phase 2 — Remote & Power)

### Remote Access (the qBittorrent mode)
- Optional built-in HTTP server (Rust/axum)
- Same React UI served over the network
- Token or user/password auth
- HTTPS via self-signed cert or user-provided cert
- Launch at startup → set-and-forget on a home server or NAS

### Scheduler
- "Start at 2am" for off-peak bandwidth
- Recurring: re-check a channel/playlist for new content

### Playlists & Channels
- Queue entire playlist or channel
- Filter by date range, max count, title keyword
- Archive mode: skip files already downloaded (yt-dlp `--download-archive`)

### Notifications
- OS native notifications (download complete, errors)
- Optional webhook (Discord, ntfy, etc.)

### Themes & Customization
- Light / dark / system mode
- Compact vs comfortable layout density
- Custom categories with separate output directories

---

## Phase 3 — Stretch Goals

- **Browser extension**: right-click any video → "Send to Catalyst"
- **Mobile companion app**: manage queue from phone (talks to the remote server)
- **Metadata enrichment**: auto-tag mp3s, embed thumbnails, write NFO files for Jellyfin/Plex
- **Torrent support**: queueing is queueing
- **Plugin / post-processor system**: run custom scripts after download (compress, move, notify)
- **TUI mode**: `catalyst --tui` for terminal users, talks to same backend
- **gallery-dl / spotdl backends**: expand beyond video to image galleries, Spotify

---

## Competitive Landscape

| Tool | Desktop | Open Source | Queue | Remote | Cross-platform | Lightweight |
|------|---------|-------------|-------|--------|----------------|-------------|
| yt-dlp | CLI only | ✓ | ✗ | ✗ | ✓ | ✓ |
| ClipGrab | ✓ | ? | basic | ✗ | ✓ | ✓ |
| MeTube | Web only | ✓ | basic | ✓ | ✓ | ✓ |
| Tartube | ✓ | ✓ | ✓ | ✗ | partial | ✓ |
| qBittorrent | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Catalyst** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Tartube is actually the closest desktop comparison, but it's built with GTK/Python and feels dated. Catalyst should feel like a modern app — clean, fast, opinionated UI.

---

## Name

**Catalyst** — speeds up reactions, enables things that wouldn't happen otherwise. Good metaphor. Already the directory.

---

## Open Questions

- [ ] Tauri v1 or v2? (v2 is stable as of late 2024, recommended for new projects)
- [ ] SQLite via `rusqlite` or `sqlx`?
- [ ] How to handle yt-dlp updates — bundle a fixed version or auto-update the sidecar?
- [ ] Cookie handling UX — importing a Netscape cookies.txt is the yt-dlp standard, but it's arcane for non-technical users. Can we make this friendlier?
- [ ] Should the optional HTTP server be in the same binary or a companion `catalyst-server` binary?
- [ ] Which React UI library? (Radix UI + Tailwind, shadcn/ui, or fully custom?)

---

## Build Order

1. `[x]` Git init, brainstorm doc
2. `[ ]` Tauri v2 project scaffold + React frontend wired up
3. `[ ]` yt-dlp sidecar: bundle binary, invoke from Rust, parse progress output
4. `[ ]` In-memory download queue with configurable concurrency
5. `[ ]` Basic UI: add URL, queue list with live progress bars
6. `[ ]` Format/quality picker (call yt-dlp `--dump-json` to get available formats)
7. `[ ]` Settings page + persistent config (TOML or JSON file)
8. `[ ]` SQLite history
9. `[ ]` System tray + OS notifications
10. `[ ]` Optional HTTP server for remote access + auth
11. `[ ]` Playlist/channel support
12. `[ ]` Packaging: installers for Windows (.msi), macOS (.dmg), Linux (.AppImage / .deb)
