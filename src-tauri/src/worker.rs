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
fn friendly_error(raw: &str) -> String {
    let t = raw.to_lowercase();
    let hint = if t.contains("private video") {
        Some("This video is private. You need to be signed in with an account that \
              has access — enable browser cookies in Settings → Advanced.")
    } else if t.contains("members-only") || t.contains("join this channel") {
        Some("This video is for channel members only. Enable browser cookies in \
              Settings → Advanced, signed in with an account that's a member.")
    } else if t.contains("sign in to confirm you") {
        Some("YouTube's bot-detection blocked this request. Catalyst already retries \
              this automatically with browser impersonation — if it still fails, try \
              enabling browser cookies in Settings → Advanced.")
    } else if t.contains("age") && (t.contains("restrict") || t.contains("confirm")) {
        Some("This video is age-restricted. Enable browser cookies in Settings → \
              Advanced with a signed-in account old enough to view it.")
    } else if t.contains("geo") || t.contains("in your country") {
        Some("This video is blocked in your region. Try a proxy or VPN in Settings → Advanced.")
    } else if t.contains("video unavailable") {
        Some("This video is unavailable — it may have been removed or made private by the uploader.")
    } else if t.contains("http error 404") || t.contains("404: not found") {
        Some("Nothing was found at this URL. Double-check the link is correct and still exists.")
    } else if t.contains("http error 403") || t.contains("403: forbidden")
        || t.contains("http error 410") || t.contains("410: gone")
        || t.contains("http error 429") || t.contains("too many requests") {
        Some("The site blocked this request. Catalyst already retries this \
              automatically — if it still fails, try again later or use a proxy.")
    } else if t.contains("unable to download webpage") || t.contains("name resolution")
        || t.contains("timed out") || t.contains("connection refused") {
        Some("Couldn't reach the site — check your internet connection (or proxy settings) and try again.")
    } else if t.contains("unsupported url") {
        Some("Catalyst doesn't know how to download from this link.")
    } else {
        None
    };

    match hint {
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

    while let Some(event) = rx.recv().await {
        if is_cancelled(state, id) { return Outcome::Cancelled; }
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = String::from_utf8_lossy(&b);
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
                } else if line.trim().starts_with("ERROR:") {
                    error_lines.push(line.trim().to_string());
                }
            }
            CommandEvent::Terminated(status) => {
                state.children.lock().unwrap().remove(id);
                // A kill from cancel_download surfaces as a non-zero exit; don't
                // misreport it as a (retryable) failure.
                if is_cancelled(state, id) { return Outcome::Cancelled; }
                if status.code == Some(0) { return Outcome::Success; }
                let error = if error_lines.is_empty() {
                    format!("yt-dlp exited with code {:?}", status.code)
                } else {
                    error_lines.join("\n")
                };
                return Outcome::Failed { error };
            }
            _ => {}
        }
    }

    // Stream closed without an explicit Terminated event.
    state.children.lock().unwrap().remove(id);
    if is_cancelled(state, id) { return Outcome::Cancelled; }
    let error = if error_lines.is_empty() {
        "yt-dlp terminated unexpectedly".to_string()
    } else {
        error_lines.join("\n")
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
        assert!(msg.contains("check your internet connection"));
    }

    #[test]
    fn friendly_error_falls_back_to_raw_text_when_unmatched() {
        let raw = "ERROR: some completely novel yt-dlp failure we've never seen";
        assert_eq!(friendly_error(raw), raw);
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
