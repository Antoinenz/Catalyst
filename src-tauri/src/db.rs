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
    pub category_id: Option<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct HistoryStats {
    pub total_downloads:  i64,
    pub unique_days:      i64,
    pub downloads_today:  i64,
    pub downloads_week:   i64,
    pub total_size_bytes: i64,
    pub most_used_format: Option<String>,
    pub avg_per_day:      f64,
}

fn parse_size_bytes(s: &str) -> Option<i64> {
    let s = s.trim();
    let idx = s.find(|c: char| c.is_alphabetic())?;
    let num: f64 = s[..idx].trim().parse().ok()?;
    let unit = s[idx..].trim().to_uppercase();
    let factor: f64 = match unit.as_str() {
        "B"         => 1.0,
        "KIB"|"KB"  => 1_024.0,
        "MIB"|"MB"  => 1_048_576.0,
        "GIB"|"GB"  => 1_073_741_824.0,
        "TIB"|"TB"  => 1_099_511_627_776.0,
        _           => return None,
    };
    Some((num * factor) as i64)
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
                downloaded_at INTEGER NOT NULL,
                category_id TEXT
            );
            CREATE INDEX IF NOT EXISTS history_date ON history(downloaded_at DESC);",
        )?;
        // Migration for existing databases without category_id
        conn.execute("ALTER TABLE history ADD COLUMN category_id TEXT", []).ok();
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn insert(&self, e: &HistoryEntry) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO history
             (id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at,category_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![e.id,e.url,e.title,e.thumbnail,e.duration,e.uploader,
                    e.format_type,e.quality,e.actual_quality,e.size,e.output_path,e.downloaded_at,e.category_id],
        )?;
        Ok(())
    }

    pub fn get_all(&self, limit: usize) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at,category_id
             FROM history ORDER BY downloaded_at DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| Ok(HistoryEntry {
            id: r.get(0)?, url: r.get(1)?,
            title: r.get(2)?, thumbnail: r.get(3)?, duration: r.get(4)?, uploader: r.get(5)?,
            format_type: r.get(6)?, quality: r.get(7)?, actual_quality: r.get(8)?,
            size: r.get(9)?, output_path: r.get(10)?, downloaded_at: r.get(11)?,
            category_id: r.get(12)?,
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

        let total: i64 = conn.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?;
        let days: i64  = conn.query_row(
            "SELECT COUNT(DISTINCT DATE(downloaded_at,'unixepoch','localtime')) FROM history",
            [], |r| r.get(0))?;
        let today: i64 = conn.query_row(
            "SELECT COUNT(*) FROM history WHERE DATE(downloaded_at,'unixepoch','localtime')=DATE('now','localtime')",
            [], |r| r.get(0))?;
        let week: i64  = conn.query_row(
            "SELECT COUNT(*) FROM history WHERE downloaded_at > strftime('%s','now','-7 days')",
            [], |r| r.get(0))?;

        // Sum file sizes from stored strings
        let total_bytes: i64 = {
            let mut stmt = conn.prepare("SELECT size FROM history WHERE size IS NOT NULL")?;
            let rows = stmt.query_map([], |r| r.get::<_, Option<String>>(0))?;
            let v: Vec<_> = rows.collect::<Result<Vec<_>>>()?;
            v.iter().filter_map(|s| s.as_deref().and_then(parse_size_bytes)).sum()
        };

        // Most used format_type
        let most_used: Option<String> = conn.query_row(
            "SELECT format_type FROM history GROUP BY format_type ORDER BY COUNT(*) DESC LIMIT 1",
            [], |r| r.get(0)).ok();

        let avg_per_day = if days > 0 { total as f64 / days as f64 } else { 0.0 };

        Ok(HistoryStats {
            total_downloads: total, unique_days: days,
            downloads_today: today, downloads_week: week,
            total_size_bytes: total_bytes,
            most_used_format: most_used,
            avg_per_day,
        })
    }
}
