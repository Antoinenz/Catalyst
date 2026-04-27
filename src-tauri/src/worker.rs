use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
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

fn is_postprocessing(line: &str) -> bool {
    let l = line.trim();
    l.starts_with("[Merger]") || l.starts_with("[ffmpeg]") || l.starts_with("[Fixup")
        || l.starts_with("[EmbedThumbnail]") || l.starts_with("[MoveFiles]")
        || l.starts_with("[ModifyChapters]") || l.starts_with("[SplitChapters]")
}

// ─── metadata ────────────────────────────────────────────────────────────────

async fn fetch_metadata(
    id: &str, url: &str, format_type: &str, quality: &str,
    state: &Arc<AppState>, app: &AppHandle,
) {
    let is_audio = config::is_audio_format(format_type);
    let mut args: Vec<String> = vec![
        "--no-download".into(), "--no-playlist".into(),
        "--print".into(), "title".into(),
        "--print".into(), "thumbnail".into(),
        "--print".into(), "duration_string".into(),
        "--print".into(), "uploader".into(),
    ];
    if !is_audio {
        args.extend(config::format_args(format_type, quality));
        args.push("--print".into());
        args.push("%(height)s".into());
    }
    // Cookie args during metadata too (needed for member-only content)
    args.extend(state.config.lock().unwrap().cookie_source.to_args());
    args.push(url.to_string());

    if let Ok(sidecar) = app.shell().sidecar("yt-dlp") {
        if let Ok((mut rx, _)) = sidecar.args(args).spawn() {
            let mut lines = Vec::<String>::new();
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(b) => {
                        let s = String::from_utf8_lossy(&b).trim().to_string();
                        if !s.is_empty() && s != "NA" && s != "none" { lines.push(s); }
                    }
                    CommandEvent::Terminated(_) => break,
                    _ => {}
                }
            }
            state.update_job(id, |job| {
                if let Some(v) = lines.get(0) { job.title     = Some(v.clone()); }
                if let Some(v) = lines.get(1) { job.thumbnail = Some(v.clone()); }
                if let Some(v) = lines.get(2) { job.duration  = Some(v.clone()); }
                if let Some(v) = lines.get(3) { job.uploader  = Some(v.clone()); }
                if !is_audio {
                    if let Some(h) = lines.get(4) {
                        if let Ok(px) = h.parse::<u32>() {
                            job.actual_quality = Some(format!("{}p", px));
                        }
                    }
                }
            });
        }
    }

    state.update_job(id, |job| job.status = DownloadStatus::Queued);
    emit_job(state, id, app);
}

// ─── main ────────────────────────────────────────────────────────────────────

pub async fn run(
    id: String, url: String, format_type: String, quality: String,
    state: Arc<AppState>, app: AppHandle,
) {
    fetch_metadata(&id, &url, &format_type, &quality, &state, &app).await;
    if is_cancelled(&state, &id) { return; }

    // Wait while queue is paused before competing for a download slot
    loop {
        if !*state.queue_paused.lock().unwrap() { break; }
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        if is_cancelled(&state, &id) { return; }
    }

    let _permit = state.semaphore.clone().acquire_owned().await;
    if is_cancelled(&state, &id) { return; }

    // Re-check pause after acquiring slot (queue may have been paused while we waited)
    while *state.queue_paused.lock().unwrap() {
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
        if is_cancelled(&state, &id) { return; }
    }

    let args: Vec<String> = {
        let cfg = state.config.lock().unwrap();
        let out = std::path::Path::new(&cfg.output_dir)
            .join("%(title)s [%(id)s].%(ext)s").to_string_lossy().to_string();
        let mut a = vec![
            "--newline".into(), "--no-playlist".into(),
            "-o".into(), out,
            "--windows-filenames".into(), // strip/replace chars illegal on any OS
        ];
        a.extend(config::format_args(&format_type, &quality));
        a.extend(cfg.cookie_source.to_args());
        a.push(url.clone());
        a
    };

    let sidecar = match app.shell().sidecar("yt-dlp") {
        Ok(s) => s,
        Err(e) => {
            state.update_job(&id, |job| job.status = DownloadStatus::Failed { message: e.to_string() });
            emit_job(&state, &id, &app); return;
        }
    };

    let (mut rx, child) = match sidecar.args(args).spawn() {
        Ok(r) => r,
        Err(e) => {
            state.update_job(&id, |job| job.status = DownloadStatus::Failed { message: e.to_string() });
            emit_job(&state, &id, &app); return;
        }
    };

    state.children.lock().unwrap().insert(id.clone(), child);
    state.update_job(&id, |job| job.status = DownloadStatus::Downloading);
    emit_job(&state, &id, &app);

    while let Some(event) = rx.recv().await {
        if is_cancelled(&state, &id) { break; }
        match event {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = String::from_utf8_lossy(&b);
                if let Some(p) = parse_progress(&line) {
                    state.update_job(&id, |job| {
                        job.progress = p.percent;
                        job.size  = Some(p.size.clone());
                        job.speed = Some(p.speed.clone());
                        job.eta   = Some(p.eta.clone());
                    });
                    emit_job(&state, &id, &app);
                } else if let Some((path, title)) = parse_destination(&line) {
                    state.update_job(&id, |job| {
                        if job.title.is_none() { job.title = Some(title.clone()); }
                        job.output_path = Some(path);
                    });
                    emit_job(&state, &id, &app);
                } else if let Some(path) = parse_merger_path(&line) {
                    state.update_job(&id, |job| { job.output_path = Some(path); });
                    emit_job(&state, &id, &app);
                } else if is_postprocessing(&line) {
                    state.update_job(&id, |job| {
                        if job.status == DownloadStatus::Downloading {
                            job.status = DownloadStatus::Processing;
                            job.speed = None; job.eta = None;
                        }
                    });
                    emit_job(&state, &id, &app);
                }
            }
            CommandEvent::Terminated(status) => {
                state.children.lock().unwrap().remove(&id);
                let ok = status.code == Some(0);

                // Read actual file size from disk — more accurate than stream progress sizes
                let disk_size = if ok {
                    state.get_job(&id)
                        .and_then(|j| j.output_path.clone())
                        .and_then(|p| std::fs::metadata(&p).ok().map(|m| disk_size_str(m.len())))
                } else {
                    None
                };

                state.update_job(&id, |job| {
                    if ok {
                        job.status = DownloadStatus::Finished;
                        job.progress = 100.0; job.speed = None; job.eta = None;
                        if let Some(ref s) = disk_size { job.size = Some(s.clone()); }
                    } else {
                        job.status = DownloadStatus::Failed {
                            message: format!("yt-dlp exited with code {:?}", status.code),
                        };
                    }
                });
                emit_job(&state, &id, &app);

                if ok && !state.history_is_paused() {
                    if let (Some(job), Some(db)) = (state.get_job(&id), state.db.as_ref()) {
                        let _ = db.insert(&HistoryEntry {
                            id: job.id, url: job.url,
                            title: job.title, thumbnail: job.thumbnail,
                            duration: job.duration, uploader: job.uploader,
                            format_type: job.format_type, quality: job.quality,
                            actual_quality: job.actual_quality,
                            size: job.size, output_path: job.output_path,
                            downloaded_at: now_secs(),
                        });
                    }
                }
                break;
            }
            _ => {}
        }
    }
}
