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
  status: DownloadStatus;
  progress: number;
  speed: string | null;
  eta: string | null;
  size: string | null;
}
