import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ExternalLink, Loader2, RefreshCw, CheckCircle2, AlertCircle,
  Bell, Rocket, Palette, LayoutGrid, Puzzle, Wifi, BarChart2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Config, DetectedBrowser, HistoryStats } from "@/types";
import { FORMAT_TYPES, QUALITY_LEVELS, isAudioFormat } from "@/types";

// ─── shared primitives ────────────────────────────────────────────────────────

function Sel({ value, onChange, disabled, children, className }: {
  value: string; onChange: (v: string) => void;
  disabled?: boolean; children: React.ReactNode; className?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className={cn("bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-40 cursor-pointer", className)}>
      {children}
    </select>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-zinc-400">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer">
      <div onClick={() => onChange(!value)}
        className={cn("w-9 h-5 rounded-full transition-colors relative shrink-0", value ? "bg-zinc-300" : "bg-zinc-700")}>
        <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", value ? "translate-x-4" : "translate-x-0.5")} />
      </div>
      <span className="text-sm text-zinc-300">{label}</span>
    </label>
  );
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type Tab = "downloads" | "application" | "advanced" | "remote" | "stats" | "about";

const TABS: { id: Tab; label: string; soon?: boolean }[] = [
  { id: "downloads",   label: "Downloads"      },
  { id: "application", label: "Application",   soon: true },
  { id: "advanced",    label: "Advanced"       },
  { id: "remote",      label: "Remote Access", soon: true },
  { id: "stats",       label: "Stats"          },
  { id: "about",       label: "About"          },
];

// ─── coming soon placeholder ──────────────────────────────────────────────────

function ComingSoon({ features }: { features: { icon: React.ElementType; label: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-500">
        Coming soon
      </div>
      <div className="grid grid-cols-2 gap-2">
        {features.map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-2.5 p-3 rounded-xl bg-zinc-900 border border-zinc-800 opacity-60">
            <Icon className="w-4 h-4 text-zinc-500 shrink-0" />
            <span className="text-sm text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── tab content: downloads ───────────────────────────────────────────────────

function DownloadsTab({ cfg, update, handleSave, saved, handleBrowse }: {
  cfg: Config; update: (p: Partial<Config>) => void;
  handleSave: () => void; saved: boolean; handleBrowse: () => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Output folder">
        <div className="flex gap-2">
          <input type="text" value={cfg.output_dir} onChange={e => update({ output_dir: e.target.value })}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
          <button onClick={handleBrowse} className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
            Browse
          </button>
        </div>
      </Field>

      <Field label="Default format" hint="MP4 (H264) plays everywhere. Best Quality may use AV1/VP9 which needs a modern player.">
        <div className="flex gap-2">
          <Sel value={cfg.default_format_type}
            onChange={v => { update({ default_format_type: v }); if (isAudioFormat(v)) update({ default_quality: "best" }); }}>
            {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Sel>
          <Sel value={cfg.default_quality} onChange={v => update({ default_quality: v })} disabled={isAudioFormat(cfg.default_format_type)}>
            {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
          </Sel>
        </div>
      </Field>

      <Field label={`Concurrent downloads — ${cfg.max_concurrent}`}>
        <input type="range" min={1} max={8} value={cfg.max_concurrent}
          onChange={e => update({ max_concurrent: Number(e.target.value) })}
          className="w-full accent-zinc-300" />
        <div className="flex justify-between text-xs text-zinc-700"><span>1 (sequential)</span><span>8 (maximum)</span></div>
      </Field>

      <SaveButton saved={saved} onSave={handleSave} />
    </div>
  );
}

// ─── tab content: advanced ────────────────────────────────────────────────────

function AdvancedTab({ cfg, update, handleSave, saved, handleCookieFile, browsers }: {
  cfg: Config; update: (p: Partial<Config>) => void;
  handleSave: () => void; saved: boolean; handleCookieFile: () => void;
  browsers: DetectedBrowser[];
}) {
  const cookieType = cfg.cookie_source.type;
  const selectedBrowser = cookieType === "Browser" ? (cfg.cookie_source as any).browser : "";
  const selectedProfile  = cookieType === "Browser" ? (cfg.cookie_source as any).profile  : "";
  const browserObj = browsers.find(b => b.id === selectedBrowser);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs text-zinc-400 font-medium">Cookies</p>
        <p className="text-xs text-zinc-600">Used for age-restricted, members-only, or geo-blocked content.</p>

        <div className="space-y-2 pt-1">
          {[
            { label: "Disabled",            value: "None"    },
            { label: "Use browser cookies", value: "Browser" },
            { label: "Import cookie file",  value: "File"    },
          ].map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
              <div onClick={() => {
                if (opt.value === "None")    update({ cookie_source: { type: "None" } });
                if (opt.value === "Browser") update({ cookie_source: { type: "Browser", browser: browsers[0]?.id ?? "", profile: browsers[0]?.profiles[0]?.id ?? "" } });
                if (opt.value === "File")    update({ cookie_source: { type: "File", path: "" } });
              }}
                className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                  cookieType === opt.value ? "border-zinc-300" : "border-zinc-600 group-hover:border-zinc-500"
                )}>
                {cookieType === opt.value && <div className="w-2 h-2 rounded-full bg-zinc-300" />}
              </div>
              <span className="text-sm text-zinc-300">{opt.label}</span>
            </label>
          ))}
        </div>

        {cookieType === "Browser" && (
          <div className="flex gap-2 pl-6 pt-1">
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
          <div className="flex gap-2 pl-6 pt-1">
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
      </div>

      <SaveButton saved={saved} onSave={handleSave} />
    </div>
  );
}

// ─── tab content: stats ───────────────────────────────────────────────────────

function StatsTab({ stats }: { stats: HistoryStats | null }) {
  if (!stats) return <p className="text-sm text-zinc-600">Loading…</p>;
  const cards = [
    { label: "Total downloads",  value: stats.total_downloads.toString() },
    { label: "Days active",      value: stats.unique_days.toString() },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-2xl font-semibold text-zinc-100 tabular-nums">{c.value}</p>
            <p className="text-xs text-zinc-600 mt-1">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── tab content: about ───────────────────────────────────────────────────────

function AboutTab({ ytVersion, appVersion, updating, updateResult, onUpdate, cfg, update, onSave, saved }: {
  ytVersion: string | null; appVersion: string;
  updating: boolean; updateResult: { ok: boolean; msg: string } | null;
  onUpdate: () => void; cfg: Config; update: (p: Partial<Config>) => void;
  onSave: () => void; saved: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* Catalyst */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Catalyst</p>
        <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-200">Version {appVersion}</p>
            <p className="text-xs text-zinc-600 mt-0.5">Open source · Built with Tauri + yt-dlp</p>
          </div>
          <a href="https://github.com/Antoinenz/Catalyst" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors">
            <ExternalLink className="w-3 h-3" />GitHub
          </a>
        </div>
      </div>

      {/* yt-dlp */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">yt-dlp</p>
        <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-200">Version {ytVersion ?? "…"}</p>
            <p className="text-xs text-zinc-600 mt-0.5">The download engine powering Catalyst</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onUpdate} disabled={updating}
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
          <div className={cn("flex items-start gap-2 p-3 rounded-xl text-xs border",
            updateResult.ok ? "bg-green-500/5 border-green-500/20 text-green-400" : "bg-red-500/5 border-red-500/20 text-red-400")}>
            {updateResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span className="break-words">{updateResult.msg}</span>
          </div>
        )}

        <Toggle value={cfg.auto_update_ytdlp} onChange={v => { update({ auto_update_ytdlp: v }); onSave(); }} label="Auto-update yt-dlp on startup" />
      </div>
    </div>
  );
}

// ─── save button ──────────────────────────────────────────────────────────────

function SaveButton({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <button onClick={onSave}
      className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-colors",
        saved ? "bg-green-600/20 text-green-400 border border-green-600/30" : "bg-zinc-100 text-zinc-900 hover:bg-white"
      )}>
      {saved ? "Saved" : "Save changes"}
    </button>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const [tab, setTab]             = useState<Tab>("downloads");
  const [cfg, setCfg]             = useState<Config | null>(null);
  const [saved, setSaved]         = useState(false);
  const [browsers, setBrowsers]   = useState<DetectedBrowser[]>([]);
  const [stats, setStats]         = useState<HistoryStats | null>(null);
  const [ytVersion, setYtVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
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
    if (typeof file === "string") update({ cookie_source: { type: "File", path: file } });
  };

  const handleYtUpdate = async () => {
    setUpdating(true);
    setUpdateResult(null);
    try {
      const msg = await invoke<string>("update_ytdlp");
      const ok  = !msg.toLowerCase().includes("error");
      setUpdateResult({ ok, msg: msg || "yt-dlp is already up to date." });
      invoke<string>("get_ytdlp_version").then(setYtVersion).catch(console.error);
    } catch (e) {
      setUpdateResult({ ok: false, msg: String(e) });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-end gap-1 px-6 pt-4 border-b border-zinc-800 shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "relative px-3 py-2 text-sm transition-colors shrink-0 whitespace-nowrap",
              tab === t.id
                ? "text-zinc-100 after:absolute after:bottom-0 after:inset-x-0 after:h-px after:bg-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            )}>
            {t.label}
            {t.soon && <span className="ml-1.5 text-[9px] text-zinc-600 bg-zinc-800 px-1 py-0.5 rounded-full">soon</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-lg">
          {tab === "downloads" && (
            <DownloadsTab cfg={cfg} update={update} handleSave={handleSave} saved={saved} handleBrowse={handleBrowse} />
          )}

          {tab === "application" && (
            <ComingSoon features={[
              { icon: Bell,        label: "Notifications"      },
              { icon: Rocket,      label: "Launch at startup"  },
              { icon: Palette,     label: "Themes"             },
              { icon: LayoutGrid,  label: "Layout"             },
              { icon: Puzzle,      label: "Browser extension"  },
            ]} />
          )}

          {tab === "advanced" && (
            <AdvancedTab cfg={cfg} update={update} handleSave={handleSave} saved={saved}
              handleCookieFile={handleCookieFile} browsers={browsers} />
          )}

          {tab === "remote" && (
            <ComingSoon features={[
              { icon: Wifi,        label: "Built-in HTTP server" },
              { icon: Info,        label: "Authentication"       },
              { icon: Palette,     label: "HTTPS support"        },
            ]} />
          )}

          {tab === "stats" && <StatsTab stats={stats} />}

          {tab === "about" && (
            <AboutTab
              ytVersion={ytVersion} appVersion={appVersion}
              updating={updating} updateResult={updateResult} onUpdate={handleYtUpdate}
              cfg={cfg} update={update} onSave={handleSave} saved={saved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
