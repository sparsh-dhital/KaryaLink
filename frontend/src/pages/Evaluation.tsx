import clsx from "clsx";
import { GraduationCap, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Calibration, ConfusionMatrix, DecisionMix, LearningChart, PrecisionCoverage } from "../components/charts";
import { Card, EmptyState, ErrorBanner, Kpi, Spinner, SyntheticLabel, useAsync, useToast } from "../components/ui";
import { dataBus, demoRegistry } from "../lib/demo";
import { DISC, fmtTime, pct } from "../lib/format";
import type { Meta, Thresholds } from "../types";

export default function Evaluation({ meta, onMetaChange }: { meta: Meta | null; onMetaChange: () => void }) {
  const [split, setSplit] = useState<"test" | "hard">("test");
  const m = useAsync(() => api.metrics(split), [split]);
  const hist = useAsync(() => api.history(), []);
  const learn = useAsync(() => api.learning(), []);
  const [training, setTraining] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => { m.reload(); hist.reload(); learn.reload(); }, [m.reload, hist.reload, learn.reload]);
  useEffect(() => dataBus.on(() => { learn.reload(); }), [learn.reload]);

  const retrain = useCallback(async () => {
    setTraining(true);
    try {
      const r = await api.retrain();
      toast("ok", `Retrained ${r.version} with ${r.n_corrections} correction(s), ${r.n_learned_terms} learned term(s). Metrics re-measured on held-out sets.`);
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
    async retrain() { await retrainRef.current(); },
    setSplit(s) { setSplit(s); },
    async refresh() { await refresh(); },
  }), [refresh]);

  const d = m.data;
  const th = meta?.thresholds.auto_apply ?? d?.auto_apply_threshold ?? 0.8;
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">Evaluation <SyntheticLabel /></h1>
          <p className="text-sm muted">
            Every number is computed by running the live engine over the held-out synthetic reports (the model never trains on them).
            {d && <> Model <b>{d.model_version}</b>, measured {fmtTime(d.computed_at)}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-200 text-sm font-semibold dark:border-ink-700" role="group" aria-label="Benchmark split">
            {(["test", "hard"] as const).map((s) => (
              <button key={s} onClick={() => setSplit(s)} className={clsx("px-3 py-1.5", split === s ? "bg-brand-600 text-white" : "hover:bg-ink-100 dark:hover:bg-ink-800")}>
                {s === "test" ? "Test set (150)" : "Hard set (40)"}
              </button>
            ))}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => void refresh()} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>
      <ErrorBanner error={m.error} onRetry={m.reload} />
      {!d ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Top-1 accuracy" value={pct(d.top1_accuracy)} sub={`${d.n_planned} planned-work reports`} tone="brand" />
            <Kpi label="Top-3 recall" value={pct(d.top3_recall)} sub={`top-5 ${pct(d.top5_recall)}`} />
            <Kpi label={`Precision @ auto-apply ${Math.round(th * 100)}%`} value={pct(d.precision_at_auto)} sub="of auto-applied links, correct" tone="good" />
            <Kpi label="Coverage (auto-applied)" value={pct(d.coverage_auto)} sub={`of all ${d.n} reports`} />
            <Kpi label="New-activity recall" value={pct(d.new_activity_recall)} sub={`${d.n_new} unplanned-work reports · precision ${pct(d.new_activity_precision)}`} />
            <Kpi label="Extraction" value={pct(d.event_type_accuracy)} sub={`event type · date ${pct(d.date_accuracy)}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Precision vs coverage (sweep of the auto-apply threshold)" actions={<SyntheticLabel />}>
              <PrecisionCoverage curve={d.curve} threshold={th} />
              <p className="text-xs muted">Raising the threshold auto-applies fewer reports but with higher precision; the rest go to clarification or review.</p>
            </Card>
            <Card title="Calibration (is 80% confidence right 80% of the time?)" actions={<SyntheticLabel />}>
              <Calibration bins={d.calibration} />
              <p className="text-xs muted">Logistic-regression scorer with isotonic calibration; points near the diagonal mean confidence behaves like a probability.</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Confusion by discipline" className="lg:col-span-2" actions={<SyntheticLabel />}>
              <ConfusionMatrix conf={d.confusion} />
            </Card>
            <Card title="Decision mix">
              <DecisionMix decisions={d.decisions} />
              <table className="mt-2 w-full text-xs">
                <thead className="table-head"><tr><th className="px-2 py-1">Discipline</th><th className="px-2 py-1 text-right">n</th><th className="px-2 py-1 text-right">Top-1</th></tr></thead>
                <tbody>{Object.entries(d.per_discipline).map(([k, v]) => (
                  <tr key={k} className="border-t border-ink-100 dark:border-ink-800"><td className="px-2 py-1">{DISC[k]}</td><td className="px-2 py-1 text-right tabular-nums">{v.n}</td><td className="px-2 py-1 text-right tabular-nums">{pct(v.top1)}</td></tr>
                ))}</tbody>
              </table>
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><GraduationCap className="h-4 w-4 text-brand-500" /> Learning loop: accuracy across retrain rounds</span>} className="lg:col-span-2"
          actions={<button className="btn-primary btn-sm" onClick={() => void retrain()} disabled={training}>
            {training ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {training ? "Retraining…" : "Retrain with corrections"}</button>}>
          {hist.data?.length ? <LearningChart rows={hist.data} /> : <Spinner />}
          <p className="text-xs muted">R0 = retrieval-only baseline (no trained scorer). R1 = scorer trained on the synthetic TRAIN split. R2+ = retrained with planner / supervisor corrections and learned vocabulary. Held-out sets are never trained on. <SyntheticLabel /></p>
          {hist.data && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="table-head"><tr><th className="px-2 py-1">Round</th><th className="px-2 py-1">Corrections</th><th className="px-2 py-1">Learned terms</th><th className="px-2 py-1 text-right">Top-1 test</th><th className="px-2 py-1 text-right">Top-1 hard</th><th className="px-2 py-1 text-right">Prec@auto test</th><th className="px-2 py-1 text-right">Prec@auto hard</th><th className="px-2 py-1 text-right">New recall test</th></tr></thead>
                <tbody>{hist.data.map((h) => (
                  <tr key={h.version} className={clsx("border-t border-ink-100 dark:border-ink-800", h.is_active && "font-semibold")}>
                    <td className="px-2 py-1">R{h.round} {h.version}{h.is_active ? " (active)" : ""}</td><td className="px-2 py-1">{h.n_corrections}</td><td className="px-2 py-1">{h.n_learned_terms}</td>
                    <td className="px-2 py-1 text-right">{pct(h.test.top1_accuracy)}</td><td className="px-2 py-1 text-right">{pct(h.hard.top1_accuracy)}</td>
                    <td className="px-2 py-1 text-right">{pct(h.test.precision_at_auto)}</td><td className="px-2 py-1 text-right">{pct(h.hard.precision_at_auto)}</td>
                    <td className="px-2 py-1 text-right">{pct(h.test.new_activity_recall)}</td>
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
                <p className="text-sm"><b>{learn.data.corrections}</b> correction(s) stored · <b>{learn.data.pending_corrections}</b> not yet used in training</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(learn.data.learned_lexicon).length === 0 ? <span className="text-xs muted">No learned terms yet - they appear when corrections repeatedly tie an unknown word to one phase.</span>
                    : Object.entries(learn.data.learned_lexicon).map(([w, p]) => <span key={w} className="chip-brand">{w} → {p}</span>)}
                </div>
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {learn.data.recent.slice(0, 8).map((c) => (
                    <li key={c.id} className="truncate" title={c.text}><span className="chip-neu mr-1">{c.kind}</span>{c.text}</li>
                  ))}
                </ul>
              </>
            ) : <Spinner />}
          </Card>
          {meta && <ThresholdEditor t={meta.thresholds} onSaved={() => { onMetaChange(); void refresh(); }} />}
        </div>
      </div>

      {d && (
        <Card title={`Where it goes wrong (${split} set)`} actions={<SyntheticLabel />} pad={false}>
          {d.errors.length === 0 ? <EmptyState title="No errors on this split" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-head"><tr><th className="px-3 py-2">Report</th><th className="px-3 py-2">Truth</th><th className="px-3 py-2">Top-1</th><th className="px-3 py-2 text-right">Conf.</th><th className="px-3 py-2">Decision</th></tr></thead>
                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">{d.errors.map((e) => (
                  <tr key={e.report_id}><td className="px-3 py-2"><span className="text-[11px] muted">{e.report_id}</span> {e.text}</td><td className="px-3 py-2 font-mono text-xs">{e.truth}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.predicted ?? "-"}</td><td className="px-3 py-2 text-right tabular-nums">{pct(e.confidence, 0)}</td><td className="px-3 py-2 text-xs">{e.decision}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="px-3 py-2 text-xs muted">Includes decisions that were safe but not ideal (e.g. sent to review). A wrong top-1 that went to review is caught by the planner, not auto-applied.</p>
        </Card>
      )}
    </div>
  );
}

function ThresholdEditor({ t, onSaved }: { t: Thresholds; onSaved: () => void }) {
  const [v, setV] = useState(t);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  useEffect(() => setV(t), [t]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.setThresholds(v);
      toast("ok", "Thresholds saved; metrics recomputed for the active model");
      onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const row = (k: keyof Thresholds, label: string, min: number, max: number) => (
    <label className="block text-xs">
      <div className="flex justify-between"><span className="muted">{label}</span><span className="font-semibold tabular-nums">{v[k].toFixed(2)}</span></div>
      <input type="range" min={min} max={max} step={0.01} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="w-full accent-brand-600" />
    </label>
  );
  return (
    <Card title={<span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Decision thresholds</span>}>
      <div className="space-y-2">
        {row("auto_apply", "Auto-apply at confidence ≥", 0.4, 0.99)}
        {row("review", "Below this → propose new activity", 0.05, 0.6)}
        {row("margin", "Min gap top-1 vs top-2 to auto-apply", 0, 0.5)}
        {row("clarify_gap", "Ask clarification if top-2 within", 0, 0.5)}
      </div>
      <ErrorBanner error={err} />
      <button className="btn-primary btn-sm mt-3 w-full" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save & re-measure</button>
    </Card>
  );
}
