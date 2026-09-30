import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FlaskConical, Info, Loader2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DECISION_LABEL, STATUS_LABEL } from "../lib/format";
import type { DecisionKind, Reason, Span } from "../types";

// ------------------------------------------------------------------ layout primitives
export function PageHeader({ eyebrow, title, description, actions, badge }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[22px] font-semibold leading-7 text-ink-900 dark:text-white">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1.5 max-w-3xl text-[13px] leading-5 muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true, footer }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; footer?: ReactNode;
}) {
  return (
    <section className={clsx("card flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold text-ink-900 dark:text-ink-50">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("min-w-0 flex-1", pad && "px-5 pb-5", pad && !(title || actions) && "pt-5")}>{children}</div>
      {footer && <footer className="border-t divider px-5 py-3 text-xs muted">{footer}</footer>}
    </section>
  );
}

export function Stat({ label, value, sub, tone = "default", icon, trend }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "brand"; icon?: ReactNode; trend?: ReactNode;
}) {
  const toneCls = {
    default: "text-ink-900 dark:text-white", good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400", bad: "text-rose-600 dark:text-rose-400", brand: "text-brand-600 dark:text-brand-400",
  }[tone];
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium muted">{label}</span>
        {icon && <span className="text-ink-400 dark:text-ink-500">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={clsx("text-[26px] font-semibold leading-8 tracking-tight num", toneCls)}>{value}</span>
        {trend}
      </div>
      {sub && <div className="mt-0.5 truncate text-xs muted">{sub}</div>}
    </div>
  );
}
/** @deprecated alias kept for older imports */
export const Kpi = Stat;

export function Segmented<T extends string>({ value, onChange, options, size = "md", ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; size?: "sm" | "md"; ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-lg bg-ink-100 p-0.5 dark:bg-ink-850">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={clsx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-white text-ink-900 shadow-xs dark:bg-ink-700 dark:text-white" : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100")}>
          {o.label}
          {o.count !== undefined && <span className={clsx("num rounded px-1 text-2xs", value === o.value ? "bg-ink-100 dark:bg-ink-600" : "bg-ink-200/70 dark:bg-ink-800")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={clsx("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />)}
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-2 text-[13px] muted", className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 text-ink-400 dark:bg-ink-850 dark:text-ink-500">
        {icon ?? <Info className="h-5 w-5" />}
      </div>
      <p className="text-[13px] font-semibold text-ink-800 dark:text-ink-100">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs leading-5 muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children, action, icon }: {
  tone?: "info" | "warn" | "error" | "success"; children: ReactNode; action?: ReactNode; icon?: ReactNode;
}) {
  const cls = {
    info: "border-brand-200 bg-brand-50 text-brand-900 dark:border-brand-500/25 dark:bg-brand-500/10 dark:text-brand-100",
    warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100",
    error: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100",
  }[tone];
  const Icon = { info: Info, warn: AlertTriangle, error: XCircle, success: CheckCircle2 }[tone];
  return (
    <div className={clsx("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-5", cls)} role={tone === "error" ? "alert" : "status"}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <Alert tone="error" action={onRetry && <button className="btn-ghost btn-xs" onClick={onRetry}>Retry</button>}>{msg}</Alert>;
}

export function SyntheticLabel({ text = "synthetic benchmark" }: { text?: string }) {
  return <span className="synthetic"><FlaskConical className="h-3 w-3" />{text}</span>;
}

export function ProgressBar({ value, marker, tone = "brand", size = "md", color }: {
  value: number; marker?: number; tone?: "brand" | "good" | "warn" | "bad" | "neutral"; size?: "sm" | "md"; color?: string;
}) {
  const fill = { brand: "bg-brand-500", good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500", neutral: "bg-ink-400" }[tone];
  return (
    <div className={clsx("relative w-full rounded-full bg-ink-100 dark:bg-ink-800", size === "sm" ? "h-1.5" : "h-2")}>
      <div className={clsx("h-full rounded-full transition-[width] duration-500", !color && fill)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      {marker !== undefined && (
        <div className="absolute -top-[3px] h-[calc(100%+6px)] w-[2px] rounded-full bg-ink-800 dark:bg-white" style={{ left: `calc(${Math.min(100, marker)}% - 1px)` }} />
      )}
    </div>
  );
}

export function ConfidenceBar({ value, threshold, compact }: { value: number; threshold?: number; compact?: boolean }) {
  const tone = value >= (threshold ?? 0.8) ? "good" : value >= 0.3 ? "warn" : "bad";
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1"><ProgressBar value={value * 100} marker={threshold !== undefined ? threshold * 100 : undefined} tone={tone} size={compact ? "sm" : "md"} /></div>
      <span className={clsx("w-9 text-right text-xs font-semibold num", compact && "text-2xs")}>{Math.round(value * 100)}%</span>
    </div>
  );
}

const DEC_CLS: Record<DecisionKind, string> = {
  AUTO_APPLY: "badge-success", CLARIFY: "badge-brand", REVIEW: "badge-warning", CONFIRM_SEQUENCE: "badge-warning", NEW_ACTIVITY: "badge-neutral",
};
const DEC_DOT: Record<DecisionKind, string> = {
  AUTO_APPLY: "bg-emerald-500", CLARIFY: "bg-brand-500", REVIEW: "bg-amber-500", CONFIRM_SEQUENCE: "bg-amber-500", NEW_ACTIVITY: "bg-ink-400",
};

export function DecisionBadge({ kind }: { kind: DecisionKind }) {
  return <span className={DEC_CLS[kind] ?? "badge-neutral"}><span className={clsx("dot", DEC_DOT[kind])} />{DECISION_LABEL[kind] ?? kind}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "applied" || status === "new_activity_created" ? "badge-success"
    : status === "rejected" || status === "reverted" ? "badge-danger" : status.startsWith("awaiting") ? "badge-warning" : "badge-neutral";
  return <span className={cls}>{STATUS_LABEL[status] ?? status}</span>;
}

export function ReasonChips({ reasons, max = 8 }: { reasons: Reason[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.slice(0, max).map((r, i) => (
        <span key={i} className={r.polarity === "+" ? "chip-pos" : r.polarity === "-" ? "chip-neg" : "chip-neu"}>
          <span aria-hidden>{r.polarity === "+" ? "+" : r.polarity === "-" ? "−" : "·"}</span> {r.label}
        </span>
      ))}
    </div>
  );
}

export const EVIDENCE_LEGEND: Record<string, string> = {
  phase: "Phase", status: "Status", tag: "Tag", quantity: "Quantity", date: "Date", area: "Area",
  discipline: "Discipline", new_work_cue: "New-work cue",
};

/** Report text with evidence spans highlighted (overlaps resolved: first span wins). */
export function EvidenceText({ text, spans, className }: { text: string; spans: Span[]; className?: string }) {
  const sorted = [...spans].filter((s) => s.start >= 0 && s.end <= text.length && s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: ReactNode[] = [];
  let pos = 0;
  sorted.forEach((s, i) => {
    if (s.start < pos) return;
    if (s.start > pos) parts.push(text.slice(pos, s.start));
    parts.push(
      <mark key={i} className={clsx("ev", `ev-${s.field}`)} title={`${EVIDENCE_LEGEND[s.field] ?? s.field}: ${String(s.value)}`}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    pos = s.end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <p className={clsx("whitespace-pre-wrap break-words leading-7", className)}>{parts}</p>;
}

export function Modal({ open, onClose, title, description, children, wide }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink-950/40 backdrop-blur-[2px] animate-fadein sm:items-center sm:p-6" onClick={onClose}>
      <div className={clsx("max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl shadow-pop animate-slideup sm:rounded-2xl", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <div>
            <h2 className="text-base font-semibold text-ink-900 dark:text-white">{title}</h2>
            {description && <p className="mt-1 text-[13px] muted">{description}</p>}
          </div>
          <button className="btn-ghost btn-sm btn-icon -mr-2 -mt-1" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="px-6 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts
type Toast = { id: number; tone: "ok" | "warn" | "err" | "info"; text: string };
const ToastCtx = createContext<(tone: Toast["tone"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const t = { id: ++id.current, tone, text };
    setItems((xs) => [...xs.slice(-2), t]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 top-3 z-[80] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-5 sm:top-5 sm:w-[360px]" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] shadow-pop animate-slideup"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            {t.tone === "ok" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
            {t.tone === "warn" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
            {t.tone === "err" && <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
            {t.tone === "info" && <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
            <span className="flex-1 leading-5">{t.text}</span>
            <button className="subtle hover:text-ink-700" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ async data hook
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
