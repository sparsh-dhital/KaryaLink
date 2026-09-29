import clsx from "clsx";
import { useMemo, useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, ComposedChart, Tooltip,
  XAxis, YAxis, Bar, BarChart,
} from "recharts";
import { DISC, DISC_COLOR, DISC_ORDER, fmtDate } from "../lib/format";
import type { GanttRow, HistoryRow, Metrics } from "../types";

const axis = { stroke: "var(--chart-axis)", tick: { fill: "var(--chart-muted)", fontSize: 11 }, tickLine: false };
const grid = <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />;
const tip = {
  contentStyle: { background: "var(--chart-surface)", border: "1px solid var(--chart-grid)", borderRadius: 8, fontSize: 12, color: "var(--chart-ink)" },
  labelStyle: { color: "var(--chart-ink)", fontWeight: 600 },
  cursor: { stroke: "var(--chart-axis)", strokeWidth: 1 },
};
const pctTick = (v: number) => `${Math.round(v)}%`;
const fracTick = (v: number) => `${Math.round(v * 100)}%`;

// ------------------------------------------------------------------ S-curve
export function SCurve({ data, today }: { data: { date: string; planned: number; actual?: number }[]; today: string }) {
  const last = [...data].reverse().find((d) => d.actual !== undefined);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 64, left: -8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => fmtDate(d).slice(3)} minTickGap={40} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={pctTick} width={48} />
        <Tooltip {...tip} labelFormatter={(d: string) => `Week of ${fmtDate(d)}`} formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, n]} />
        <Legend verticalAlign="top" height={24} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine x={data.find((d) => d.date >= today)?.date} stroke="var(--chart-muted)" strokeDasharray="3 3"
          label={{ value: "data date", position: "insideTopLeft", fill: "var(--chart-muted)", fontSize: 11 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="planned" name="Planned" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} />
        <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual (earned)" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
        {last && (
          <ReferenceDot x={last.date} y={last.actual} r={4} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2}
            label={{ value: `${last.actual?.toFixed(1)}%`, position: "right", fill: "var(--chart-ink)", fontSize: 12, fontWeight: 600 }} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ discipline bullet bars (HTML)
export function DisciplineBars({ data, onPick, active }: {
  data: Record<string, { actual_pct: number; planned_pct: number; activities: number }>; onPick?: (d: string) => void; active?: string;
}) {
  return (
    <ul className="space-y-2.5">
      {DISC_ORDER.filter((d) => data[d]).map((d) => {
        const r = data[d];
        const gap = r.actual_pct - r.planned_pct;
        return (
          <li key={d}>
            <button className={clsx("w-full rounded-md px-1 py-0.5 text-left", active === d && "bg-ink-100 dark:bg-ink-800")} onClick={() => onPick?.(d)}
              title={`${DISC[d]}: actual ${r.actual_pct}% vs planned ${r.planned_pct}% (${r.activities} activities)`}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: DISC_COLOR[d] }} />{DISC[d]}</span>
                <span className="tabular-nums muted">
                  <span className="font-semibold text-ink-800 dark:text-ink-100">{r.actual_pct.toFixed(1)}%</span> / plan {r.planned_pct.toFixed(1)}%
                  <span className={clsx("ml-1.5", gap < -5 ? "text-rose-600 dark:text-rose-400" : "muted")}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}</span>
                </span>
              </div>
              <div className="relative h-2.5 rounded bg-ink-100 dark:bg-ink-800">
                <div className="h-full rounded" style={{ width: `${r.actual_pct}%`, background: DISC_COLOR[d] }} />
                <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink-900 dark:bg-white" style={{ left: `calc(${r.planned_pct}% - 1px)` }} />
              </div>
            </button>
          </li>
        );
      })}
      <li className="flex items-center gap-3 pt-1 text-[11px] muted"><span className="inline-block h-2.5 w-6 rounded bg-ink-400" /> actual earned % <span className="inline-block h-3 w-0.5 bg-ink-900 dark:bg-white" /> planned % today</li>
    </ul>
  );
}

// ------------------------------------------------------------------ Gantt (custom SVG)
export function Gantt({ rows, today }: { rows: GanttRow[]; today: string }) {
  const [hover, setHover] = useState<{ r: GanttRow; x: number; y: number } | null>(null);
  const { start, end } = useMemo(() => {
    const ds = rows.flatMap((r) => [r.planned_start, r.planned_finish, r.actual_start ?? r.planned_start, r.actual_finish ?? today]);
    const s = ds.reduce((a, b) => (a < b ? a : b), today);
    const e = ds.reduce((a, b) => (a > b ? a : b), today);
    return { start: new Date(s + "T00:00:00").getTime(), end: new Date(e + "T00:00:00").getTime() + 86400000 };
  }, [rows, today]);
  if (!rows.length) return null;
  const labelW = 230, rowH = 22, W = 1000, chartW = W - labelW - 8, H = rows.length * rowH + 28;
  const x = (d: string) => labelW + ((new Date(d + "T00:00:00").getTime() - start) / (end - start)) * chartW;
  const months: { x: number; label: string }[] = [];
  const m = new Date(start);
  m.setDate(1);
  while (m.getTime() < end) {
    const iso = m.toISOString().slice(0, 10);
    if (m.getTime() >= start) months.push({ x: x(iso), label: m.toLocaleDateString("en-IN", { month: "short" }) });
    m.setMonth(m.getMonth() + 1);
  }
  return (
    <div className="relative">
      <div className="scrollbar-thin max-h-[520px] overflow-auto rounded-lg border border-ink-100 dark:border-ink-800">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[760px]" role="img" aria-label="Plan versus actual Gantt chart">
          {months.map((mm) => (
            <g key={mm.x}>
              <line x1={mm.x} x2={mm.x} y1={18} y2={H} stroke="var(--chart-grid)" />
              <text x={mm.x + 3} y={12} fontSize={10} fill="var(--chart-muted)">{mm.label}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = 22 + i * rowH;
            const ps = x(r.planned_start), pf = x(r.planned_finish) + chartW / ((end - start) / 86400000);
            const as = r.actual_start ? x(r.actual_start) : null;
            const af = r.actual_finish ? x(r.actual_finish) + chartW / ((end - start) / 86400000) : as !== null ? x(today) : null;
            const color = DISC_COLOR[r.discipline];
            return (
              <g key={r.activity_id} onMouseEnter={(e) => setHover({ r, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={y - 2} width={W} height={rowH} fill="transparent" />
                {i % 2 === 0 && <rect x={labelW} y={y - 2} width={chartW} height={rowH} fill="var(--chart-grid)" opacity={0.25} />}
                <text x={4} y={y + 12} fontSize={11} fill="var(--chart-ink)">
                  {r.flag && <tspan fill={r.flag === "red" ? "var(--status-critical)" : "var(--status-warning)"}>{r.flag === "red" ? "▲ " : "● "}</tspan>}
                  {r.name.length > 34 ? r.name.slice(0, 33) + "…" : r.name}
                </text>
                <rect x={ps} y={y + 2} width={Math.max(2, pf - ps)} height={7} rx={2} fill="none" stroke="var(--chart-muted)" strokeWidth={1.2} />
                {as !== null && af !== null && (
                  <rect x={as} y={y + 10} width={Math.max(3, af - as)} height={7} rx={2} fill={color}
                    opacity={r.actual_finish ? 1 : 0.85} />
                )}
              </g>
            );
          })}
          <line x1={x(today)} x2={x(today)} y1={16} y2={H} stroke="var(--status-critical)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={x(today) + 4} y={H - 4} fontSize={10} fill="var(--status-critical)">data date</text>
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] muted">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-6 rounded-sm border border-ink-400" /> planned</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-6 rounded-sm bg-ink-400" /> actual (colour = discipline)</span>
        <span><span style={{ color: "var(--status-critical)" }}>▲</span> red delay flag</span>
        <span><span style={{ color: "var(--status-warning)" }}>●</span> amber delay flag</span>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-50 card px-3 py-2 text-xs" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <p className="font-semibold">{hover.r.name}</p>
          <p className="muted">{hover.r.activity_id} · {DISC[hover.r.discipline]} · {hover.r.area}</p>
          <p>Plan {fmtDate(hover.r.planned_start)} → {fmtDate(hover.r.planned_finish)} ({hover.r.planned_pct}% planned today)</p>
          <p>Actual {hover.r.actual_start ? fmtDate(hover.r.actual_start) : "not started"} → {hover.r.actual_finish ? fmtDate(hover.r.actual_finish) : "…"} · <b>{hover.r.pct.toFixed(0)}%</b></p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ evaluation charts
export function PrecisionCoverage({ curve, threshold }: { curve: Metrics["curve"]; threshold: number }) {
  const pts = curve.filter((c) => c.precision !== null).map((c) => ({ ...c, precision: c.precision as number }));
  const cur = pts.reduce((best, p) => (Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best), pts[0]);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={[...pts].sort((a, b) => a.coverage - b.coverage)} margin={{ top: 10, right: 20, left: -8, bottom: 14 }}>
        {grid}
        <XAxis dataKey="coverage" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick}
          label={{ value: "coverage (share of reports auto-decided)", position: "insideBottom", offset: -8, fill: "var(--chart-muted)", fontSize: 11 }} />
        <YAxis domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin * 10) / 10), 1]} {...axis} tickFormatter={fracTick} width={48} />
        <Tooltip {...tip} labelFormatter={(v: number) => `coverage ${fracTick(v)}`}
          formatter={(v: number, _n, p) => [`${(v * 100).toFixed(1)}% precision at threshold ${(p.payload as { threshold: number }).threshold.toFixed(2)}`, ""]} />
        <Line isAnimationActive={false} type="stepAfter" dataKey="precision" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        {cur && <ReferenceDot x={cur.coverage} y={cur.precision} r={5} fill="var(--series-2)" stroke="var(--chart-surface)" strokeWidth={2}
          label={{ value: `threshold ${threshold.toFixed(2)}`, position: "top", fill: "var(--chart-ink)", fontSize: 11 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Calibration({ bins }: { bins: Metrics["calibration"] }) {
  const data = bins.map((b) => ({ x: b.mean_conf, y: b.accuracy, n: b.n, bin: b.bin }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 10, right: 20, left: -8, bottom: 14 }}>
        {grid}
        <XAxis dataKey="x" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick}
          label={{ value: "predicted confidence", position: "insideBottom", offset: -8, fill: "var(--chart-muted)", fontSize: 11 }} />
        <YAxis dataKey="y" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick} width={48} />
        <Tooltip {...tip} labelFormatter={() => ""}
          formatter={(v: number, n: string, p) => [`${(v * 100).toFixed(1)}%`, n === "y" ? `observed accuracy (n=${(p.payload as { n: number }).n})` : "mean confidence"]} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--chart-muted)" strokeDasharray="4 4"
          label={{ value: "perfect calibration", position: "insideTopLeft", fill: "var(--chart-muted)", fontSize: 10 }} />
        <Scatter isAnimationActive={false} dataKey="y" fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} shape="circle" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LearningChart({ rows }: { rows: HistoryRow[] }) {
  const data = rows.map((r) => ({
    label: r.round === 0 ? "R0 baseline" : `R${r.round} ${r.version}`,
    t1: r.test.top1_accuracy, h1: r.hard.top1_accuracy, tp: r.test.precision_at_auto, hp: r.hard.precision_at_auto,
    corr: r.n_corrections,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: -8, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" {...axis} />
        <YAxis domain={[(m: number) => Math.max(0, Math.floor(m * 10) / 10 - 0.05), 1]} {...axis} tickFormatter={fracTick} width={48} />
        <Tooltip {...tip} formatter={(v, n) => [typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "-", String(n)]}
          labelFormatter={(l: string, p) => `${l} · ${p?.[0]?.payload?.corr ?? 0} corrections`} />
        <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={false} dataKey="t1" name="Top-1 · test" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="tp" name="Precision@auto · test" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="h1" name="Top-1 · hard" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="hp" name="Precision@auto · hard" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DecisionMix({ decisions }: { decisions: Record<string, number> }) {
  const labels: Record<string, string> = { AUTO_APPLY: "Auto-apply", CLARIFY: "Clarify", REVIEW: "Review", CONFIRM_SEQUENCE: "Seq. check", NEW_ACTIVITY: "New activity" };
  const data = Object.entries(decisions).map(([k, v]) => ({ k: labels[k] ?? k, v }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 20, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="k" {...axis} width={86} axisLine={false} />
        <Tooltip {...tip} cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }} formatter={(v: number) => [v, "reports"]} />
        <Bar isAnimationActive={false} dataKey="v" fill="var(--series-1)" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "var(--chart-ink)", fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const SEQ = ["#f4f8fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

export function ConfusionMatrix({ conf }: { conf: Metrics["confusion"] }) {
  const keys = ["CIV", "PIP", "ELE", "INS", "MEC", "HSE", "NEW"].filter((k) => Object.values(conf[k] ?? {}).some((v) => v > 0) || Object.values(conf).some((r) => (r[k] ?? 0) > 0));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs tabular-nums">
        <thead>
          <tr>
            <th className="p-1 text-left font-normal muted">truth ↓ / predicted →</th>
            {keys.map((k) => <th key={k} className="w-12 p-1 text-center font-semibold">{k}</th>)}
          </tr>
        </thead>
        <tbody>
          {keys.map((t) => {
            const row = conf[t] ?? {};
            const tot = Object.values(row).reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={t}>
                <th className="p-1 text-left font-semibold">{t === "NEW" ? "NEW (unplanned)" : DISC[t]}</th>
                {keys.map((p) => {
                  const v = row[p] ?? 0;
                  const share = v / tot;
                  const step = v === 0 ? 0 : Math.min(SEQ.length - 1, 1 + Math.floor(share * (SEQ.length - 1)));
                  return (
                    <td key={p} className="p-0.5" title={`truth ${t}, predicted ${p}: ${v} (${(share * 100).toFixed(0)}% of row)`}>
                      <div className={clsx("flex h-9 items-center justify-center rounded", t === p && "ring-1 ring-ink-900/30 dark:ring-white/40")}
                        style={{ background: SEQ[step], color: step >= 4 ? "#fff" : "#0b0b0b" }}>{v || ""}</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] muted">Cell shade = share of the truth row (single-hue sequential scale). Diagonal = correct discipline.</p>
    </div>
  );
}
