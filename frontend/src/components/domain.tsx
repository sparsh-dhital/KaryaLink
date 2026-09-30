// KaryaLink domain components: confidence, unit ("project") cards, site-update feed items, status pills.
import clsx from "clsx";
import { ArrowUpRight, Bot, FileSpreadsheet, FileText, Image as ImageIcon, MessageSquare, Mic, MoonStar, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DISC, PHASE, fmtDate, fmtTime } from "../lib/format";
import type { AreaSummary, DecisionKind, Report } from "../types";
import { ProgressBar } from "./ui";

/** "Ask, don't guess": confidence is always shown with what happens because of it. */
export function ConfidenceIndicator({ value, threshold = 0.8, review = 0.3, showLabel = true, size = "md" }: {
  value: number; threshold?: number; review?: number; showLabel?: boolean; size?: "sm" | "md";
}) {
  const tone = value >= threshold ? "good" : value >= review ? "warn" : "bad";
  const label = value >= threshold ? "High confidence" : value >= review ? "Needs review" : "No confident match";
  const color = { good: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", bad: "text-rose-600 dark:text-rose-400" }[tone];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className={clsx("font-semibold num", size === "sm" ? "text-xs" : "text-sm", color)}>{Math.round(value * 100)}%</span>
        {showLabel && <span className="truncate text-2xs muted">{label}</span>}
      </div>
      <div className="mt-1"><ProgressBar value={value * 100} marker={threshold * 100} tone={tone} size="sm" /></div>
    </div>
  );
}

const STATUS_META: Record<AreaSummary["status"], { label: string; cls: string; dot: string }> = {
  complete: { label: "Complete", cls: "badge-success", dot: "bg-emerald-500" },
  on_track: { label: "On track", cls: "badge-success", dot: "bg-emerald-500" },
  at_risk: { label: "At risk", cls: "badge-warning", dot: "bg-amber-500" },
  behind: { label: "Behind plan", cls: "badge-danger", dot: "bg-rose-500" },
};

export function HealthPill({ status }: { status: AreaSummary["status"] }) {
  const m = STATUS_META[status];
  return <span className={m.cls}><span className={clsx("dot", m.dot)} />{m.label}</span>;
}

export function Variance({ value }: { value: number }) {
  const tone = value >= -3 ? "text-emerald-600 dark:text-emerald-400" : value >= -10 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
  return <span className={clsx("text-xs font-semibold num", tone)}>{value >= 0 ? "+" : ""}{value.toFixed(1)} pts</span>;
}

/** A unit of the facility shown like a portfolio card: actual vs planned, health, exceptions, last update. */
export function UnitCard({ u, onOpen }: { u: AreaSummary; onOpen: () => void }) {
  const exceptions = u.red_flags + u.amber_flags;
  return (
    <button onClick={onOpen} className="card card-hover group flex min-w-[250px] flex-col p-4 text-left sm:min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xs font-medium muted">{u.area}</div>
          <div className="truncate text-[13.5px] font-semibold text-ink-900 dark:text-white">{u.name.replace(`${u.area} `, "")}</div>
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-ink-400 transition group-hover:border-brand-300 group-hover:text-brand-600 dark:group-hover:border-brand-500/40 dark:group-hover:text-brand-300"
          style={{ borderColor: "var(--border)" }}><ArrowUpRight className="h-3.5 w-3.5" /></span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <div className="text-2xs muted">Actual progress</div>
          <div className="text-[28px] font-semibold leading-8 tracking-tight text-ink-900 num dark:text-white">{u.actual_pct.toFixed(1)}<span className="text-base text-ink-400">%</span></div>
        </div>
        <div className="text-right">
          <div className="text-2xs muted">vs plan {u.planned_pct.toFixed(0)}%</div>
          <Variance value={u.variance} />
        </div>
      </div>
      <div className="mt-3"><ProgressBar value={u.actual_pct} marker={u.planned_pct} tone={u.status === "behind" ? "bad" : u.status === "at_risk" ? "warn" : "good"} /></div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 text-2xs muted" style={{ borderColor: "var(--border)" }}>
        <HealthPill status={u.status} />
        {u.current_phase && <span>Now: {PHASE[u.current_phase] ?? u.current_phase}</span>}
        <span className={clsx(exceptions ? "text-rose-600 dark:text-rose-400" : "")}>{exceptions} exception{exceptions === 1 ? "" : "s"}</span>
        <span className="ml-auto">{u.last_update ? `Updated ${fmtDate(u.last_update)}` : "No updates"}</span>
      </div>
    </button>
  );
}

const CHANNEL_ICON: Record<string, ReactNode> = {
  voice: <Mic className="h-3.5 w-3.5" />, chat: <MessageSquare className="h-3.5 w-3.5" />, spreadsheet: <FileSpreadsheet className="h-3.5 w-3.5" />,
  file: <FileText className="h-3.5 w-3.5" />, email: <FileText className="h-3.5 w-3.5" />, chaser: <MoonStar className="h-3.5 w-3.5" />,
};
export const channelIcon = (c: string) => CHANNEL_ICON[c] ?? <MessageSquare className="h-3.5 w-3.5" />;

export const UPDATE_STATE: Record<string, { label: string; cls: string }> = {
  applied: { label: "Schedule updated", cls: "badge-success" },
  awaiting_planner: { label: "Needs review", cls: "badge-warning" },
  awaiting_supervisor: { label: "Awaiting clarification", cls: "badge-brand" },
  new_activity_created: { label: "New activity created", cls: "badge-success" },
  rejected: { label: "Rejected", cls: "badge-danger" },
  reverted: { label: "Undone", cls: "badge-neutral" },
};

export function decisionHeadline(kind: DecisionKind): string {
  return { AUTO_APPLY: "AI linked", CLARIFY: "Asked supervisor", REVIEW: "Suggested match", CONFIRM_SEQUENCE: "Exception detected", NEW_ACTIVITY: "Possible new work" }[kind] ?? kind;
}

/** One site update: what was said, where the AI linked it, how sure it was, what happened. */
export function UpdateItem({ r, threshold, compact, onClick, active }: { r: Report; threshold: number; compact?: boolean; onClick?: () => void; active?: boolean }) {
  const st = UPDATE_STATE[r.status] ?? { label: r.status, cls: "badge-neutral" };
  const target = r.activity_name ?? r.top_candidate?.name;
  const conf = r.decision === "NEW_ACTIVITY" ? (r.top_candidate?.confidence ?? 0) : r.confidence;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={clsx("flex w-full gap-3 text-left", onClick && "rounded-xl px-3 py-3 transition hover:bg-[var(--hover)]",
      active && "bg-brand-50/70 ring-1 ring-brand-200 dark:bg-brand-500/[0.08] dark:ring-brand-500/25")}>
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 pt-0.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border text-ink-500 dark:text-ink-400" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>{channelIcon(r.channel)}</span>
        <span className="text-[10px] muted num">{fmtTime(r.created_at).split(", ").pop()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs muted">
          <span className="font-medium text-ink-700 dark:text-ink-300">{r.reporter}</span>
          {r.reporter_discipline && <span>· {DISC[r.reporter_discipline]}</span>}
          <span>· {r.channel}</span>
          {r.photo_id && <span className="inline-flex items-center gap-1">· <ImageIcon className="h-3 w-3" /> photo</span>}
        </div>
        <p className={clsx("mt-1 text-[13.5px] leading-5 text-ink-900 dark:text-ink-50", compact && "line-clamp-2")}>“{r.text}”</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
            {r.decision === "AUTO_APPLY" ? <Sparkles className="h-3.5 w-3.5 text-brand-500" /> : <Bot className="h-3.5 w-3.5 subtle" />}
            <span className="muted">{decisionHeadline(r.decision)}</span>
            {target && (r.decision === "NEW_ACTIVITY" && r.status !== "applied" && r.status !== "new_activity_created"
              ? <span className="truncate muted">· closest: {target}</span>
              : <span className="truncate font-medium text-ink-800 dark:text-ink-100">→ {target}</span>)}
          </span>
          <span className={st.cls}>{st.label}</span>
        </div>
      </div>
      {!compact && (
        <div className="hidden w-36 shrink-0 sm:block">
          <div className="label mb-1">AI confidence</div>
          <ConfidenceIndicator value={conf} threshold={threshold} size="sm" />
        </div>
      )}
    </Tag>
  );
}

export function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">{children}<ArrowUpRight className="h-3.5 w-3.5" /></Link>;
}

// ------------------------------------------------------------------ traceability chain
const KIND_LABEL: Record<string, { title: string; tone: "brand" | "good" | "warn" | "bad" | "neutral" }> = {
  DECISION_AUTO_APPLY: { title: "AI activity match - auto-linked", tone: "brand" },
  DECISION_REVIEW: { title: "AI activity match - sent for review", tone: "warn" },
  DECISION_CLARIFY: { title: "AI asked a clarifying question", tone: "brand" },
  DECISION_CONFIRM_SEQUENCE: { title: "Sequence exception raised", tone: "warn" },
  DECISION_NEW_ACTIVITY: { title: "Flagged as possible new work", tone: "warn" },
  DECISION_SUPERVISOR_CONFIRMED: { title: "Confirmed by supervisor (end of day)", tone: "good" },
  CLARIFICATION_ANSWERED: { title: "Supervisor answered", tone: "good" },
  CLARIFICATION_UNANSWERED: { title: "Unanswered - moved to planner", tone: "neutral" },
  SEQUENCE_CONFIRMED: { title: "Sequence confirmed", tone: "good" },
  SEQUENCE_REJECTED: { title: "Sequence rejected", tone: "bad" },
  PLANNER_APPROVE: { title: "Planner approved", tone: "good" },
  PLANNER_REASSIGN: { title: "Planner reassigned", tone: "good" },
  PLANNER_REJECT: { title: "Planner rejected", tone: "bad" },
  SUPERVISOR_CORRECTED: { title: "Supervisor corrected the link", tone: "good" },
  NEW_ACTIVITY_CREATED: { title: "New activity created", tone: "good" },
  ACTUAL_APPLIED: { title: "Schedule updated", tone: "good" },
  ACTUAL_REVERTED: { title: "Update undone", tone: "neutral" },
  PHOTO_ATTACHED: { title: "Photo evidence attached", tone: "neutral" },
};
export const kindTitle = (k: string) => KIND_LABEL[k]?.title ?? k.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

interface TraceEntry { seq: number; ts: string; kind: string; actor: string; payload: Record<string, unknown>; hash: string }

function detailFor(e: TraceEntry): string | null {
  const p = e.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (e.kind.startsWith("DECISION_") && Array.isArray(p.candidates) && p.candidates[0]) {
    const c = p.candidates[0];
    return `${c.name} · ${Math.round(c.confidence * 100)}% confidence`;
  }
  if (e.kind === "ACTUAL_APPLIED") return `${p.activity?.name ?? ""}: ${Math.round(p.pct_before ?? 0)}% → ${Math.round(p.pct_after ?? 0)}%${p.rule_of_credit ? ` · ${p.rule_of_credit}` : ""}`;
  if (e.kind === "ACTUAL_REVERTED") return `${p.activity?.name ?? ""}: back to ${Math.round(p.pct_after ?? 0)}%`;
  if (e.kind === "CLARIFICATION_ANSWERED") return `“${p.answer}” to: ${p.question ?? ""}`;
  if (e.kind === "PLANNER_REASSIGN") return `${p.from ?? "-"} → ${p.to}`;
  if (e.kind === "SUPERVISOR_CORRECTED") return `${p.from ?? "-"} → ${p.to}`;
  if (e.kind === "NEW_ACTIVITY_CREATED") return `${p.activity_id} · ${p.name}`;
  if (Array.isArray(p.warnings) && p.warnings[0]) return String(p.warnings[0]);
  return null;
}

export function Trace({ received, entries }: { received?: { ts: string; who: string; channel: string; text: string }; entries: TraceEntry[] }) {
  const tone = (k: string) => KIND_LABEL[k]?.tone ?? "neutral";
  const dot = { brand: "bg-brand-500 ring-brand-500/20", good: "bg-emerald-500 ring-emerald-500/20", warn: "bg-amber-500 ring-amber-500/20", bad: "bg-rose-500 ring-rose-500/20", neutral: "bg-ink-400 ring-ink-400/20" };
  const steps = [
    ...(received ? [{ key: "rx", title: "Site update received", time: received.ts, who: `${received.who} · ${received.channel}`, detail: `“${received.text}”`, t: "neutral" as const, hash: null as string | null }] : []),
    ...entries.map((e) => ({ key: String(e.seq), title: kindTitle(e.kind), time: e.ts, who: e.actor, detail: detailFor(e), t: tone(e.kind), hash: e.hash })),
  ];
  return (
    <ol className="relative">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < steps.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px" style={{ background: "var(--border-strong)" }} />}
          <span className={clsx("relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4", dot[s.t])} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[13px] font-medium text-ink-900 dark:text-ink-50">{s.title}</span>
              <span className="text-2xs muted num">{fmtTime(s.time)}</span>
            </div>
            <div className="text-2xs muted">{s.who}{s.hash && <span className="ml-2 font-mono">#{s.hash.slice(0, 8)}</span>}</div>
            {s.detail && <p className="mt-1 break-words text-xs leading-5 text-ink-600 dark:text-ink-300">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
