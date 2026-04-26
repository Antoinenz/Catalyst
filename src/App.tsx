import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Download, History, Settings, Plus, Link, X,
  AlertCircle, CheckCircle2, Loader2, FolderOpen,
  RotateCcw, Trash2, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DownloadJob, DownloadStatus, Config } from "@/types";
import { FORMAT_PRESETS } from "@/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname.slice(0, 32) : "";
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url.slice(0, 50);
  }
}

function formatLabel(id: string) {
  return FORMAT_PRESETS.find((f) => f.id === id)?.label ?? id;
}

// ─── format selector ────────────────────────────────────────────────────────

function FormatSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const groups = [...new Set(FORMAT_PRESETS.map((f) => f.group))];
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-zinc-900 border border-zinc-700 rounded-md pl-3 pr-7 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-300 cursor-pointer"
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {FORMAT_PRESETS.filter((f) => f.group === g).map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
    </div>
  );
}

// ─── queue item ─────────────────────────────────────────────────────────────

function QueueItem({
  job, onCancel, onRemove, onRetry, onOpenFolder,
}: {
  job: DownloadJob;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const s = job.status;
  const downloading = s.type === "Downloading";
  const queued      = s.type === "Queued";
  const done        = s.type === "Finished";
  const failed      = s.type === "Failed";
  const active      = downloading || queued;

  return (
    <div className="flex items-start gap-3 px-6 py-4 border-b border-zinc-800/60 hover:bg-white/[0.02] transition-colors group">
      {/* status icon */}
      <div className="pt-0.5 shrink-0 w-4">
        {downloading ? (
          <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
        ) : queued ? (
          <div className="w-2 h-2 rounded-full bg-zinc-500 mt-1" />
        ) : done ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        ) : failed ? (
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-zinc-700 mt-1" />
        )}
      </div>

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium leading-snug truncate text-zinc-100">
            {job.title ?? shortenUrl(job.url)}
          </p>
          <span className="text-[10px] text-zinc-600 shrink-0">{formatLabel(job.format)}</span>
        </div>

        {downloading && (
          <div className="mt-2 space-y-1.5">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            <div className="flex gap-3 text-xs text-zinc-500">
              <span className="tabular-nums w-12">{job.progress.toFixed(1)}%</span>
              {job.size  && <span>{job.size}</span>}
              {job.speed && <span className="text-zinc-400">{job.speed}</span>}
              {job.eta   && <span>ETA {job.eta}</span>}
            </div>
          </div>
        )}

        {done && (
          <p className="text-xs text-zinc-500 mt-0.5">{job.size ?? "Complete"}</p>
        )}

        {failed && (
          <p className="text-xs text-red-400/80 mt-0.5 truncate">
            {(s as Extract<DownloadStatus, { type: "Failed" }>).message}
          </p>
        )}

        {queued && (
          <p className="text-xs text-zinc-600 mt-0.5">Waiting…</p>
        )}
      </div>

      {/* actions — revealed on hover */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {done && job.output_path && (
          <button
            onClick={() => onOpenFolder(job.output_path!)}
            title="Show in folder"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        )}
        {failed && (
          <button
            onClick={() => onRetry(job.id)}
            title="Retry"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        {active ? (
          <button
            onClick={() => onCancel(job.id)}
            title="Cancel"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={() => onRemove(job.id)}
            title="Remove"
            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── settings page ───────────────────────────────────────────────────────────

function SettingsPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<Config>("get_config").then(setCfg).catch(console.error);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<Config>) => setCfg((c) => c ? { ...c, ...patch } : c);

  const handleBrowse = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") update({ output_dir: dir });
  };

  const handleSave = async () => {
    await invoke("save_config", { newConfig: cfg }).catch(console.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* Output directory */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Download folder
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={cfg.output_dir}
            onChange={(e) => update({ output_dir: e.target.value })}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-300"
          />
          <button
            onClick={handleBrowse}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

      {/* Default format */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Default format
        </label>
        <FormatSelect value={cfg.default_format} onChange={(v) => update({ default_format: v })} />
        <p className="text-xs text-zinc-600">
          "Best MP4" downloads H.264 video in a .mp4 container — plays everywhere.
          "Best Quality" may use AV1/VP9 which requires a modern player.
        </p>
      </div>

      {/* Concurrent downloads */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Concurrent downloads — {cfg.max_concurrent}
        </label>
        <input
          type="range"
          min={1}
          max={8}
          value={cfg.max_concurrent}
          onChange={(e) => update({ max_concurrent: Number(e.target.value) })}
          className="w-full accent-zinc-300"
        />
        <div className="flex justify-between text-xs text-zinc-600">
          <span>1 (sequential)</span>
          <span>8 (maximum)</span>
        </div>
        <p className="text-xs text-zinc-600">
          Takes effect for new downloads. Active downloads are not affected.
        </p>
      </div>

      <button
        onClick={handleSave}
        className={cn(
          "px-4 py-2 rounded-md text-sm font-medium transition-colors",
          saved
            ? "bg-green-600/20 text-green-400 border border-green-600/30"
            : "bg-zinc-100 text-zinc-900 hover:bg-white"
        )}
      >
        {saved ? "Saved" : "Save settings"}
      </button>
    </div>
  );
}

// ─── nav ─────────────────────────────────────────────────────────────────────

type NavItem = "queue" | "history" | "settings";
const NAV = [
  { id: "queue"    as NavItem, icon: Download, label: "Queue"    },
  { id: "history"  as NavItem, icon: History,  label: "History"  },
  { id: "settings" as NavItem, icon: Settings, label: "Settings" },
];

// ─── app ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [nav, setNav]       = useState<NavItem>("queue");
  const [url, setUrl]       = useState("");
  const [format, setFormat] = useState("best_mp4");
  const [adding, setAdding] = useState(false);
  const [jobs, setJobs]     = useState<DownloadJob[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate queue and subscribe to live updates
  useEffect(() => {
    invoke<DownloadJob[]>("get_queue").then(setJobs).catch(console.error);
    invoke<{ default_format: string }>("get_config")
      .then((c) => setFormat(c.default_format))
      .catch(console.error);

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
      await invoke("add_download", { url: trimmed, format });
      setUrl("");
    } catch (e) { console.error(e); }
    finally {
      setAdding(false);
      inputRef.current?.focus();
    }
  };

  const handleCancel  = (id: string) => invoke("cancel_download", { id }).catch(console.error);
  const handleRemove  = async (id: string) => {
    await invoke("remove_job", { id }).catch(console.error);
    setJobs((p) => p.filter((j) => j.id !== id));
  };
  const handleRetry   = (id: string) => invoke("retry_download", { id }).catch(console.error);
  const handleFolder  = (path: string) => invoke("open_folder", { path }).catch(console.error);
  const handleClear   = async () => {
    await invoke("clear_completed").catch(console.error);
    setJobs((p) => p.filter((j) => j.status.type === "Downloading" || j.status.type === "Queued"));
  };

  const activeJobs   = jobs.filter((j) => j.status.type === "Downloading" || j.status.type === "Queued");
  const finishedJobs = jobs.filter((j) => j.status.type !== "Downloading" && j.status.type !== "Queued");
  const hasCompleted = finishedJobs.length > 0;

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
          <div className="flex items-center gap-3">
            {nav === "queue" && activeJobs.length > 0 && (
              <span className="text-xs text-zinc-500">{activeJobs.length} active</span>
            )}
            {nav === "queue" && hasCompleted && (
              <button
                onClick={handleClear}
                title="Clear completed"
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear done
              </button>
            )}
          </div>
        </header>

        {/* Queue page */}
        {nav === "queue" && (
          <>
            {/* Input bar */}
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
                <FormatSelect value={format} onChange={setFormat} />
                <button
                  onClick={handleAdd}
                  disabled={!url.trim() || adding}
                  className="flex items-center gap-1.5 bg-zinc-100 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
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
                    <QueueItem key={job.id} job={job}
                      onCancel={handleCancel} onRemove={handleRemove}
                      onRetry={handleRetry}   onOpenFolder={handleFolder}
                    />
                  ))}
                  {hasCompleted && activeJobs.length > 0 && (
                    <div className="px-6 py-2 text-[10px] text-zinc-600 uppercase tracking-widest border-b border-zinc-800/60 bg-zinc-950">
                      Completed
                    </div>
                  )}
                  {finishedJobs.map((job) => (
                    <QueueItem key={job.id} job={job}
                      onCancel={handleCancel} onRemove={handleRemove}
                      onRetry={handleRetry}   onOpenFolder={handleFolder}
                    />
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
            <p className="text-xs">Coming soon</p>
          </main>
        )}

        {nav === "settings" && <SettingsPage />}
      </div>
    </div>
  );
}
