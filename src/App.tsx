import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, History, Settings, Plus, Link, X, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DownloadJob, DownloadStatus } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname.slice(0, 40);
  } catch {
    return url.slice(0, 60);
  }
}

function statusDot(status: DownloadStatus) {
  switch (status.type) {
    case "Queued":      return "bg-zinc-500";
    case "Downloading": return "bg-blue-400";
    case "Finished":    return "bg-green-400";
    case "Failed":      return "bg-red-400";
    case "Cancelled":   return "bg-zinc-700";
  }
}

// ─── queue item ─────────────────────────────────────────────────────────────

function QueueItem({ job, onCancel, onRemove }: {
  job: DownloadJob;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const downloading = job.status.type === "Downloading";
  const done = job.status.type === "Finished";
  const failed = job.status.type === "Failed";
  const cancelled = job.status.type === "Cancelled";
  const active = downloading || job.status.type === "Queued";

  return (
    <div className="flex items-start gap-3 px-6 py-4 border-b border-zinc-800/60 hover:bg-white/[0.02] transition-colors group">
      {/* status dot */}
      <div className="pt-1 shrink-0">
        {downloading ? (
          <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
        ) : done ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        ) : failed ? (
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <div className={cn("w-2 h-2 rounded-full mt-0.5", statusDot(job.status))} />
        )}
      </div>

      {/* content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug truncate text-zinc-100">
          {job.title ?? shortenUrl(job.url)}
        </p>

        {downloading && (
          <div className="mt-2 space-y-1.5">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <div className="flex gap-3 text-xs text-zinc-500">
              <span className="tabular-nums">{job.progress.toFixed(1)}%</span>
              {job.size  && <span>{job.size}</span>}
              {job.speed && <span className="text-zinc-400">{job.speed}</span>}
              {job.eta   && <span>ETA {job.eta}</span>}
            </div>
          </div>
        )}

        {done && job.size && (
          <p className="text-xs text-zinc-500 mt-0.5">{job.size}</p>
        )}

        {failed && (
          <p className="text-xs text-red-400/80 mt-0.5 truncate">
            {(job.status as Extract<DownloadJob["status"], { type: "Failed" }>).message}
          </p>
        )}

        {job.status.type === "Queued" && (
          <p className="text-xs text-zinc-600 mt-0.5">Waiting…</p>
        )}
      </div>

      {/* actions */}
      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {active ? (
          <button
            onClick={() => onCancel(job.id)}
            title="Cancel"
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => onRemove(job.id)}
            title="Remove"
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── nav ────────────────────────────────────────────────────────────────────

type NavItem = "queue" | "history" | "settings";
const NAV = [
  { id: "queue"    as NavItem, icon: Download, label: "Queue" },
  { id: "history"  as NavItem, icon: History,  label: "History" },
  { id: "settings" as NavItem, icon: Settings, label: "Settings" },
];

// ─── app ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [nav, setNav]     = useState<NavItem>("queue");
  const [url, setUrl]     = useState("");
  const [adding, setAdding] = useState(false);
  const [jobs, setJobs]   = useState<DownloadJob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing queue on mount and subscribe to updates
  useEffect(() => {
    invoke<DownloadJob[]>("get_queue").then(setJobs).catch(console.error);

    const unlisten = listen<DownloadJob>("download-update", (e) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === e.payload.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = e.payload;
          return next;
        }
        return [...prev, e.payload];
      });
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await invoke("add_download", { url: trimmed });
      setUrl("");
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  };

  const handleCancel = async (id: string) => {
    await invoke("cancel_download", { id }).catch(console.error);
  };

  const handleRemove = async (id: string) => {
    await invoke("remove_job", { id }).catch(console.error);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const activeJobs   = jobs.filter((j) => j.status.type === "Downloading" || j.status.type === "Queued");
  const finishedJobs = jobs.filter((j) => j.status.type === "Finished" || j.status.type === "Failed" || j.status.type === "Cancelled");

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Sidebar */}
      <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-zinc-900 border-r border-zinc-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center mb-4">
          <Download className="w-4 h-4 text-zinc-900" />
        </div>
        {NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setNav(id)}
            title={label}
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
              nav === id
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="px-6 h-14 flex items-center justify-between border-b border-zinc-800 shrink-0">
          <h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
            {NAV.find((n) => n.id === nav)?.label}
          </h1>
          {nav === "queue" && activeJobs.length > 0 && (
            <span className="text-xs text-zinc-500">
              {activeJobs.length} active
            </span>
          )}
        </header>

        {/* Queue page */}
        {nav === "queue" && (
          <>
            {/* URL input */}
            <div className="px-6 py-3 border-b border-zinc-800 shrink-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    placeholder="Paste a URL — YouTube, Vimeo, Twitter, 1800+ sites"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 placeholder:text-zinc-600"
                  />
                </div>
                <button
                  onClick={handleAdd}
                  disabled={!url.trim() || adding}
                  className="flex items-center gap-1.5 bg-zinc-100 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {adding ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Add
                </button>
              </div>
            </div>

            {/* Queue list */}
            <main className="flex-1 overflow-auto">
              {jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
                  <Download className="w-8 h-8 mb-1 opacity-20" />
                  <p className="text-sm font-medium">Nothing in the queue</p>
                  <p className="text-xs">Paste a URL above to get started</p>
                </div>
              ) : (
                <>
                  {activeJobs.map((job) => (
                    <QueueItem key={job.id} job={job} onCancel={handleCancel} onRemove={handleRemove} />
                  ))}
                  {finishedJobs.length > 0 && activeJobs.length > 0 && (
                    <div className="px-6 py-2 text-xs text-zinc-600 uppercase tracking-widest border-b border-zinc-800/60">
                      Completed
                    </div>
                  )}
                  {finishedJobs.map((job) => (
                    <QueueItem key={job.id} job={job} onCancel={handleCancel} onRemove={handleRemove} />
                  ))}
                </>
              )}
            </main>
          </>
        )}

        {nav === "history" && (
          <main className="flex-1 overflow-auto flex flex-col items-center justify-center gap-2 text-zinc-600">
            <History className="w-8 h-8 mb-1 opacity-20" />
            <p className="text-sm font-medium">No history yet</p>
            <p className="text-xs">Completed downloads will appear here</p>
          </main>
        )}

        {nav === "settings" && (
          <main className="flex-1 overflow-auto p-6">
            <p className="text-sm text-zinc-500">Settings coming soon</p>
          </main>
        )}
      </div>
    </div>
  );
}
