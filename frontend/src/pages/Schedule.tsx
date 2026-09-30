import clsx from "clsx";
import { AlertTriangle, CalendarRange, ChevronDown, ChevronRight, Download, GitBranch, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Gantt } from "../components/charts";
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader, ProgressBar, Segmented, Skeleton, useAsync } from "../components/ui";
import { dataBus } from "../lib/demo";
import { DISC, DISC_COLOR, DISC_ORDER, PHASE, fmtDate } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { Activity, ActualEventRow, Meta, WbsNodeT } from "../types";
import { apiUrl } from "../lib/config";

type View = "timeline" | "wbs" | "delays" | "warnings";

export default function Schedule({ meta }: { meta: Meta | null }) {
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as View) || "timeline";
  const disc = params.get("discipline") || "";
  const area = params.get("area") || "";
  const activity = params.get("activity");
  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const today = meta?.data_date ?? "";
  const gantt = useAsync(() => api.gantt(disc || undefined, area || undefined), [disc, area]);
  const wbs = useAsync(() => api.wbs(disc || undefined), [disc]);
  const delays = useAsync(() => api.delays(disc || undefined), [disc]);
  const warnings = useAsync(() => api.warnings(), []);
  useEffect(() => dataBus.on(() => { gantt.reload(); wbs.reload(); delays.reload(); warnings.reload(); }), [gantt.reload, wbs.reload, delays.reload, warnings.reload]);
  const dl = (delays.data ?? []).filter((d) => !area || d.area === area);

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Overview" title="Schedule intelligence"
        description="The L1-L6 schedule with actuals from linked site updates: planned vs actual timeline, WBS roll-up by rules of credit, early delay flags and sequence exceptions."
        actions={<>
          <a className="btn-secondary btn-sm" href={apiUrl("/api/export/schedule.xml")} download><Download className="h-3.5 w-3.5" /> MS Project XML</a>
          <a className="btn-secondary btn-sm" href={apiUrl("/api/export/schedule.csv")} download><Download className="h-3.5 w-3.5" /> CSV</a>
        </>} />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented ariaLabel="View" value={view} onChange={(v) => set("view", v === "timeline" ? null : v)} options={[
            { value: "timeline", label: <><CalendarRange className="h-3.5 w-3.5" /> Timeline</> },
            { value: "wbs", label: <><GitBranch className="h-3.5 w-3.5" /> WBS roll-up</> },
            { value: "delays", label: <><AlertTriangle className="h-3.5 w-3.5" /> Delay flags</>, count: delays.data ? dl.length : undefined },
            { value: "warnings", label: <><ShieldAlert className="h-3.5 w-3.5" /> Sequence</>, count: warnings.data?.filter((w) => w.status === "open").length },
          ]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="select h-8 w-auto text-xs" value={area} onChange={(e) => set("area", e.target.value || null)} aria-label="Unit">
            <option value="">All units</option>
            {(meta?.areas ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="flex gap-1 overflow-x-auto" role="group" aria-label="Discipline">
            {["", ...DISC_ORDER].map((d) => (
              <button key={d || "all"} onClick={() => set("discipline", d || null)} aria-pressed={disc === d}
                className={clsx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition",
                  disc === d ? "border-transparent bg-ink-900 text-white dark:bg-white dark:text-ink-950" : "text-ink-600 hover:bg-[var(--hover)] dark:text-ink-300")}
                style={disc === d ? undefined : { borderColor: "var(--border)" }}>
                {d && <span className="h-1.5 w-1.5 rounded-full" style={{ background: DISC_COLOR[d] }} />}{d ? DISC[d] : "All"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "timeline" && (
        <Card title="Plan vs actual timeline" subtitle={`Activities active around the data date${area ? ` · ${area}` : ""}${disc ? ` · ${DISC[disc]}` : ""} · click a row for details`}>
          {gantt.error ? <ErrorBanner error={gantt.error} onRetry={gantt.reload} /> : gantt.loading && !gantt.data ? <Skeleton className="h-[420px]" /> :
            gantt.data?.length ? <Gantt rows={gantt.data} today={today} onPick={(id) => set("activity", id)} highlight={activity} />
              : <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No activities in this window" hint="Try another unit or discipline." />}
        </Card>
      )}

      {view === "wbs" && (
        <Card title="WBS roll-up (L1 → L6)" subtitle="Budget-weighted earned progress · bar = actual, marker = planned today" pad={false}>
          <div className="px-3 pb-3">
            {wbs.loading && !wbs.data ? <div className="p-3"><LoadingBlock rows={8} /></div> : wbs.error ? <ErrorBanner error={wbs.error} onRetry={wbs.reload} /> :
              wbs.data?.roots.map((n) => <WbsRow key={n.code} n={n} depth={0} open onPick={(id) => set("activity", id)} area={area} />)}
          </div>
        </Card>
      )}

      {view === "delays" && (
        <Card title="Early delay flags" pad={false}
          subtitle={meta ? `Due within ${meta.delay_rules.due_window_days} d or overdue, with no update for ≥${meta.delay_rules.amber_days} d (amber) or ≥${meta.delay_rules.red_days} d (red)` : undefined}>
          {delays.loading && !delays.data ? <div className="px-5 pb-5"><LoadingBlock /></div> : !dl.length ? <EmptyState title="No delay flags" hint="Every activity due soon has a recent update." /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead><tr className="border-y text-left" style={{ borderColor: "var(--border)" }}>
                  {["Activity", "Unit", "Due", "Progress", "Last update", "Why"].map((h) => <th key={h} className="table-head px-4 py-2.5">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {dl.map((d) => (
                    <tr key={d.activity_id} className="cursor-pointer hover:bg-[var(--hover)]" onClick={() => set("activity", d.activity_id)}>
                      <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><span className={clsx("h-6 w-1 rounded-full", d.level === "red" ? "bg-rose-500" : "bg-amber-500")} /><span className="font-medium">{d.name}</span></span></td>
                      <td className="px-4 py-2.5 muted">{d.area}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(d.planned_finish)}</td>
                      <td className="w-36 px-4 py-2.5"><div className="flex items-center gap-2"><ProgressBar value={d.pct} size="sm" tone={d.level === "red" ? "bad" : "warn"} /><span className="w-8 text-right text-xs num">{d.pct.toFixed(0)}%</span></div></td>
                      <td className="whitespace-nowrap px-4 py-2.5 muted">{d.last_update ? fmtDate(d.last_update) : "never"}</td>
                      <td className="px-4 py-2.5 text-xs muted">{d.reasons.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {view === "warnings" && (
        <Card title="Sequence exceptions" subtitle="Predecessor logic checks on incoming updates" pad={false}>
          {warnings.loading && !warnings.data ? <div className="px-5 pb-5"><LoadingBlock /></div> : !warnings.data?.length ? <EmptyState title="No sequence exceptions" /> : (
            <ul className="divide-y px-2 pb-2" style={{ borderColor: "var(--border)" }}>
              {warnings.data.map((w) => (
                <li key={w.id}>
                  <button className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-[var(--hover)]" onClick={() => set("activity", w.activity_id)}>
                    <span className={w.status === "open" ? "badge-warning" : w.status === "confirmed" ? "badge-success" : "badge-danger"}>{w.status}</span>
                    <span className="min-w-0 flex-1 text-[13px] leading-5">{w.message}<span className="block text-2xs muted">Report #{w.report_id} · {w.type.replace(/_/g, " ")}{w.resolved_by ? ` · resolved by ${w.resolved_by}` : ""}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {activity && <ActivityDrawer id={activity} onClose={() => set("activity", null)} />}
    </div>
  );
}

function WbsRow({ n, depth, open: initial, onPick, area }: { n: WbsNodeT; depth: number; open?: boolean; onPick: (id: string) => void; area: string }) {
  const [open, setOpen] = useState(!!initial || (area !== "" && n.level === 2 && n.name.startsWith(area)));
  if (area && n.level === 2 && !n.name.startsWith(area)) return null;
  const has = n.children.length > 0 || n.activities.length > 0;
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-[var(--hover)]" style={{ paddingLeft: 8 + depth * 16 }}>
        {has ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 subtle" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 subtle" />) : <span className="w-3.5" />}
        <span className="shrink-0 rounded px-1 text-[10px] font-semibold text-ink-500 dark:text-ink-400" style={{ background: "var(--hover)" }}>L{n.level}</span>
        <span className={clsx("min-w-0 flex-1 truncate", n.level <= 2 && "font-medium text-ink-900 dark:text-white")}>{n.name}</span>
        <span className="w-12 text-right text-xs font-semibold num">{n.actual_pct.toFixed(0)}%</span>
        <span className="hidden w-28 sm:block"><ProgressBar value={n.actual_pct} marker={n.planned_pct} size="sm" tone={n.actual_pct < n.planned_pct - 10 ? "bad" : n.actual_pct < n.planned_pct - 3 ? "warn" : "good"} /></span>
      </button>
      {open && (
        <div>
          {n.children.map((c) => <WbsRow key={c.code} n={c} depth={depth + 1} onPick={onPick} area={area} />)}
          {n.activities.map((a) => (
            <button key={a.activity_id} onClick={() => onPick(a.activity_id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-xs hover:bg-[var(--hover)]"
              style={{ paddingLeft: 8 + (depth + 1) * 16 + 22 }}>
              <span className="shrink-0 rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">L{a.level}</span>
              <span className="min-w-0 flex-1 truncate">{a.flag && <span className={a.flag === "red" ? "text-rose-500" : "text-amber-500"}>{a.flag === "red" ? "▲ " : "● "}</span>}{a.name}</span>
              <span className="w-12 text-right num">{a.pct.toFixed(0)}%</span>
              <span className="hidden w-28 sm:block"><ProgressBar value={a.pct} marker={a.planned_pct} size="sm" tone={a.pct >= 100 ? "good" : "brand"} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [a, setA] = useState<(Activity & { events: ActualEventRow[] }) | null>(null);
  const [preds, setPreds] = useState<Activity[]>([]);
  const [error, setError] = useState<unknown>(null);
  const nav = useNavigate();
  useEffect(() => {
    setA(null);
    setPreds([]);
    api.activityDetail(id).then(async (d) => {
      setA(d);
      const ps = await Promise.all((d.predecessors ?? []).map((p) => api.activityDetail(p).catch(() => null)));
      setPreds(ps.filter(Boolean) as Activity[]);
    }).catch(setError);
  }, [id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[65] bg-ink-950/40 backdrop-blur-[2px] animate-fadein" onClick={onClose}>
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col shadow-pop animate-slideup" style={{ background: "var(--elevated)", borderLeft: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Activity details">
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div className="min-w-0">
            <div className="label">Schedule activity</div>
            <h2 className="mt-1 text-base font-semibold leading-6 text-ink-900 dark:text-white">{a?.name ?? "Loading…"}</h2>
            {a && <div className="mt-0.5 font-mono text-2xs muted">{a.activity_id} · L{a.level} · {a.wbs_code}</div>}
          </div>
          <button className="btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {error ? <ErrorBanner error={error} /> : !a ? <LoadingBlock rows={10} /> : <>
            <div>
              <div className="flex items-end justify-between">
                <div><div className="text-2xs muted">Actual progress</div><div className="text-3xl font-semibold tracking-tight num">{a.pct.toFixed(0)}%</div></div>
                <div className="text-right text-2xs muted">{a.qty_done.toFixed(0)} / {a.quantity} {a.unit}<div>{a.credit_method === "milestone" ? "milestone rule (0 / 100)" : "quantity rule of credit"}</div></div>
              </div>
              <div className="mt-2"><ProgressBar value={a.pct} tone={a.pct >= 100 ? "good" : "brand"} /></div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Field k="Discipline" v={DISC[a.discipline]} /><Field k="Unit" v={`${a.area}`} />
              <Field k="Phase" v={PHASE[a.phase] ?? a.phase} /><Field k="Tag" v={a.tag} />
              <Field k="Planned" v={`${fmtDate(a.planned_start)} → ${fmtDate(a.planned_finish)}`} />
              <Field k="Actual" v={`${a.actual_start ? fmtDate(a.actual_start) : "not started"} → ${a.actual_finish ? fmtDate(a.actual_finish) : "…"}`} />
            </dl>
            <div>
              <div className="label mb-2">Predecessors (finish-to-start)</div>
              {a.predecessors.length === 0 ? <p className="text-xs muted">None - this activity can start any time.</p> : (
                <ul className="space-y-1.5">
                  {a.predecessors.map((p) => {
                    const pa = preds.find((x) => x.activity_id === p);
                    return (
                      <li key={p} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                        <span className="min-w-0 flex-1 truncate">{pa?.name ?? p}</span>
                        <span className={clsx("font-semibold num", pa && pa.pct >= 100 ? "text-emerald-500" : "text-amber-500")}>{pa ? `${pa.pct.toFixed(0)}%` : "…"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div>
              <div className="label mb-2">Actuals history ({a.events.length})</div>
              {a.events.length === 0 ? <p className="text-xs muted">No actual events yet.</p> : (
                <ol className="space-y-2">
                  {[...a.events].reverse().map((e) => (
                    <li key={e.id} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium capitalize">{e.event} · {fmtDate(e.event_date)}</span>
                        <span className="num muted">{e.pct_before.toFixed(0)}% → <b className="text-ink-900 dark:text-white">{e.pct_after.toFixed(0)}%</b></span>
                      </div>
                      <div className="mt-0.5 muted">{e.approver}{e.credit_note && e.credit_note !== "historical import" ? ` · ${e.credit_note}` : ""}</div>
                      {e.report_id && <button className="mt-1 text-brand-600 hover:underline dark:text-brand-400" onClick={() => nav(`/updates?report=${e.report_id}`)}>View site update #{e.report_id}</button>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>}
        </div>
      </aside>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return <div><dt className="label">{k}</dt><dd className="mt-0.5">{v}</dd></div>;
}
