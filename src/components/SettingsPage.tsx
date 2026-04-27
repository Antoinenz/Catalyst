import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ExternalLink, Loader2, RefreshCw, CheckCircle2, AlertCircle,
  Palette, LayoutGrid, Puzzle, Wifi, Info, Download, Search,
  Plus, Trash2, FolderOpen, Edit2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Config, DetectedBrowser, HistoryStats, DownloadCategory } from "@/types";
import { FORMAT_TYPES, QUALITY_LEVELS, isAudioFormat, CATEGORY_COLORS } from "@/types";

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

/** Clickable toggle — clicking the text label also works */
function Toggle({ value, onChange, label, hint }: {
  value: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-2.5 cursor-pointer select-none"
        onClick={() => onChange(!value)}>
        <div className={cn("w-9 h-5 rounded-full transition-colors relative shrink-0",
          value ? "bg-green-500" : "bg-zinc-700")}>
          <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
            value ? "translate-x-4" : "translate-x-0.5")} />
        </div>
        <span className="text-sm text-zinc-300">{label}</span>
      </label>
      {hint && <p className="text-xs text-zinc-600 pl-[52px]">{hint}</p>}
    </div>
  );
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type Tab = "downloads" | "application" | "advanced" | "remote" | "stats" | "about";

const TABS: { id: Tab; label: string; soon?: boolean }[] = [
  { id: "downloads",   label: "Downloads"      },
  { id: "application", label: "Application"    }, // soon tag removed
  { id: "advanced",    label: "Advanced"       },
  { id: "remote",      label: "Remote Access", soon: true },
  { id: "stats",       label: "Stats"          },
  { id: "about",       label: "About"          },
];

// ─── coming soon ─────────────────────────────────────────────────────────────

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

// ─── downloads tab ────────────────────────────────────────────────────────────

function DownloadsTab({ cfg, update, handleBrowse }: {
  cfg: Config; update: (p: Partial<Config>) => void; handleBrowse: () => void;
}) {
  return (
    <div className="space-y-5">
      <Field label="Output folder">
        <div className="flex gap-2">
          <input type="text" value={cfg.output_dir} onChange={e => update({ output_dir: e.target.value })}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
          <button onClick={handleBrowse}
            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors">
            Browse
          </button>
        </div>
      </Field>

      <Field label="Default format" hint="MP4 (H264) plays everywhere. Best Quality may use AV1/VP9.">
        <div className="flex gap-2">
          <Sel value={cfg.default_format_type}
            onChange={v => { update({ default_format_type: v }); if (isAudioFormat(v)) update({ default_quality: "best" }); }}>
            {FORMAT_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Sel>
          <Sel value={cfg.default_quality} onChange={v => update({ default_quality: v })}
            disabled={isAudioFormat(cfg.default_format_type)}>
            {QUALITY_LEVELS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
          </Sel>
        </div>
      </Field>

      <Field label={`Concurrent downloads — ${cfg.max_concurrent}`}>
        <input type="range" min={1} max={8} value={cfg.max_concurrent}
          onChange={e => update({ max_concurrent: Number(e.target.value) })}
          className="w-full accent-green-500" />
        <div className="flex justify-between text-xs text-zinc-700"><span>1 (sequential)</span><span>8 (maximum)</span></div>
      </Field>

      {/* Cache folder */}
      <div className="border-t border-zinc-800 pt-5 space-y-3">
        <Toggle
          value={cfg.use_cache_folder}
          onChange={v => update({ use_cache_folder: v })}
          label="Download to cache folder first"
          hint="Temp files go to a cache directory and are moved to the output folder only when complete. Keeps your library clean while downloading."
        />
        {cfg.use_cache_folder && (
          <Field label="Cache directory">
            <div className="flex gap-2">
              <input type="text" value={cfg.cache_dir}
                onChange={e => update({ cache_dir: e.target.value })}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 font-mono focus:outline-none focus:ring-1 focus:ring-zinc-500" />
            </div>
          </Field>
        )}
      </div>

      {/* Output categories */}
      <div className="border-t border-zinc-800 pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-400 font-medium">Output categories</p>
          <button
            onClick={() => {
              const id = crypto.randomUUID();
              const cats = cfg.categories ?? [];
              update({ categories: [...cats, { id, name: "New category", output_dir: cfg.output_dir, color: CATEGORY_COLORS[cats.length % CATEGORY_COLORS.length] }] });
            }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            <Plus className="w-3 h-3" />Add
          </button>
        </div>
        <p className="text-xs text-zinc-600">Create named destinations with custom output directories. Shown as a dropdown when adding downloads.</p>
        <CategoryList categories={cfg.categories ?? []} update={update} />
      </div>
    </div>
  );
}

// ─── category list ────────────────────────────────────────────────────────────

function CategoryList({ categories, update }: {
  categories: DownloadCategory[]; update: (p: Partial<Config>) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);

  const updateCat = (id: string, patch: Partial<DownloadCategory>) => {
    update({ categories: categories.map(c => c.id === id ? { ...c, ...patch } : c) });
  };
  const deleteCat = (id: string) => {
    update({ categories: categories.filter(c => c.id !== id) });
    if (editing === id) setEditing(null);
  };

  const browseForCat = async (id: string) => {
    setBrowsing(true);
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof dir === "string") updateCat(id, { output_dir: dir });
    setBrowsing(false);
  };

  if (categories.length === 0) {
    return <p className="text-xs text-zinc-700 italic">No categories yet. Add one above.</p>;
  }

  return (
    <div className="space-y-2">
      {categories.map(cat => (
        <div key={cat.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2.5">
            {/* color dot */}
            <div className="w-3 h-3 rounded-full shrink-0 ring-2 ring-zinc-800" style={{ backgroundColor: cat.color }} />
            <span className="flex-1 text-sm text-zinc-200 font-medium">{cat.name}</span>
            <span className="text-xs text-zinc-600 truncate max-w-[120px]">{cat.output_dir.split(/[\\/]/).pop()}</span>
            <button onClick={() => setEditing(editing === cat.id ? null : cat.id)}
              className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded">
              <Edit2 className="w-3 h-3" />
            </button>
            <button onClick={() => deleteCat(cat.id)}
              className="p-1 text-zinc-600 hover:text-red-400 transition-colors rounded">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          {editing === cat.id && (
            <div className="px-3 pb-3 space-y-2 border-t border-zinc-800">
              <div className="flex gap-2 pt-2">
                <input type="text" value={cat.name} onChange={e => updateCat(cat.id, { name: e.target.value })}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500" />
              </div>
              <div className="flex gap-2">
                <input type="text" value={cat.output_dir} onChange={e => updateCat(cat.id, { output_dir: e.target.value })}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-sm text-zinc-200 font-mono focus:outline-none focus:ring-1 focus:ring-zinc-500" />
                <button onClick={() => browseForCat(cat.id)} disabled={browsing}
                  className="px-2.5 py-1.5 bg-zinc-700 border border-zinc-600 rounded-md text-xs text-zinc-300 hover:bg-zinc-600 transition-colors">
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORY_COLORS.map(color => (
                  <button key={color} onClick={() => updateCat(cat.id, { color })}
                    className={cn("w-5 h-5 rounded-full transition-transform hover:scale-110", cat.color === color && "ring-2 ring-white ring-offset-1 ring-offset-zinc-900")}
                    style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── application tab ──────────────────────────────────────────────────────────

function ApplicationTab({ cfg, update, autostart, setAutostart }: {
  cfg: Config; update: (p: Partial<Config>) => void;
  autostart: boolean; setAutostart: (v: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">System</p>
        <Toggle value={autostart} onChange={setAutostart} label="Launch at startup" />
        <Toggle
          value={cfg.minimize_to_tray}
          onChange={v => update({ minimize_to_tray: v })}
          label="Minimize to system tray on close"
          hint="When off, closing the window exits Catalyst"
        />
        <Toggle value={cfg.notifications_enabled} onChange={v => update({ notifications_enabled: v })}
          label="Download notifications"
          hint="Only shown when the window is not in focus" />
      </div>

      <div className="border-t border-zinc-800 pt-5 space-y-3">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Coming soon</p>
        <ComingSoon features={[
          { icon: Palette,    label: "Themes"            },
          { icon: LayoutGrid, label: "Layout density"    },
          { icon: Puzzle,     label: "Browser extension" },
        ]} />
      </div>
    </div>
  );
}

// ─── advanced tab ─────────────────────────────────────────────────────────────

function AdvancedTab({ cfg, update, handleCookieFile, browsers }: {
  cfg: Config; update: (p: Partial<Config>) => void;
  handleCookieFile: () => void;
  browsers: DetectedBrowser[];
}) {
  const cookieType = cfg.cookie_source.type;
  const selectedBrowser = cookieType === "Browser" ? (cfg.cookie_source as any).browser : "";
  const selectedProfile  = cookieType === "Browser" ? (cfg.cookie_source as any).profile  : "";
  const browserObj = browsers.find(b => b.id === selectedBrowser);

  return (
    <div className="space-y-6">
      {/* Cookies */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-400 font-medium">Cookies</p>
        <p className="text-xs text-zinc-600">For age-restricted, members-only, or geo-blocked content.</p>
        <div className="space-y-2">
          {[
            { label: "Disabled",            value: "None"    },
            { label: "Use browser cookies", value: "Browser" },
            { label: "Import cookie file",  value: "File"    },
          ].map(opt => (
            <label key={opt.value}
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => {
                if (opt.value === "None")    update({ cookie_source: { type: "None" } });
                if (opt.value === "Browser") update({ cookie_source: { type: "Browser", browser: browsers[0]?.id ?? "", profile: browsers[0]?.profiles[0]?.id ?? "" } });
                if (opt.value === "File")    update({ cookie_source: { type: "File", path: "" } });
              }}>
              <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                cookieType === opt.value ? "border-green-500" : "border-zinc-600")}>
                {cookieType === opt.value && <div className="w-2 h-2 rounded-full bg-green-500" />}
              </div>
              <span className="text-sm text-zinc-300">{opt.label}</span>
            </label>
          ))}
        </div>

        {cookieType === "Browser" && (
          <div className="flex gap-2 pl-6">
            <Sel value={selectedBrowser}
              onChange={v => { const b = browsers.find(x => x.id === v); update({ cookie_source: { type: "Browser", browser: v, profile: b?.profiles[0]?.id ?? "" } }); }}>
              {browsers.length === 0
                ? <option value="">No browsers detected</option>
                : browsers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
      </div>

      {/* Proxy */}
      <div className="space-y-3 border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-400 font-medium">Proxy</p>
        <Field label="Proxy URL" hint="HTTP(S) or SOCKS5, e.g. http://127.0.0.1:8080 or socks5://127.0.0.1:1080. Leave empty to disable.">
          <input type="text" value={cfg.proxy} onChange={e => update({ proxy: e.target.value })}
            placeholder="http://127.0.0.1:8080"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-500 placeholder:text-zinc-700 font-mono" />
        </Field>
      </div>
    </div>
  );
}

// ─── stats tab ────────────────────────────────────────────────────────────────

function StatsTab({ stats }: { stats: HistoryStats | null }) {
  if (!stats) return <p className="text-sm text-zinc-600">Loading…</p>;
  function formatBytes(b: number) {
    if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GiB`;
    if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MiB`;
    if (b >= 1_024)         return `${(b / 1_024).toFixed(1)} KiB`;
    return `${b} B`;
  }
  const cards = [
    { label: "Total downloads",  value: stats.total_downloads.toLocaleString() },
    { label: "Total downloaded", value: stats.total_size_bytes > 0 ? formatBytes(stats.total_size_bytes) : "—" },
    { label: "Today",            value: stats.downloads_today.toLocaleString() },
    { label: "This week",        value: stats.downloads_week.toLocaleString() },
    { label: "Active days",      value: stats.unique_days.toLocaleString() },
    { label: "Avg / active day", value: stats.avg_per_day > 0 ? stats.avg_per_day.toFixed(1) : "—" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xl font-semibold text-zinc-100 tabular-nums">{c.value}</p>
            <p className="text-xs text-zinc-600 mt-1">{c.label}</p>
          </div>
        ))}
      </div>
      {stats.most_used_format && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-3">
          <Download className="w-4 h-4 text-zinc-500" />
          <div>
            <p className="text-sm font-medium text-zinc-200">{stats.most_used_format.toUpperCase()}</p>
            <p className="text-xs text-zinc-600">Most used format</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── about tab ────────────────────────────────────────────────────────────────

function AboutTab({ ytVersion, appVersion, updating, updateResult, onYtUpdate,
  cfg, update, updateAvailable, onCheckUpdate, checking }: {
  ytVersion: string | null; appVersion: string;
  updating: boolean; updateResult: { ok: boolean; msg: string } | null; onYtUpdate: () => void;
  cfg: Config; update: (p: Partial<Config>) => void;
  updateAvailable: string | null; onCheckUpdate: () => void; checking: boolean;
}) {
  const openUrl = (url: string) => invoke("open_url", { url }).catch(console.error);

  return (
    <div className="space-y-6">
      {/* Catalyst */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Catalyst</p>

        {updateAvailable && (
          <div className="flex items-start gap-3 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-300">Update available — v{updateAvailable}</p>
              <p className="text-xs text-amber-400/70 mt-0.5">Download the latest release from GitHub.</p>
              <button onClick={() => openUrl("https://github.com/Antoinenz/Catalyst/releases/latest")}
                className="mt-2 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors">
                <ExternalLink className="w-3 h-3" />View release
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-200">Version {appVersion}</p>
            <p className="text-xs text-zinc-600 mt-0.5">Open source · Built with Tauri + yt-dlp</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCheckUpdate} disabled={checking}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors disabled:opacity-50">
              {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Check
            </button>
            <button onClick={() => openUrl("https://github.com/Antoinenz/Catalyst")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors">
              <ExternalLink className="w-3 h-3" />GitHub
            </button>
          </div>
        </div>

        <Toggle value={cfg.auto_check_updates} onChange={v => update({ auto_check_updates: v })}
          label="Check for updates on startup" />
      </div>

      {/* yt-dlp */}
      <div className="space-y-3 border-t border-zinc-800 pt-5">
        <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">yt-dlp</p>
        <div className="flex items-center justify-between p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
          <div>
            <p className="text-sm font-medium text-zinc-200">Version {ytVersion ?? "…"}</p>
            <p className="text-xs text-zinc-600 mt-0.5">The download engine powering Catalyst</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onYtUpdate} disabled={updating}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors disabled:opacity-50">
              {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Update
            </button>
            <button onClick={() => openUrl("https://github.com/yt-dlp/yt-dlp")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-400 transition-colors">
              <ExternalLink className="w-3 h-3" />GitHub
            </button>
          </div>
        </div>

        {updateResult && (
          <div className={cn("flex items-start gap-2 p-3 rounded-xl text-xs border",
            updateResult.ok ? "bg-green-500/5 border-green-500/20 text-green-400" : "bg-red-500/5 border-red-500/20 text-red-400")}>
            {updateResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span className="break-words">{updateResult.msg}</span>
          </div>
        )}

        <Toggle value={cfg.auto_update_ytdlp} onChange={v => update({ auto_update_ytdlp: v })}
          label="Auto-update yt-dlp on startup" />
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface SettingsPageProps { updateAvailable?: string | null; }

export function SettingsPage({ updateAvailable }: SettingsPageProps) {
  const [tab, setTab]               = useState<Tab>("downloads");
  const [cfg, setCfg]               = useState<Config | null>(null);
  const [browsers, setBrowsers]     = useState<DetectedBrowser[]>([]);
  const [stats, setStats]           = useState<HistoryStats | null>(null);
  const [ytVersion, setYtVersion]   = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [updating, setUpdating]     = useState(false);
  const [updateResult, setUpdateResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [autostart, setAutostartState]  = useState(false);
  const [checking, setChecking]     = useState(false);

  useEffect(() => {
    invoke<Config>("get_config").then(setCfg).catch(console.error);
    invoke<DetectedBrowser[]>("detect_browsers").then(setBrowsers).catch(console.error);
    invoke<HistoryStats>("get_history_stats").then(setStats).catch(console.error);
    invoke<string>("get_ytdlp_version").then(setYtVersion).catch(() => setYtVersion("unknown"));
    invoke<string>("get_app_version").then(setAppVersion).catch(console.error);
    invoke<boolean>("get_autostart").then(setAutostartState).catch(console.error);
  }, []);

  if (!cfg) return null;

  const update = (patch: Partial<Config>) => {
    setCfg(c => {
      if (!c) return c;
      const next = { ...c, ...patch };
      invoke("save_config", { newConfig: next }).catch(console.error);
      return next;
    });
  };

  const handleBrowse = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") update({ output_dir: dir });
  };

  const handleCookieFile = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: "Cookie files", extensions: ["txt"] }] });
    if (typeof file === "string") update({ cookie_source: { type: "File", path: file } });
  };

  const handleSetAutostart = async (v: boolean) => {
    await invoke("set_autostart", { enabled: v }).catch(console.error);
    setAutostartState(v);
  };

  const handleYtUpdate = async () => {
    setUpdating(true); setUpdateResult(null);
    try {
      const msg = await invoke<string>("update_ytdlp");
      const ok = !msg.toLowerCase().includes("error");
      setUpdateResult({ ok, msg: msg || "yt-dlp is already up to date." });
      invoke<string>("get_ytdlp_version").then(setYtVersion).catch(console.error);
    } catch (e) { setUpdateResult({ ok: false, msg: String(e) }); }
    finally { setUpdating(false); }
  };

  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const v = await invoke<string | null>("check_for_catalyst_update", { force: true });
      if (!v) setUpdateResult({ ok: true, msg: "You're on the latest version." });
    } catch (e) { console.error(e); }
    finally { setChecking(false); }
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
            {t.id === "about" && updateAvailable && (
              <span className="absolute top-1.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-lg">
          {tab === "downloads" && (
            <DownloadsTab cfg={cfg} update={update} handleBrowse={handleBrowse} />
          )}
          {tab === "application" && (
            <ApplicationTab cfg={cfg} update={update} autostart={autostart} setAutostart={handleSetAutostart} />
          )}
          {tab === "advanced" && (
            <AdvancedTab cfg={cfg} update={update} handleCookieFile={handleCookieFile} browsers={browsers} />
          )}
          {tab === "remote" && (
            <ComingSoon features={[
              { icon: Wifi,    label: "Built-in HTTP server" },
              { icon: Info,    label: "Authentication"       },
              { icon: Palette, label: "HTTPS support"        },
            ]} />
          )}
          {tab === "stats" && <StatsTab stats={stats} />}
          {tab === "about" && (
            <AboutTab
              ytVersion={ytVersion} appVersion={appVersion}
              updating={updating} updateResult={updateResult} onYtUpdate={handleYtUpdate}
              cfg={cfg} update={update}
              updateAvailable={updateAvailable ?? null}
              onCheckUpdate={handleCheckUpdate} checking={checking}
            />
          )}
        </div>
      </div>
    </div>
  );
}
