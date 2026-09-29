import clsx from "clsx";
import { ChevronDown, ChevronRight, Link2, MapPin, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, EmptyState, ErrorBanner, Spinner, useAsync } from "../components/ui";
import { dataBus } from "../lib/demo";
import { fmtTime, shortHash } from "../lib/format";
import type { LedgerItem } from "../types";

const PAGE = 30;
const KIND_TONE: Record<string, string> = {
  DECISION_AUTO_APPLY: "chip-pos", ACTUAL_APPLIED: "chip-pos", PLANNER_APPROVE: "chip-pos", PLANNER_REASSIGN: "chip-brand",
  PLANNER_REJECT: "chip-neg", SEQUENCE_REJECTED: "chip-neg", DECISION_NEW_ACTIVITY: "chip-warn", NEW_ACTIVITY_CREATED: "chip-warn",
  DECISION_CONFIRM_SEQUENCE: "chip-warn", SEQUENCE_CONFIRMED: "chip-warn", MODEL_RETRAINED: "chip-brand", MODEL_TRAINED: "chip-brand",
};

export default function Audit() {
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const list = useAsync(() => api.audit({ limit: PAGE, offset, kind: kind || undefined }), [kind, offset]);
  const ver = useAsync(() => api.verify(), []);
  useEffect(() => dataBus.on(() => { list.reload(); ver.reload(); }), [list.reload, ver.reload]);
  const v = ver.data;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-5">
      <div>
        <h1 className="text-xl font-semibold">Audit trail</h1>
        <p className="text-sm muted">Append-only ledger. Each entry stores the evidence, candidates, scores, decision, approver and model version, and is SHA-256 hash-chained to the previous entry, so any edit or deletion is detectable. (Tamper-evident log - not a blockchain.)</p>
      </div>

      <div className={clsx("card flex flex-wrap items-center gap-3 px-4 py-3", v && (v.ok ? "border-emerald-300 dark:border-emerald-500/40" : "border-rose-400"))}>
        {ver.loading && !v ? <Spinner label="Verifying hash chain…" /> : v ? (
          <>
            {v.ok ? <ShieldCheck className="h-7 w-7 text-emerald-500" /> : <ShieldX className="h-7 w-7 text-rose-500" />}
            <div className="flex-1">
              <p className="font-semibold">{v.ok ? "Hash chain verified" : "Hash chain BROKEN"}</p>
              <p className="text-xs muted">
                {v.ok ? <>All {v.entries} entries recomputed and linked · head <span className="font-mono">{v.head ? shortHash(v.head) : ""}</span></>
                  : <>Entry #{v.broken_at}: {v.reason}</>} · checked {fmtTime(v.checked_at)}
              </p>
            </div>
            <button className="btn-secondary btn-sm" onClick={ver.reload}>Re-verify</button>
          </>
        ) : <ErrorBanner error={ver.error} onRetry={ver.reload} />}
      </div>

      <Card pad={false} title={`Ledger (${list.data?.total ?? "…"} entries)`} actions={
        <select className="select py-1 text-xs" value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); }} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {list.data?.kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      }>
        <ErrorBanner error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? <Spinner className="p-4" /> : !list.data?.items.length ? <EmptyState title="No ledger entries" /> : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {list.data.items.map((e) => <Entry key={e.seq} e={e} />)}
          </ul>
        )}
        {list.data && list.data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-xs dark:border-ink-800">
            <button className="btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</button>
            <span className="muted">{offset + 1}-{Math.min(offset + PAGE, list.data.total)} of {list.data.total}</span>
            <button className="btn-secondary btn-sm" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Older</button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Entry({ e }: { e: LedgerItem }) {
  const [open, setOpen] = useState(false);
  const p = e.payload as Record<string, unknown>;
  const photo = (p.photo as { id: number; sha256: string; lat: number | null; lon: number | null; taken_at: string } | null) ?? null;
  const rep = p.report as { text?: string } | undefined;
  const act = p.activity as { id: string; name: string } | undefined;
  const summary = rep?.text ?? (act ? `${act.name} → ${p.pct_after ?? ""}%` : (p.note as string) ?? (p.version as string) ?? "");
  return (
    <li className="px-4 py-2.5">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 muted" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 muted" />}
        <span className="w-12 shrink-0 font-mono text-xs muted">#{e.seq}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={KIND_TONE[e.kind] ?? "chip-neu"}>{e.kind}</span>
            <span className="text-xs muted">{fmtTime(e.ts)} · {e.actor}{e.report_id ? ` · report #${e.report_id}` : ""}{e.activity_id ? ` · ${e.activity_id}` : ""}</span>
          </div>
          {summary && <p className="mt-0.5 truncate text-sm">{String(summary)}</p>}
        </div>
        {photo && <img src={`/api/photos/${photo.id}`} alt="evidence" className="h-10 w-10 shrink-0 rounded object-cover" />}
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2 text-xs">
          {photo && (
            <div className="flex items-start gap-3 rounded-lg bg-ink-50 p-2 dark:bg-ink-800/60">
              <img src={`/api/photos/${photo.id}`} alt="photo evidence" className="max-h-48 rounded" />
              <div className="space-y-1">
                <p><b>Photo evidence</b> · {fmtTime(photo.taken_at)}</p>
                <p className="font-mono">sha256 {shortHash(photo.sha256)}</p>
                <p>{photo.lat !== null ? <><MapPin className="inline h-3 w-3" /> {photo.lat?.toFixed(5)}, {photo.lon?.toFixed(5)}</> : "no GPS (not permitted)"}</p>
              </div>
            </div>
          )}
          <pre className="scrollbar-thin max-h-72 overflow-auto rounded-lg bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-100">{JSON.stringify(e.payload, null, 2)}</pre>
          <p className="flex flex-wrap items-center gap-1 font-mono muted"><Link2 className="h-3 w-3" /> prev {shortHash(e.prev_hash)} → hash {shortHash(e.hash)}</p>
        </div>
      )}
    </li>
  );
}
