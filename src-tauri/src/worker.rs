use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::config;
use crate::db::HistoryEntry;
use crate::state::{AppState, DownloadStatus};

fn disk_size_str(bytes: u64) -> String {
    if bytes >= 1_073_741_824 { format!("{:.2} GiB", bytes as f64 / 1_073_741_824.0) }
    else if bytes >= 1_048_576 { format!("{:.2} MiB", bytes as f64 / 1_048_576.0) }
    else { format!("{:.1} KiB", bytes as f64 / 1_024.0) }
}

/// Strip ANSI color/style escape sequences. yt-dlp colorizes some output
/// when it detects a terminal-like stream, which can otherwise hide an
/// "ERROR:" line from a plain `starts_with` check (e.g. `\x1b[31mERROR:...`).
/// Simple enough not to need a regex dependency: an escape sequence is
/// ESC '[' followed by parameter/intermediate bytes and a final letter.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() { break; }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// How many trailing lines of raw output to keep as context for when yt-dlp
/// fails without printing a recognizable "ERROR:" line.
const TAIL_LINES: usize = 12;

/// Build a failure message from a non-zero exit. Prefers captured "ERROR:"
/// lines; falls back to the last few lines of raw output instead of a bare
/// exit code, which is what used to happen whenever yt-dlp failed without
/// emitting a line our narrower old check recognized (colored output, a
/// raw crash/traceback, etc.) — the user would just see "yt-dlp exited with
/// code Some(1)" with zero context.
fn build_failure_message(
    code: Option<i32>,
    error_lines: &[String],
    tail: &std::collections::VecDeque<String>,
) -> String {
    if !error_lines.is_empty() {
        return error_lines.join("\n");
    }
    let code_str = code.map(|c| c.to_string()).unwrap_or_else(|| "unknown".to_string());
    if tail.is_empty() {
        format!("yt-dlp exited with code {code_str} and produced no output")
    } else {
        let context = tail.iter().cloned().collect::<Vec<_>>().join("\n");
        format!("yt-dlp exited with code {code_str}. Last output:\n{context}")
    }
}

fn emit_job(state: &Arc<AppState>, id: &str, app: &AppHandle) {
    if let Some(job) = state.get_job(id) { let _ = app.emit("download-update", job); }
}

fn is_cancelled(state: &Arc<AppState>, id: &str) -> bool {
    state.get_job(id).map_or(false, |j| j.status == DownloadStatus::Cancelled)
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

/// Persist a job's current terminal status (Finished/Failed/Cancelled) into
/// history. History used to only ever record successful downloads — now
/// every terminal state is kept (including a download cancelled or failed
/// partway through, or one that never got past "Queued"), so nothing about a
/// job silently disappears once it leaves the active queue. `size_bytes` is
/// only meaningful for a successful, fully-written file.
fn write_history(state: &Arc<AppState>, id: &str, category_id: Option<&str>, size_bytes: Option<i64>) {
    if state.history_is_paused() { return; }
    let Some(job) = state.get_job(id) else { return; };
    let Some(db) = state.db.as_ref() else { return; };
    let (status, error) = match &job.status {
        DownloadStatus::Finished => ("Finished".to_string(), None),
        DownloadStatus::Failed { message } => ("Failed".to_string(), Some(message.clone())),
        _ => ("Cancelled".to_string(), None),
    };
    let _ = db.insert(&HistoryEntry {
        id: job.id, url: job.url,
        title: job.title, thumbnail: job.thumbnail,
        duration: job.duration, uploader: job.uploader,
        format_type: job.format_type, quality: job.quality,
        actual_quality: job.actual_quality,
        size: job.size, output_path: job.output_path,
        downloaded_at: now_secs(),
        category_id: category_id.map(|s| s.to_string()),
        size_bytes, status, error,
        codec: job.codec, fps: job.fps, filesize_approx: job.filesize_approx,
    });
}

// ─── auto-pause on systemic failures ────────────────────────────────────────

/// Actively double-check basic internet connectivity before trusting a
/// "no internet" classification enough to pause the whole queue — a single
/// request timing out or a DNS blip doesn't necessarily mean the machine
/// itself is offline. Tries two well-known, highly-available IPs (never a
/// site the user is downloading from) so one provider's hiccup doesn't
/// cause a false positive; only reports offline if neither answers.
async fn confirm_offline() -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};
    for addr in ["1.1.1.1:443", "8.8.8.8:443"] {
        if timeout(Duration::from_secs(3), TcpStream::connect(addr)).await.is_ok() {
            return false; // something answered — we do have connectivity
        }
    }
    true
}

/// After a failed download, pause the whole queue if — and only if — the
/// failure means every other queued item is doomed too (no internet, no
/// disk space). Emits "queue-auto-paused" with a human-readable reason so
/// the frontend can reflect it live and show a banner instead of the pause
/// happening silently.
async fn maybe_auto_pause_queue(category: ErrorCategory, state: &Arc<AppState>, app: &AppHandle) {
    if !category.is_systemic() { return; }
    if *state.queue_paused.lock().unwrap() { return; } // already paused

    if category == ErrorCategory::NoInternet && !confirm_offline().await {
        return; // just this site/request, not an actual outage
    }

    let reason = match category {
        ErrorCategory::NoInternet   => "No internet connection detected.",
        ErrorCategory::LowDiskSpace => "Low disk space detected.",
        _ => "A problem was detected that would affect every queued download.",
    };
    *state.queue_paused.lock().unwrap() = true;
    *state.auto_pause_reason.lock().unwrap() = Some(reason.to_string());
    let _ = app.emit("queue-auto-paused", reason);
}

// ─── parsers ─────────────────────────────────────────────────────────────────

struct Progress { percent: f32, size: String, speed: String, eta: String }

fn parse_progress(line: &str) -> Option<Progress> {
    let content = line.trim().strip_prefix("[download]")?.trim();
    if !content.contains('%') { return None; }
    let t: Vec<&str> = content.split_whitespace().collect();
    let percent: f32 = t.first()?.strip_suffix('%')?.parse().ok()?;
    let of_i  = t.iter().position(|&x| x == "of")?;
    let at_i  = t.iter().position(|&x| x == "at")?;
    let eta_i = t.iter().position(|&x| x == "ETA")?;
    Some(Progress {
        percent,
        size:  t.get(of_i+1)?.to_string(),
        speed: t.get(at_i+1)?.to_string(),
        eta:   t.get(eta_i+1)?.to_string(),
    })
}

fn parse_destination(line: &str) -> Option<(String, String)> {
    let path = line.trim().strip_prefix("[download] Destination:")?.trim();
    let stem = std::path::Path::new(path).file_stem()?.to_str()?.to_string();
    Some((path.replace(".part", ""), stem))
}

fn parse_merger_path(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("[Merger] Merging formats into ")?;
    Some(rest.trim_matches('"').to_string())
}

fn parse_ffmpeg_destination(line: &str) -> Option<String> {
    let l = line.trim();
    if let Some(rest) = l.strip_prefix("[ffmpeg] Destination:") {
        return Some(rest.trim().to_string());
    }
    if let Some(rest) = l.strip_prefix("[ExtractAudio] Destination:") {
        return Some(rest.trim().to_string());
    }
    None
}

fn is_postprocessing(line: &str) -> bool {
    let l = line.trim();
    l.starts_with("[Merger]") || l.starts_with("[ffmpeg]") || l.starts_with("[Fixup")
        || l.starts_with("[EmbedThumbnail]") || l.starts_with("[MoveFiles]")
        || l.starts_with("[ModifyChapters]") || l.starts_with("[SplitChapters]")
}

// ─── retry / error classification ──────────────────────────────────────────────

/// Errors that impersonation (`--impersonate chrome`) tends to fix: HTTP 410/403/429
/// blocks and YouTube's bot-detection gate. A non-zero yt-dlp exit whose output
/// matches one of these is retried once with impersonation enabled.
fn is_retryable_error(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains("http error 410") || t.contains("410: gone")
        || t.contains("http error 403") || t.contains("403: forbidden")
        || t.contains("http error 429") || t.contains("too many requests")
        // bot-detection gate; loose match tolerates straight/curly apostrophe
        || t.contains("sign in to confirm you")
}

/// Map common yt-dlp failure text to a short, plain-language explanation with
/// a suggested fix, followed by the raw yt-dlp output so nothing is lost.
/// Falls back to just the raw text when nothing matches.
/// What kind of failure a yt-dlp error text represents. Shared between the
/// user-facing message (`friendly_error`) and the auto-pause decision in
/// `run()` — both need to answer "what actually went wrong", so it's
/// classified once instead of pattern-matching the same text twice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    Copyright,
    Private,
    MembersOnly,
    BotDetection,
    AgeRestricted,
    GeoBlocked,
    NotYetLive,
    VideoUnavailable,
    NotFound,
    NoMatchingFormats,
    MissingFfmpeg,
    ExtractorFailure,
    UnsupportedUrl,
    SslError,
    RateLimited,
    SiteBlocked,
    ServerError,
    NoInternet,
    LowDiskSpace,
    /// Our own generic fallback shape from `build_failure_message` — no
    /// recognizable "ERROR:" line was found, just a raw exit code/tail.
    GenericFailure,
    Unknown,
}

impl ErrorCategory {
    fn hint(self) -> Option<&'static str> {
        use ErrorCategory::*;
        match self {
            Copyright => Some("This video was removed due to a copyright claim by the rights holder."),
            Private => Some("This video is private. You need to be signed in with an account that \
                              has access — enable browser cookies in Settings → Advanced."),
            MembersOnly => Some("This video is for channel members only. Enable browser cookies in \
                                  Settings → Advanced, signed in with an account that's a member."),
            BotDetection => Some("YouTube's bot-detection blocked this request. Catalyst already retries \
                                   this automatically with browser impersonation — if it still fails, try \
                                   enabling browser cookies in Settings → Advanced."),
            AgeRestricted => Some("This video is age-restricted. Enable browser cookies in Settings → \
                                    Advanced with a signed-in account old enough to view it."),
            GeoBlocked => Some("This video is blocked in your region. Try a proxy or VPN in Settings → Advanced."),
            NotYetLive => Some("This is a scheduled premiere or live stream that hasn't started yet. Try again once it's live."),
            VideoUnavailable => Some("This video is unavailable — it may have been removed or made private by the uploader."),
            NotFound => Some("Video not found. Double-check the link is correct and the video still exists."),
            NoMatchingFormats => Some("None of the available formats matched your quality/format settings. \
                                        Try a different quality or format."),
            MissingFfmpeg => Some("This download needs ffmpeg to merge or convert the file, but it isn't \
                                    installed on this system (Catalyst doesn't bundle it). Install ffmpeg, \
                                    make sure it's on your PATH, then try again."),
            ExtractorFailure => Some("Catalyst/yt-dlp couldn't read this page — the site may have changed, \
                                       or this link isn't fully supported yet."),
            UnsupportedUrl => Some("Catalyst doesn't know how to download from this link."),
            SslError => Some("A secure-connection (SSL/TLS) error occurred — this can happen behind \
                               some proxies, VPNs, or corporate networks."),
            RateLimited => Some("You're being rate-limited by this site. Wait a few minutes before trying \
                                  again, or lower the concurrent-downloads setting in Settings → Downloads."),
            SiteBlocked => Some("The site blocked this request. Catalyst already retries this \
                                  automatically — if it still fails, try again later or use a proxy."),
            ServerError => Some("The site's server had a problem (a temporary server-side error) — try again shortly."),
            NoInternet => Some("No internet connection detected. The download queue has been paused — \
                                 resume it once you're back online."),
            LowDiskSpace => Some("Not enough free disk space to continue. The download queue has been \
                                   paused — free up space, then resume."),
            GenericFailure => Some("The download failed unexpectedly. This may be a temporary issue with \
                                     the site — try again, or double-check the URL still works in a browser."),
            Unknown => None,
        }
    }

    /// Whether this failure means every other queued download is doomed too
    /// — worth pausing the whole queue for instead of burning through every
    /// remaining item and having each one fail individually.
    pub fn is_systemic(self) -> bool {
        matches!(self, ErrorCategory::NoInternet | ErrorCategory::LowDiskSpace)
    }
}

/// True for text patterns indicating the machine itself can't reach the
/// network — as opposed to the site/server refusing the request, which is a
/// different (non-systemic) problem.
fn looks_like_network_down(t: &str) -> bool {
    t.contains("unable to download webpage") || t.contains("name resolution")
        || t.contains("timed out") || t.contains("connection refused")
        || t.contains("connection reset") || t.contains("network is unreachable")
        || t.contains("no route to host") || t.contains("failed to establish a new connection")
        || t.contains("temporary failure in name resolution")
}

pub fn classify_error(raw: &str) -> ErrorCategory {
    let t = raw.to_lowercase();
    use ErrorCategory::*;
    if t.contains("no space left") || t.contains("not enough space") || t.contains("disk full")
        || t.contains("insufficient disk space") || t.contains("there is not enough space on the disk") {
        LowDiskSpace
    } else if t.contains("copyright") {
        Copyright
    } else if t.contains("private video") {
        Private
    } else if t.contains("members-only") || t.contains("join this channel") {
        MembersOnly
    } else if t.contains("sign in to confirm you") {
        BotDetection
    } else if t.contains("age") && (t.contains("restrict") || t.contains("confirm")) {
        AgeRestricted
    } else if t.contains("geo") || t.contains("in your country") {
        GeoBlocked
    } else if t.contains("premieres in") || t.contains("live event will begin") {
        NotYetLive
    } else if t.contains("video unavailable") {
        VideoUnavailable
    } else if t.contains("video not found") || t.contains("does not exist")
        || t.contains("http error 404") || t.contains("404: not found") {
        NotFound
    } else if t.contains("requested format not available") || t.contains("no video formats found") {
        NoMatchingFormats
    } else if t.contains("ffmpeg") || t.contains("ffprobe") {
        MissingFfmpeg
    } else if t.contains("unable to extract") {
        ExtractorFailure
    } else if t.contains("unsupported url") {
        UnsupportedUrl
    } else if t.contains("certificate verify failed") || (t.contains("ssl") && t.contains("error")) {
        SslError
    } else if t.contains("http error 429") || t.contains("too many requests") {
        RateLimited
    } else if t.contains("http error 403") || t.contains("403: forbidden")
        || t.contains("http error 410") || t.contains("410: gone") {
        SiteBlocked
    } else if t.contains("http error 5") {
        ServerError
    } else if looks_like_network_down(&t) {
        NoInternet
    } else if t.contains("exited with code") || t.contains("terminated unexpectedly") {
        // Our own generic fallback from build_failure_message() when no
        // recognizable "ERROR:" line was found.
        GenericFailure
    } else {
        Unknown
    }
}

fn friendly_error(raw: &str) -> String {
    match classify_error(raw).hint() {
        Some(h) => format!("{h}\n\nDetails: {raw}"),
        None => raw.to_string(),
    }
}

/// Build the yt-dlp argument vector for a download attempt. When `impersonate` is
/// true the configured cookie source is dropped and `--impersonate chrome
/// --no-cookies` is appended (the bot-detection retry path).
fn build_download_args(
    download_dir: &str,
    format_type: &str,
    quality: &str,
    cookie_source: &crate::config::CookieSource,
    proxy: &str,
    custom_args: &str,
    url: &str,
    impersonate: bool,
) -> Vec<String> {
    let out = std::path::Path::new(download_dir)
        .join("%(title)s [%(id)s].%(ext)s").to_string_lossy().to_string();
    let mut a = vec![
        "--newline".into(), "--no-playlist".into(),
        "-o".into(), out,
    ];
    // Only sanitize filenames the Windows way on Windows — on macOS/Linux this
    // needlessly stripped characters (":", "?", etc.) that are perfectly valid
    // filename characters on those filesystems.
    if cfg!(windows) {
        a.push("--windows-filenames".into());
    }
    a.extend(config::format_args(format_type, quality));
    if impersonate {
        // Bot-detection retry: spoof a real browser, ignore any configured cookies.
        a.push("--impersonate".into());
        a.push("chrome".into());
        a.push("--no-cookies".into());
    } else {
        a.extend(cookie_source.to_args());
    }
    if !proxy.is_empty() { a.push("--proxy".into()); a.push(proxy.to_string()); }
    // User-supplied extra flags go last (before the URL) so they can override
    // anything above if yt-dlp sees a later occurrence of the same flag win.
    a.extend(config::shell_split(custom_args));
    a.push(url.to_string());
    a
}

// ─── metadata ────────────────────────────────────────────────────────────────

async fn fetch_metadata(
    id: &str, url: &str, format_type: &str, quality: &str,
    state: &Arc<AppState>, app: &AppHandle,
) {
    let is_audio = config::is_audio_format(format_type);
    // A single delimited --print template instead of one --print per field.
    // Printing each field separately and dropping empty/"NA" lines (as this
    // used to do) desyncs the positional fields below the moment any field is
    // legitimately blank for a given site (e.g. no uploader) — one line,
    // split on a separator that won't appear in the data, keeps every field
    // aligned to its index regardless of which ones come back empty.
    const SEP: &str = "\x1f";
    let template = format!(
        "%(title)s{SEP}%(thumbnail)s{SEP}%(duration_string)s{SEP}%(uploader)s{SEP}\
         %(height)s{SEP}%(vcodec)s{SEP}%(fps)s{SEP}%(filesize_approx)s{SEP}%(acodec)s"
    );
    let mut args: Vec<String> = vec![
        "--no-download".into(), "--no-playlist".into(),
        "--print".into(), template,
    ];
    if !is_audio {
        args.extend(config::format_args(format_type, quality));
    }
    // Cookie + proxy + custom args during metadata too, so anything that
    // affects yt-dlp's ability to resolve the page (e.g. a custom
    // --user-agent or --extractor-args) applies consistently at both stages.
    {
        let cfg = state.config.lock().unwrap();
        args.extend(cfg.cookie_source.to_args());
        if !cfg.proxy.is_empty() { args.push("--proxy".into()); args.push(cfg.proxy.clone()); }
        args.extend(config::shell_split(&cfg.custom_args));
    }
    args.push(url.to_string());

    if let Ok(sidecar) = app.shell().sidecar("yt-dlp") {
        if let Ok((mut rx, child)) = sidecar.args(args).spawn() {
            // Register the metadata-fetch child so cancel_download can kill it —
            // previously only the download-phase child was tracked, so cancelling
            // during "Fetching info…" had nothing to kill.
            state.children.lock().unwrap().insert(id.to_string(), child);
            let mut line: Option<String> = None;
            while let Some(event) = rx.recv().await {
                if is_cancelled(state, id) {
                    if let Some(child) = state.children.lock().unwrap().remove(id) { let _ = child.kill(); }
                    return;
                }
                match event {
                    CommandEvent::Stdout(b) => {
                        let s = String::from_utf8_lossy(&b).trim().to_string();
                        // Only the first non-empty line matters — yt-dlp can
                        // print warnings/other lines to stdout too.
                        if !s.is_empty() && line.is_none() && s.contains(SEP) { line = Some(s); }
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            state.children.lock().unwrap().remove(id);
            // Don't let a cancellation that landed after the loop exited (but
            // before we get here) be clobbered by metadata written below.
            if is_cancelled(state, id) { return; }
            if let Some(line) = line {
                let parts: Vec<&str> = line.split(SEP).collect();
                let field = |i: usize| -> Option<String> {
                    parts.get(i).map(|s| s.trim())
                        .filter(|s| !s.is_empty() && *s != "NA" && *s != "none")
                        .map(|s| s.to_string())
                };
                state.update_job(id, |job| {
                    job.title     = field(0);
                    job.thumbnail = field(1);
                    job.duration  = field(2);
                    job.uploader  = field(3);
                    if !is_audio {
                        if let Some(px) = field(4).and_then(|h| h.parse::<u32>().ok()) {
                            job.actual_quality = Some(format!("{}p", px));
                        }
                        job.codec = field(5);
                        job.fps   = field(6);
                    } else {
                        job.codec = field(8);
                    }
                    job.filesize_approx = field(7)
                        .and_then(|s| s.parse::<f64>().ok())
                        .map(|bytes| disk_size_str(bytes as u64));
                });
            }
        }
    }

    // Cancellation may have happened while we had no sidecar running at all
    // (e.g. shell().sidecar() failed) or was set concurrently — never
    // downgrade a Cancelled job back to Queued.
    if is_cancelled(state, id) { return; }
    state.update_job(id, |job| job.status = DownloadStatus::Queued);
    emit_job(state, id, app);
}

// ─── main ────────────────────────────────────────────────────────────────────

fn move_file(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if let Some(p) = dst.parent() { std::fs::create_dir_all(p)?; }
    // Try fast rename first; fall back to copy+delete across filesystems
    std::fs::rename(src, dst).or_else(|_| {
        std::fs::copy(src, dst)?;
        std::fs::remove_file(src)
    })
}

/// Terminal result of a single yt-dlp invocation.
enum Outcome {
    Success,
    Cancelled,
    Failed { error: String },
}

/// Run one yt-dlp download attempt: spawn the sidecar, stream progress into the
/// job, and collect any `ERROR:` output. Returns the terminal outcome; the caller
/// decides whether to retry (e.g. with impersonation) and does post-processing.
async fn run_attempt(
    id: &str,
    args: Vec<String>,
    state: &Arc<AppState>,
    app: &AppHandle,
) -> Outcome {
    let sidecar = match app.shell().sidecar("yt-dlp") {
        Ok(s) => s,
        Err(e) => return Outcome::Failed { error: e.to_string() },
    };
    let (mut rx, child) = match sidecar.args(args).spawn() {
        Ok(r) => r,
        Err(e) => return Outcome::Failed { error: e.to_string() },
    };

    state.children.lock().unwrap().insert(id.to_string(), child);
    state.update_job(id, |job| job.status = DownloadStatus::Downloading);
    emit_job(state, id, app);

    let mut error_lines: Vec<String> = Vec::new();
    // Rolling context of the last few non-empty output lines, used only as a
    // fallback when yt-dlp fails without printing a recognizable "ERROR:"
    // line (a raw crash/traceback, or output that isn't in yt-dlp's usual
    // format) — better than surfacing a bare exit code with nothing else.
    let mut tail: std::collections::VecDeque<String> = std::collections::VecDeque::with_capacity(TAIL_LINES + 1);

    while let Some(event) = rx.recv().await {
        if is_cancelled(state, id) { return Outcome::Cancelled; }
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = strip_ansi(&String::from_utf8_lossy(&b));
                if let Some(p) = parse_progress(&line) {
                    state.update_job(id, |job| {
                        job.progress = p.percent;
                        job.size  = Some(p.size.clone());
                        job.speed = Some(p.speed.clone());
                        job.eta   = Some(p.eta.clone());
                    });
                    emit_job(state, id, app);
                } else if let Some((path, title)) = parse_destination(&line) {
                    state.update_job(id, |job| {
                        if job.title.is_none() { job.title = Some(title.clone()); }
                        job.output_path = Some(path);
                    });
                    emit_job(state, id, app);
                } else if let Some(path) = parse_merger_path(&line) {
                    state.update_job(id, |job| { job.output_path = Some(path); });
                    emit_job(state, id, app);
                } else if let Some(path) = parse_ffmpeg_destination(&line) {
                    state.update_job(id, |job| { job.output_path = Some(path); });
                    emit_job(state, id, app);
                } else if is_postprocessing(&line) {
                    state.update_job(id, |job| {
                        if job.status == DownloadStatus::Downloading {
                            job.status = DownloadStatus::Processing;
                            job.speed = None; job.eta = None;
                        }
                    });
                    emit_job(state, id, app);
                } else {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        if trimmed.to_ascii_lowercase().starts_with("error:") {
                            error_lines.push(trimmed.to_string());
                        }
                        if tail.len() == TAIL_LINES { tail.pop_front(); }
                        tail.push_back(trimmed.to_string());
                    }
                }
            }
            CommandEvent::Terminated(status) => {
                state.children.lock().unwrap().remove(id);
                // A kill from cancel_download surfaces as a non-zero exit; don't
                // misreport it as a (retryable) failure.
                if is_cancelled(state, id) { return Outcome::Cancelled; }
                if status.code == Some(0) { return Outcome::Success; }
                return Outcome::Failed { error: build_failure_message(status.code, &error_lines, &tail) };
            }
            _ => {}
        }
    }

    // Stream closed without an explicit Terminated event.
    state.children.lock().unwrap().remove(id);
    if is_cancelled(state, id) { return Outcome::Cancelled; }
    let error = if !error_lines.is_empty() {
        error_lines.join("\n")
    } else if !tail.is_empty() {
        let context = tail.iter().cloned().collect::<Vec<_>>().join("\n");
        format!("yt-dlp terminated unexpectedly. Last output:\n{context}")
    } else {
        "yt-dlp terminated unexpectedly with no output".to_string()
    };
    Outcome::Failed { error }
}

pub async fn run(
    id: String, url: String, format_type: String, quality: String,
    category_id: Option<String>,
    state: Arc<AppState>, app: AppHandle,
) {
    fetch_metadata(&id, &url, &format_type, &quality, &state, &app).await;
    if is_cancelled(&state, &id) { write_history(&state, &id, category_id.as_deref(), None); return; }

    // Wait while queue is paused before competing for a download slot
    loop {
        if !*state.queue_paused.lock().unwrap() { break; }
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        if is_cancelled(&state, &id) { write_history(&state, &id, category_id.as_deref(), None); return; }
    }

    let _permit = state.semaphore.clone().acquire_owned().await;
    if is_cancelled(&state, &id) { write_history(&state, &id, category_id.as_deref(), None); return; }

    // Re-check pause after acquiring slot (queue may have been paused while we waited)
    while *state.queue_paused.lock().unwrap() {
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        if is_cancelled(&state, &id) { write_history(&state, &id, category_id.as_deref(), None); return; }
    }

    // Resolve download-time dirs
    let (download_dir, final_output_dir, use_cache) = {
        let cfg = state.config.lock().unwrap();
        let final_dir = cfg.resolve_output_dir(category_id.as_deref());
        let (dl_dir, cache) = if cfg.use_cache_folder {
            let _ = std::fs::create_dir_all(&cfg.cache_dir);
            (cfg.cache_dir.clone(), true)
        } else {
            (final_dir.clone(), false)
        };
        (dl_dir, final_dir, cache)
    };

    let (cookie_source, proxy, custom_args) = {
        let cfg = state.config.lock().unwrap();
        (cfg.cookie_source.clone(), cfg.proxy.clone(), cfg.custom_args.clone())
    };

    // First attempt. On a bot-detection / HTTP block (410/403/429/"not a bot"),
    // retry once with browser impersonation and cookies disabled.
    let base_args = build_download_args(
        &download_dir, &format_type, &quality, &cookie_source, &proxy, &custom_args, &url, false,
    );
    let mut outcome = run_attempt(&id, base_args, &state, &app).await;

    if let Outcome::Failed { ref error, .. } = outcome {
        if is_retryable_error(error) && !is_cancelled(&state, &id) {
            state.update_job(&id, |job| {
                job.progress = 0.0; job.speed = None; job.eta = None;
                job.status = DownloadStatus::Downloading;
            });
            emit_job(&state, &id, &app);
            let retry_args = build_download_args(
                &download_dir, &format_type, &quality, &cookie_source, &proxy, &custom_args, &url, true,
            );
            outcome = run_attempt(&id, retry_args, &state, &app).await;
        }
    }

    if matches!(outcome, Outcome::Cancelled) {
        write_history(&state, &id, category_id.as_deref(), None);
        return;
    }
    let ok = matches!(outcome, Outcome::Success);

    // If using cache, move the finished file to the final output directory
    if ok && use_cache {
        if let Some(cache_path) = state.get_job(&id).and_then(|j| j.output_path.clone()) {
            let src = std::path::Path::new(&cache_path);
            if src.exists() {
                if let Some(filename) = src.file_name() {
                    let _ = std::fs::create_dir_all(&final_output_dir);
                    let dst = std::path::Path::new(&final_output_dir).join(filename);
                    if move_file(src, &dst).is_ok() {
                        let dst_str = dst.to_string_lossy().to_string();
                        state.update_job(&id, |job| job.output_path = Some(dst_str));
                    }
                }
            }
        }
    }

    // Read actual file size from disk after any move
    let disk_size_bytes: Option<u64> = if ok {
        state.get_job(&id)
            .and_then(|j| j.output_path.clone())
            .and_then(|p| std::fs::metadata(&p).ok())
            .map(|m| m.len())
    } else { None };
    let disk_size = disk_size_bytes.map(disk_size_str);

    state.update_job(&id, |job| {
        if ok {
            job.status = DownloadStatus::Finished;
            job.progress = 100.0; job.speed = None; job.eta = None;
            if let Some(ref s) = disk_size { job.size = Some(s.clone()); }
        } else if let Outcome::Failed { ref error, .. } = outcome {
            job.status = DownloadStatus::Failed { message: friendly_error(error) };
        }
    });
    emit_job(&state, &id, &app);

    // OS notification (only if window not focused)
    {
        let notify = state.config.lock().unwrap().notifications_enabled;
        let not_focused = app.get_webview_window("main")
            .map(|w| !w.is_focused().unwrap_or(true))
            .unwrap_or(false);
        if notify && not_focused {
            use tauri_plugin_notification::NotificationExt;
            let (title, body) = if ok {
                let name = state.get_job(&id)
                    .and_then(|j| j.title)
                    .unwrap_or_else(|| "Download".into());
                ("Download complete".to_string(), name)
            } else {
                ("Download failed".to_string(),
                 state.get_job(&id).and_then(|j| j.title).unwrap_or_else(|| "Unknown".into()))
            };
            let _ = app.notification().builder().title(&title).body(&body).show();
        }
    }

    if let Outcome::Failed { ref error, .. } = outcome {
        maybe_auto_pause_queue(classify_error(error), &state, &app).await;
    }

    // Finished and Failed both get a history entry now — only Cancelled
    // outcomes reaching here would be from the retry path, and those already
    // returned above via the Outcome::Cancelled check.
    write_history(&state, &id, category_id.as_deref(), disk_size_bytes.map(|b| b as i64));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CookieSource;

    #[test]
    fn retryable_on_http_410_gone() {
        assert!(is_retryable_error("ERROR: [youtube] abc: HTTP Error 410: Gone"));
    }

    #[test]
    fn retryable_on_http_403_forbidden() {
        assert!(is_retryable_error("ERROR: unable to download video data: HTTP Error 403: Forbidden"));
    }

    #[test]
    fn retryable_on_http_429_too_many_requests() {
        assert!(is_retryable_error("ERROR: HTTP Error 429: Too Many Requests"));
    }

    #[test]
    fn retryable_on_bot_detection_gate() {
        assert!(is_retryable_error(
            "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies"
        ));
    }

    #[test]
    fn not_retryable_on_private_video() {
        // Contains "Sign in" but not the bot-detection phrase — impersonation won't help.
        assert!(!is_retryable_error(
            "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video"
        ));
    }

    #[test]
    fn not_retryable_on_network_failure() {
        assert!(!is_retryable_error(
            "ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>"
        ));
    }

    #[test]
    fn friendly_error_explains_private_video() {
        let msg = friendly_error("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video");
        assert!(msg.starts_with("This video is private."));
        assert!(msg.contains("Details: ERROR: [youtube] abc: Private video."));
    }

    #[test]
    fn friendly_error_explains_bot_detection() {
        let msg = friendly_error("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies");
        assert!(msg.contains("bot-detection blocked"));
    }

    #[test]
    fn friendly_error_explains_geo_block() {
        let msg = friendly_error("ERROR: The uploader has not made this video available in your country");
        assert!(msg.contains("blocked in your region"));
    }

    #[test]
    fn friendly_error_explains_network_failure() {
        let msg = friendly_error("ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>");
        assert!(msg.contains("No internet connection detected"));
        assert_eq!(classify_error("ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>"), ErrorCategory::NoInternet);
    }

    #[test]
    fn friendly_error_falls_back_to_raw_text_when_unmatched() {
        let raw = "ERROR: some completely novel yt-dlp failure we've never seen";
        assert_eq!(friendly_error(raw), raw);
    }

    #[test]
    fn classify_error_recognizes_video_not_found() {
        assert_eq!(classify_error("ERROR: [generic] abc: 404: Not Found"), ErrorCategory::NotFound);
        assert_eq!(classify_error("ERROR: [youtube] abc: Video not found"), ErrorCategory::NotFound);
        assert!(friendly_error("ERROR: [generic] abc: 404: Not Found").starts_with("Video not found."));
    }

    #[test]
    fn classify_error_recognizes_rate_limited() {
        assert_eq!(classify_error("ERROR: HTTP Error 429: Too Many Requests"), ErrorCategory::RateLimited);
        assert!(friendly_error("ERROR: HTTP Error 429: Too Many Requests").contains("rate-limited"));
    }

    #[test]
    fn classify_error_recognizes_low_disk_space() {
        assert_eq!(classify_error("OSError: [Errno 28] No space left on device"), ErrorCategory::LowDiskSpace);
        assert_eq!(classify_error("There is not enough space on the disk"), ErrorCategory::LowDiskSpace);
        assert!(friendly_error("OSError: [Errno 28] No space left on device").contains("Not enough free disk space"));
    }

    #[test]
    fn only_no_internet_and_low_disk_space_are_systemic() {
        assert!(ErrorCategory::NoInternet.is_systemic());
        assert!(ErrorCategory::LowDiskSpace.is_systemic());
        assert!(!ErrorCategory::RateLimited.is_systemic());
        assert!(!ErrorCategory::NotFound.is_systemic());
        assert!(!ErrorCategory::VideoUnavailable.is_systemic());
        assert!(!ErrorCategory::Unknown.is_systemic());
    }

    #[test]
    fn friendly_error_explains_missing_ffmpeg() {
        let msg = friendly_error("ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location");
        assert!(msg.contains("ffmpeg"));
        assert!(msg.contains("Catalyst doesn't bundle it"));
    }

    #[test]
    fn friendly_error_explains_copyright_removal() {
        let msg = friendly_error("ERROR: [youtube] abc: Video unavailable. This video is no longer available due to a copyright claim by Example Corp");
        assert!(msg.starts_with("This video was removed due to a copyright claim"));
    }

    #[test]
    fn friendly_error_wraps_generic_exit_code_fallback() {
        // This is exactly the shape build_failure_message() produces when no
        // ERROR: line was captured — must not be shown to the user bare.
        let raw = "yt-dlp exited with code 1. Last output:\nsome unrecognized line";
        let msg = friendly_error(raw);
        assert!(msg.starts_with("The download failed unexpectedly."));
        assert!(msg.contains("Details: yt-dlp exited with code 1"));
    }

    #[test]
    fn strip_ansi_removes_color_codes_but_keeps_text() {
        assert_eq!(strip_ansi("\u{1b}[31mERROR:\u{1b}[0m something broke"), "ERROR: something broke");
        assert_eq!(strip_ansi("no codes here"), "no codes here");
    }

    #[test]
    fn build_failure_message_prefers_error_lines_over_tail() {
        let error_lines = vec!["ERROR: the real reason".to_string()];
        let tail: std::collections::VecDeque<String> = ["unrelated line".to_string()].into();
        assert_eq!(build_failure_message(Some(1), &error_lines, &tail), "ERROR: the real reason");
    }

    #[test]
    fn build_failure_message_falls_back_to_tail_with_readable_exit_code() {
        let tail: std::collections::VecDeque<String> = ["last thing yt-dlp printed".to_string()].into();
        let msg = build_failure_message(Some(1), &[], &tail);
        // Must never leak Rust's Option debug formatting ("Some(1)") to the user.
        assert!(!msg.contains("Some("));
        assert!(msg.contains("exited with code 1"));
        assert!(msg.contains("last thing yt-dlp printed"));
    }

    #[test]
    fn build_failure_message_handles_no_output_at_all() {
        let msg = build_failure_message(None, &[], &std::collections::VecDeque::new());
        assert!(!msg.contains("Some(") && !msg.contains("None"));
        assert!(msg.contains("unknown"));
    }

    #[test]
    fn base_args_use_cookies_and_no_impersonation() {
        let cookies = CookieSource::Browser { browser: "chrome".into(), profile: "Default".into() };
        let args = build_download_args(
            "/tmp/out", "mp4", "1080p", &cookies, "", "", "https://example.com/v", false,
        );
        assert!(args.iter().any(|a| a == "--cookies-from-browser"));
        assert!(!args.iter().any(|a| a == "--impersonate"));
        assert!(!args.iter().any(|a| a == "--no-cookies"));
        // core flags + output template + url are always present
        assert!(args.iter().any(|a| a == "-o"));
        assert!(args.iter().any(|a| a.contains("%(title)s [%(id)s].%(ext)s")));
        assert!(args.iter().any(|a| a == "https://example.com/v"));
    }

    #[test]
    fn impersonation_retry_drops_cookies_and_adds_impersonate() {
        let cookies = CookieSource::Browser { browser: "chrome".into(), profile: "Default".into() };
        let args = build_download_args(
            "/tmp/out", "mp4", "1080p", &cookies, "", "", "https://example.com/v", true,
        );
        assert!(args.iter().any(|a| a == "--impersonate"));
        assert!(args.iter().any(|a| a == "chrome"));
        assert!(args.iter().any(|a| a == "--no-cookies"));
        // configured cookie source must NOT leak into the impersonation attempt
        assert!(!args.iter().any(|a| a == "--cookies-from-browser"));
        // still a valid download command
        assert!(args.iter().any(|a| a == "-o"));
        assert!(args.iter().any(|a| a == "https://example.com/v"));
    }

    #[test]
    fn proxy_is_forwarded_when_set() {
        let args = build_download_args(
            "/tmp/out", "mp4", "best", &CookieSource::None, "socks5://127.0.0.1:9050", "",
            "https://example.com/v", false,
        );
        let i = args.iter().position(|a| a == "--proxy").expect("proxy flag present");
        assert_eq!(args[i + 1], "socks5://127.0.0.1:9050");
    }

    #[test]
    fn custom_args_are_appended_before_the_url() {
        let args = build_download_args(
            "/tmp/out", "mp4", "best", &CookieSource::None, "",
            r#"--limit-rate 2M --user-agent "My UA""#,
            "https://example.com/v", false,
        );
        assert!(args.iter().any(|a| a == "--limit-rate"));
        assert!(args.iter().any(|a| a == "2M"));
        assert!(args.iter().any(|a| a == "My UA"), "quoted value should stay one argument: {args:?}");
        // custom args must land before the URL, not after
        let url_idx = args.iter().position(|a| a == "https://example.com/v").unwrap();
        let flag_idx = args.iter().position(|a| a == "--limit-rate").unwrap();
        assert!(flag_idx < url_idx);
    }
}
