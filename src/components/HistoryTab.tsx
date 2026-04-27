import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, FileVideo, Music, FolderOpen, X, RotateCcw, User, Clock, Trash2, ExternalLink, PauseCircle, Timer, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "@/types";
import { formatTypeLabel, isAudioFormat, resolvedQuality, formatDateTime, groupByDate } from "@/types";

// ─── history preview panel ───────────────────────────────────────────────────

function HistoryPreview({ entry, onClose, onDelete, onOpenFolder, onRedownload }: {
  entry: HistoryEntry;
  onClose: () => void;
  onDelete: (id: string) => void;
  onOpenFolder: (p: string) => void;
  onRedownload: (e: HistoryEntry) => void;
}) {
  const isAudio = isAudioFormat(entry.format_type);
  const { date, time } = formatDateTime(entry.downloaded_at);

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-950 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Details</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors"><X className="w-3.5 h-3.5" /></button>
      </div>

      {entry.thumbnail
        ? <div className="aspect-video bg-zinc-900 overflow-hidden shrink-0"><img src={entry.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} /></div>
        : <div className="aspect-video bg-zinc-900 flex items-center justify-center shrink-0">
            {isAudio ? <Music className="w-10 h-10 text-zinc-700" /> : <FileVideo className="w-10 h-10 text-zinc-700" />}
          </div>
      }

      <div className="p-4 space-y-4 flex-1">
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-snug">{entry.title ?? entry.url}</p>
          {entry.uploader && <div className="flex items-center gap-1.5 mt-1"><User className="w-3 h-3 text-zinc-600" /><span className="text-xs text-zinc-500 truncate">{entry.uploader}</span></div>}
          {entry.duration  && <div className="flex items-center gap-1.5 mt-0.5"><Clock className="w-3 h-3 text-zinc-600" /><span className="text-xs text-zinc-500">{entry.duration}</span></div>}
        </div>

        <div className="border-t border-zinc-800" />

        <div className="space-y-1">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Format</p>
          <p className="text-sm text-zinc-300">
            {isAudio ? formatTypeLabel(entry.format_type) : `${formatTypeLabel(entry.format_type)} · ${resolvedQuality(entry)}`}
          </p>
        </div>

        {entry.size && (
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">File size</p>
            <p className="text-sm text-zinc-300">{entry.size}</p>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Downloaded</p>
          <p className="text-sm text-zinc-300">{date} at {time}</p>
        </div>

        {entry.output_path && (
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider">File</p>
            <p className="text-xs text-zinc-500 break-all leading-relaxed">{entry.output_path}</p>
          </div>
        )}

        <div className="border-t border-zinc-800" />

        <div className="space-y-1.5">
          {entry.output_path && (
            <button onClick={() => onOpenFolder(entry.output_path!)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors">
              <FolderOpen className="w-3.5 h-3.5" />Show in folder
            </button>
          )}
          <button onClick={() => onRedownload(entry)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" />Re-download
          </button>
          <button onClick={() => invoke("open_url", { url: entry.url }).catch(console.error)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50 text-sm text-zinc-500 transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />Open URL
          </button>
          <button onClick={() => onDelete(entry.id)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50 text-sm text-zinc-600 hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />Remove from history
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── history row ─────────────────────────────────────────────────────────────

function HistoryRow({ entry, focused, checked, anyChecked, onFocus, onCheck }: {
  entry: HistoryEntry; focused: boolean; checked: boolean; anyChecked: boolean;
  onFocus: () => void; onCheck: () => void;
}) {
  const isAudio = isAudioFormat(entry.format_type);
  const qual = isAudio ? "" : resolvedQuality(entry);
  const { time } = formatDateTime(entry.downloaded_at);

  return (
    <div onClick={onFocus}
      className={cn("flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 cursor-pointer transition-colors group",
        focused ? "bg-zinc-800/70" : "hover:bg-white/[0.025]"
      )}
    >
      {/* checkbox */}
      <div onClick={e => { e.stopPropagation(); onCheck(); }}
        className={cn("shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all",
          checked ? "bg-zinc-100 border-zinc-100" :
            anyChecked ? "border-zinc-600" : "border-transparent group-hover:border-zinc-600"
        )}>
        {checked && <svg className="w-2.5 h-2.5 text-zinc-900" viewBox="0 0 10 10"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>

      {/* thumbnail */}
      <div className="shrink-0 w-20 h-12 rounded bg-zinc-800 overflow-hidden">
        {entry.thumbnail
          ? <img src={entry.thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
          : <div className="w-full h-full flex items-center justify-center">
              {isAudio ? <Music className="w-4 h-4 text-zinc-700" /> : <FileVideo className="w-4 h-4 text-zinc-700" />}
            </div>
        }
      </div>

      {/* info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">{entry.title ?? entry.url}</p>
        <div className="flex gap-2 mt-0.5 text-[11px] text-zinc-600 flex-wrap">
          {entry.uploader && <span>{entry.uploader}</span>}
          {entry.duration  && <span>{entry.duration}</span>}
          <span>{formatTypeLabel(entry.format_type)}{qual ? ` · ${qual}` : ""}</span>
          {entry.size && <span>{entry.size}</span>}
          <span className="text-zinc-700">{time}</span>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

// ─── stop-time button ─────────────────────────────────────────────────────────

const PAUSE_OPTS = [
  { label: "1 hour",       secs: 3600       },
  { label: "3 hours",      secs: 10800      },
  { label: "12 hours",     secs: 43200      },
  { label: "24 hours",     secs: 86400      },
  { label: "Indefinitely", secs: null       },
];
const INDEFINITE = 9223372036854775807;

function StopTimeButton() {
  const [open, setOpen]   = useState(false);
  const [until, setUntil] = useState<number | null>(null);

  useEffect(() => {
    const poll = () => invoke<number | null>("get_history_pause").then(setUntil).catch(() => {});
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  const isPaused = until !== null && (until > Math.floor(Date.now() / 1000) || until === INDEFINITE);

  const activate = async (secs: number | null) => {
    const ts = secs === null ? INDEFINITE : Math.floor(Date.now() / 1000) + secs;
    await invoke("set_history_pause", { until: ts }).catch(console.error);
    setUntil(ts);
    setOpen(false);
  };
  const deactivate = async () => {
    await invoke("set_history_pause", { until: null }).catch(console.error);
    setUntil(null);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)}
        title="Stop time — pause history recording"
        className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors border",
          isPaused
            ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
            : "border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
        )}>
        {isPaused ? <Timer className="w-3 h-3" /> : <PauseCircle className="w-3 h-3" />}
        {isPaused ? "Recording paused" : "Stop time"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 w-44">
            {isPaused ? (
              <button onClick={deactivate} className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-zinc-800 transition-colors">
                Resume recording
              </button>
            ) : (
              <>
                <p className="px-3 py-1 text-[10px] text-zinc-600 uppercase tracking-widest">Pause history for…</p>
                {PAUSE_OPTS.map(o => (
                  <button key={o.label} onClick={() => activate(o.secs)}
                    className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors">
                    {o.label}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface Props {
  onRedownload: (e: HistoryEntry) => void;
}

export function HistoryTab({ onRedownload }: Props) {
  const [entries, setEntries]       = useState<HistoryEntry[]>([]);
  const [focusedId, setFocusedId]   = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [query, setQuery]           = useState("");

  const filtered = query.trim()
    ? entries.filter(e =>
        (e.title ?? "").toLowerCase().includes(query.toLowerCase()) ||
        e.url.toLowerCase().includes(query.toLowerCase()) ||
        (e.uploader ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : entries;

  const focusedEntry = entries.find(e => e.id === focusedId) ?? null;
  const anyChecked = checkedIds.size > 0;

  useEffect(() => {
    invoke<HistoryEntry[]>("get_history").then(setEntries).catch(console.error);
  }, []);

  const handleFocus = (id: string) => {
    setFocusedId(p => p === id ? null : id);
    setCheckedIds(new Set());
  };

  const handleCheck = (id: string) => {
    setCheckedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setFocusedId(id);
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_history_entry", { id }).catch(console.error);
    setEntries(p => p.filter(e => e.id !== id));
    setCheckedIds(p => { const n = new Set(p); n.delete(id); return n; });
    if (focusedId === id) setFocusedId(null);
  };

  const handleDeleteChecked = async () => {
    for (const id of checkedIds) {
      await invoke("delete_history_entry", { id }).catch(console.error);
    }
    setEntries(p => p.filter(e => !checkedIds.has(e.id)));
    if (focusedId && checkedIds.has(focusedId)) setFocusedId(null);
    setCheckedIds(new Set());
  };

  const handleClearAll = async () => {
    await invoke("clear_history").catch(console.error);
    setEntries([]);
    setFocusedId(null);
    setCheckedIds(new Set());
  };

  const handleOpenFolder = (path: string) => invoke("open_folder", { path }).catch(console.error);

  const groups = groupByDate(filtered);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center justify-end px-4 py-2 border-b border-zinc-800 shrink-0">
          <StopTimeButton />
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-zinc-600">
          <History className="w-8 h-8 mb-1 opacity-20" />
          <p className="text-sm font-medium">No history yet</p>
          <p className="text-xs">Completed downloads appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* search */}
        <div className="px-4 py-2 border-b border-zinc-800 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search downloads…"
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600" />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
          <span className="text-xs text-zinc-600">
            {query ? `${filtered.length} of ${entries.length}` : `${entries.length} download${entries.length !== 1 ? "s" : ""}`}
          </span>
          <div className="flex items-center gap-3">
            {anyChecked && (
              <button onClick={handleDeleteChecked} className="text-xs text-red-400/80 hover:text-red-300 transition-colors flex items-center gap-1">
                <Trash2 className="w-3 h-3" />Delete {checkedIds.size} selected
              </button>
            )}
            {!anyChecked && (
              <button onClick={handleClearAll} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors flex items-center gap-1">
                <Trash2 className="w-3 h-3" />Clear all
              </button>
            )}
            <StopTimeButton />
          </div>
        </div>

        {/* grouped list */}
        <div className="flex-1 overflow-auto">
          {groups.map(({ label, items }) => (
            <div key={label}>
              <div className="sticky top-0 z-10 px-4 py-1.5 text-[10px] text-zinc-600 uppercase tracking-widest bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800/60">
                {label}
              </div>
              {items.map(entry => (
                <HistoryRow key={entry.id} entry={entry}
                  focused={focusedId === entry.id}
                  checked={checkedIds.has(entry.id)}
                  anyChecked={anyChecked}
                  onFocus={() => handleFocus(entry.id)}
                  onCheck={() => handleCheck(entry.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* preview panel */}
      {focusedEntry && (
        <HistoryPreview
          entry={focusedEntry}
          onClose={() => setFocusedId(null)}
          onDelete={handleDelete}
          onOpenFolder={handleOpenFolder}
          onRedownload={onRedownload}
        />
      )}
    </div>
  );
}
