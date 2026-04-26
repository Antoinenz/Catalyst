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

Build **Catalyst** — a self-hosted, remote-accessible video download manager powered by yt-dlp, with a polished interface that makes downloading simple for anyone while giving power users full control.

Think: the reliability of yt-dlp + the UX of a modern queueing app + the accessibility of a web service you can run anywhere.

---

## Architecture Decision: CLI vs TUI vs Web App

### Option A — CLI wrapper
- Quick to build, familiar to power users
- Bad: doesn't solve the core UX problem, no remote access, no queue visibility
- **Verdict**: good for a companion tool, not the main product

### Option B — TUI (Terminal UI)
- Rich terminal interface (think htop, lazygit)
- Better queue visibility, keyboard-driven
- Bad: still terminal-only, no remote access, harder to self-host cleanly
- **Verdict**: nice-to-have later, maybe as a mode

### Option C — Self-hosted Web App ✓
- Backend server + web frontend
- Remote accessible out of the box
- Works on any machine, any OS, any browser
- Queue management with live progress (WebSockets)
- Easy to expose via Tailscale, VPN, or reverse proxy
- Self-hostable like qBittorrent or Sonarr
- **Verdict**: the right call — solves every stated requirement naturally

---

## Proposed Architecture

```
catalyst/
├── server/          # Backend — Python (FastAPI)
│   ├── api/         # REST endpoints
│   ├── queue/       # Download queue logic
│   ├── worker/      # yt-dlp wrapper & thread pool
│   └── config/      # Settings management
├── web/             # Frontend — React + TypeScript
│   ├── components/
│   ├── pages/
│   └── hooks/
├── cli/             # Optional CLI client
├── docs/
└── docker/          # Docker + Compose for easy self-hosting
```

### Why Python backend?
- yt-dlp is Python — direct library import, no subprocess overhead if not needed
- FastAPI is fast, async, auto-generates OpenAPI docs
- Easy to install anywhere, familiar to yt-dlp users

### Why React frontend?
- Rich UI for queue management
- Real-time updates via WebSockets
- Could ship as Electron/Tauri desktop app later with zero backend changes

---

## Core Features (Phase 1 — MVP)

### Download Queue
- Add URLs one at a time or in bulk (paste a list)
- Queue displays: title, thumbnail, format, status, progress bar, speed, ETA
- Reorder, pause, cancel individual items
- Configurable concurrent download threads (e.g. 1–8)

### Format & Quality Selection
- Per-download or global defaults
- Video: best, 1080p, 720p, 480p, audio-only (mp3/m4a), etc.
- Smart defaults that just work for most users

### Settings
- Output directory (per-category or global)
- Default format/quality
- Max concurrent downloads
- Speed throttle (optional)
- Filename template (yt-dlp's `--output` format)
- Cookie file support (for members-only content)
- Proxy support

### History
- Persistent log of completed downloads
- Re-download from history
- Search/filter

---

## Core Features (Phase 2 — Remote & Power)

### Remote Access
- Auth (simple token or user/password)
- HTTPS support
- API-first — every action available via REST
- Share download links with others on the same instance

### Scheduler
- "Download at 2am" for bandwidth-sensitive users
- Recurring downloads (e.g. channel subscriptions)

### Playlists & Channels
- Queue an entire playlist or channel
- Filter by date range, count, keyword
- Archive mode: skip already-downloaded items

### Notifications
- Browser push / webhook / email when queue finishes or an item fails

### Themes & Customization
- Light/dark mode
- Compact vs comfortable layout
- Custom download categories with icons and separate output dirs

---

## Phase 3 — Stretch Goals

- **Browser extension**: right-click any video → send to Catalyst
- **Mobile-friendly UI**: manage your queue from your phone
- **Torrent support**: why not, queueing is queueing
- **Metadata enrichment**: auto-tag mp3s, pull thumbnails, write NFO files for media servers (Jellyfin/Plex)
- **TUI mode**: `catalyst tui` for terminal purists
- **Plugin system**: custom post-processors (compress, watermark, notify, etc.)

---

## Competitive Landscape

| Tool | Open Source | Web UI | Queue | Remote | Self-host |
|------|-------------|--------|-------|--------|-----------|
| yt-dlp | ✓ | ✗ | ✗ | ✗ | — |
| ClipGrab | ? | ✗ | basic | ✗ | — |
| MeTube | ✓ | ✓ | basic | partial | ✓ |
| Tartube | ✓ | ✗ | ✓ | ✗ | — |
| **Catalyst** | ✓ | ✓ | ✓ | ✓ | ✓ |

MeTube is the closest competitor — it's good but minimal. Catalyst should feel like what MeTube would be if someone spent real time on the UX, settings, and power-user features.

---

## Name

**Catalyst** — speeds up reactions, enables things that wouldn't happen otherwise. Good metaphor for what we're building. Already the project directory name, let's keep it.

---

## Open Questions

- [ ] Do we want an Electron/Tauri desktop build from the start, or add it later?
- [ ] Cookie/auth handling for premium content — how do we make this safe and easy?
- [ ] Should the API be stable enough for third-party clients from day one?
- [ ] Packaging: pip install? Docker only? Standalone binary via PyInstaller/Nuitka?
- [ ] Should we support other backends besides yt-dlp (gallery-dl, spotdl)?

---

## Build Order

1. `[x]` Git init, repo structure, brainstorm doc
2. `[ ]` Backend scaffold: FastAPI + yt-dlp worker + in-memory queue
3. `[ ]` WebSocket progress stream
4. `[ ]` Basic frontend: add URL, see queue, watch progress
5. `[ ]` Settings page + persistent config
6. `[ ]` History + completed downloads
7. `[ ]` Docker + Compose for self-hosting
8. `[ ]` Auth for remote access
9. `[ ]` Polish: format picker, bulk add, notifications
10. `[ ]` Docs + README
