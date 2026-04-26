use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::state::{AppState, DownloadStatus};

pub fn downloads_dir() -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| PathBuf::from("."))
}

struct ProgressInfo {
    percent: f32,
    size: String,
    speed: String,
    eta: String,
}

fn parse_progress(line: &str) -> Option<ProgressInfo> {
    let content = line.trim().strip_prefix("[download]")?.trim();
    if !content.contains('%') {
        return None;
    }

    let tokens: Vec<&str> = content.split_whitespace().collect();

    let pct_str = tokens.first()?.strip_suffix('%')?;
    let percent: f32 = pct_str.parse().ok()?;

    let of_idx = tokens.iter().position(|&t| t == "of")?;
    let size = tokens.get(of_idx + 1)?.to_string();

    let at_idx = tokens.iter().position(|&t| t == "at")?;
    let speed = tokens.get(at_idx + 1)?.to_string();

    let eta_idx = tokens.iter().position(|&t| t == "ETA")?;
    let eta = tokens.get(eta_idx + 1)?.to_string();

    Some(ProgressInfo { percent, size, speed, eta })
}

fn parse_destination_title(line: &str) -> Option<String> {
    let path = line.trim().strip_prefix("[download] Destination:")?.trim();
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

fn emit_job(state: &Arc<AppState>, id: &str, app: &AppHandle) {
    if let Some(job) = state.get_job(id) {
        let _ = app.emit("download-update", job);
    }
}

pub async fn run_download(id: String, url: String, state: Arc<AppState>, app: AppHandle) {
    let output_template = downloads_dir()
        .join("%(title)s [%(id)s].%(ext)s")
        .to_string_lossy()
        .to_string();

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

    let result = sidecar
        .args(["--newline", "--no-playlist", "-o", &output_template, &url])
        .spawn();

    let (mut rx, child) = match result {
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

    while let Some(event) = rx.recv().await {
        // Bail if cancelled
        if state.get_job(&id).map_or(false, |j| j.status == DownloadStatus::Cancelled) {
            break;
        }

        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes);

                if let Some(p) = parse_progress(&line) {
                    state.update_job(&id, |job| {
                        job.progress = p.percent;
                        job.size = Some(p.size.clone());
                        job.speed = Some(p.speed.clone());
                        job.eta = Some(p.eta.clone());
                    });
                    emit_job(&state, &id, &app);
                } else if let Some(title) = parse_destination_title(&line) {
                    state.update_job(&id, |job| {
                        if job.title.is_none() {
                            job.title = Some(title.clone());
                        }
                    });
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
