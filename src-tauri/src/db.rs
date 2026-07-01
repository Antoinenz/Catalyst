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
    /// Raw file size in bytes, stored alongside the formatted `size` string so
    /// aggregate stats don't have to re-parse "12.34 MiB" back into a number.
    #[serde(default)]
    pub size_bytes: Option<i64>,
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
                category_id TEXT,
                size_bytes INTEGER
            );
            CREATE INDEX IF NOT EXISTS history_date ON history(downloaded_at DESC);",
        )?;
        // Migrations for existing databases from earlier releases.
        conn.execute("ALTER TABLE history ADD COLUMN category_id TEXT", []).ok();
        if conn.execute("ALTER TABLE history ADD COLUMN size_bytes INTEGER", []).is_ok() {
            // Column was just added — backfill from the formatted `size` strings
            // of existing rows so old history entries still count toward stats.
            let db = Self { conn: Mutex::new(conn) };
            db.backfill_size_bytes().ok();
            return Ok(db);
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// One-time backfill: parse existing `size` display strings (e.g. "12.34 MiB")
    /// into `size_bytes` for rows written before that column existed.
    fn backfill_size_bytes(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let rows: Vec<(String, String)> = {
            let mut stmt = conn.prepare(
                "SELECT id, size FROM history WHERE size_bytes IS NULL AND size IS NOT NULL")?;
            let mapped = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            mapped.collect::<Result<Vec<_>>>()?
        };
        for (id, size) in rows {
            if let Some(bytes) = parse_size_bytes(&size) {
                conn.execute("UPDATE history SET size_bytes = ?1 WHERE id = ?2", params![bytes, id])?;
            }
        }
        Ok(())
    }

    pub fn insert(&self, e: &HistoryEntry) -> Result<()> {
        self.conn.lock().unwrap().execute(
            "INSERT OR REPLACE INTO history
             (id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at,category_id,size_bytes)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![e.id,e.url,e.title,e.thumbnail,e.duration,e.uploader,
                    e.format_type,e.quality,e.actual_quality,e.size,e.output_path,e.downloaded_at,e.category_id,
                    e.size_bytes],
        )?;
        Ok(())
    }

    pub fn get_all(&self, limit: usize) -> Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id,url,title,thumbnail,duration,uploader,format_type,quality,actual_quality,size,output_path,downloaded_at,category_id,size_bytes
             FROM history ORDER BY downloaded_at DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| Ok(HistoryEntry {
            id: r.get(0)?, url: r.get(1)?,
            title: r.get(2)?, thumbnail: r.get(3)?, duration: r.get(4)?, uploader: r.get(5)?,
            format_type: r.get(6)?, quality: r.get(7)?, actual_quality: r.get(8)?,
            size: r.get(9)?, output_path: r.get(10)?, downloaded_at: r.get(11)?,
            category_id: r.get(12)?, size_bytes: r.get(13)?,
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

        // Sum raw byte sizes (see size_bytes column / backfill_size_bytes for
        // rows written before this column existed).
        let total_bytes: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM history", [], |r| r.get(0))?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("catalyst_test_{}_{}.db", name, std::process::id()));
        let _ = std::fs::remove_file(&p);
        p
    }

    fn sample_entry(id: &str, size: Option<&str>, size_bytes: Option<i64>) -> HistoryEntry {
        HistoryEntry {
            id: id.into(), url: "https://example.com".into(),
            title: None, thumbnail: None, duration: None, uploader: None,
            format_type: "mp4".into(), quality: "best".into(), actual_quality: None,
            size: size.map(|s| s.to_string()), output_path: None,
            downloaded_at: 0, category_id: None, size_bytes,
        }
    }

    #[test]
    fn insert_and_get_all_roundtrips_size_bytes() {
        let path = temp_db_path("roundtrip");
        let db = Database::new(&path).unwrap();
        db.insert(&sample_entry("a", Some("1.00 MiB"), Some(1_048_576))).unwrap();
        let all = db.get_all(10).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].size_bytes, Some(1_048_576));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn stats_sum_size_bytes_instead_of_reparsing_strings() {
        let path = temp_db_path("stats");
        let db = Database::new(&path).unwrap();
        db.insert(&sample_entry("a", Some("1.00 MiB"), Some(1_048_576))).unwrap();
        db.insert(&sample_entry("b", Some("2.00 MiB"), Some(2_097_152))).unwrap();
        let stats = db.get_stats().unwrap();
        assert_eq!(stats.total_size_bytes, 1_048_576 + 2_097_152);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn legacy_rows_without_size_bytes_are_backfilled_on_open() {
        let path = temp_db_path("backfill");
        {
            // Simulate a database written before the size_bytes column existed.
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE history (
                    id TEXT PRIMARY KEY, url TEXT NOT NULL,
                    title TEXT, thumbnail TEXT, duration TEXT, uploader TEXT,
                    format_type TEXT NOT NULL DEFAULT 'mp4',
                    quality TEXT NOT NULL DEFAULT 'best',
                    actual_quality TEXT, size TEXT, output_path TEXT,
                    downloaded_at INTEGER NOT NULL,
                    category_id TEXT
                );",
            ).unwrap();
            conn.execute(
                "INSERT INTO history (id,url,format_type,quality,size,downloaded_at) VALUES (?1,?2,?3,?4,?5,?6)",
                params!["legacy", "https://example.com", "mp4", "best", "3.00 MiB", 0],
            ).unwrap();
        }
        // Re-opening through Database::new must add size_bytes and backfill it
        // from the legacy `size` string, not just leave it NULL.
        let db = Database::new(&path).unwrap();
        let all = db.get_all(10).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].size_bytes, Some(3 * 1_048_576));
        let _ = std::fs::remove_file(&path);
    }
}
