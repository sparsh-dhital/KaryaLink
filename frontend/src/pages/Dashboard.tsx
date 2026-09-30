import clsx from "clsx";
import { AlertTriangle, ArrowRight, ClipboardCheck, Inbox, Link2, ShieldAlert, Sparkles, TrendingDown, Activity as ActivityIcon, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { DisciplineBars, SCurve } from "../components/charts";
import { SectionLink, UnitCard, UpdateItem } from "../components/domain";
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader, Skeleton, Stat, SyntheticLabel, useAsync } from "../components/ui";
import { dataBus } from "../lib/demo";
import { DISC, DISC_COLOR, DISC_ORDER, fmtDate } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { Meta } from "../types";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard({ meta }: { meta: Meta | null }) {
  const [disc, setDisc] = useState<string>("");
  const nav = useNavigate();
  const summary = useAsync(() => api.summary(), []);
  const scurve = useAsync(() => api.scurve(disc || undefined), [disc]);
  const feed = useAsync(() => api.reports({ limit: 6 }), []);
  const delays = useAsync(() => api.delays(), []);
  const warnings = useAsync(() => api.warnings(), []);
  useEffect(() => dataBus.on(() => { summary.reload(); scurve.reload(); feed.reload(); delays.reload(); warnings.reload(); }),
    [summary.reload, scurve.reload, feed.reload, delays.reload, warnings.reload]);
  const s = summary.data;
  const today = s?.data_date ?? meta?.data_date ?? "";
  const th = meta?.thresholds.auto_apply ?? 0.8;
  const openWarn = (warnings.data ?? []).filter((w) => w.status === "open");
  const gap = s ? s.actual_pct - s.planned_pct : 0;
  const exceptions = s ? s.delays_red + s.open_warnings : 0;

  return (
    <div className={PAGE}>
      <PageHeader eyebrow={<>GGS-7 Gas Gathering Station · data date {fmtDate(today)}</>}
        title={`${greeting()}, R. Sharma`}
        badge={<SyntheticLabel text="synthetic project data" />}
        description={s ? <>Project intelligence at a glance: <b className="text-ink-800 dark:text-ink-100">{s.updates_today}</b> site updates today, <b className="text-ink-800 dark:text-ink-100">{s.linked_today}</b> linked to the schedule automatically, <b className="text-ink-800 dark:text-ink-100">{s.queue_planner + s.queue_supervisor}</b> waiting for a person.</> : "Loading project intelligence…"}
        actions={<>
          <button className="btn-secondary" onClick={() => nav("/updates")}><Inbox className="h-4 w-4" /> Site updates</button>
          <button className="btn-primary" onClick={() => nav("/planner")}><ClipboardCheck className="h-4 w-4" /> Review queue{s ? ` (${s.queue_planner + s.queue_supervisor})` : ""}</button>
        </>} />
      <ErrorBanner error={summary.error} onRetry={summary.reload} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {!s ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="card p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-16" /><Skeleton className="mt-2 h-3 w-24" /></div>) : <>
          <Stat label="Actual progress" value={`${s.actual_pct.toFixed(1)}%`} icon={<ActivityIcon className="h-4 w-4" />}
            trend={<span className={clsx("text-xs font-semibold num", gap < -5 ? "text-rose-500" : "text-emerald-500")}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}</span>}
            sub={`plan ${s.planned_pct.toFixed(1)}% · SPI ${s.spi?.toFixed(2) ?? "-"}`} />
          <Stat label="Updates today" value={s.updates_today} icon={<Inbox className="h-4 w-4" />} sub={`${s.linked_today} auto-linked`} />
          <Stat label="Pending reviews" value={s.queue_planner + s.queue_supervisor} tone={s.queue_planner ? "warn" : "default"} icon={<ClipboardCheck className="h-4 w-4" />}
            sub={`${s.queue_supervisor} awaiting supervisor`} />
          <Stat label="Schedule-linked updates" value={s.auto_applied} icon={<Link2 className="h-4 w-4" />} sub={`of ${s.reports_total} reports received`} />
          <Stat label="Exceptions" value={exceptions} tone={exceptions ? "bad" : "good"} icon={<ShieldAlert className="h-4 w-4" />}
            sub={`${s.delays_red} delays · ${s.open_warnings} sequence`} />
          <Stat label="Activities complete" value={`${s.completed}`} icon={<CheckCircle2 className="h-4 w-4" />}
            sub={`of ${s.activities} · ${s.in_progress} in progress`} />
        </>}
      </div>

      {/* planned vs actual + assistant */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Planned vs actual progress" subtitle={`Earned progress (rules of credit) against the baseline${disc ? ` · ${DISC[disc]}` : " · all disciplines"}`}
          actions={
            <div className="flex max-w-full gap-1 overflow-x-auto" role="group" aria-label="Discipline filter">
              {["", ...DISC_ORDER].map((d) => (
                <button key={d || "all"} onClick={() => setDisc(d)} aria-pressed={disc === d}
                  className={clsx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition",
                    disc === d ? "bg-ink-900 text-white dark:bg-white dark:text-ink-950" : "text-ink-500 hover:bg-[var(--hover)] hover:text-ink-800 dark:hover:text-ink-100")}>
                  {d && <span className="h-1.5 w-1.5 rounded-full" style={{ background: DISC_COLOR[d] }} />}
                  {d || "All"}
                </button>
              ))}
            </div>
          }>
          {scurve.loading && !scurve.data ? <Skeleton className="h-[280px]" /> : scurve.error ? <ErrorBanner error={scurve.error} onRetry={scurve.reload} /> :
            scurve.data?.length ? <SCurve data={scurve.data} today={today} /> : <EmptyState title="No schedule data" hint="Import a schedule from Settings." />}
          {s && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
              <Legend color="var(--series-1)" label="Actual (earned)" value={`${s.actual_pct.toFixed(1)}%`} />
              <Legend color="var(--chart-muted)" dashed label="Planned" value={`${s.planned_pct.toFixed(1)}%`} />
              <span className={clsx("inline-flex items-center gap-1.5 font-medium", gap < -5 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                <TrendingDown className="h-3.5 w-3.5" /> {Math.abs(gap).toFixed(1)} pts {gap < 0 ? "behind" : "ahead of"} plan
              </span>
            </div>
          )}
        </Card>
        <AssistantCard />
      </div>

      {/* unit portfolio */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900 dark:text-white">Unit portfolio</h2>
            <p className="text-xs muted">Six process units of GGS-7 · actual vs planned today · click a unit to open its schedule</p>
          </div>
          <SectionLink to="/schedule">Open schedule</SectionLink>
        </div>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
          {!s ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="card min-w-[250px] p-4"><LoadingBlock rows={4} /></div>)
            : s.by_area.map((u) => <UnitCard key={u.area} u={u} onOpen={() => nav(`/schedule?area=${u.area}`)} />)}
        </div>
      </section>

      {/* recent updates + disciplines */}
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Recent site updates" subtitle="What supervisors reported, where KaryaLink linked it, and how sure it was" pad={false}
          actions={<SectionLink to="/updates">All updates</SectionLink>}>
          <div className="px-2 pb-2">
            {feed.loading && !feed.data ? <div className="p-3"><LoadingBlock rows={6} /></div> : !feed.data?.items.length ? (
              <EmptyState icon={<Inbox className="h-5 w-5" />} title="No site updates yet" hint="Once supervisors submit progress, KaryaLink analyses it and links it to the schedule." />
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {feed.data.items.map((r) => <li key={r.id}><UpdateItem r={r} threshold={th} onClick={() => nav(`/updates?report=${r.id}`)} /></li>)}
              </ul>
            )}
          </div>
        </Card>
        <Card title="Progress by discipline" subtitle="Weighted by rules of credit · marker = planned today">
          {s ? <DisciplineBars data={s.by_discipline} onPick={(d) => setDisc(disc === d ? "" : d)} active={disc} /> : <LoadingBlock rows={6} />}
        </Card>
      </div>

      {/* exceptions */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Early delay flags</span>}
          subtitle={meta ? `Due within ${meta.delay_rules.due_window_days} d or overdue, silent ≥${meta.delay_rules.amber_days} d (amber) / ≥${meta.delay_rules.red_days} d (red)` : undefined}
          actions={<SectionLink to="/schedule?view=delays">View all</SectionLink>} pad={false}>
          {delays.loading && !delays.data ? <div className="px-5 pb-5"><LoadingBlock /></div> : !delays.data?.length ? <EmptyState title="No delay flags" hint="Every activity due soon has a recent update." /> : (
            <ul className="divide-y px-2 pb-2" style={{ borderColor: "var(--border)" }}>
              {delays.data.slice(0, 5).map((d) => (
                <li key={d.activity_id}>
                  <button onClick={() => nav(`/schedule?activity=${encodeURIComponent(d.activity_id)}`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--hover)]">
                    <span className={clsx("h-8 w-1 shrink-0 rounded-full", d.level === "red" ? "bg-rose-500" : "bg-amber-500")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{d.name}</span>
                      <span className="block truncate text-2xs muted">{d.reasons.join(" · ")}</span>
                    </span>
                    <span className="text-right text-2xs muted"><span className="block text-xs font-semibold text-ink-800 num dark:text-ink-100">{d.pct.toFixed(0)}%</span>due {fmtDate(d.planned_finish)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-500" />Sequence exceptions</span>}
          subtitle="Updates reported out of logic order - confirmed by the supervisor or resolved by a planner" pad={false}
          actions={<SectionLink to="/schedule?view=warnings">View all</SectionLink>}>
          {warnings.loading && !warnings.data ? <div className="px-5 pb-5"><LoadingBlock /></div> : !warnings.data?.length ? <EmptyState title="No sequence exceptions" hint="Out-of-order reports, e.g. hydrotest before welding is complete, appear here." /> : (
            <ul className="divide-y px-2 pb-2" style={{ borderColor: "var(--border)" }}>
              {warnings.data.slice(0, 5).map((w) => (
                <li key={w.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={w.status === "open" ? "badge-warning" : w.status === "confirmed" ? "badge-success" : "badge-danger"}>{w.status}</span>
                  <span className="min-w-0 flex-1 text-[13px] leading-5">{w.message}<span className="block text-2xs muted">Report #{w.report_id}{w.resolved_by ? ` · resolved by ${w.resolved_by}` : ""}</span></span>
                </li>
              ))}
            </ul>
          )}
          {openWarn.length > 0 && <p className="border-t px-5 py-2.5 text-2xs muted" style={{ borderColor: "var(--border)" }}>{openWarn.length} open · supervisors confirm in the assistant, planners resolve in the review queue</p>}
        </Card>
      </div>
    </div>
  );
}

function Legend({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx("inline-block h-0 w-5", dashed ? "border-t-2 border-dashed" : "border-t-[2.5px]")} style={{ borderColor: color }} />
      <span className="muted">{label}</span> <b className="num text-ink-900 dark:text-white">{value}</b>
    </span>
  );
}

function AssistantCard() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const ask = (t: string) => { if (t.trim()) nav(`/supervisor?ask=${encodeURIComponent(t.trim())}`); };
  const ex = ["What is delayed?", "Status of line 1022?", "What is planned today?"];
  return (
    <section className="card glow relative flex flex-col overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(117,101,243,.20),transparent_60%)]" />
      <div className="relative flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold"><Sparkles className="h-4 w-4 text-brand-500" /> AI Site Assistant</span>
        <span className="badge-brand">voice · EN / हिंदी</span>
      </div>
      <h3 className="relative mt-5 text-xl font-semibold leading-7 tracking-tight text-ink-900 dark:text-white">Ask, don't guess.</h3>
      <p className="relative mt-1.5 text-[13px] leading-5 muted">Supervisors speak or type progress in English, Hindi or Hinglish. Confident links update the schedule; uncertain ones get one clarifying question.</p>
      <div className="relative mt-4 flex flex-wrap gap-1.5">
        {ex.map((e) => <button key={e} onClick={() => ask(e)} className="rounded-full border px-2.5 py-1 text-2xs font-medium text-ink-600 transition hover:border-brand-300 hover:text-brand-700 dark:text-ink-300 dark:hover:border-brand-500/40 dark:hover:text-brand-200" style={{ borderColor: "var(--border-strong)" }}>{e}</button>)}
      </div>
      <ul className="relative mt-5 space-y-2 border-t pt-4 text-xs" style={{ borderColor: "var(--border)" }}>
        {[["Report", "“F-12 pour done, 42 cum” · voice or chat"], ["Ask", "status of a tag, today's plan, delays"], ["Correct", "“undo” · “no, it was line 1022” · “why?”"], ["Evidence", "photo with GPS · daily report files"]].map(([k, v]) => (
          <li key={k} className="flex gap-3"><span className="w-16 shrink-0 font-semibold text-ink-700 dark:text-ink-200">{k}</span><span className="muted">{v}</span></li>
        ))}
      </ul>
      <form className="relative mt-auto pt-5" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <div className="flex items-center gap-2 rounded-xl border px-2 py-1.5 transition focus-within:border-brand-400 focus-within:shadow-ring" style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about progress or report an update…" aria-label="Ask the assistant"
            className="h-8 flex-1 bg-transparent px-1.5 text-[13px] placeholder:text-ink-400 focus:outline-none" />
          <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-500 disabled:opacity-50" disabled={!q.trim()} aria-label="Ask"><ArrowRight className="h-4 w-4" /></button>
        </div>
      </form>
    </section>
  );
}
