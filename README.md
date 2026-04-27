<div align="center">

<img src="src-tauri/icons/128x128.png" alt="Catalyst" width="72" />

# Catalyst

**The video downloader, done right.**

A lightweight, cross-platform desktop app powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) — 1800+ sites, smart queue, zero bloat.

[Download](#download) · [Features](#features) · [Development](#development) · [Website](https://antoinenz.github.io/Catalyst)

</div>

---

## Why Catalyst?

Most video downloaders are sketchy, have ads, require subscriptions, or just don't work. yt-dlp is incredible but its CLI is hard to remember and doesn't handle batches well.

Catalyst is a proper desktop UI for yt-dlp — fast, private, and packed with features people actually need.

## Features

- **1800+ supported sites** — YouTube, Vimeo, Twitter/X, TikTok, Reddit, Instagram, and many more via yt-dlp
- **Smart download queue** — Add multiple URLs, reorder by dragging, configure concurrency (1–8 simultaneous)
- **Format & quality control** — MP4 (H264), Best Quality (AV1/VP9), MP3, M4A · 4K / 1080p / 720p / 480p
- **Cache folder** — Downloads go to a temp cache first; clean files move to your output folder only when complete
- **Output categories** — Named destinations (Movies, Music, Work…) each with their own directory and colour tag
- **Metadata prefetch** — Title, thumbnail, channel, and duration fetched before the download starts
- **History** — Full download log with search, grouped by date, preview pane, re-download
- **System tray** — Runs quietly in the background; click to show/hide
- **OS notifications** — Get notified when downloads finish (only when window isn't focused)
- **Update checker** — Keeps yt-dlp updated automatically; checks for Catalyst updates too
- **Cookie support** — Automatically pull cookies from Chrome, Edge, Firefox, Brave, or import a file (for members-only content)
- **Proxy support** — HTTP(S) and SOCKS5
- **No tracking, no analytics** — everything stays on your machine

## Download

> Releases are coming soon. In the meantime, build from source.

| Platform | Status |
|----------|--------|
| Windows  | ✓ Supported |
| macOS    | ✓ Supported |
| Linux    | ✓ Supported |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | [Tauri v2](https://tauri.app/) (Rust) |
| Backend / queue | Rust — process management, SQLite history |
| UI | React 18 + TypeScript + Tailwind CSS |
| Download engine | [yt-dlp](https://github.com/yt-dlp/yt-dlp) (bundled sidecar binary) |
| Components | shadcn/ui design system |
| Drag & drop | @dnd-kit |

## Development

### Prerequisites

- **Node.js** 18+
- **Rust** 1.88+ (via [rustup](https://rustup.rs/))
- **Windows**: Visual Studio Build Tools with "Desktop development with C++" workload

### Setup

```bash
git clone https://github.com/Antoinenz/Catalyst
cd Catalyst
npm install
npm run tauri dev
```

The first `tauri dev` run compiles the Rust backend — this takes a few minutes. Subsequent runs are incremental and fast.

### Build for production

```bash
npm run tauri build
```

Outputs an installer to `src-tauri/target/release/bundle/`.

### Project structure

```
Catalyst/
├── src/                    # React frontend
│   ├── App.tsx             # Main layout + queue state
│   ├── types.ts            # Shared TypeScript types
│   └── components/
│       ├── HistoryTab.tsx
│       ├── SettingsPage.tsx
│       └── BulkImportModal.tsx
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands + setup
│   │   ├── worker.rs       # yt-dlp process + queue logic
│   │   ├── config.rs       # Settings model
│   │   ├── state.rs        # App state
│   │   ├── db.rs           # SQLite history
│   │   └── browsers.rs     # Browser cookie detection
│   └── binaries/           # yt-dlp sidecar binary
└── docs/                   # GitHub Pages website
```

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
Built with ❤️ using <a href="https://tauri.app">Tauri</a> + <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>
</div>
