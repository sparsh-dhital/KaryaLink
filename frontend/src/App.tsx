import clsx from "clsx";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { DemoProvider } from "./components/DemoRunner";
import { CommandPalette, HelpModal, MobileNav, Sidebar, Topbar, useSignals, useTheme } from "./components/Shell";
import { ErrorBanner, ToastProvider } from "./components/ui";
import Audit from "./pages/Audit";
import Dashboard from "./pages/Dashboard";
import Evaluation from "./pages/Evaluation";
import Planner from "./pages/Planner";
import Schedule from "./pages/Schedule";
import Settings from "./pages/Settings";
import Supervisor from "./pages/Supervisor";
import Updates from "./pages/Updates";
import type { Meta } from "./types";

function Shell({ meta, metaError, reloadMeta }: { meta: Meta | null; metaError: unknown; reloadMeta: () => void }) {
  const [dark, setDark] = useTheme();
  const signals = useSignals();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  const fullHeight = loc.pathname.startsWith("/supervisor");
  const toggle = useCallback(() => setDark((d) => !d), [setDark]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="min-h-dvh">
      <Sidebar meta={meta} signals={signals} />
      <div className="flex min-h-dvh flex-col lg:pl-[256px]">
        <Topbar signals={signals} dark={dark} toggleDark={toggle} onSearch={() => setPalette(true)} onHelp={() => setHelp(true)} onMenu={() => setDrawer(true)} />
        {metaError ? <div className="mx-auto w-full max-w-3xl px-4 pt-4"><ErrorBanner error={metaError} onRetry={reloadMeta} /></div> : null}
        <main key={loc.pathname} className={clsx("flex-1 animate-fadein", !fullHeight && "pb-20 lg:pb-0")}>
          <Routes>
            <Route path="/" element={<Dashboard meta={meta} />} />
            <Route path="/updates" element={<Updates meta={meta} />} />
            <Route path="/schedule" element={<Schedule meta={meta} />} />
            <Route path="/supervisor" element={<Supervisor />} />
            <Route path="/planner" element={<Planner meta={meta} />} />
            <Route path="/evaluation" element={<Evaluation meta={meta} onMetaChange={reloadMeta} />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/settings" element={<Settings meta={meta} onMetaChange={reloadMeta} dark={dark} toggleDark={toggle} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <MobileNav signals={signals} drawer={drawer} setDrawer={setDrawer} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} toggleDark={toggle} />
      <HelpModal open={help} onClose={() => setHelp(false)} />
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
