import clsx from "clsx";
import { BarChart3, ClipboardCheck, Clapperboard, FlaskConical, LayoutDashboard, Moon, ScrollText, Smartphone, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { DemoProvider, useDemo } from "./components/DemoRunner";
import { ErrorBanner, ToastProvider } from "./components/ui";
import Audit from "./pages/Audit";
import Dashboard from "./pages/Dashboard";
import Evaluation from "./pages/Evaluation";
import Planner from "./pages/Planner";
import Supervisor from "./pages/Supervisor";
import type { Meta } from "./types";

const NAV = [
  { to: "/supervisor", label: "Supervisor", icon: Smartphone },
  { to: "/planner", label: "Planner", icon: ClipboardCheck },
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/evaluation", label: "Evaluation", icon: BarChart3 },
  { to: "/audit", label: "Audit", icon: ScrollText },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("sitesync-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
  }, [dark]);
  return [dark, setDark] as const;
}

function Shell({ meta, metaError, reloadMeta }: { meta: Meta | null; metaError: unknown; reloadMeta: () => void }) {
  const [dark, setDark] = useTheme();
  const demo = useDemo();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-white/90 backdrop-blur dark:border-ink-800 dark:bg-ink-900/90">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 lg:h-16 lg:px-5">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline">SiteSync</span>
          </NavLink>
          <nav className="scrollbar-thin -mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => clsx(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition",
                isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200" : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800")}>
                <Icon className="h-4 w-4" /><span className="hidden md:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5">
            {meta && (
              <span className="hidden items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300 lg:flex"
                title={meta.llm_enabled ? `LLM-assisted extraction via ${meta.llm_model} (evidence-checked)` : "Fully offline rule + lexicon extraction (no API key)"}>
                <FlaskConical className="h-3 w-3" /> model {meta.model_version} · {meta.llm_enabled ? "LLM assist on" : "offline"}
              </span>
            )}
            <button className="btn-primary btn-sm" onClick={demo.open} disabled={demo.running} title="Run the scripted 3-minute demo">
              <Clapperboard className="h-4 w-4" /><span className="hidden sm:inline">Demo Day</span>
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setDark((d) => !d)} aria-label="Toggle dark mode">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>
      {metaError ? <div className="mx-auto max-w-3xl p-4"><ErrorBanner error={metaError} onRetry={reloadMeta} /></div> : null}
      <main>
        <Routes>
          <Route path="/" element={<Dashboard meta={meta} />} />
          <Route path="/supervisor" element={<Supervisor />} />
          <Route path="/planner" element={<Planner meta={meta} />} />
          <Route path="/evaluation" element={<Evaluation meta={meta} onMetaChange={reloadMeta} />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<unknown>(null);
  const reloadMeta = useCallback(() => {
    api.meta().then((m) => { setMeta(m); setMetaError(null); }).catch(setMetaError);
  }, []);
  useEffect(() => { reloadMeta(); }, [reloadMeta]);
  return (
    <ToastProvider>
      <DemoProvider onMetaChange={reloadMeta}>
        <Shell meta={meta} metaError={metaError} reloadMeta={reloadMeta} />
      </DemoProvider>
    </ToastProvider>
  );
}
