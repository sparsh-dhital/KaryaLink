import clsx from "clsx";
import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { DISC, DISC_COLOR, DISC_ORDER, fmtDate } from "../lib/format";
import type { GanttRow, HistoryRow, Metrics } from "../types";

const axis = { stroke: "var(--chart-axis)", tick: { fill: "var(--chart-muted)", fontSize: 11 }, tickLine: false, axisLine: false };
const grid = <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="0" vertical={false} />;
export const tip = {
  contentStyle: { background: "var(--elevated)", border: "1px solid var(--border-strong)", borderRadius: 10, fontSize: 12,
    color: "var(--chart-ink)", boxShadow: "0 12px 32px -8px rgba(0,0,0,.35)", padding: "8px 10px" },
  labelStyle: { color: "var(--chart-ink)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--chart-muted)", strokeWidth: 1, strokeDasharray: "3 3" },
};
const pctTick = (v: number) => `${Math.round(v)}%`;
const fracTick = (v: number) => `${Math.round(v * 100)}%`;

// ------------------------------------------------------------------ planned vs actual (S-curve)
export function SCurve({ data, today, height = 280 }: { data: { date: string; planned: number; actual?: number }[]; today: string; height?: number }) {
  const last = [...data].reverse().find((d) => d.actual !== undefined);
  const todayX = data.find((d) => d.date >= today)?.date;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 16, right: 64, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="kl-actual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => fmtDate(d).slice(3)} minTickGap={48} />
        <YAxis {...axis} domain={[0, 100]} tickFormatter={pctTick} width={48} />
        <Tooltip {...tip} labelFormatter={(d: string) => `Week of ${fmtDate(d)}`}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { planned: number; actual?: number };
            const gap = p.actual !== undefined ? p.actual - p.planned : null;
            return (
              <div style={tip.contentStyle}>
                <div style={tip.labelStyle}>Week of {fmtDate(String(label))}</div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: "var(--series-1)" }} />Actual <b className="ml-auto pl-4 num">{p.actual !== undefined ? `${p.actual.toFixed(1)}%` : "-"}</b></div>
                <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded border-t border-dashed" style={{ borderColor: "var(--chart-muted)" }} />Planned <b className="ml-auto pl-4 num">{p.planned.toFixed(1)}%</b></div>
                {gap !== null && <div className={clsx("mt-1 border-t pt-1 font-semibold num", gap < -5 ? "text-rose-500" : "text-emerald-500")} style={{ borderColor: "var(--border)" }}>Variance {gap >= 0 ? "+" : ""}{gap.toFixed(1)} pts</div>}
              </div>
            );
          }} />
        {todayX && <ReferenceLine x={todayX} stroke="var(--chart-muted)" strokeDasharray="3 3"
          label={{ value: "data date", position: "insideTopLeft", fill: "var(--chart-muted)", fontSize: 11 }} />}
        <Area isAnimationActive={false} type="monotone" dataKey="planned" name="Planned" stroke="var(--chart-muted)" strokeWidth={1.75} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 3.5 }} />
        <Area isAnimationActive={false} type="monotone" dataKey="actual" name="Actual (earned)" stroke="var(--series-1)" strokeWidth={2.25} fill="url(#kl-actual)" dot={false}
          activeDot={{ r: 4.5, stroke: "var(--chart-surface)", strokeWidth: 2 }} connectNulls={false} />
        {last && (
          <ReferenceDot x={last.date} y={last.actual} r={4.5} fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2}
            label={{ value: `${last.actual?.toFixed(1)}%`, position: "right", fill: "var(--chart-ink)", fontSize: 12, fontWeight: 600 }} />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ discipline bullet bars (HTML)
export function DisciplineBars({ data, onPick, active }: {
  data: Record<string, { actual_pct: number; planned_pct: number; activities: number }>; onPick?: (d: string) => void; active?: string;
}) {
  return (
    <ul className="space-y-3">
      {DISC_ORDER.filter((d) => data[d]).map((d) => {
        const r = data[d];
        const gap = r.actual_pct - r.planned_pct;
        return (
          <li key={d}>
            <button className={clsx("w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--hover)]", active === d && "bg-[var(--hover)]")} onClick={() => onPick?.(d)}
              title={`${DISC[d]}: actual ${r.actual_pct}% vs planned ${r.planned_pct}% (${r.activities} activities)`} aria-pressed={active === d}>
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="flex items-center gap-2 font-medium text-ink-800 dark:text-ink-100"><span className="h-2 w-2 rounded-sm" style={{ background: DISC_COLOR[d] }} />{DISC[d]}</span>
                <span className="num muted">
                  <span className="font-semibold text-ink-900 dark:text-white">{r.actual_pct.toFixed(1)}%</span> / {r.planned_pct.toFixed(1)}%
                  <span className={clsx("ml-2 font-semibold", gap < -5 ? "text-rose-500" : "text-emerald-500")}>{gap >= 0 ? "+" : ""}{gap.toFixed(1)}</span>
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-ink-100 dark:bg-ink-800">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${r.actual_pct}%`, background: DISC_COLOR[d] }} />
                <div className="absolute -top-[3px] h-[14px] w-[2px] rounded-full bg-ink-800 dark:bg-white" style={{ left: `calc(${r.planned_pct}% - 1px)` }} />
              </div>
            </button>
          </li>
        );
      })}
      <li className="flex items-center gap-4 px-2 pt-1 text-2xs muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-full bg-ink-400" /> actual (earned)</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-[2px] rounded bg-ink-800 dark:bg-white" /> planned today</span>
      </li>
    </ul>
  );
}

// ------------------------------------------------------------------ Gantt (custom SVG)
export function Gantt({ rows, today, onPick, highlight }: { rows: GanttRow[]; today: string; onPick?: (id: string) => void; highlight?: string | null }) {
  const [hover, setHover] = useState<{ r: GanttRow; x: number; y: number } | null>(null);
  const { start, end } = useMemo(() => {
    const ds = rows.flatMap((r) => [r.planned_start, r.planned_finish, r.actual_start ?? r.planned_start, r.actual_finish ?? today]);
    const s = ds.reduce((a, b) => (a < b ? a : b), today);
    const e = ds.reduce((a, b) => (a > b ? a : b), today);
    return { start: new Date(s + "T00:00:00").getTime(), end: new Date(e + "T00:00:00").getTime() + 86400000 };
  }, [rows, today]);
  if (!rows.length) return null;
  const labelW = 250, rowH = 26, W = 1040, chartW = W - labelW - 12, H = rows.length * rowH + 30;
  const day = chartW / ((end - start) / 86400000);
  const x = (d: string) => labelW + ((new Date(d + "T00:00:00").getTime() - start) / (end - start)) * chartW;
  const months: { x: number; label: string }[] = [];
  const m = new Date(start);
  m.setDate(1);
  while (m.getTime() < end) {
    if (m.getTime() >= start) months.push({ x: labelW + ((m.getTime() - start) / (end - start)) * chartW, label: m.toLocaleDateString("en-IN", { month: "short" }) });
    m.setMonth(m.getMonth() + 1);
  }
  return (
    <div className="relative">
      <div className="max-h-[560px] overflow-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[780px]" role="img" aria-label="Plan versus actual timeline">
          {months.map((mm) => (
            <g key={mm.x}>
              <line x1={mm.x} x2={mm.x} y1={20} y2={H} stroke="var(--chart-grid)" />
              <text x={mm.x + 4} y={14} fontSize={10.5} fill="var(--chart-muted)">{mm.label}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = 24 + i * rowH;
            const ps = x(r.planned_start), pf = x(r.planned_finish) + day;
            const as = r.actual_start ? x(r.actual_start) : null;
            const af = r.actual_finish ? x(r.actual_finish) + day : as !== null ? x(today) : null;
            const hl = highlight === r.activity_id;
            return (
              <g key={r.activity_id} className={clsx(onPick && "cursor-pointer")} onClick={() => onPick?.(r.activity_id)}
                onMouseEnter={(e) => setHover({ r, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setHover({ r, x: e.clientX, y: e.clientY })} onMouseLeave={() => setHover(null)}>
                <rect x={0} y={y - 3} width={W} height={rowH} fill={hl ? "rgba(117,101,243,.14)" : hover?.r.activity_id === r.activity_id ? "var(--hover)" : "transparent"} />
                <text x={12} y={y + 13} fontSize={11.5} fill="var(--chart-ink)" fontWeight={hl ? 600 : 400}>
                  {r.flag && <tspan fill={r.flag === "red" ? "var(--status-critical)" : "var(--status-warning)"}>{r.flag === "red" ? "▲ " : "● "}</tspan>}
                  {r.name.length > 36 ? r.name.slice(0, 35) + "…" : r.name}
                </text>
                <rect x={ps} y={y + 2} width={Math.max(3, pf - ps)} height={7} rx={3.5} fill="var(--chart-grid)" stroke="var(--chart-axis)" strokeWidth={1} />
                {as !== null && af !== null && (
                  <rect x={as} y={y + 11} width={Math.max(4, af - as)} height={7} rx={3.5} fill={DISC_COLOR[r.discipline]} opacity={r.actual_finish ? 1 : 0.85} />
                )}
              </g>
            );
          })}
          <line x1={x(today)} x2={x(today)} y1={18} y2={H} stroke="var(--status-critical)" strokeWidth={1.25} strokeDasharray="4 3" />
          <text x={x(today) + 4} y={H - 5} fontSize={10} fill="var(--status-critical)">data date</text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-2xs muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded-full border" style={{ background: "var(--chart-grid)", borderColor: "var(--chart-axis)" }} /> planned</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded-full bg-ink-400" /> actual (colour = discipline)</span>
        <span><span style={{ color: "var(--status-critical)" }}>▲</span> red flag</span>
        <span><span style={{ color: "var(--status-warning)" }}>●</span> amber flag</span>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-50 rounded-xl px-3 py-2 text-xs shadow-pop" style={{ left: hover.x + 14, top: hover.y + 14, background: "var(--elevated)", border: "1px solid var(--border-strong)" }}>
          <p className="font-semibold">{hover.r.name}</p>
          <p className="muted">{hover.r.activity_id} · {DISC[hover.r.discipline]} · {hover.r.area}</p>
          <p className="mt-1">Plan {fmtDate(hover.r.planned_start)} → {fmtDate(hover.r.planned_finish)} <span className="muted">({hover.r.planned_pct}% planned today)</span></p>
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
      <LineChart data={[...pts].sort((a, b) => a.coverage - b.coverage)} margin={{ top: 26, right: 24, left: -8, bottom: 16 }}>
        {grid}
        <XAxis dataKey="coverage" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick}
          label={{ value: "coverage (share of reports auto-decided)", position: "insideBottom", offset: -10, fill: "var(--chart-muted)", fontSize: 11 }} />
        <YAxis domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin * 10) / 10), 1]} {...axis} tickFormatter={fracTick} width={48} />
        <Tooltip {...tip} labelFormatter={(v: number) => `coverage ${fracTick(v)}`}
          formatter={(v: number, _n, p) => [`${(v * 100).toFixed(1)}% at threshold ${(p.payload as { threshold: number }).threshold.toFixed(2)}`, "precision"]} />
        <Line isAnimationActive={false} type="stepAfter" dataKey="precision" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        {cur && <ReferenceDot x={cur.coverage} y={cur.precision} r={5} fill="var(--series-2)" stroke="var(--chart-surface)" strokeWidth={2}
          label={{ value: `threshold ${threshold.toFixed(2)}`, position: "left", fill: "var(--chart-ink)", fontSize: 11 }} />}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Calibration({ bins }: { bins: Metrics["calibration"] }) {
  const data = bins.map((b) => ({ x: b.mean_conf, y: b.accuracy, n: b.n, bin: b.bin }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 12, right: 20, left: -8, bottom: 16 }}>
        {grid}
        <XAxis dataKey="x" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick}
          label={{ value: "predicted confidence", position: "insideBottom", offset: -10, fill: "var(--chart-muted)", fontSize: 11 }} />
        <YAxis dataKey="y" type="number" domain={[0, 1]} {...axis} tickFormatter={fracTick} width={48} />
        <Tooltip {...tip} labelFormatter={() => ""}
          formatter={(v: number, n: string, p) => [`${(v * 100).toFixed(1)}%`, n === "y" ? `observed accuracy (n=${(p.payload as { n: number }).n})` : "mean confidence"]} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--chart-muted)" strokeDasharray="4 4"
          label={{ value: "perfect calibration", position: "insideBottomRight", fill: "var(--chart-muted)", fontSize: 10 }} />
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
        <Legend verticalAlign="top" height={30} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line isAnimationActive={false} dataKey="t1" name="Top-1 · test" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="tp" name="Precision@auto · test" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="h1" name="Top-1 · hard" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
        <Line isAnimationActive={false} dataKey="hp" name="Precision@auto · hard" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DecisionMix({ decisions }: { decisions: Record<string, number> }) {
  const labels: Record<string, string> = { AUTO_APPLY: "Auto-linked", CLARIFY: "Clarify", REVIEW: "Review", CONFIRM_SEQUENCE: "Seq. check", NEW_ACTIVITY: "New activity" };
  const data = Object.entries(decisions).map(([k, v]) => ({ k: labels[k] ?? k, v }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 12, bottom: 0 }} barCategoryGap={7}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="k" {...axis} width={86} />
        <Tooltip {...tip} cursor={{ fill: "var(--hover)" }} formatter={(v: number) => [v, "reports"]} />
        <Bar isAnimationActive={false} dataKey="v" fill="var(--series-1)" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "var(--chart-ink)", fontSize: 11 }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Daily site-update volume, split into auto-linked vs needing a human. */
export function UpdateVolume({ data }: { data: { date: string; auto: number; review: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={4}>
        {grid}
        <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => fmtDate(d).slice(0, 6)} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} width={40} />
        <Tooltip {...tip} cursor={{ fill: "var(--hover)" }} labelFormatter={(d: string) => fmtDate(d)} />
        <Legend verticalAlign="top" height={26} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} dataKey="auto" name="Auto-linked" stackId="a" fill="var(--series-1)" />
        <Bar isAnimationActive={false} dataKey="review" name="Asked / reviewed" stackId="a" fill="var(--series-4)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const SEQ_LIGHT = ["#f5f8fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];
const SEQ_DARK = ["#141620", "#12264a", "#16366a", "#1c4c93", "#2562b8", "#3987e5", "#6da7ec"];

export function ConfusionMatrix({ conf }: { conf: Metrics["confusion"] }) {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const SEQ = dark ? SEQ_DARK : SEQ_LIGHT;
  const keys = ["CIV", "PIP", "ELE", "INS", "MEC", "HSE", "NEW"].filter((k) => Object.values(conf[k] ?? {}).some((v) => v > 0) || Object.values(conf).some((r) => (r[k] ?? 0) > 0));
  return (
    <div className="overflow-x-auto">
      <table className="text-xs num">
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
                <th className="whitespace-nowrap p-1 pr-3 text-left font-medium">{t === "NEW" ? "Unplanned" : DISC[t]}</th>
                {keys.map((p) => {
                  const v = row[p] ?? 0;
                  const share = v / tot;
                  const step = v === 0 ? 0 : Math.min(SEQ.length - 1, 1 + Math.floor(share * (SEQ.length - 1)));
                  return (
                    <td key={p} className="p-0.5" title={`truth ${t}, predicted ${p}: ${v} (${(share * 100).toFixed(0)}% of row)`}>
                      <div className={clsx("flex h-9 items-center justify-center rounded-md", t === p && "ring-1 ring-ink-900/25 dark:ring-white/30")}
                        style={{ background: SEQ[step], color: dark ? (step >= 5 ? "#0b0b0b" : "#e6e8ee") : (step >= 4 ? "#fff" : "#0b0b0b") }}>{v || ""}</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-2xs muted">Cell shade = share of the truth row (single-hue sequential scale). Diagonal = correct discipline.</p>
    </div>
  );
}
