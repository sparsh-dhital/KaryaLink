import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FlaskConical, Info, Loader2, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DECISION_LABEL, STATUS_LABEL } from "../lib/format";
import type { DecisionKind, Reason, Span } from "../types";

export function Card({ title, actions, children, className, pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={clsx("card min-w-0", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800 sm:px-5">
          <h2 className="card-title">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(pad && "card-pad")}>{children}</div>
    </section>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-2 text-sm muted", className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="text-ink-300 dark:text-ink-600">{icon ?? <Info className="h-8 w-8" />}</div>
      <p className="text-sm font-medium text-ink-700 dark:text-ink-200">{title}</p>
      {hint && <p className="max-w-sm text-xs muted">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{msg}</span>
      {onRetry && <button className="btn-ghost btn-sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function SyntheticLabel({ text = "synthetic benchmark" }: { text?: string }) {
  return <span className="synthetic"><FlaskConical className="h-3 w-3" />{text}</span>;
}

export function Kpi({ label, value, sub, tone = "default", icon }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "brand"; icon?: ReactNode;
}) {
  const toneCls = {
    default: "text-ink-900 dark:text-ink-50", good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400", bad: "text-rose-600 dark:text-rose-400", brand: "text-brand-600 dark:text-brand-400",
  }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="flex items-center justify-between text-xs font-medium muted">{label}{icon}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs muted">{sub}</div>}
    </div>
  );
}

export function ConfidenceBar({ value, threshold }: { value: number; threshold?: number }) {
  const color = value >= (threshold ?? 0.8) ? "bg-emerald-500" : value >= 0.3 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
        <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${Math.round(value * 100)}%` }} />
        {threshold !== undefined && (
          <div className="absolute top-0 h-full w-px bg-ink-900/50 dark:bg-white/60" style={{ left: `${threshold * 100}%` }}
            title={`auto-apply threshold ${Math.round(threshold * 100)}%`} />
        )}
      </div>
      <span className="w-11 text-right text-xs font-semibold tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

const DEC_CLS: Record<DecisionKind, string> = {
  AUTO_APPLY: "chip-pos", CLARIFY: "chip-brand", REVIEW: "chip-warn", CONFIRM_SEQUENCE: "chip-warn", NEW_ACTIVITY: "chip-neu",
};

export function DecisionBadge({ kind }: { kind: DecisionKind }) {
  return <span className={DEC_CLS[kind] ?? "chip-neu"}>{DECISION_LABEL[kind] ?? kind}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "applied" || status === "new_activity_created" ? "chip-pos"
    : status === "rejected" ? "chip-neg" : status.startsWith("awaiting") ? "chip-warn" : "chip-neu";
  return <span className={cls}>{STATUS_LABEL[status] ?? status}</span>;
}

export function ReasonChips({ reasons, max = 8 }: { reasons: Reason[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.slice(0, max).map((r, i) => (
        <span key={i} className={r.polarity === "+" ? "chip-pos" : r.polarity === "-" ? "chip-neg" : "chip-neu"}>
          {r.polarity === "+" ? "✓" : r.polarity === "-" ? "✗" : "•"} {r.label}
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
  return <p className={clsx("whitespace-pre-wrap break-words leading-relaxed", className)}>{parts}</p>;
}

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className={clsx("card max-h-[90vh] w-full overflow-y-auto animate-slideup rounded-b-none sm:rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-3 dark:border-ink-800 dark:bg-ink-900">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="p-5">{children}</div>
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
    setItems((xs) => [...xs.slice(-3), t]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto card flex items-start gap-2 px-3 py-2.5 text-sm animate-slideup">
            {t.tone === "ok" && <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />}
            {t.tone === "warn" && <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />}
            {t.tone === "err" && <XCircle className="mt-0.5 h-4 w-4 text-rose-500" />}
            {t.tone === "info" && <Info className="mt-0.5 h-4 w-4 text-brand-500" />}
            <span className="flex-1">{t.text}</span>
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
