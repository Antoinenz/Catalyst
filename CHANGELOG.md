# Changelog

All notable changes to Catalyst are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

A full UX/backend audit pass — every finding was either fixed or logged
below/in `BRAINSTORM.md`'s roadmap — plus three new features.

### Fixed

- **Cancelling during metadata fetch was ignored.** `fetch_metadata()` used
  to unconditionally set the job back to `Queued` after the yt-dlp metadata
  process exited, clobbering a `Cancelled` status set moments earlier — the
  download would silently proceed anyway. The metadata sidecar is now also
  registered so `cancel_download` has something to kill during "Fetching
  info…", and a Cancelled status is never overwritten.
- **Removing an active download orphaned its process.** Single or bulk
  "remove" only deleted the job from the in-memory list; if it was still
  downloading, the yt-dlp process kept running in the background with no
  way to stop it. `remove_job`/`remove_jobs` now kill the process first.
- **Re-download from History didn't switch tabs or keep the category.** A
  callback wired from `App.tsx` was never actually used by `HistoryTab` —
  the button called `add_download` directly instead, so nothing indicated
  the redownload had started, and the original category was dropped.
- **"Clear done" / "Clear all" had no confirmation**, unlike every other
  destructive action in the app. Both now confirm first.
- **"Import from file" in Bulk Import didn't read the file.** It opened a
  native picker and did nothing with the result. Added a minimal
  `read_text_file` command and wired it up.
- **History stats re-parsed formatted size strings** (e.g. "12.34 MiB")
  back into numbers on every call. Now stored as a raw `size_bytes` column,
  backfilled once for existing rows.
- **`--windows-filenames` applied on every platform**, unnecessarily
  stripping valid filename characters on macOS/Linux. Now Windows-only.
- **yt-dlp self-update always reported success**, even when it failed (most
  commonly: no write access to the install directory). Now checks the
  actual exit code and surfaces a clear explanation on failure.
- **No visible keyboard focus indicator** on almost any control besides two
  text inputs — Tab navigation was effectively invisible. Added a global
  `:focus-visible` style.
- **Blanket `select-none` on the whole app** prevented copying titles, file
  paths, or error text. Scoped to just the chrome that benefits from it.

### Added

- **Duplicate-URL warning** when adding a link already active in the queue
  (main Add bar and Bulk Import), instead of silently double-queuing it.
- **Playlist/channel notice** when a pasted URL looks like one, since
  Catalyst only downloads a single video per link (`--no-playlist` always
  applies) — this wasn't previously explained anywhere.
- **Plain-language failure explanations** for common cases (private,
  age-restricted, members-only, geo-blocked, bot-detected, HTTP
  403/404/410/429, network failures), with the original yt-dlp output kept
  alongside for debugging/bug reports.
- **History keeps queued/partial/failed/cancelled downloads**, not just
  successful ones, with a status badge and error message in the UI. Stats
  (Total downloads, Avg/day, etc.) are scoped to `status = 'Finished'` so
  this doesn't skew them.
- **Resume after a crash or restart.** The active queue is checkpointed to
  disk every 5 seconds; on next launch, anything still active is restored
  and automatically re-queued — yt-dlp resumes a partially-downloaded file
  by default since Catalyst reuses the same output path. A one-time
  "Resumed N downloads…" banner reports this.
- **Custom yt-dlp arguments** (Settings → Advanced), applied to every
  metadata fetch and download — e.g. `--limit-rate 2M --user-agent "..."`.
- **Expanded metadata**: codec, fps, and yt-dlp's estimated file size,
  shown in the Queue and History details panes.

### Changed

- `fetch_metadata`'s one-`--print`-per-field approach could silently desync
  every field after the first one that came back blank for a given site
  (e.g. no uploader) — replaced with a single delimited `--print` template
  so fields stay aligned to their index regardless of which are empty.

See `BRAINSTORM.md`'s roadmap section for audit findings that were
deliberately deferred rather than fixed this pass (theme support, toast
feedback, and others), plus new feature ideas raised during this work.
