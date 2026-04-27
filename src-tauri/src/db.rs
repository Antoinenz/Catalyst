use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String, pub url: String,
    pub title: Option<String>, pub thumbnail: Option<String>,
    pub duration: Option<String>, pub uploader: Option<String>,
    pub format_type: String, pub quality: String,
    pub actual_quality: Option<String>,
    pub size: Option<String>, pub output_path: Option<String>,
    pub downloaded_at: i64,
}

#[derive(Debug, Default, Serialize)]
pub struct HistoryStats {
    pub total_downloads: i64,
    pub unique_days:     i64,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY, url TEXT NOT NULL,
                title TEXT, thumbnail TEXT, duration TEXT, uploader TEXT,
                format_type TEXT NOT NULL DEFAULT 'mp4',
                quality TEXT NOT NULL DEFAULT 'best',
                actual_quality TEXT, size TEXT, output_path TEXT,
                downloaded_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS history_date ON history(downloaded_at DESC);",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert(&self, e: &HistoryEntry) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO history
             (id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![e.id,e.url,e.title,e.thumbnail,e.duration,e.uploader,
                    e.format_type,e.quality,e.actual_quality,e.size,e.output_path,e.downloaded_at],
        )?;
        Ok(())
    }

    pub fn get_all(&self, limit: usize) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at
             FROM history ORDER BY downloaded_at DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| Ok(HistoryEntry {
            id: r.get(0)?, url: r.get(1)?,
            title: r.get(2)?, thumbnail: r.get(3)?, duration: r.get(4)?, uploader: r.get(5)?,
            format_type: r.get(6)?, quality: r.get(7)?, actual_quality: r.get(8)?,
            size: r.get(9)?, output_path: r.get(10)?, downloaded_at: r.get(11)?,
        }))?;
        rows.collect()
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        self.conn.lock().unwrap().execute("DELETE FROM history WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        self.conn.lock().unwrap().execute_batch("DELETE FROM history")?;
        Ok(())
    }

    pub fn get_stats(&self) -> Result<HistoryStats> {
        let conn = self.conn.lock().unwrap();
        let total = conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?;
        let days = conn.query_row(
            "SELECT COUNT(DISTINCT DATE(downloaded_at,'unixepoch','localtime')) FROM history",
            [], |r| r.get(0))?;
        Ok(HistoryStats { total_downloads: total, unique_days: days })
    }
}
