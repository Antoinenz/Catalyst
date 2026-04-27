export type DownloadStatus =
  | { type: "Fetching" } | { type: "Queued" } | { type: "Downloading" }
  | { type: "Processing" } | { type: "Finished" }
  | { type: "Failed"; message: string } | { type: "Cancelled" };

export interface DownloadJob {
  id: string; url: string;
  title: string | null; thumbnail: string | null;
  duration: string | null; uploader: string | null;
  format_type: string; quality: string; actual_quality: string | null;
  category_id: string | null;
  status: DownloadStatus; progress: number;
  speed: string | null; eta: string | null;
  size: string | null; output_path: string | null;
}

export interface HistoryEntry {
  id: string; url: string;
  title: string | null; thumbnail: string | null;
  duration: string | null; uploader: string | null;
  format_type: string; quality: string; actual_quality: string | null;
  size: string | null; output_path: string | null;
  downloaded_at: number;
}

export interface Config {
  output_dir: string;
  default_format_type: string;
  default_quality: string;
  max_concurrent: number;
  cookie_source: CookieSource;
  auto_update_ytdlp:     boolean;
  notifications_enabled: boolean;
  auto_check_updates:    boolean;
  minimize_to_tray:      boolean;
  proxy:                 string;
  use_cache_folder:      boolean;
  cache_dir:             string;
  categories:            DownloadCategory[];
}

export interface DownloadCategory {
  id: string; name: string; output_dir: string; color: string;
}

export const CATEGORY_COLORS = [
  "#ef4444","#f97316","#eab308","#22c55e",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6",
] as const;

export type CookieSource =
  | { type: "None" }
  | { type: "Browser"; browser: string; profile: string }
  | { type: "File"; path: string };

export interface BrowserProfile { id: string; name: string; }
export interface DetectedBrowser { id: string; name: string; profiles: BrowserProfile[]; }
export interface HistoryStats {
  total_downloads:  number;
  unique_days:      number;
  downloads_today:  number;
  downloads_week:   number;
  total_size_bytes: number;
  most_used_format: string | null;
  avg_per_day:      number;
}

// ─── format definitions ──────────────────────────────────────────────────────

export const FORMAT_TYPES = [
  { id: "mp4",  label: "MP4 (H264)",   audio: false },
  { id: "best", label: "Best Quality", audio: false },
  { id: "mp3",  label: "MP3",          audio: true  },
  { id: "m4a",  label: "M4A",          audio: true  },
] as const;

export const QUALITY_LEVELS = [
  { id: "best",  label: "Best"  },
  { id: "2160p", label: "4K"    },
  { id: "1080p", label: "1080p" },
  { id: "720p",  label: "720p"  },
  { id: "480p",  label: "480p"  },
  { id: "360p",  label: "360p"  },
] as const;

export const formatTypeLabel = (id: string) => FORMAT_TYPES.find(f => f.id === id)?.label ?? id;
export const qualityLabel    = (id: string) => QUALITY_LEVELS.find(q => q.id === id)?.label ?? id;
export const isAudioFormat   = (id: string) => FORMAT_TYPES.find(f => f.id === id)?.audio ?? false;
export const resolvedQuality = (job: Pick<DownloadJob | HistoryEntry, "quality" | "actual_quality">) =>
  job.actual_quality ?? qualityLabel(job.quality);

// ─── speed parsing ───────────────────────────────────────────────────────────

export function parseSpeedBytes(s: string | null): number {
  if (!s) return 0;
  const m = s.match(/^([\d.]+)\s*([KMGTP]?)i?B\/s$/i);
  if (!m) return 0;
  const mul: Record<string, number> = { '': 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
  return parseFloat(m[1]) * (mul[m[2].toUpperCase()] ?? 1);
}

export function formatSpeed(bps: number): string {
  if (bps >= 1073741824) return `${(bps / 1073741824).toFixed(1)} GiB/s`;
  if (bps >= 1048576)    return `${(bps / 1048576).toFixed(1)} MiB/s`;
  if (bps >= 1024)       return `${(bps / 1024).toFixed(1)} KiB/s`;
  return `${bps.toFixed(0)} B/s`;
}

// ─── date helpers ────────────────────────────────────────────────────────────

export function formatDateTime(ts: number): { date: string; time: string } {
  const d = new Date(ts * 1000);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const date = days === 0 ? "Today"
    : days === 1 ? "Yesterday"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: now.getFullYear() !== d.getFullYear() ? "numeric" : undefined });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return { date, time };
}

export function groupByDate<T extends { downloaded_at: number }>(items: T[]): { label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const { date } = formatDateTime(item.downloaded_at);
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(item);
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }));
}
