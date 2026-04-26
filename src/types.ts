export type DownloadStatus =
  | { type: "Queued" }
  | { type: "Downloading" }
  | { type: "Finished" }
  | { type: "Failed"; message: string }
  | { type: "Cancelled" };

export interface DownloadJob {
  id: string;
  url: string;
  title: string | null;
  format: string;
  status: DownloadStatus;
  progress: number;
  speed: string | null;
  eta: string | null;
  size: string | null;
  output_path: string | null;
}

export interface Config {
  output_dir: string;
  default_format: string;
  max_concurrent: number;
}

export const FORMAT_PRESETS = [
  { id: "best_mp4", label: "Best MP4",     group: "Video" },
  { id: "best",     label: "Best Quality", group: "Video" },
  { id: "1080p",    label: "1080p",        group: "Video" },
  { id: "720p",     label: "720p",         group: "Video" },
  { id: "480p",     label: "480p",         group: "Video" },
  { id: "mp3",      label: "MP3",          group: "Audio" },
  { id: "m4a",      label: "M4A",          group: "Audio" },
] as const;
