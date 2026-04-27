import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Download, History, Settings, Plus, Link, X, AlertCircle, CheckCircle2,
  Loader2, FolderOpen, RotateCcw, Trash2, ChevronDown, Clock, User,
  FileVideo, Music, ExternalLink, Zap, Upload, Pause, Play, GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DownloadJob, DownloadStatus, HistoryEntry, Config } from "@/types";
import { FORMAT_TYPES, QUALITY_LEVELS, formatTypeLabel, isAudioFormat, resolvedQuality, parseSpeedBytes, formatSpeed } from "@/types";
import { HistoryTab } from "@/components/HistoryTab";
import { SettingsPage } from "@/components/SettingsPage";
import { BulkImportModal } from "@/components/BulkImportModal";

const ACTIVE_STATUSES = new Set(["Fetching", "Queued", "Downloading", "Processing"]);

// ─── helpers ─────────────────────────────────────────────────────────────────

function shortenUrl(url: string) {
  try { const u = new URL(url); return u.hostname.replace(/^www\./, "") + u.pathname.slice(0, 28); }
  catch { return url.slice(0, 50); }
}

// ─── selects ─────────────────────────────────────────────────────────────────

function Sel({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void;
  disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="appearance-none w-full bg-zinc-900 border border-zinc-700 rounded-md pl-3 pr-6 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-40 cursor-pointer">
        {children}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
    </div>
  );
}

// ─── remove modal ─────────────────────────────────────────────────────────────

interface RemovePending { id: string; title: string | null; outputPath: string | null; }

function RemoveModal({ p, onList, onDisk, onCancel }: {
  p: RemovePending; onList: () => void; onDisk: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-5 w-72 shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Remove download</h3>
          {p.title && <p className="text-xs text-zinc-500 mt-1 truncate">{p.title}</p>}
        </div>
        <div className="space-y-2">
          <button onClick={onList} className="w-full text-left px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors">
            <div className="text-sm font-medium text-zinc-200">Remove from list</div>
            <div className="text-xs text-zinc-500 mt-0.5">Keep the file on disk</div>
          </button>
          {p.outputPath && (
            <button onClick={onDisk} className="w-full text-left px-4 py-3 rounded-xl bg-zinc-800 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors">
              <div className="text-sm font-medium text-red-400">Delete file from disk</div>
              <div className="text-xs text-zinc-500 mt-0.5">Cannot be undone</div>
            </button>
          )}
          <button onClick={onCancel} className="w-full py-2.5 rounded-xl text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── queue item ───────────────────────────────────────────────────────────────

function QueueItem({ job, focused, checked, anyChecked, sortable, onFocus, onCheck, onCancel, onRemoveClick }: {
  job: DownloadJob; focused: boolean; checked: boolean; anyChecked: boolean; sortable: boolean;
  onFocus: () => void; onCheck: () => void;
  onCancel: () => void; onRemoveClick: () => void;
}) {
  const s = job.status;
  const downloading = s.type === "Downloading";
  const processing  = s.type === "Processing";
  const active = ACTIVE_STATUSES.has(s.type);
  const qualDisplay = isAudioFormat(job.format_type) ? formatTypeLabel(job.format_type)
    : `${formatTypeLabel(job.format_type)} · ${resolvedQuality(job)}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: job.id, disabled: !sortable });
  const dragStyle = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={dragStyle} onClick={onFocus}
      className={cn("relative flex items-start gap-3 px-4 py-3 border-b border-zinc-800/60 cursor-pointer transition-colors group",
        focused ? "bg-zinc-800/70" : "hover:bg-white/[0.025]",
        isDragging && "z-50 shadow-2xl"
      )}
    >
      {/* drag handle — only for active items */}
      {sortable ? (
        <button {...attributes} {...listeners}
          onClick={e => e.stopPropagation()}
          className="shrink-0 mt-1 text-zinc-700 hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none">
          <GripVertical className="w-3 h-3" />
        </button>
      ) : (
        <div className="w-3 shrink-0" />
      )}

      <div onClick={e => { e.stopPropagation(); onCheck(); }}
        className={cn("shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center transition-all",
          checked ? "bg-zinc-100 border-zinc-100" :
            anyChecked ? "border-zinc-600" : "border-transparent group-hover:border-zinc-600"
        )}>
        {checked && <svg className="w-2.5 h-2.5 text-zinc-900" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>

      <div className="shrink-0 pt-0.5 w-3.5">
        {s.type === "Fetching" ? <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
          : downloading || processing ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          : s.type === "Queued"   ? <div className="w-2 h-2 mt-1 rounded-full bg-zinc-600" />
          : s.type === "Finished" ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          : s.type === "Failed"   ? <AlertCircle  className="w-3.5 h-3.5 text-red-400" />
          :                         <div className="w-2 h-2 mt-1 rounded-full bg-zinc-700" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium truncate text-zinc-100">{job.title ?? shortenUrl(job.url)}</p>
          <span className="text-[10px] text-zinc-600 shrink-0">{qualDisplay}</span>
        </div>

        {s.type === "Fetching" && <p className="text-xs text-zinc-600 mt-0.5">Fetching info…</p>}
        {s.type === "Queued"   && <p className="text-xs text-zinc-600 mt-0.5">Waiting…</p>}

        {downloading && (
          <div className="mt-1.5 space-y-1">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} />
            </div>
            <div className="flex gap-3 text-xs text-zinc-500">
              <span className="tabular-nums w-10">{job.progress.toFixed(1)}%</span>
              {job.size  && <span>{job.size}</span>}
              {job.speed && <span className="text-zinc-400">{job.speed}</span>}
              {job.eta   && <span>ETA {job.eta}</span>}
            </div>
          </div>
        )}

        {processing && (
          <div className="mt-1.5 space-y-1">
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden relative">
              <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue-400/70 to-transparent animate-shimmer" />
            </div>
            <p className="text-xs text-zinc-500">Processing…</p>
          </div>
        )}

        {s.type === "Finished" && <p className="text-xs text-zinc-500 mt-0.5">{job.size ?? "Complete"}</p>}
        {s.type === "Failed" && <p className="text-xs text-red-400/80 mt-0.5 truncate">{(s as Extract<DownloadStatus, { type: "Failed" }>).message}</p>}
      </div>

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        {s.type === "Failed" && <button onClick={() => invoke("retry_download", { id: job.id }).catch(console.error)} className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"><RotateCcw className="w-3 h-3" /></button>}
        {active
          ? <button onClick={onCancel}      className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"><X className="w-3 h-3" /></button>
          : <button onClick={onRemoveClick} className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"><X className="w-3 h-3" /></button>
        }
      </div>
    </div>
  );
}

// ─── preview panel ────────────────────────────────────────────────────────────

function PreviewPanel({ job, onClose, onCancel, onRemoveClick }: {
  job: DownloadJob; onClose: () => void;
  onCancel: (id: string) => void; onRemoveClick: (job: DownloadJob) => void;
}) {
  const s = job.status;
  const isAudio = isAudioFormat(job.format_type);
  const qualDisplay = isAudio ? formatTypeLabel(job.format_type)
    : `${formatTypeLabel(job.format_type)} · ${resolvedQuality(job)}`;
  const active = ["Downloading","Queued","Fetching","Processing"].includes(s.type);

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-950 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Details</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors"><X className="w-3.5 h-3.5" /></button>
      </div>

      {job.thumbnail
        ? <div className="aspect-video bg-zinc-900 overflow-hidden shrink-0"><img src={job.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} /></div>
        : <div className="aspect-video bg-zinc-900 flex items-center justify-center shrink-0">
            {isAudio ? <Music className="w-10 h-10 text-zinc-700" /> : <FileVideo className="w-10 h-10 text-zinc-700" />}
          </div>
      }

      <div className="p-4 space-y-4 flex-1">
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-snug">{job.title ?? shortenUrl(job.url)}</p>
          {job.uploader && <div className="flex items-center gap-1.5 mt-1"><User className="w-3 h-3 text-zinc-600" /><span className="text-xs text-zinc-500 truncate">{job.uploader}</span></div>}
          {job.duration  && <div className="flex items-center gap-1.5 mt-0.5"><Clock className="w-3 h-3 text-zinc-600" /><span className="text-xs text-zinc-500">{job.duration}</span></div>}
        </div>
        <div className="border-t border-zinc-800" />
        <div className="space-y-1"><p className="text-[10px] text-zinc-600 uppercase tracking-wider">Format</p><p className="text-sm text-zinc-300">{qualDisplay}</p></div>

        <div className="space-y-1.5">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Status</p>
          {s.type === "Downloading" && (
            <div className="space-y-1.5">
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${job.progress}%` }} /></div>
              <div className="flex justify-between text-xs text-zinc-500"><span>{job.progress.toFixed(1)}%</span>{job.speed && <span>{job.speed}</span>}{job.eta && <span>ETA {job.eta}</span>}</div>
              {job.size && <p className="text-xs text-zinc-600">{job.size}</p>}
            </div>
          )}
          {s.type === "Processing" && (
            <div className="space-y-1.5">
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden relative"><div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue-400/70 to-transparent animate-shimmer" /></div>
              <p className="text-xs text-zinc-500">Processing…</p>
            </div>
          )}
          {!["Downloading","Processing"].includes(s.type) && (
            <div className="flex items-center gap-2">
              {s.type === "Fetching"  && <><Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" /><span className="text-sm text-zinc-500">Fetching info…</span></>}
              {s.type === "Queued"    && <><div className="w-2 h-2 rounded-full bg-zinc-600" /><span className="text-sm text-zinc-500">Queued</span></>}
              {s.type === "Finished"  && <><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /><span className="text-sm text-green-400">Finished{job.size ? ` · ${job.size}` : ""}</span></>}
              {s.type === "Failed"    && <><AlertCircle  className="w-3.5 h-3.5 text-red-400" /><span className="text-sm text-red-400">Failed</span></>}
              {s.type === "Cancelled" && <><div className="w-2 h-2 rounded-full bg-zinc-700" /><span className="text-sm text-zinc-600">Cancelled</span></>}
            </div>
          )}
          {s.type === "Failed" && <p className="text-xs text-red-400/70 break-words">{(s as Extract<DownloadStatus, { type: "Failed" }>).message}</p>}
        </div>

        {job.output_path && <div className="space-y-1"><p className="text-[10px] text-zinc-600 uppercase tracking-wider">File</p><p className="text-xs text-zinc-500 break-all">{job.output_path}</p></div>}

        <div className="border-t border-zinc-800" />

        <div className="space-y-1.5">
          {s.type === "Finished" && job.output_path && (
            <button onClick={() => invoke("open_folder", { path: job.output_path! }).catch(console.error)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors">
              <FolderOpen className="w-3.5 h-3.5" />Show in folder
            </button>
          )}
          {s.type === "Failed" && (
            <button onClick={() => invoke("retry_download", { id: job.id }).catch(console.error)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />Retry
            </button>
          )}
          {active && (
            <button onClick={() => onCancel(job.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors">
              <X className="w-3.5 h-3.5" />Cancel
            </button>
          )}
          <button onClick={() => invoke("open_url", { url: job.url }).catch(console.error)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50 text-sm text-zinc-500 transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />Open URL
          </button>
          {!active && (
            <button onClick={() => onRemoveClick(job)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50 text-sm text-zinc-600 hover:text-zinc-400 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />Remove…
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

// ─── nav ──────────────────────────────────────────────────────────────────────

type NavItem = "queue" | "history" | "settings";
const NAV = [
  { id: "queue"    as NavItem, icon: Download, label: "Queue"    },
  { id: "history"  as NavItem, icon: History,  label: "History"  },
  { id: "settings" as NavItem, icon: Settings, label: "Settings" },
];

// ─── app ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nav, setNav]               = useState<NavItem>("queue");
  const [url, setUrl]               = useState("");
  const [formatType, setFormatType] = useState("mp4");
  const [quality, setQuality]       = useState("best");
  const [adding, setAdding]         = useState(false);
  // Split active/completed for proper ordering
  const [activeJobs,    setActiveJobs]    = useState<DownloadJob[]>([]);
  const [completedJobs, setCompletedJobs] = useState<DownloadJob[]>([]);
  const [focusedId, setFocusedId]   = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [removePending, setRemovePending] = useState<RemovePending | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [queuePaused, setQueuePaused] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allJobs    = [...activeJobs, ...completedJobs];
  const focusedJob = allJobs.find(j => j.id === focusedId) ?? null;

  // Total speed of active downloads
  const totalSpeedBps = activeJobs
    .filter(j => j.status.type === "Downloading")
    .reduce((sum, j) => sum + parseSpeedBytes(j.speed), 0);

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const applyUpdate = useCallback((payload: DownloadJob) => {
    const isNowActive = ACTIVE_STATUSES.has(payload.status.type);
    if (isNowActive) {
      setActiveJobs(prev => {
        const idx = prev.findIndex(j => j.id === payload.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = payload; return n; }
        return [payload, ...prev]; // newest at top
      });
    } else {
      // Transition from active → completed (or direct completed)
      setActiveJobs(prev => prev.filter(j => j.id !== payload.id));
      setCompletedJobs(prev => {
        const idx = prev.findIndex(j => j.id === payload.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = payload; return n; }
        return [payload, ...prev]; // newest completion at top
      });
    }
  }, []);

  useEffect(() => {
    invoke<boolean>("get_queue_paused").then(setQueuePaused).catch(console.error);
    invoke<DownloadJob[]>("get_queue").then(all => {
      setActiveJobs(all.filter(j => ACTIVE_STATUSES.has(j.status.type)));
      setCompletedJobs(all.filter(j => !ACTIVE_STATUSES.has(j.status.type)));
    }).catch(console.error);
    invoke<Config>("get_config").then(cfg => {
      setFormatType(cfg.default_format_type);
      setQuality(cfg.default_quality);
    }).catch(console.error);
    invoke<string | null>("get_update_available").then(v => { if (v) setUpdateAvailable(v); }).catch(console.error);

    const unlisten = listen<DownloadJob>("download-update", e => applyUpdate(e.payload));
    return () => { unlisten.then(fn => fn()); };
  }, [applyUpdate]);

  useEffect(() => { if (isAudioFormat(formatType)) setQuality("best"); }, [formatType]);

  const handleAdd = async () => {
    const t = url.trim();
    if (!t || adding) return;
    setAdding(true);
    try {
      await invoke("add_download", { url: t, formatType, quality });
      setUrl("");
    } catch (e) { console.error(e); }
    finally { setAdding(false); inputRef.current?.focus(); }
  };

  const handleFocus = useCallback((id: string) => {
    setFocusedId(p => p === id ? null : id);
    setCheckedIds(new Set());
  }, []);

  const handleCheck = useCallback((id: string) => {
    setCheckedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setFocusedId(id);
  }, []);

  const handleCancel = (id: string) => invoke("cancel_download", { id }).catch(console.error);

  const handleRemoveClick = (job: DownloadJob) =>
    setRemovePending({ id: job.id, title: job.title, outputPath: job.output_path });

  const commitRemove = async (id: string, deleteDisk: boolean) => {
    const job = allJobs.find(j => j.id === id);
    if (deleteDisk && job?.output_path) await invoke("delete_file", { path: job.output_path }).catch(console.error);
    await invoke("remove_job", { id }).catch(console.error);
    setActiveJobs(p => p.filter(j => j.id !== id));
    setCompletedJobs(p => p.filter(j => j.id !== id));
    setCheckedIds(p => { const n = new Set(p); n.delete(id); return n; });
    if (focusedId === id) setFocusedId(null);
    setRemovePending(null);
  };

  const handleDeleteChecked = async () => {
    await invoke("remove_jobs", { ids: [...checkedIds] }).catch(console.error);
    setActiveJobs(p => p.filter(j => !checkedIds.has(j.id)));
    setCompletedJobs(p => p.filter(j => !checkedIds.has(j.id)));
    if (focusedId && checkedIds.has(focusedId)) setFocusedId(null);
    setCheckedIds(new Set());
  };

  const handleClear = async () => {
    await invoke("clear_completed").catch(console.error);
    setCompletedJobs([]);
  };

  const handleRedownload = async (e: HistoryEntry) => {
    setNav("queue");
    await invoke("add_download", { url: e.url, formatType: e.format_type, quality: e.quality }).catch(console.error);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setActiveJobs(prev => {
      const oldIdx = prev.findIndex(j => j.id === active.id);
      const newIdx = prev.findIndex(j => j.id === over.id);
      const reordered = arrayMove(prev, oldIdx, newIdx);
      invoke("reorder_queue", { ids: reordered.map(j => j.id) }).catch(console.error);
      return reordered;
    });
  };

  const anyChecked   = checkedIds.size > 0;
  const hasCompleted = completedJobs.length > 0;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Sidebar */}
      <aside className="w-14 flex flex-col items-center py-4 gap-1 bg-zinc-900 border-r border-zinc-800 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center mb-4">
          <Zap className="w-4 h-4 text-zinc-900" />
        </div>
        {NAV.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setNav(id)} title={label}
            className={cn("relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors",
              nav === id ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            )}>
            <Icon className="w-4 h-4" />
            {id === "settings" && updateAvailable && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-zinc-900" />
            )}
          </button>
        ))}
      </aside>

      {/* Main */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="px-4 h-14 flex items-center gap-2 border-b border-zinc-800 shrink-0">
          <h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase flex-1">
            {NAV.find(n => n.id === nav)?.label}
          </h1>

          {/* Speed indicator */}
          {nav === "queue" && totalSpeedBps > 0 && (
            <span className="text-xs text-zinc-500 tabular-nums">
              ↓ {formatSpeed(totalSpeedBps)}
            </span>
          )}

          {nav === "queue" && !anyChecked && activeJobs.length > 0 && (
            <span className="text-xs text-zinc-600">{activeJobs.length} active</span>
          )}
          {nav === "queue" && anyChecked && (
            <button onClick={handleDeleteChecked} className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-300 transition-colors">
              <Trash2 className="w-3 h-3" />Delete {checkedIds.size} selected
            </button>
          )}
          {nav === "queue" && hasCompleted && !anyChecked && (
            <button onClick={handleClear} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              <Trash2 className="w-3 h-3" />Clear done
            </button>
          )}
          {nav === "queue" && (
            <>
              <button onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800/50 border border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <Upload className="w-3 h-3" />Import
              </button>
              <button
                onClick={async () => {
                  const next = !queuePaused;
                  await invoke("set_queue_paused", { paused: next }).catch(console.error);
                  setQueuePaused(next);
                }}
                title={queuePaused ? "Resume queue" : "Pause queue"}
                className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors border",
                  queuePaused
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                )}>
                {queuePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                {queuePaused ? "Paused" : "Pause"}
              </button>
            </>
          )}
        </header>

        <div className="flex flex-1 overflow-hidden">
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
                    <Sel value={formatType} onChange={setFormatType} className="w-36">
                      {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </Sel>
                    <Sel value={quality} onChange={setQuality} disabled={isAudioFormat(formatType)} className="w-24">
                      {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
                    </Sel>
                    <button onClick={handleAdd} disabled={!url.trim() || adding}
                      className="flex items-center gap-1.5 bg-zinc-100 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                      {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Add
                    </button>
                  </div>
                </div>

                {/* Queue list */}
                <main className="flex-1 overflow-auto">
                  {activeJobs.length === 0 && completedJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
                      <Download className="w-8 h-8 mb-1 opacity-20" />
                      <p className="text-sm font-medium">Nothing in the queue</p>
                      <p className="text-xs">Paste a URL above to get started</p>
                    </div>
                  ) : (
                    <>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={activeJobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
                          {activeJobs.map(job => (
                            <QueueItem key={job.id} job={job} sortable
                              focused={focusedId === job.id} checked={checkedIds.has(job.id)} anyChecked={anyChecked}
                              onFocus={() => handleFocus(job.id)} onCheck={() => handleCheck(job.id)}
                              onCancel={() => handleCancel(job.id)} onRemoveClick={() => handleRemoveClick(job)}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                      {hasCompleted && activeJobs.length > 0 && (
                        <div className="px-4 py-1.5 text-[10px] text-zinc-600 uppercase tracking-widest border-b border-zinc-800/60">Completed</div>
                      )}
                      {completedJobs.map(job => (
                        <QueueItem key={job.id} job={job} sortable={false}
                          focused={focusedId === job.id} checked={checkedIds.has(job.id)} anyChecked={anyChecked}
                          onFocus={() => handleFocus(job.id)} onCheck={() => handleCheck(job.id)}
                          onCancel={() => handleCancel(job.id)} onRemoveClick={() => handleRemoveClick(job)}
                        />
                      ))}
                    </>
                  )}
                </main>
              </>
            )}

            {nav === "history"  && <HistoryTab onRedownload={handleRedownload} />}
            {nav === "settings" && <SettingsPage updateAvailable={updateAvailable} />}
          </div>

          {/* Preview panel */}
          {focusedJob && nav === "queue" && (
            <PreviewPanel job={focusedJob} onClose={() => setFocusedId(null)}
              onCancel={handleCancel} onRemoveClick={handleRemoveClick} />
          )}
        </div>
      </div>

      {/* Overlays */}
      {removePending && (
        <RemoveModal p={removePending}
          onList={() => commitRemove(removePending.id, false)}
          onDisk={() => commitRemove(removePending.id, true)}
          onCancel={() => setRemovePending(null)}
        />
      )}
      {showImport && <BulkImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
