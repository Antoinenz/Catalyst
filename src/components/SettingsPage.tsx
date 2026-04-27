import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ExternalLink, Loader2, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Config, DetectedBrowser, HistoryStats } from "@/types";
import { FORMAT_TYPES, QUALITY_LEVELS, isAudioFormat } from "@/types";

// ─── small select ─────────────────────────────────────────────────────────────

function Sel({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void; disabled?: boolean;
  children: React.ReactNode; className?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className={cn("bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-40 cursor-pointer", className)}>
      {children}
    </select>
  );
}

// ─── section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const [cfg, setCfg]             = useState<Config | null>(null);
  const [saved, setSaved]         = useState(false);
  const [browsers, setBrowsers]   = useState<DetectedBrowser[]>([]);
  const [stats, setStats]         = useState<HistoryStats | null>(null);
  const [ytVersion, setYtVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [updating, setUpdating]   = useState(false);
  const [updateResult, setUpdateResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    invoke<Config>("get_config").then(setCfg).catch(console.error);
    invoke<DetectedBrowser[]>("detect_browsers").then(setBrowsers).catch(console.error);
    invoke<HistoryStats>("get_history_stats").then(setStats).catch(console.error);
    invoke<string>("get_ytdlp_version").then(setYtVersion).catch(() => setYtVersion("unknown"));
    invoke<string>("get_app_version").then(setAppVersion).catch(console.error);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<Config>) => setCfg(c => c ? { ...c, ...patch } : c);

  const handleSave = async () => {
    await invoke("save_config", { newConfig: cfg }).catch(console.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleBrowse = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") update({ output_dir: dir });
  };

  const handleCookieFile = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: "Cookie files", extensions: ["txt"] }] });
    if (typeof file === "string") {
      update({ cookie_source: { type: "File", path: file } });
    }
  };

  const handleYtUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const msg = await invoke<string>("update_ytdlp");
      const ok  = msg.toLowerCase().includes("updated") || msg.toLowerCase().includes("up to date") || msg === "";
      setUpdateResult({ ok, msg: msg || "yt-dlp is up to date." });
      invoke<string>("get_ytdlp_version").then(setYtVersion).catch(console.error);
    } catch (e) {
      setUpdateResult({ ok: false, msg: String(e) });
    } finally {
      setUpdating(false);
    }
  };

  const cookieType = cfg.cookie_source.type;
  const selectedBrowser = cookieType === "Browser" ? (cfg.cookie_source as any).browser : "";
  const selectedProfile = cookieType === "Browser" ? (cfg.cookie_source as any).profile : "";
  const browserObj = browsers.find(b => b.id === selectedBrowser);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-lg space-y-8">

        {/* Downloads */}
        <Section title="Downloads">
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Output folder</label>
            <div className="flex gap-2">
              <input type="text" value={cfg.output_dir} onChange={e => update({ output_dir: e.target.value })}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
              <button onClick={handleBrowse} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                Browse
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Default format</label>
            <div className="flex gap-2">
              <Sel value={cfg.default_format_type} onChange={v => { update({ default_format_type: v }); if (isAudioFormat(v)) update({ default_quality: "best" }); }}>
                {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Sel>
              <Sel value={cfg.default_quality} onChange={v => update({ default_quality: v })} disabled={isAudioFormat(cfg.default_format_type)}>
                {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
              </Sel>
            </div>
            <p className="text-xs text-zinc-600">MP4 (H264) plays everywhere. Best Quality may use AV1/VP9.</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Concurrent downloads — {cfg.max_concurrent}</label>
            <input type="range" min={1} max={8} value={cfg.max_concurrent}
              onChange={e => update({ max_concurrent: Number(e.target.value) })}
              className="w-full accent-zinc-300" />
            <div className="flex justify-between text-xs text-zinc-700"><span>1 (sequential)</span><span>8 (maximum)</span></div>
          </div>
        </Section>

        {/* Cookies */}
        <Section title="Cookies">
          <p className="text-xs text-zinc-600">Used for age-restricted or members-only content.</p>
          <div className="space-y-2">
            {[
              { label: "Disabled",              value: "None"    },
              { label: "Use browser cookies",   value: "Browser" },
              { label: "Import cookie file",    value: "File"    },
            ].map(opt => (
              <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                <div className={cn(
                  "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                  cookieType === opt.value ? "border-zinc-300" : "border-zinc-600 group-hover:border-zinc-500"
                )}>
                  {cookieType === opt.value && <div className="w-2 h-2 rounded-full bg-zinc-300" />}
                </div>
                <span className="text-sm text-zinc-300" onClick={() => {
                  if (opt.value === "None")    update({ cookie_source: { type: "None" } });
                  if (opt.value === "Browser") update({ cookie_source: { type: "Browser", browser: browsers[0]?.id ?? "", profile: browsers[0]?.profiles[0]?.id ?? "" } });
                  if (opt.value === "File")    update({ cookie_source: { type: "File", path: "" } });
                }}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>

          {cookieType === "Browser" && (
            <div className="flex gap-2 pl-6">
              <Sel value={selectedBrowser}
                onChange={v => { const b = browsers.find(x => x.id === v); update({ cookie_source: { type: "Browser", browser: v, profile: b?.profiles[0]?.id ?? "" } }); }}>
                {browsers.length === 0
                  ? <option value="">No browsers detected</option>
                  : browsers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                }
              </Sel>
              {browserObj && (
                <Sel value={selectedProfile}
                  onChange={v => update({ cookie_source: { type: "Browser", browser: selectedBrowser, profile: v } })}>
                  {browserObj.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Sel>
              )}
            </div>
          )}

          {cookieType === "File" && (
            <div className="flex gap-2 pl-6">
              <input type="text" value={(cfg.cookie_source as any).path}
                onChange={e => update({ cookie_source: { type: "File", path: e.target.value } })}
                placeholder="Path to cookies.txt (Netscape format)"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
              <button onClick={handleCookieFile}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
                Browse
              </button>
            </div>
          )}
        </Section>

        {/* yt-dlp */}
        <Section title="yt-dlp">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Version</p>
              <p className="text-xs text-zinc-600 mt-0.5">{ytVersion ?? "…"}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleYtUpdate} disabled={updating}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors disabled:opacity-50">
                {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Update
              </button>
              <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors">
                <ExternalLink className="w-3 h-3" />GitHub
              </a>
            </div>
          </div>

          {updateResult && (
            <div className={cn("flex items-start gap-2 p-3 rounded-lg text-xs", updateResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
              {updateResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span className="break-words">{updateResult.msg}</span>
            </div>
          )}

          <label className="flex items-center gap-2.5 cursor-pointer">
            <div onClick={() => update({ auto_update_ytdlp: !cfg.auto_update_ytdlp })}
              className={cn("w-9 h-5 rounded-full transition-colors relative", cfg.auto_update_ytdlp ? "bg-zinc-300" : "bg-zinc-700")}>
              <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", cfg.auto_update_ytdlp ? "translate-x-4" : "translate-x-0.5")} />
            </div>
            <span className="text-sm text-zinc-300">Auto-update on startup</span>
          </label>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Catalyst</p>
              <p className="text-xs text-zinc-600 mt-0.5">v{appVersion}</p>
            </div>
            <a href="https://github.com/Antoinenz/Catalyst" target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors">
              <ExternalLink className="w-3 h-3" />GitHub
            </a>
          </div>
        </Section>

        {/* Stats */}
        {stats && (
          <Section title="Stats">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total downloads", value: stats.total_downloads.toString() },
                { label: "Days active",     value: stats.unique_days.toString() },
              ].map(s => (
                <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                  <p className="text-lg font-semibold text-zinc-100">{s.value}</p>
                  <p className="text-xs text-zinc-600 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* save */}
        <button onClick={handleSave}
          className={cn("px-4 py-2 rounded-md text-sm font-medium transition-colors",
            saved ? "bg-green-600/20 text-green-400 border border-green-600/30" : "bg-zinc-100 text-zinc-900 hover:bg-white"
          )}>
          {saved ? "Saved" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
