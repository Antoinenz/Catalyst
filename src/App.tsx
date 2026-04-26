import { useState } from "react";
import { Download, History, Settings, Plus, Link } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = "queue" | "history" | "settings";

const NAV = [
  { id: "queue" as NavItem, icon: Download, label: "Queue" },
  { id: "history" as NavItem, icon: History, label: "History" },
  { id: "settings" as NavItem, icon: Settings, label: "Settings" },
];

export default function App() {
  const [nav, setNav] = useState<NavItem>("queue");
  const [url, setUrl] = useState("");

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

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="px-6 h-14 flex items-center justify-between border-b border-zinc-800 shrink-0">
          <h1 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">
            {NAV.find((n) => n.id === nav)?.label}
          </h1>
        </header>

        {nav === "queue" && (
          <>
            {/* URL input bar */}
            <div className="px-6 py-3 border-b border-zinc-800 shrink-0">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && url && setUrl("")}
                    placeholder="Paste a URL — YouTube, Vimeo, Twitter, 1800+ sites supported"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-500 placeholder:text-zinc-600"
                  />
                </div>
                <button
                  disabled={!url}
                  className="flex items-center gap-1.5 bg-zinc-100 text-zinc-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Queue list (empty state) */}
            <main className="flex-1 overflow-auto">
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-600">
                <Download className="w-8 h-8 mb-1 opacity-30" />
                <p className="text-sm font-medium">Nothing in the queue</p>
                <p className="text-xs">Paste a URL above to get started</p>
              </div>
            </main>
          </>
        )}

        {nav === "history" && (
          <main className="flex-1 overflow-auto flex flex-col items-center justify-center gap-2 text-zinc-600">
            <History className="w-8 h-8 mb-1 opacity-30" />
            <p className="text-sm font-medium">No downloads yet</p>
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
