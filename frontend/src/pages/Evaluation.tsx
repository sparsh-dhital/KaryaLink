import clsx from "clsx";
import { BookOpen, GraduationCap, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Calibration, ConfusionMatrix, DecisionMix, LearningChart, PrecisionCoverage, UpdateVolume } from "../components/charts";
import { Card, EmptyState, ErrorBanner, LoadingBlock, PageHeader, Segmented, Skeleton, Stat, SyntheticLabel, useAsync, useToast } from "../components/ui";
import { dataBus, demoRegistry } from "../lib/demo";
import { DISC, fmtTime, pct } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { Meta } from "../types";
import { ThresholdEditor } from "./Settings";

type Tab = "operations" | "accuracy";

export default function Evaluation({ meta, onMetaChange }: { meta: Meta | null; onMetaChange: () => void }) {
  const [tab, setTab] = useState<Tab>("operations");
  const [split, setSplit] = useState<"test" | "hard">("test");
  const m = useAsync(() => api.metrics(split), [split]);
  const hist = useAsync(() => api.history(), []);
  const learn = useAsync(() => api.learning(), []);
  const stats = useAsync(() => api.reportStats(), []);
  const summary = useAsync(() => api.summary(), []);
  const [training, setTraining] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => { m.reload(); hist.reload(); learn.reload(); stats.reload(); summary.reload(); },
    [m.reload, hist.reload, learn.reload, stats.reload, summary.reload]);
  useEffect(() => dataBus.on(() => { learn.reload(); stats.reload(); summary.reload(); }), [learn.reload, stats.reload, summary.reload]);

  const retrain = useCallback(async () => {
    setTraining(true);
    try {
      const r = await api.retrain();
      toast("ok", `Retrained ${r.version} with ${r.n_corrections} correction(s), ${r.n_learned_terms} learned term(s). Held-out sets re-measured.`);
      await refresh();
      onMetaChange();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setTraining(false);
    }
  }, [refresh, toast, onMetaChange]);

  const retrainRef = useRef(retrain); retrainRef.current = retrain;
  useEffect(() => demoRegistry.register("evaluation", {
    async retrain() { setTab("accuracy"); await retrainRef.current(); },
    setSplit(s) { setTab("accuracy"); setSplit(s); },
    async refresh() { await refresh(); },
  }), [refresh]);

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Intelligence" title="Reports"
        description="Operational reporting from live site updates, and AI matching accuracy measured on the held-out synthetic benchmark."
        actions={<Segmented ariaLabel="Report" value={tab} onChange={setTab} options={[{ value: "operations", label: "Operations" }, { value: "accuracy", label: "AI accuracy" }]} />} />
      {tab === "operations" ? <Operations stats={stats} summary={summary} /> : (
        <Accuracy meta={meta} m={m} hist={hist} learn={learn} split={split} setSplit={setSplit} training={training} retrain={retrain} refresh={refresh} onMetaChange={onMetaChange} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ operations (live data)
function Operations({ stats, summary }: { stats: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.reportStats>>>>; summary: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.summary>>>> }) {
  const st = stats.data;
  const s = summary.data;
  const autoShare = st && st.total ? (st.by_decision.AUTO_APPLY ?? 0) / st.total : null;
  const statusLabel: Record<string, string> = { applied: "Schedule updated", awaiting_planner: "Needs review", awaiting_supervisor: "Awaiting clarification",
    new_activity_created: "New activity", rejected: "Rejected", reverted: "Undone" };
  return (
    <div className="space-y-4">
      <ErrorBanner error={stats.error} onRetry={stats.reload} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!st || !s ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="card p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-14" /></div>) : <>
          <Stat label="Site updates received" value={st.total} sub={`${s.updates_today} today`} />
          <Stat label="Linked without a person" value={pct(autoShare, 0)} tone="brand" sub={`${st.by_decision.AUTO_APPLY ?? 0} auto-applied`} />
          <Stat label="Review workload" value={s.queue_planner + s.queue_supervisor} tone={s.queue_planner ? "warn" : "default"} sub={`${s.queue_planner} planner · ${s.queue_supervisor} supervisor`} />
          <Stat label="Schedule variance" value={`${(s.actual_pct - s.planned_pct).toFixed(1)} pts`} tone={s.actual_pct - s.planned_pct < -5 ? "bad" : "good"} sub={`actual ${s.actual_pct}% vs plan ${s.planned_pct}%`} />
        </>}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Site update volume" subtitle="Per report date · auto-linked vs needing a clarification or a planner">
          {!st ? <Skeleton className="h-[220px]" /> : st.by_day.length ? <UpdateVolume data={st.by_day} /> : <EmptyState title="No updates yet" />}
        </Card>
        <Card title="Outcomes" subtitle="Where every update ended up - nothing is dropped">
          {!st ? <LoadingBlock /> : (
            <ul className="space-y-2.5">
              {Object.entries(st.by_status).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k}>
                  <div className="mb-1 flex justify-between text-xs"><span>{statusLabel[k] ?? k}</span><span className="font-semibold num">{v}</span></div>
                  <div className="h-1.5 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(v / st.total) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Decisions" subtitle="What the policy did with each live update">
          {!st ? <LoadingBlock /> : <DecisionMix decisions={st.by_decision} />}
        </Card>
        <Card title="Channels" subtitle="How supervisors reported">
          {!st ? <LoadingBlock /> : (
            <ul className="grid grid-cols-2 gap-2">
              {Object.entries(st.by_channel).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k} className="rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <div className="text-2xs capitalize muted">{k}</div><div className="text-lg font-semibold num">{v}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <MemoryBox />
      </div>
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
  const examples = ["typical duration for piping erection", "average slip for civil concrete pour", "productivity of cable pulling", "which activities in U-300 slipped most"];
  return (
    <Card title={<span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-brand-500" />Institutional memory</span>} subtitle="Answers from stored actuals" actions={<SyntheticLabel text="synthetic-data demo" />}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 subtle" />
          <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about historical actuals…" maxLength={300} aria-label="Question" />
        </div>
        <button className="btn-primary" disabled={busy || !q.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ask"}</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1">
        {examples.map((e) => <button key={e} className="chip-neu cursor-pointer hover:opacity-80" onClick={() => { setQ(e); void ask(e); }}>{e}</button>)}
      </div>
      <div className="mt-3"><ErrorBanner error={err} /></div>
      {res && (
        <div className="mt-3 rounded-xl border p-3 text-[13px] leading-5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <p>{res.answer}</p>
          {res.histogram && res.histogram.length > 0 && (
            <div className="mt-3 flex h-16 items-end gap-1" aria-label="Duration histogram">
              {res.histogram.map((h) => {
                const max = Math.max(...res.histogram!.map((x) => x.count), 1);
                return (
                  <div key={h.bin} className="flex flex-1 flex-col items-center gap-1" title={`${h.bin}: ${h.count}`}>
                    <div className="w-full rounded-t" style={{ height: `${(h.count / max) * 44 + 2}px`, background: "var(--series-1)" }} />
                    <span className="text-[9px] muted">{h.bin}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ AI accuracy (benchmark)
function Accuracy({ meta, m, hist, learn, split, setSplit, training, retrain, refresh, onMetaChange }: {
  meta: Meta | null; m: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.metrics>>>>; hist: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.history>>>>;
  learn: ReturnType<typeof useAsync<Awaited<ReturnType<typeof api.learning>>>>; split: "test" | "hard"; setSplit: (s: "test" | "hard") => void;
  training: boolean; retrain: () => Promise<void>; refresh: () => Promise<void>; onMetaChange: () => void;
}) {
  const d = m.data;
  const th = meta?.thresholds.auto_apply ?? d?.auto_apply_threshold ?? 0.8;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-6 muted">
          <SyntheticLabel /> <span className="ml-1">Computed by running the live engine over held-out reports the model never trains on.</span>
          {d && <> Model <b className="text-ink-800 dark:text-ink-100">{d.model_version}</b>, measured {fmtTime(d.computed_at)}.</>}
        </p>
        <div className="flex items-center gap-2">
          <Segmented ariaLabel="Benchmark split" value={split} onChange={setSplit} size="sm" options={[{ value: "test", label: "Test set · 150" }, { value: "hard", label: "Hard set · 40" }]} />
          <button className="btn-ghost btn-sm btn-icon" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>
      <ErrorBanner error={m.error} onRetry={m.reload} />
      {!d ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-16" /></div>)}</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Top-1 accuracy" value={pct(d.top1_accuracy)} tone="brand" sub={`${d.n_planned} planned-work reports`} />
            <Stat label="Top-3 recall" value={pct(d.top3_recall)} sub={`top-5 ${pct(d.top5_recall)}`} />
            <Stat label={`Precision @ ${Math.round(th * 100)}%`} value={pct(d.precision_at_auto)} tone="good" sub="auto-applied links that are right" />
            <Stat label="Coverage" value={pct(d.coverage_auto)} sub={`auto-decided of ${d.n}`} />
            <Stat label="New-work recall" value={pct(d.new_activity_recall)} sub={`${d.n_new} unplanned · precision ${pct(d.new_activity_precision)}`} />
            <Stat label="Extraction" value={pct(d.event_type_accuracy)} sub={`event type · date ${pct(d.date_accuracy)}`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Precision vs coverage" subtitle="Sweep of the auto-apply threshold" actions={<SyntheticLabel />}>
              <PrecisionCoverage curve={d.curve} threshold={th} />
              <p className="mt-2 text-2xs muted">A higher threshold auto-applies fewer updates but more precisely; the rest ask the supervisor or go to review.</p>
            </Card>
            <Card title="Calibration" subtitle="Is 80% confidence right 80% of the time?" actions={<SyntheticLabel />}>
              <Calibration bins={d.calibration} />
              <p className="mt-2 text-2xs muted">Logistic regression + isotonic calibration: points near the diagonal mean confidence behaves like a probability.</p>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title="Confusion by discipline" actions={<SyntheticLabel />}><ConfusionMatrix conf={d.confusion} /></Card>
            <Card title="Decision mix & per-discipline accuracy">
              <DecisionMix decisions={d.decisions} />
              <table className="mt-3 w-full text-xs">
                <thead><tr className="border-b text-left" style={{ borderColor: "var(--border)" }}><th className="table-head py-1.5">Discipline</th><th className="table-head py-1.5 text-right">n</th><th className="table-head py-1.5 text-right">Top-1</th></tr></thead>
                <tbody>{Object.entries(d.per_discipline).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}><td className="py-1.5">{DISC[k]}</td><td className="py-1.5 text-right num">{v.n}</td><td className="py-1.5 text-right num">{pct(v.top1)}</td></tr>
                ))}</tbody>
              </table>
            </Card>
          </div>
        </>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title={<span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-brand-500" />Learning loop</span>}
          subtitle="Accuracy across retrain rounds on the held-out sets"
          actions={<button className="btn-primary btn-sm" onClick={() => void retrain()} disabled={training}>
            {training ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {training ? "Retraining…" : "Retrain with corrections"}</button>}>
          {hist.data?.length ? <LearningChart rows={hist.data} /> : <Skeleton className="h-[260px]" />}
          <p className="mt-2 text-2xs muted">R0 = retrieval-only baseline. R1 = scorer trained on the synthetic TRAIN split. R2+ = retrained with planner / supervisor corrections and learned vocabulary.</p>
          {hist.data && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs num">
                <thead><tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                  {["Round", "Corrections", "Terms", "Top-1 test", "Top-1 hard", "Prec@auto test", "Prec@auto hard", "New recall"].map((h) => <th key={h} className="table-head py-2 pr-3">{h}</th>)}
                </tr></thead>
                <tbody>{hist.data.map((h) => (
                  <tr key={h.version} className={clsx("border-b last:border-0", h.is_active && "font-semibold")} style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pr-3">R{h.round} {h.version}{h.is_active ? " · active" : ""}</td><td className="pr-3">{h.n_corrections}</td><td className="pr-3">{h.n_learned_terms}</td>
                    <td className="pr-3">{pct(h.test.top1_accuracy)}</td><td className="pr-3">{pct(h.hard.top1_accuracy)}</td>
                    <td className="pr-3">{pct(h.test.precision_at_auto)}</td><td className="pr-3">{pct(h.hard.precision_at_auto)}</td><td>{pct(h.test.new_activity_recall)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Corrections & learned vocabulary">
            {learn.data ? (
              <>
                <p className="text-[13px]"><b>{learn.data.corrections}</b> correction(s) stored · <b>{learn.data.pending_corrections}</b> not yet trained on</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(learn.data.learned_lexicon).length === 0 ? <span className="text-2xs muted">No learned terms yet - they appear when corrections repeatedly tie an unknown word to one phase.</span>
                    : Object.entries(learn.data.learned_lexicon).map(([w, p]) => <span key={w} className="badge-brand">{w} → {p}</span>)}
                </div>
                <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto text-xs">
                  {learn.data.recent.slice(0, 8).map((c) => <li key={c.id} className="flex gap-2"><span className="badge-neutral shrink-0">{c.kind}</span><span className="truncate" title={c.text}>{c.text}</span></li>)}
                </ul>
              </>
            ) : <LoadingBlock />}
          </Card>
          {meta && <ThresholdEditor t={meta.thresholds} onSaved={() => { onMetaChange(); void refresh(); }} />}
        </div>
      </div>
      {d && (
        <Card title={`Where it goes wrong · ${split} set`} actions={<SyntheticLabel />} pad={false}
          footer="Includes safe-but-not-ideal outcomes (e.g. sent to review). A wrong top-1 that went to review is caught by the planner, not auto-applied.">
          {d.errors.length === 0 ? <EmptyState title="No errors on this split" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead><tr className="border-y text-left" style={{ borderColor: "var(--border)" }}>{["Report", "Truth", "Top-1", "Conf.", "Decision"].map((h) => <th key={h} className="table-head px-4 py-2">{h}</th>)}</tr></thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>{d.errors.map((e) => (
                  <tr key={e.report_id}><td className="px-4 py-2"><span className="text-2xs muted">{e.report_id}</span> {e.text}</td><td className="px-4 py-2 font-mono text-xs">{e.truth}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.predicted ?? "-"}</td><td className="px-4 py-2 num">{pct(e.confidence, 0)}</td><td className="px-4 py-2 text-xs">{e.decision}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
