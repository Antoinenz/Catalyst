import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Link, X, Loader2, Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { FORMAT_TYPES, QUALITY_LEVELS, isAudioFormat } from "@/types";

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]\x00-\x1f\x7f]+/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  // deduplicate while preserving order
  return [...new Set(matches.map(u => u.replace(/[,;.]+$/, "")))];
}

interface Props { onClose: () => void; }

export function BulkImportModal({ onClose }: Props) {
  const [text, setText]         = useState("");
  const [urls, setUrls]         = useState<string[]>([]);
  const [formatType, setFmt]    = useState("mp4");
  const [quality, setQuality]   = useState("best");
  const [importing, setImporting] = useState(false);
  const [done, setDone]         = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const parseText = (t: string) => {
    setText(t);
    setUrls(extractUrls(t));
  };

  const handleFile = async () => {
    // Open a file dialog — user can copy-paste content from the selected file
    // (fs plugin not bundled; this just shows the path so they can paste manually)
    const file = await openDialog({ multiple: false, filters: [{ name: "Text files", extensions: ["txt","csv","html","m3u","m3u8"] }] });
    if (typeof file === "string") {
      // Show the file path as a hint; actual reading requires fs plugin
      textRef.current?.focus();
    }
  };

  const handleImport = async () => {
    if (!urls.length) return;
    setImporting(true);
    try {
      await invoke("add_downloads_bulk", {
        urls,
        formatType: formatType || null,
        quality: quality || null,
      });
      setDone(true);
      setTimeout(onClose, 800);
    } catch (e) { console.error(e); }
    finally { setImporting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-[520px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Import URLs</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* paste area */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500 uppercase tracking-wider">Paste URLs or any text containing URLs</label>
            <textarea
              ref={textRef}
              value={text}
              onChange={e => parseText(e.target.value)}
              placeholder={"Paste URLs, a playlist, a text file, or anything — one per line, comma separated, whatever.\nhttps://youtube.com/watch?v=...\nhttps://vimeo.com/..."}
              rows={6}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none font-mono"
            />
          </div>

          {/* file import button */}
          <button onClick={handleFile}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
            <FileText className="w-3.5 h-3.5" />
            Import from file (.txt, .csv, …)
          </button>

          {/* detected URLs preview */}
          {urls.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <Link className="w-3 h-3" />
                {urls.length} URL{urls.length !== 1 ? "s" : ""} detected
              </p>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-h-40 overflow-auto">
                {urls.map((u, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/50 last:border-0">
                    <span className="text-[10px] text-zinc-700 w-5 shrink-0 tabular-nums">{i + 1}</span>
                    <span className="text-xs text-zinc-400 truncate">{u}</span>
                    <button onClick={() => setUrls(p => p.filter((_, j) => j !== i))}
                      className="shrink-0 text-zinc-700 hover:text-zinc-400 transition-colors ml-auto">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* format selectors */}
          {urls.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500 uppercase tracking-wider">Format for all imports</label>
              <div className="flex gap-2">
                <div className="relative">
                  <select value={formatType} onChange={e => { setFmt(e.target.value); if (isAudioFormat(e.target.value)) setQuality("best"); }}
                    className="appearance-none bg-zinc-950 border border-zinc-700 rounded-md pl-3 pr-6 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 cursor-pointer">
                    {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>
                </div>
                <div className="relative">
                  <select value={quality} onChange={e => setQuality(e.target.value)} disabled={isAudioFormat(formatType)}
                    className="appearance-none bg-zinc-950 border border-zinc-700 rounded-md pl-3 pr-6 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-40 cursor-pointer">
                    {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-xs text-zinc-600">
            {urls.length === 0 ? "Paste or import URLs above" : `Ready to add ${urls.length} download${urls.length !== 1 ? "s" : ""}`}
          </span>
          <button
            onClick={handleImport}
            disabled={urls.length === 0 || importing || done}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              done ? "bg-green-600/20 text-green-400 border border-green-600/30"
                : "bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            {done      ? "Added!" :
             importing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Adding…</> :
                         <><Plus className="w-3.5 h-3.5" />Add {urls.length > 0 ? `${urls.length} ` : ""}to queue</>}
          </button>
        </div>
      </div>
    </div>
  );
}
