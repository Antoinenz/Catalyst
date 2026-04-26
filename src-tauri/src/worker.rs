use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::config;
use crate::state::{AppState, DownloadStatus};

struct Progress {
    percent: f32,
    size: String,
    speed: String,
    eta: String,
}

fn parse_progress(line: &str) -> Option<Progress> {
    let content = line.trim().strip_prefix("[download]")?.trim();
    if !content.contains('%') {
        return None;
    }
    let tokens: Vec<&str> = content.split_whitespace().collect();
    let percent: f32 = tokens.first()?.strip_suffix('%')?.parse().ok()?;
    let of_i   = tokens.iter().position(|&t| t == "of")?;
    let at_i   = tokens.iter().position(|&t| t == "at")?;
    let eta_i  = tokens.iter().position(|&t| t == "ETA")?;
    Some(Progress {
        percent,
        size:  tokens.get(of_i  + 1)?.to_string(),
        speed: tokens.get(at_i  + 1)?.to_string(),
        eta:   tokens.get(eta_i + 1)?.to_string(),
    })
}

/// Parses "[download] Destination: /path/to/file.ext"
/// Returns (full_path, title_stem)
fn parse_destination(line: &str) -> Option<(String, String)> {
    let path = line.trim().strip_prefix("[download] Destination:")?.trim();
    let stem = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())?;
    Some((path.to_string(), stem))
}

/// Parses "[Merger] Merging formats into \"/path/to/file.ext\""
fn parse_merger_path(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix("[Merger] Merging formats into ")?;
    Some(rest.trim_matches('"').to_string())
}

fn emit_job(state: &Arc<AppState>, id: &str, app: &AppHandle) {
    if let Some(job) = state.get_job(id) {
        let _ = app.emit("download-update", job);
    }
}

pub async fn run_download(
    id: String,
    url: String,
    format: String,
    state: Arc<AppState>,
    app: AppHandle,
) {
    // Wait for a concurrency slot
    let _permit = state.semaphore.clone().acquire_owned().await;

    // Bail if cancelled while waiting
    if state.get_job(&id).map_or(false, |j| j.status == DownloadStatus::Cancelled) {
        return;
    }

    let (output_dir, args) = {
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
        a.extend(config::format_args(&format));
        a.push(url);
        (cfg.output_dir.clone(), a)
    };
    let _ = output_dir; // used in output_template above

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

    while let Some(event) = rx.recv().await {
        if state.get_job(&id).map_or(false, |j| j.status == DownloadStatus::Cancelled) {
            break;
        }
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
                    state.update_job(&id, |job| {
                        job.output_path = Some(path.clone());
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
