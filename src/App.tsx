import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Download, History, Settings, Plus, Link, X, AlertCircle, CheckCircle2,
  Loader2, FolderOpen, RotateCcw, Trash2, ChevronDown, Clock, User,
  FileVideo, Music, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DownloadJob, DownloadStatus, Config } from "@/types";
import { FORMAT_TYPES, QUALITY_LEVELS, formatTypeLabel, qualityLabel, isAudioFormat } from "@/types";

// ─── tiny helpers ────────────────────────────────────────────────────────────

function shortenUrl(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname.slice(0, 28);
  } catch { return url.slice(0, 50); }
}

// ─── format selectors ────────────────────────────────────────────────────────

function Select({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void;
  disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="appearance-none w-full bg-zinc-900 border border-zinc-700 rounded-md pl-3 pr-6 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
    </div>
  );
}

function FormatTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={onChange} className="w-36">
      {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
    </Select>
  );
}

function QualitySelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Select value={value} onChange={onChange} disabled={disabled} className="w-24">
      {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
    </Select>
  );
}

// ─── queue item ──────────────────────────────────────────────────────────────

function QueueItem({
  job, focused, checked, anyChecked,
  onFocus, onCheck,
  onCancel, onRemove, onRetry,
}: {
  job: DownloadJob;
  focused: boolean; checked: boolean; anyChecked: boolean;
  onFocus: () => void; onCheck: () => void;
  onCancel: () => void; onRemove: () => void; onRetry: () => void;
}) {
  const s = job.status;
  const downloading = s.type === "Downloading";
  const queued      = s.type === "Queued";
  const fetching    = s.type === "Fetching";
  const done        = s.type === "Finished";
  const failed      = s.type === "Failed";
  const active      = downloading || queued || fetching;

  return (
    <div
      onClick={onFocus}
      className={cn(
        "relative flex items-start gap-3 px-4 py-3 border-b border-zinc-800/60 cursor-pointer transition-colors group",
        focused ? "bg-zinc-800/70" : "hover:bg-white/[0.025]"
      )}
    >
      {/* checkbox — always visible when any selected, else hover-only */}
      <div
        onClick={e => { e.stopPropagation(); onCheck(); }}
        className={cn(
          "shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all",
          checked
            ? "bg-zinc-100 border-zinc-100"
            : anyChecked
              ? "border-zinc-600 bg-transparent"
              : "border-transparent group-hover:border-zinc-600",
        )}
      >
        {checked && <svg className="w-2.5 h-2.5 text-zinc-900" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>

      {/* status icon */}
      <div className="shrink-0 pt-0.5">
        {fetching    ? <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
         : downloading ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
         : queued      ? <div className="w-2 h-2 mt-0.5 rounded-full bg-zinc-600" />
         : done        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
         : failed      ? <AlertCircle  className="w-3.5 h-3.5 text-red-400" />
         :               <div className="w-2 h-2 mt-0.5 rounded-full bg-zinc-700" />}
      </div>

      {/* content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-sm font-medium truncate text-zinc-100 leading-snug">
            {job.title ?? shortenUrl(job.url)}
          </p>
          <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums">
            {isAudioFormat(job.format_type) ? formatTypeLabel(job.format_type)
              : `${formatTypeLabel(job.format_type)} · ${qualityLabel(job.quality)}`}
          </span>
        </div>

        {fetching && <p className="text-xs text-zinc-600 mt-0.5">Fetching info…</p>}
        {queued   && <p className="text-xs text-zinc-600 mt-0.5">Waiting…</p>}

        {downloading && (
          <div className="mt-1.5 space-y-1">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${job.progress}%` }} />
            </div>
            <div className="flex gap-3 text-xs text-zinc-500">
              <span className="tabular-nums w-10">{job.progress.toFixed(1)}%</span>
              {job.size  && <span>{job.size}</span>}
              {job.speed && <span className="text-zinc-400">{job.speed}</span>}
              {job.eta   && <span>ETA {job.eta}</span>}
            </div>
          </div>
        )}

        {done   && <p className="text-xs text-zinc-500 mt-0.5">{job.size ?? "Complete"}</p>}
        {failed && <p className="text-xs text-red-400/80 mt-0.5 truncate">{(s as Extract<DownloadStatus, { type: "Failed" }>).message}</p>}
      </div>

      {/* action buttons — hover reveal */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        {failed && (
          <button onClick={onRetry} title="Retry" className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded">
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
        {active
          ? <button onClick={onCancel} title="Cancel" className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"><X className="w-3 h-3" /></button>
          : <button onClick={onRemove} title="Remove" className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"><X className="w-3 h-3" /></button>
        }
      </div>
    </div>
  );
}

// ─── preview panel ────────────────────────────────────────────────────────────

function PreviewPanel({ job, onClose, onCancel, onRemove, onRetry, onOpenFolder }: {
  job: DownloadJob;
  onClose: () => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const s = job.status;
  const done   = s.type === "Finished";
  const failed = s.type === "Failed";
  const active = s.type === "Downloading" || s.type === "Queued" || s.type === "Fetching";
  const isAudio = isAudioFormat(job.format_type);

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-950 overflow-y-auto">
      {/* close */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Details</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* thumbnail */}
      {job.thumbnail ? (
        <div className="aspect-video bg-zinc-900 overflow-hidden shrink-0">
          <img src={job.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
        </div>
      ) : (
        <div className="aspect-video bg-zinc-900 flex items-center justify-center shrink-0">
          {isAudio ? <Music className="w-10 h-10 text-zinc-700" /> : <FileVideo className="w-10 h-10 text-zinc-700" />}
        </div>
      )}

      {/* metadata */}
      <div className="p-4 space-y-4 flex-1">
        {/* title */}
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-snug">
            {job.title ?? shortenUrl(job.url)}
          </p>
          {job.uploader && (
            <div className="flex items-center gap-1.5 mt-1">
              <User className="w-3 h-3 text-zinc-600" />
              <span className="text-xs text-zinc-500">{job.uploader}</span>
            </div>
          )}
          {job.duration && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3 h-3 text-zinc-600" />
              <span className="text-xs text-zinc-500">{job.duration}</span>
            </div>
          )}
        </div>

        {/* divider */}
        <div className="border-t border-zinc-800" />

        {/* format */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Format</p>
          <p className="text-sm text-zinc-300">
            {isAudio ? formatTypeLabel(job.format_type)
              : `${formatTypeLabel(job.format_type)} · ${qualityLabel(job.quality)}`}
          </p>
        </div>

        {/* status / progress */}
        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Status</p>
          {s.type === "Downloading" && (
            <div className="space-y-1.5">
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{job.progress.toFixed(1)}%</span>
                {job.speed && <span>{job.speed}</span>}
                {job.eta   && <span>ETA {job.eta}</span>}
              </div>
              {job.size && <p className="text-xs text-zinc-600">{job.size}</p>}
            </div>
          )}
          {s.type !== "Downloading" && (
            <div className="flex items-center gap-2">
              {s.type === "Fetching"    && <><Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" /><span className="text-sm text-zinc-500">Fetching info…</span></>}
              {s.type === "Queued"      && <><div className="w-2 h-2 rounded-full bg-zinc-600" /><span className="text-sm text-zinc-500">Queued</span></>}
              {done                     && <><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /><span className="text-sm text-green-400">Finished{job.size ? ` · ${job.size}` : ""}</span></>}
              {failed                   && <><AlertCircle className="w-3.5 h-3.5 text-red-400" /><span className="text-sm text-red-400">Failed</span></>}
              {s.type === "Cancelled"   && <><div className="w-2 h-2 rounded-full bg-zinc-700" /><span className="text-sm text-zinc-600">Cancelled</span></>}
            </div>
          )}
          {failed && <p className="text-xs text-red-400/70 break-words">{(s as Extract<DownloadStatus, { type: "Failed" }>).message}</p>}
        </div>

        {/* output path */}
        {job.output_path && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">File</p>
            <p className="text-xs text-zinc-500 break-all leading-relaxed">{job.output_path}</p>
          </div>
        )}

        {/* divider */}
        <div className="border-t border-zinc-800" />

        {/* actions */}
        <div className="space-y-2">
          {done && job.output_path && (
            <button
              onClick={() => onOpenFolder(job.output_path!)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Show in folder
            </button>
          )}
          {failed && (
            <button
              onClick={() => onRetry(job.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry download
            </button>
          )}
          {active && (
            <button
              onClick={() => onCancel(job.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
          <button
            onClick={() => { window.open(job.url); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-zinc-800/50 hover:bg-zinc-800 text-sm text-zinc-500 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open URL
          </button>
          {!active && (
            <button
              onClick={() => { onRemove(job.id); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-800/50 text-sm text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ─── settings page ────────────────────────────────────────────────────────────

function SettingsPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { invoke<Config>("get_config").then(setCfg).catch(console.error); }, []);
  if (!cfg) return null;

  const update = (patch: Partial<Config>) => setCfg(c => c ? { ...c, ...patch } : c);

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
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Download folder</label>
        <div className="flex gap-2">
          <input
            type="text" value={cfg.output_dir}
            onChange={e => update({ output_dir: e.target.value })}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 text-zinc-300"
          />
          <button onClick={handleBrowse} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
            Browse
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Default format</label>
        <div className="flex items-center gap-2">
          <FormatTypeSelect value={cfg.default_format_type} onChange={v => update({ default_format_type: v })} />
          <QualitySelect
            value={cfg.default_quality}
            onChange={v => update({ default_quality: v })}
            disabled={isAudioFormat(cfg.default_format_type)}
          />
        </div>
        <p className="text-xs text-zinc-600">
          "MP4 (H264)" plays on any device. "Best Quality" may use AV1/VP9 which needs a modern player.
          Quality cap only applies to video formats.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Concurrent downloads — {cfg.max_concurrent}
        </label>
        <input type="range" min={1} max={8} value={cfg.max_concurrent}
          onChange={e => update({ max_concurrent: Number(e.target.value) })}
          className="w-full accent-zinc-300"
        />
        <div className="flex justify-between text-xs text-zinc-600">
          <span>1 (sequential)</span><span>8 (maximum)</span>
        </div>
      </div>

      <button
        onClick={handleSave}
        className={cn(
          "px-4 py-2 rounded-md text-sm font-medium transition-colors",
          saved ? "bg-green-600/20 text-green-400 border border-green-600/30" : "bg-zinc-100 text-zinc-900 hover:bg-white"
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
  const [nav, setNav]             = useState<NavItem>("queue");
  const [url, setUrl]             = useState("");
  const [formatType, setFormatType] = useState("mp4");
  const [quality, setQuality]     = useState("best");
  const [adding, setAdding]       = useState(false);
  const [jobs, setJobs]           = useState<DownloadJob[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const focusedJob = jobs.find(j => j.id === focusedId) ?? null;

  // Hydrate queue and subscribe to live updates
  useEffect(() => {
    invoke<DownloadJob[]>("get_queue").then(setJobs).catch(console.error);
    invoke<Config>("get_config").then(cfg => {
      setFormatType(cfg.default_format_type);
      setQuality(cfg.default_quality);
    }).catch(console.error);

    const unlisten = listen<DownloadJob>("download-update", e => {
      setJobs(prev => {
        const idx = prev.findIndex(j => j.id === e.payload.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = e.payload; return next; }
        return [...prev, e.payload];
      });
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Reset quality when switching to audio
  useEffect(() => {
    if (isAudioFormat(formatType)) setQuality("best");
  }, [formatType]);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      await invoke("add_download", { url: trimmed, formatType, quality });
      setUrl("");
    } catch (e) { console.error(e); }
    finally { setAdding(false); inputRef.current?.focus(); }
  };

  const handleFocus = useCallback((id: string) => {
    setFocusedId(prev => prev === id ? null : id);
    setCheckedIds(new Set());
  }, []);

  const handleCheck = useCallback((id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setFocusedId(id);
  }, []);

  const handleCancel     = (id: string) => invoke("cancel_download", { id }).catch(console.error);
  const handleRemove     = useCallback(async (id: string) => {
    await invoke("remove_job", { id }).catch(console.error);
    setJobs(p => p.filter(j => j.id !== id));
    setCheckedIds(p => { const n = new Set(p); n.delete(id); return n; });
    if (focusedId === id) setFocusedId(null);
  }, [focusedId]);
  const handleRetry      = (id: string) => invoke("retry_download", { id }).catch(console.error);
  const handleOpenFolder = (path: string) => invoke("open_folder", { path }).catch(console.error);

  const handleDeleteChecked = async () => {
    const ids = [...checkedIds];
    await invoke("remove_jobs", { ids }).catch(console.error);
    setJobs(p => p.filter(j => !checkedIds.has(j.id)));
    if (focusedId && checkedIds.has(focusedId)) setFocusedId(null);
    setCheckedIds(new Set());
  };

  const handleClear = async () => {
    await invoke("clear_completed").catch(console.error);
    setJobs(p => p.filter(j => j.status.type === "Downloading" || j.status.type === "Queued" || j.status.type === "Fetching"));
  };

  const activeJobs   = jobs.filter(j => ["Fetching","Queued","Downloading"].includes(j.status.type));
  const finishedJobs = jobs.filter(j => !["Fetching","Queued","Downloading"].includes(j.status.type));
  const hasCompleted = finishedJobs.length > 0;
  const anyChecked   = checkedIds.size > 0;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Sidebar */}
      <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-zinc-900 border-r border-zinc-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center mb-4">
          <Download className="w-4 h-4 text-zinc-900" />
        </div>
        {NAV.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setNav(id)} title={label}
            className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
              nav === id ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </aside>

      {/* Main area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="px-6 h-14 flex items-center justify-between border-b border-zinc-800 shrink-0">
          <h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
            {NAV.find(n => n.id === nav)?.label}
          </h1>
          <div className="flex items-center gap-3">
            {nav === "queue" && activeJobs.length > 0 && !anyChecked && (
              <span className="text-xs text-zinc-500">{activeJobs.length} active</span>
            )}
            {nav === "queue" && anyChecked && (
              <button onClick={handleDeleteChecked}
                className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete {checkedIds.size} selected
              </button>
            )}
            {nav === "queue" && hasCompleted && !anyChecked && (
              <button onClick={handleClear}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Clear done
              </button>
            )}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Content */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {nav === "queue" && (
              <>
                {/* URL input bar */}
                <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                      <input ref={inputRef} type="text" value={url}
                        onChange={e => setUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleAdd()}
                        placeholder="Paste a URL — YouTube, Vimeo, Twitter, 1800+ sites"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 placeholder:text-zinc-600"
                      />
                    </div>
                    <FormatTypeSelect value={formatType} onChange={setFormatType} />
                    <QualitySelect value={quality} onChange={setQuality} disabled={isAudioFormat(formatType)} />
                    <button onClick={handleAdd} disabled={!url.trim() || adding}
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
                      {activeJobs.map(job => (
                        <QueueItem key={job.id} job={job}
                          focused={focusedId === job.id}
                          checked={checkedIds.has(job.id)}
                          anyChecked={anyChecked}
                          onFocus={() => handleFocus(job.id)}
                          onCheck={() => handleCheck(job.id)}
                          onCancel={handleCancel.bind(null, job.id)}
                          onRemove={() => handleRemove(job.id)}
                          onRetry={handleRetry.bind(null, job.id)}
                        />
                      ))}
                      {hasCompleted && activeJobs.length > 0 && (
                        <div className="px-4 py-1.5 text-[10px] text-zinc-600 uppercase tracking-widest border-b border-zinc-800/60">
                          Completed
                        </div>
                      )}
                      {finishedJobs.map(job => (
                        <QueueItem key={job.id} job={job}
                          focused={focusedId === job.id}
                          checked={checkedIds.has(job.id)}
                          anyChecked={anyChecked}
                          onFocus={() => handleFocus(job.id)}
                          onCheck={() => handleCheck(job.id)}
                          onCancel={handleCancel.bind(null, job.id)}
                          onRemove={() => handleRemove(job.id)}
                          onRetry={handleRetry.bind(null, job.id)}
                        />
                      ))}
                    </>
                  )}
                </main>
              </>
            )}

            {nav === "history" && (
              <main className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600">
                <History className="w-8 h-8 mb-1 opacity-20" />
                <p className="text-sm font-medium">No history yet</p>
                <p className="text-xs">Coming soon</p>
              </main>
            )}

            {nav === "settings" && <SettingsPage />}
          </div>

          {/* Preview panel */}
          {focusedJob && (
            <PreviewPanel
              job={focusedJob}
              onClose={() => setFocusedId(null)}
              onCancel={handleCancel}
              onRemove={handleRemove}
              onRetry={handleRetry}
              onOpenFolder={handleOpenFolder}
            />
          )}
        </div>
      </div>
    </div>
  );
}
