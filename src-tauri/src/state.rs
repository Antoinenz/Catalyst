use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
use tauri_plugin_shell::process::CommandChild;
use crate::config::Config;
use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum DownloadStatus {
    Fetching, Queued, Downloading, Processing,
    Finished,
    Failed { message: String },
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String, pub url: String,
    pub title: Option<String>, pub thumbnail: Option<String>,
    pub duration: Option<String>, pub uploader: Option<String>,
    pub format_type: String, pub quality: String,
    pub actual_quality: Option<String>,
    pub category_id: Option<String>,
    pub status: DownloadStatus, pub progress: f32,
    pub speed: Option<String>, pub eta: Option<String>,
    pub size: Option<String>, pub output_path: Option<String>,
}

pub struct AppState {
    pub jobs:      Mutex<Vec<DownloadJob>>,
    pub children:  Mutex<HashMap<String, CommandChild>>,
    pub config:    Mutex<Config>,
    pub semaphore: Arc<Semaphore>,
    pub db:        Option<Database>,
    /// None = not paused; Some(ts) = paused until that Unix second; Some(i64::MAX) = indefinitely
    pub history_paused_until: Mutex<Option<i64>>,
    /// When true, new downloads wait before starting
    pub queue_paused: Mutex<bool>,
    /// Set to Some(version_string) when a newer Catalyst release is found
    pub update_available: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(config: Config, db: Option<Database>) -> Self {
        let permits = config.max_concurrent;
        Self {
            jobs:      Mutex::new(Vec::new()),
            children:  Mutex::new(HashMap::new()),
            semaphore: Arc::new(Semaphore::new(permits)),
            config:    Mutex::new(config),
            db,
            history_paused_until: Mutex::new(None),
            queue_paused:         Mutex::new(false),
            update_available:     Mutex::new(None),
        }
    }

    pub fn update_job<F: FnOnce(&mut DownloadJob)>(&self, id: &str, f: F) {
        if let Ok(mut jobs) = self.jobs.lock() {
            if let Some(job) = jobs.iter_mut().find(|j| j.id == id) { f(job); }
        }
    }

    pub fn get_job(&self, id: &str) -> Option<DownloadJob> {
        self.jobs.lock().ok()?.iter().find(|j| j.id == id).cloned()
    }

    pub fn history_is_paused(&self) -> bool {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
        match *self.history_paused_until.lock().unwrap() {
            None     => false,
            Some(ts) => now < ts,
        }
    }
}
