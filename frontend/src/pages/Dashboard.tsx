import clsx from "clsx";
import { AlertTriangle, BookOpen, ChevronDown, ChevronRight, Download, FileUp, Loader2, Search, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { DisciplineBars, Gantt, SCurve } from "../components/charts";
import { Card, EmptyState, ErrorBanner, Kpi, Spinner, SyntheticLabel, useAsync, useToast } from "../components/ui";
import { dataBus } from "../lib/demo";
import { DISC, DISC_COLOR, DISC_ORDER, fmtDate } from "../lib/format";
import type { Meta, WbsNodeT } from "../types";

export default function Dashboard({ meta }: { meta: Meta | null }) {
  const [disc, setDisc] = useState<string>("");
  const summary = useAsync(() => api.summary(), []);
  const scurve = useAsync(() => api.scurve(disc || undefined), [disc]);
  const gantt = useAsync(() => api.gantt(disc || undefined), [disc]);
  const delays = useAsync(() => api.delays(disc || undefined), [disc]);
  const warnings = useAsync(() => api.warnings(), []);
  const wbs = useAsync(() => api.wbs(disc || undefined), [disc]);
  useEffect(() => dataBus.on(() => { summary.reload(); scurve.reload(); gantt.reload(); delays.reload(); warnings.reload(); wbs.reload(); }),
    [summary.reload, scurve.reload, gantt.reload, delays.reload, warnings.reload, wbs.reload]);
  const s = summary.data;
  const today = s?.data_date ?? meta?.data_date ?? "";
  const openWarn = (warnings.data ?? []).filter((w) => w.status === "open");

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{s?.project ?? "Project dashboard"}</h1>
          <p className="text-sm muted">Data date {fmtDate(today)} · actuals update in near real time as reports are linked · <SyntheticLabel text="synthetic project data" /></p>
        </div>
        <DataPanel onChanged={() => dataBus.emit()} />
      </div>
      <ErrorBanner error={summary.error} onRetry={summary.reload} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Actual progress" value={s ? `${s.actual_pct.toFixed(1)}%` : "…"} sub={s ? `plan ${s.planned_pct.toFixed(1)}%` : ""} tone="brand" />
        <Kpi label="Schedule performance (SPI)" value={s?.spi?.toFixed(2) ?? "…"} sub="earned ÷ planned" tone={s && s.spi !== null && s.spi < 0.9 ? "bad" : "default"} />
        <Kpi label="Activities" value={s ? `${s.completed}/${s.activities}` : "…"} sub={s ? `${s.in_progress} in progress · ${s.new_activities} new` : ""} />
        <Kpi label="Delay flags" value={s ? <span><span className="text-rose-600 dark:text-rose-400">{s.delays_red}</span> <span className="text-base text-amber-600 dark:text-amber-400">+{s.delays_amber}</span></span> : "…"} sub="red + amber" />
        <Kpi label="Sequence warnings" value={s?.open_warnings ?? "…"} sub="open, awaiting confirmation" tone={s && s.open_warnings > 0 ? "warn" : "default"} />
        <Kpi label="Review queue" value={s ? s.queue_planner + s.queue_supervisor : "…"} sub={<Link className="text-brand-600 hover:underline dark:text-brand-400" to="/planner">open planner console →</Link>} />
      </div>

      {/* filters: one row above the charts */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Discipline filter">
        <span className="mr-1 text-xs font-semibold muted">Discipline</span>
        {["", ...DISC_ORDER].map((d) => (
          <button key={d || "all"} onClick={() => setDisc(d)}
            className={clsx("rounded-full border px-3 py-1 text-xs font-medium transition", disc === d
              ? "border-brand-600 bg-brand-600 text-white" : "border-ink-200 bg-white hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:hover:bg-ink-800")}>
            {d && <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: DISC_COLOR[d] }} />}
            {d ? DISC[d] : "All"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`S-curve: planned vs actual${disc ? ` · ${DISC[disc]}` : ""}`} className="lg:col-span-2">
          {scurve.loading && !scurve.data ? <Spinner /> : scurve.error ? <ErrorBanner error={scurve.error} /> :
            scurve.data?.length ? <SCurve data={scurve.data} today={today} /> : <EmptyState title="No schedule data" />}
        </Card>
        <Card title="Progress by discipline (weighted by rules of credit)">
          {s ? <DisciplineBars data={s.by_discipline} onPick={(d) => setDisc(disc === d ? "" : d)} active={disc} /> : <Spinner />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Early delay flags</span>}
          actions={meta && <span className="text-[11px] muted">due ≤{meta.delay_rules.due_window_days} d or overdue · silent ≥{meta.delay_rules.amber_days} d amber, ≥{meta.delay_rules.red_days} d red</span>} pad={false}>
          {delays.loading && !delays.data ? <Spinner className="p-4" /> : !delays.data?.length ? <EmptyState title="No delay flags" hint="Every activity due soon has a recent update." /> : (
            <div className="scrollbar-thin max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="table-head sticky top-0"><tr><th className="px-3 py-2">Activity</th><th className="px-2 py-2">Due</th><th className="px-2 py-2 text-right">%</th><th className="px-3 py-2">Why</th></tr></thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {delays.data.slice(0, 40).map((d) => (
                    <tr key={d.activity_id}>
                      <td className="px-3 py-2">
                        <span className={clsx("mr-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          d.level === "red" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300")}>
                          {d.level === "red" ? "▲ red" : "● amber"}</span>
                        <span className="font-medium">{d.name}</span>
                        <div className="text-[11px] muted">{d.activity_id} · last update {d.last_update ? fmtDate(d.last_update) : "never"}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs">{fmtDate(d.planned_finish)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{d.pct.toFixed(0)}</td>
                      <td className="px-3 py-2 text-xs muted">{d.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-500" /> Sequence-sanity warnings</span>} pad={false}>
          {warnings.loading && !warnings.data ? <Spinner className="p-4" /> : !warnings.data?.length ? <EmptyState title="No sequence warnings" hint="Out-of-order reports (e.g. hydrotest before welding is complete) appear here." /> : (
            <ul className="scrollbar-thin max-h-80 divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
              {warnings.data.slice(0, 40).map((w) => (
                <li key={w.id} className="px-4 py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={w.status === "open" ? "chip-warn" : w.status === "confirmed" ? "chip-pos" : "chip-neg"}>{w.status}</span>
                    <span className="text-[11px] muted">report #{w.report_id}{w.resolved_by ? ` · by ${w.resolved_by}` : ""}</span>
                  </div>
                  <p className="mt-1">{w.message}</p>
                </li>
              ))}
            </ul>
          )}
          {openWarn.length > 0 && <p className="border-t border-ink-100 px-4 py-2 text-xs muted dark:border-ink-800">{openWarn.length} open - supervisors confirm in the assistant; planners resolve in the console.</p>}
        </Card>
      </div>

      <Card title={`Plan vs actual (activities active around the data date${disc ? ` · ${DISC[disc]}` : ""})`}>
        {gantt.loading && !gantt.data ? <Spinner /> : gantt.data?.length ? <Gantt rows={gantt.data} today={today} /> : <EmptyState title="No activities in the window" />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="WBS roll-up (L1 → L6)" pad={false}>
          {wbs.loading && !wbs.data ? <Spinner className="p-4" /> : (
            <div className="scrollbar-thin max-h-[28rem] overflow-y-auto p-2">
              {wbs.data?.roots.map((n) => <WbsNode key={n.code} n={n} depth={0} defaultOpen />)}
            </div>
          )}
        </Card>
        <MemoryBox />
      </div>
    </div>
  );
}

function PctBar({ actual, planned }: { actual: number; planned: number }) {
  return (
    <div className="relative h-1.5 w-24 shrink-0 rounded bg-ink-100 dark:bg-ink-800" title={`actual ${actual}% · planned ${planned}%`}>
      <div className="h-full rounded bg-brand-500" style={{ width: `${actual}%` }} />
      <div className="absolute -top-0.5 h-2.5 w-0.5 bg-ink-800 dark:bg-white" style={{ left: `${planned}%` }} />
    </div>
  );
}

function WbsNode({ n, depth, defaultOpen }: { n: WbsNodeT; depth: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const hasKids = n.children.length > 0 || n.activities.length > 0;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-ink-50 dark:hover:bg-ink-800"
        style={{ paddingLeft: 6 + depth * 14 }} aria-expanded={open}>
        {hasKids ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 muted" />) : <span className="w-3.5" />}
        <span className="shrink-0 rounded bg-ink-100 px-1 text-[10px] font-semibold text-ink-600 dark:bg-ink-800 dark:text-ink-300">L{n.level}</span>
        <span className="min-w-0 flex-1 truncate">{n.name}</span>
        <span className="w-12 text-right text-xs font-semibold tabular-nums">{n.actual_pct.toFixed(0)}%</span>
        <PctBar actual={n.actual_pct} planned={n.planned_pct} />
      </button>
      {open && (
        <div>
          {n.children.map((c) => <WbsNode key={c.code} n={c} depth={depth + 1} />)}
          {n.activities.map((a) => (
            <div key={a.activity_id} className="flex items-center gap-2 px-1.5 py-0.5 text-xs" style={{ paddingLeft: 6 + (depth + 1) * 14 + 18 }}>
              <span className="shrink-0 rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">L{a.level}</span>
              <span className="min-w-0 flex-1 truncate" title={a.activity_id}>
                {a.flag && <span className={a.flag === "red" ? "text-rose-600" : "text-amber-500"}>{a.flag === "red" ? "▲ " : "● "}</span>}{a.name}
              </span>
              <span className="w-12 text-right tabular-nums">{a.pct.toFixed(0)}%</span>
              <PctBar actual={a.pct} planned={a.planned_pct} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryBox() {
  const [q, setQ] = useState("typical duration for piping erection");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.ask>> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const ask = async (question: string) => {
    setBusy(true);
    setErr(null);
    try { setRes(await api.ask(question)); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const examples = ["typical duration for piping erection", "average slip for civil concrete pour", "productivity of cable pulling",
    "which activities in U-300 slipped most", "how many welding activities are complete"];
  return (
    <Card title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-brand-500" /> Institutional memory</span>} actions={<SyntheticLabel text="synthetic-data demo" />}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 muted" />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about historical actuals…" maxLength={300} aria-label="Question" />
        </div>
        <button className="btn-primary" disabled={busy || !q.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((e) => <button key={e} className="chip-neu cursor-pointer hover:opacity-80" onClick={() => { setQ(e); void ask(e); }}>{e}</button>)}
      </div>
      <ErrorBanner error={err} />
      {res && (
        <div className="mt-3 rounded-lg bg-ink-50 p-3 text-sm dark:bg-ink-800/60">
          <p>{res.answer}</p>
          {res.histogram && res.histogram.length > 0 && (
            <div className="mt-3 flex h-20 items-end gap-1" aria-label="Duration histogram">
              {res.histogram.map((h) => {
                const max = Math.max(...res.histogram!.map((x) => x.count), 1);
                return (
                  <div key={h.bin} className="flex flex-1 flex-col items-center gap-1" title={`${h.bin}: ${h.count}`}>
                    <span className="text-[10px] tabular-nums muted">{h.count || ""}</span>
                    <div className="w-full rounded-t" style={{ height: `${(h.count / max) * 48}px`, background: "var(--series-1)" }} />
                    <span className="text-[9px] muted">{h.bin}</span>
                  </div>
                );
              })}
            </div>
          )}
          {res.note && <p className="mt-2 text-[11px] muted">{res.note}</p>}
        </div>
      )}
    </Card>
  );
}

function DataPanel({ onChanged }: { onChanged: () => void }) {
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
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-secondary btn-sm" onClick={() => input.current?.click()} disabled={busy} title="Import schedule: CSV or MS Project XML (MSPDI)">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} Import schedule
      </button>
      <input ref={input} type="file" accept=".csv,.xml" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      <a className="btn-secondary btn-sm" href="/api/export/schedule.xml" download><Download className="h-3.5 w-3.5" /> MSPDI XML</a>
      <a className="btn-secondary btn-sm" href="/api/export/schedule.csv" download><Download className="h-3.5 w-3.5" /> Schedule CSV</a>
      <a className="btn-secondary btn-sm" href="/api/export/actuals.csv" download><Download className="h-3.5 w-3.5" /> Actuals dataset</a>
    </div>
  );
}
