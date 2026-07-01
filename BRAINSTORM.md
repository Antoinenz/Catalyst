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

- [x] Tauri v1 or v2? → **v2**, in use since the scaffold.
- [x] SQLite via `rusqlite` or `sqlx`? → **rusqlite** (`db.rs`).
- [x] How to handle yt-dlp updates — bundle a fixed version or auto-update the sidecar? → **Auto-updates the bundled sidecar in place** (`update_ytdlp`). Works today since builds are unsigned, but self-modifying the sidecar will need to change (update into app-data instead of overwriting the bundle) once builds are code-signed/notarized — see roadmap below.
- [x] Cookie handling UX — importing a Netscape cookies.txt is the yt-dlp standard, but it's arcane for non-technical users. Can we make this friendlier? → **Yes** — Settings → Advanced detects installed browsers/profiles and builds `--cookies-from-browser` for you; raw file import is still available as a fallback.
- [ ] Should the optional HTTP server be in the same binary or a companion `catalyst-server` binary? — still open, remote access (Phase 2) isn't built yet.
- [ ] Which React UI library? → Landed as **hand-rolled Tailwind components**; `shadcn/ui` is scaffolded (`components.json`, CSS variable tokens in `index.css`) but never actually adopted — see roadmap below, this is worth revisiting since it would also fix some duplicated component code (`Sel`, the remove-confirmation modal) and the missing focus rings for free.

---

## Roadmap — UX/Backend Audit Follow-ups

A full review of the UX and backend (see git history / `CHANGELOG.md` for what
was fixed) turned up a few things worth building but deliberately not done in
that pass — either out of scope for a single session, or explicitly deferred
to keep that session focused on requested fixes/features. Rough order of
value, not priority:

- **Light/Dark/System theme.** `index.css` already defines a full light-mode
  CSS variable palette (`:root`) alongside the dark one (`.dark`), and
  `tailwind.config.js` / `components.json` are shadcn-ready — but every
  component hardcodes literal `zinc-*` classes instead of the semantic
  `bg-background` / `text-foreground` / `border-border` tokens those files
  already define. Wiring up an actual toggle (replacing the "Coming soon"
  placeholder in Settings → Application) means converting components over to
  the semantic tokens, which is also the natural point to adopt real
  `shadcn/ui` primitives and dedupe the copy-pasted `Sel`/confirm-modal
  components across `App.tsx`, `HistoryTab.tsx`, and `SettingsPage.tsx`.
- **Toast/inline feedback for silent actions.** Add-download, redownload, and
  settings-save all happen via fire-and-forget `invoke(...).catch(console.error)`
  with no success feedback — easy to miss on tabs where nothing else visibly
  changes.
- **Analytics dashboard: graphs + more metadata.** The Stats tab is
  currently a handful of number cards. A proper dashboard — downloads over
  time, format/quality breakdown, most-downloaded uploaders/categories — would
  make good use of the codec/fps/filesize metadata now being captured, plus
  whatever further per-download detail is worth adding (resolution/bitrate
  history, average speed per download, etc.).
- **Live transfer speed in the details pane / a bottom status bar.** The
  per-download details pane and queue rows already show yt-dlp's reported
  download speed; a bottom bar aggregating every active download's
  network throughput (and, separately, disk write throughput once the
  cache-folder move step is included) would give a quick at-a-glance view
  without opening each item.
- **Bottleneck / slowdown diagnostics.** Tell the user *why* something is
  slow — network-bound (ISP/site throttling), disk-bound (slow write to the
  output/cache directory), or CPU-bound (ffmpeg remux/transcode during
  post-processing) — instead of just showing a speed number. Likely needs a
  lightweight system-resource sampler (e.g. the `sysinfo` crate) correlated
  against yt-dlp's reported speed and the Processing/Merging phases already
  tracked in `worker.rs`.
- **Per-download custom-argument override.** Settings → Advanced now has a
  global custom-args default (applied to everything); a per-download
  override in the Add bar / Bulk Import for power users who want different
  flags per site would be a natural follow-up.
- **Signed & notarized builds.** Release notes currently tell users to
  bypass Gatekeeper/SmartScreen manually — a real trust/adoption cost for a
  video-downloader category that's already viewed with suspicion. Also
  unblocks making yt-dlp self-update safer (see the Open Questions entry
  above).
- Queue search/filter (History already has one).
- List virtualization for History once it grows into the thousands of rows.
- Drag-and-drop a file directly onto the Bulk Import modal (URL-list text
  parsing already works for arbitrary pasted content; dropped-file reading
  would reuse the same `read_text_file` command added for the "Import from
  file" button).
- i18n / localization.

---

## Build Order

1. `[x]` Git init, brainstorm doc
2. `[x]` Tauri v2 project scaffold + React frontend wired up
3. `[x]` yt-dlp sidecar: bundle binary, invoke from Rust, parse progress output
4. `[x]` In-memory download queue with configurable concurrency (now checkpointed to disk for crash/restart recovery too — see roadmap)
5. `[x]` Basic UI: add URL, queue list with live progress bars
6. `[x]` Format/quality picker
7. `[x]` Settings page + persistent config (JSON file)
8. `[x]` SQLite history (now also keeps queued/partial/failed/cancelled downloads, not just successes)
9. `[x]` System tray + OS notifications
10. `[ ]` Optional HTTP server for remote access + auth
11. `[ ]` Playlist/channel support
12. `[x]` Packaging: installers for Windows (.msi), macOS (.dmg), Linux (.AppImage / .deb) — unsigned; see roadmap for code-signing/notarization
