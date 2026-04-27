use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::config;
use crate::state::{AppState, DownloadStatus};

// ─── helpers ────────────────────────────────────────────────────────────────

fn emit_job(state: &Arc<AppState>, id: &str, app: &AppHandle) {
    if let Some(job) = state.get_job(id) {
        let _ = app.emit("download-update", job);
    }
}

fn is_cancelled(state: &Arc<AppState>, id: &str) -> bool {
    state.get_job(id).map_or(false, |j| j.status == DownloadStatus::Cancelled)
}

// ─── progress parsing ────────────────────────────────────────────────────────

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
        size:  t.get(of_i  + 1)?.to_string(),
        speed: t.get(at_i  + 1)?.to_string(),
        eta:   t.get(eta_i + 1)?.to_string(),
    })
}

fn parse_destination(line: &str) -> Option<(String, String)> {
    let path = line.trim().strip_prefix("[download] Destination:")?.trim();
    let stem = std::path::Path::new(path).file_stem()?.to_str()?.to_string();
    Some((path.to_string(), stem))
}

fn parse_merger_path(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("[Merger] Merging formats into ")?;
    Some(rest.trim_matches('"').to_string())
}

// ─── metadata fetch ──────────────────────────────────────────────────────────

/// Runs yt-dlp with --no-download to fetch title, thumbnail, duration, uploader.
/// On completion (success or failure), the job status is set to Queued.
async fn fetch_metadata(id: &str, url: &str, state: &Arc<AppState>, app: &AppHandle) {
    let sidecar = app.shell().sidecar("yt-dlp").ok();
    let result = sidecar.and_then(|s| {
        s.args([
            "--no-download", "--no-playlist",
            "--print", "title",
            "--print", "thumbnail",
            "--print", "duration_string",
            "--print", "uploader",
            url,
        ])
        .spawn()
        .ok()
    });

    if let Some((mut rx, _child)) = result {
        let mut lines: Vec<String> = Vec::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(b) => {
                    let line = String::from_utf8_lossy(&b).trim().to_string();
                    if !line.is_empty() && line != "NA" {
                        lines.push(line);
                    }
                }
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        state.update_job(id, |job| {
            if let Some(v) = lines.get(0) { job.title    = Some(v.clone()); }
            if let Some(v) = lines.get(1) { job.thumbnail = Some(v.clone()); }
            if let Some(v) = lines.get(2) { job.duration  = Some(v.clone()); }
            if let Some(v) = lines.get(3) { job.uploader  = Some(v.clone()); }
        });
    }

    // Always transition to Queued when metadata phase ends
    state.update_job(id, |job| job.status = DownloadStatus::Queued);
    emit_job(state, id, app);
}

// ─── main entry point ────────────────────────────────────────────────────────

/// Fetches metadata then waits for a concurrency slot and downloads.
pub async fn run(
    id: String,
    url: String,
    format_type: String,
    quality: String,
    state: Arc<AppState>,
    app: AppHandle,
) {
    // Phase 1 — metadata (no semaphore, fast network call)
    fetch_metadata(&id, &url, &state, &app).await;

    if is_cancelled(&state, &id) { return; }

    // Phase 2 — wait for a download slot
    let _permit = state.semaphore.clone().acquire_owned().await;

    if is_cancelled(&state, &id) { return; }

    // Build argument list
    let args: Vec<String> = {
        let cfg = state.config.lock().unwrap();
        let output_template = std::path::Path::new(&cfg.output_dir)
            .join("%(title)s [%(id)s].%(ext)s")
            .to_string_lossy()
            .to_string();
        let mut a: Vec<String> = vec![
            "--newline".into(),
            "--no-playlist".into(),
            "-o".into(),
            output_template,
        ];
        a.extend(config::format_args(&format_type, &quality));
        a.push(url.clone());
        a
    };

    let sidecar = match app.shell().sidecar("yt-dlp") {
        Ok(s) => s,
        Err(e) => {
            state.update_job(&id, |job| {
                job.status = DownloadStatus::Failed { message: e.to_string() };
            });
            emit_job(&state, &id, &app);
            return;
        }
    };

    let (mut rx, child) = match sidecar.args(args).spawn() {
        Ok(r) => r,
        Err(e) => {
            state.update_job(&id, |job| {
                job.status = DownloadStatus::Failed { message: e.to_string() };
            });
            emit_job(&state, &id, &app);
            return;
        }
    };

    state.children.lock().unwrap().insert(id.clone(), child);
    state.update_job(&id, |job| job.status = DownloadStatus::Downloading);
    emit_job(&state, &id, &app);

    // Phase 3 — stream output
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
                        job.output_path = Some(path.replace(".part", ""));
                    });
                    emit_job(&state, &id, &app);
                } else if let Some(path) = parse_merger_path(&line) {
                    state.update_job(&id, |job| { job.output_path = Some(path); });
                    emit_job(&state, &id, &app);
                }
            }
            CommandEvent::Terminated(status) => {
                state.children.lock().unwrap().remove(&id);
                state.update_job(&id, |job| {
                    if status.code == Some(0) {
                        job.status = DownloadStatus::Finished;
                        job.progress = 100.0;
                        job.speed = None;
                        job.eta = None;
                    } else {
                        job.status = DownloadStatus::Failed {
                            message: format!("yt-dlp exited with code {:?}", status.code),
                        };
                    }
                });
                emit_job(&state, &id, &app);
                break;
            }
            _ => {}
        }
    }
}
