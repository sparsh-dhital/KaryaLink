import { Clapperboard, Cpu, Database, Download, FileUp, Loader2, Moon, RefreshCcw, SlidersHorizontal, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { useDemo } from "../components/DemoRunner";
import { Alert, Card, ErrorBanner, Modal, PageHeader, useToast } from "../components/ui";
import { dataBus } from "../lib/demo";
import { DISC, PHASE, fmtDate } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { Meta, Thresholds } from "../types";

export default function Settings({ meta, onMetaChange, dark, toggleDark }: { meta: Meta | null; onMetaChange: () => void; dark: boolean; toggleDark: () => void }) {
  const demo = useDemo();
  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Governance" title="Settings" description="Decision policy, schedule data, appearance and the demo environment. Changes to thresholds are logged in the audit trail and re-measured on the benchmark." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {meta ? <ThresholdEditor t={meta.thresholds} onSaved={onMetaChange} /> : <Card><div className="skeleton h-40" /></Card>}
          <DataCard onChanged={() => { onMetaChange(); dataBus.emit(); }} />
          {meta && (
            <Card title={<Title icon={<Cpu className="h-4 w-4" />}>Rules of credit</Title>} subtitle="How granular events become % complete: step weights within each L5 work item">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(meta.rules_of_credit).map(([d, r]) => (
                  <div key={d} className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <div className="text-[13px] font-semibold">{DISC[d] ?? d}</div>
                    <div className="text-2xs muted">{r.basis}</div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {Object.entries(r.steps).map(([s, w]) => (
                        <li key={s} className="flex items-center gap-2"><span className="flex-1">{PHASE[s] ?? s}</span><span className="font-semibold num">{w}%</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card title={<Title icon={dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}>Appearance</Title>}>
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-[13px] font-medium">{dark ? "Dark" : "Light"} theme</div><div className="text-2xs muted">Dark is the default for control-room use</div></div>
              <button className="btn-secondary btn-sm" onClick={toggleDark}>{dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />} Switch to {dark ? "light" : "dark"}</button>
            </div>
          </Card>
          <Card title={<Title icon={<Cpu className="h-4 w-4" />}>Engine</Title>}>
            <dl className="space-y-2.5 text-[13px]">
              <Row k="Active model" v={meta?.model_version ?? "…"} />
              <Row k="Extraction" v={meta?.llm_enabled ? `Rules + LLM (${meta.llm_model}), evidence-checked` : "Offline rules + lexicon (no API key set)"} />
              <Row k="Project clock (data date)" v={meta ? fmtDate(meta.data_date) : "…"} />
              <Row k="Delay flags" v={meta ? `due ≤${meta.delay_rules.due_window_days} d · amber ≥${meta.delay_rules.amber_days} d · red ≥${meta.delay_rules.red_days} d` : "…"} />
            </dl>
          </Card>
          <DemoCard onReset={onMetaChange} running={demo.running} openDemo={demo.open} />
        </div>
      </div>
    </div>
  );
}

function Title({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="inline-flex items-center gap-2"><span className="subtle">{icon}</span>{children}</span>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-2xs muted">{k}</dt><dd className="mt-0.5 font-medium">{v}</dd></div>;
}

export function ThresholdEditor({ t, onSaved }: { t: Thresholds; onSaved: () => void }) {
  const [v, setV] = useState(t);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => setV(t), [t]);
  const dirty = JSON.stringify(v) !== JSON.stringify(t);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.setThresholds(v);
      toast("ok", "Thresholds saved and logged; metrics re-measured for the active model");
      onSaved();
      dataBus.emit();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const row = (k: keyof Thresholds, label: string, help: string, min: number, max: number) => (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3"><span className="text-[13px] font-medium">{label}</span><span className="text-sm font-semibold num text-brand-600 dark:text-brand-400">{v[k].toFixed(2)}</span></div>
      <div className="text-2xs muted">{help}</div>
      <input type="range" min={min} max={max} step={0.01} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="mt-2 w-full accent-brand-600" />
    </label>
  );
  return (
    <Card title={<Title icon={<SlidersHorizontal className="h-4 w-4" />}>Decision policy</Title>} subtitle="Ask, don't guess: calibrated confidence decides what happens to each update"
      actions={<button className="btn-primary btn-sm" disabled={busy || !dirty} onClick={save}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save & re-measure</button>}>
      <div className="grid gap-5 sm:grid-cols-2">
        {row("auto_apply", "Auto-apply at confidence ≥", "Above this the schedule updates automatically", 0.4, 0.99)}
        {row("review", "New-activity below", "No confident match - proposed as unplanned work", 0.05, 0.6)}
        {row("margin", "Required lead over 2nd match", "Top-1 must beat top-2 by this to auto-apply", 0, 0.5)}
        {row("clarify_gap", "Ask when top-2 within", "Two close candidates → one clarifying question", 0, 0.5)}
      </div>
      <div className="mt-4"><ErrorBanner error={err} /></div>
    </Card>
  );
}

function DataCard({ onChanged }: { onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const r = await api.importSchedule(f);
      toast("ok", `Schedule imported (${r.source.toUpperCase()}): ${r.activities_added} added, ${r.activities_updated} updated, ${r.wbs_nodes} WBS nodes`);
      onChanged();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const link = (href: string, label: string, sub: string) => (
    <a href={href} download className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition hover:border-[var(--border-strong)] hover:bg-[var(--hover)]" style={{ borderColor: "var(--border)" }}>
      <Download className="h-4 w-4 subtle group-hover:text-brand-500" /><span className="min-w-0"><span className="block text-[13px] font-medium">{label}</span><span className="block text-2xs muted">{sub}</span></span>
    </a>
  );
  return (
    <Card title={<Title icon={<Database className="h-4 w-4" />}>Schedule data</Title>} subtitle="Import a schedule (upserts by activity ID - actuals are kept) and export actuals back to planning tools">
      <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4 sm:flex-row sm:items-center" style={{ borderColor: "var(--border-strong)" }}>
        <FileUp className="h-5 w-5 text-brand-500" />
        <div className="flex-1"><div className="text-[13px] font-medium">Import schedule</div><div className="text-2xs muted">CSV (activity_id, name, planned_start, planned_finish, …) or MS Project XML (MSPDI)</div></div>
        <button className="btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Choose file</button>
        <input ref={input} type="file" accept=".csv,.xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {link("/api/export/schedule.xml", "MS Project XML", "MSPDI with actuals")}
        {link("/api/export/schedule.csv", "Schedule CSV", "activities + actuals")}
        {link("/api/export/actuals.csv", "Actuals dataset", "clean structured events")}
      </div>
      <div className="mt-4">
        <div className="label mb-2">Sample inputs (synthetic)</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {link("/api/samples/daily_report_EI_civil.txt", "Daily report .txt", "for file upload")}
          {link("/api/samples/piping_daily_progress.xlsx", "Piping sheet .xlsx", "discipline spreadsheet")}
          {link("/api/samples/schedule.csv", "Schedule .csv", "the GGS-7 plan")}
        </div>
      </div>
    </Card>
  );
}

function DemoCard({ onReset, running, openDemo }: { onReset: () => void; running: boolean; openDemo: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const reset = async () => {
    setBusy(true);
    try {
      await api.demoReset();
      toast("ok", "Demo database reset to the seeded state");
      onReset();
      dataBus.emit();
      setConfirm(false);
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={<Title icon={<Clapperboard className="h-4 w-4" />}>Demo environment</Title>}>
      <p className="text-[13px] muted">Everything runs on a synthetic GGS-7 dataset generated from a fixed seed, so the demo is reproducible.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" onClick={openDemo} disabled={running}><Clapperboard className="h-3.5 w-3.5" /> Run Demo Day</button>
        <button className="btn-secondary btn-sm" onClick={() => setConfirm(true)} disabled={running}><RefreshCcw className="h-3.5 w-3.5" /> Reset demo data</button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset demo data?" description="Restores the seeded schedule, history, backlog and model v1. Reports, corrections and chats you created are removed.">
        <Alert tone="warn">This cannot be undone. The audit trail restarts from the seeded state.</Alert>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirm(false)}>Cancel</button>
          <button className="btn-danger" onClick={reset} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Reset</button>
        </div>
      </Modal>
    </Card>
  );
}
