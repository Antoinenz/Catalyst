export type DownloadStatus =
  | { type: "Fetching" }
  | { type: "Queued" }
  | { type: "Downloading" }
  | { type: "Processing" }
  | { type: "Finished" }
  | { type: "Failed"; message: string }
  | { type: "Cancelled" };

export interface DownloadJob {
  id: string;
  url: string;
  title:          string | null;
  thumbnail:      string | null;
  duration:       string | null;
  uploader:       string | null;
  format_type:    string;
  quality:        string;
  actual_quality: string | null;
  status:         DownloadStatus;
  progress:       number;
  speed:          string | null;
  eta:            string | null;
  size:           string | null;
  output_path:    string | null;
}

export interface HistoryEntry {
  id:             string;
  url:            string;
  title:          string | null;
  thumbnail:      string | null;
  duration:       string | null;
  uploader:       string | null;
  format_type:    string;
  quality:        string;
  actual_quality: string | null;
  size:           string | null;
  output_path:    string | null;
  downloaded_at:  number;
}

export interface Config {
  output_dir:          string;
  default_format_type: string;
  default_quality:     string;
  max_concurrent:      number;
}

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

export const formatTypeLabel = (id: string) =>
  FORMAT_TYPES.find(f => f.id === id)?.label ?? id;

export const qualityLabel = (id: string) =>
  QUALITY_LEVELS.find(q => q.id === id)?.label ?? id;

export const isAudioFormat = (id: string) =>
  FORMAT_TYPES.find(f => f.id === id)?.audio ?? false;

/** Best display label for quality — uses actual_quality if known, else the cap */
export const resolvedQualityLabel = (job: Pick<DownloadJob, "quality" | "actual_quality">) =>
  job.actual_quality ?? qualityLabel(job.quality);
