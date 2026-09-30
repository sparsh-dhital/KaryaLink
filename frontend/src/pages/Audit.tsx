import clsx from "clsx";
import { Link2, MapPin, RefreshCw, ScrollText, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Trace, kindTitle } from "../components/domain";
import { Card, EmptyState, ErrorBanner, LoadingBlock, Modal, PageHeader, useAsync } from "../components/ui";
import { dataBus } from "../lib/demo";
import { fmtTime, shortHash } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { LedgerItem } from "../types";
import { apiUrl } from "../lib/config";

const PAGE_SIZE = 30;
const tone = (k: string) =>
  k.includes("REJECT") || k.includes("REVERT") ? "bg-rose-500" : k === "ACTUAL_APPLIED" || k.includes("APPROVE") || k.includes("CONFIRMED") || k.includes("CREATED") ? "bg-emerald-500"
    : k.startsWith("DECISION_") ? "bg-brand-500" : k.includes("MODEL") || k.includes("IMPORT") ? "bg-sky-500" : "bg-ink-400";

export default function Audit() {
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<LedgerItem | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const list = useAsync(() => api.audit({ limit: PAGE_SIZE, offset, kind: kind || undefined }), [kind, offset]);
  const ver = useAsync(() => api.verify(), []);
  useEffect(() => dataBus.on(() => { list.reload(); ver.reload(); }), [list.reload, ver.reload]);
  useEffect(() => { if (!sel && list.data?.items.length) setSel(list.data.items[0]); }, [list.data, sel]);
  const v = ver.data;

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Governance" title="Audit trail"
        description="An append-only ledger. Every decision stores its evidence, candidates, scores, approver and model version, SHA-256 hash-chained to the entry before it, so any edit or deletion is detectable. A tamper-evident log, not a blockchain." />

      <section className={clsx("card relative mb-4 overflow-hidden p-5", v && (v.ok ? "" : "border-rose-400"))}>
        <div className={clsx("pointer-events-none absolute inset-0", v?.ok ? "bg-[radial-gradient(80%_120%_at_0%_0%,rgba(16,185,129,.12),transparent_55%)]" : "bg-[radial-gradient(80%_120%_at_0%_0%,rgba(244,63,94,.14),transparent_55%)]")} />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          {ver.loading && !v ? <LoadingBlock rows={2} /> : v ? (
            <>
              <span className={clsx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", v.ok ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500")}>
                {v.ok ? <ShieldCheck className="h-6 w-6" /> : <ShieldX className="h-6 w-6" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-ink-900 dark:text-white">{v.ok ? "Hash chain verified" : "Hash chain broken"}</div>
                <div className="mt-0.5 text-xs muted">
                  {v.ok ? <>All <b className="num text-ink-800 dark:text-ink-100">{v.entries}</b> entries recomputed and linked · head <span className="font-mono">{v.head ? shortHash(v.head) : ""}</span></>
                    : <>Entry #{v.broken_at}: {v.reason}</>} · checked {fmtTime(v.checked_at)}
                </div>
              </div>
              <button className="btn-secondary btn-sm" onClick={ver.reload}><RefreshCw className="h-3.5 w-3.5" /> Re-verify</button>
            </>
          ) : <ErrorBanner error={ver.error} onRetry={ver.reload} />}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
        <Card pad={false} title={`Ledger · ${list.data?.total ?? "…"} entries`} subtitle="Newest first"
          actions={
            <select className="select h-8 w-auto text-xs" value={kind} onChange={(e) => { setKind(e.target.value); setOffset(0); setSel(null); }} aria-label="Filter by event">
              <option value="">All events</option>
              {list.data?.kinds.map((k) => <option key={k} value={k}>{kindTitle(k)}</option>)}
            </select>
          }>
          <ErrorBanner error={list.error} onRetry={list.reload} />
          {list.loading && !list.data ? <div className="p-4"><LoadingBlock rows={8} /></div> : !list.data?.items.length ? <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No ledger entries" /> : (
            <ul className="divide-y px-2 pb-2" style={{ borderColor: "var(--border)" }}>
              {list.data.items.map((e) => {
                const p = e.payload as Record<string, unknown>;
                const rep = p.report as { text?: string } | undefined;
                const act = p.activity as { name: string } | undefined;
                const summary = rep?.text ? `“${rep.text}”` : act ? `${act.name}${p.pct_after !== undefined ? ` → ${Math.round(Number(p.pct_after))}%` : ""}` : (p.note as string) ?? (p.version as string) ?? (p.source as string) ?? "";
                const photo = p.photo as { id: number } | null | undefined;
                return (
                  <li key={e.seq}>
                    <button onClick={() => { setSel(e); setMobileOpen(true); }} className={clsx("flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition",
                      sel?.seq === e.seq ? "bg-brand-50/70 ring-1 ring-brand-200 dark:bg-brand-500/[0.08] dark:ring-brand-500/25" : "hover:bg-[var(--hover)]")}>
                      <span className="w-10 shrink-0 pt-0.5 font-mono text-2xs muted">#{e.seq}</span>
                      <span className={clsx("mt-1.5 dot", tone(e.kind))} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-[13px] font-medium text-ink-900 dark:text-ink-50">{kindTitle(e.kind)}</span>
                          <span className="text-2xs muted">{e.actor}{e.report_id ? ` · update #${e.report_id}` : ""}</span></span>
                        {summary && <span className="mt-0.5 block truncate text-xs muted">{summary}</span>}
                      </span>
                      {photo && <img src={apiUrl(`/api/photos/${photo.id}`)} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
                      <span className="hidden shrink-0 text-right text-2xs muted sm:block"><span className="block num">{fmtTime(e.ts)}</span><span className="font-mono">{e.hash.slice(0, 8)}</span></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.data && list.data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs" style={{ borderColor: "var(--border)" }}>
              <button className="btn-secondary btn-sm" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSel(null); }}>Newer</button>
              <span className="muted num">{offset + 1}-{Math.min(offset + PAGE_SIZE, list.data.total)} of {list.data.total}</span>
              <button className="btn-secondary btn-sm" disabled={offset + PAGE_SIZE >= list.data.total} onClick={() => { setOffset(offset + PAGE_SIZE); setSel(null); }}>Older</button>
            </div>
          )}
        </Card>
        <div className="hidden xl:block"><div className="sticky top-20">{sel ? <Inspector e={sel} /> : null}</div></div>
      </div>
      <div className="xl:hidden">
        <Modal open={mobileOpen && !!sel} onClose={() => setMobileOpen(false)} title={sel ? kindTitle(sel.kind) : ""} wide>{sel && <Inspector e={sel} embedded />}</Modal>
      </div>
    </div>
  );
}

function Inspector({ e, embedded }: { e: LedgerItem; embedded?: boolean }) {
  const [chain, setChain] = useState<LedgerItem[] | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    setChain(null);
    if (e.report_id) api.audit({ report_id: e.report_id, limit: 50 }).then((r) => setChain([...r.items].reverse())).catch(() => setChain([]));
  }, [e.report_id, e.seq]);
  const p = e.payload as Record<string, unknown>;
  const photo = p.photo as { id: number; sha256: string; lat: number | null; lon: number | null; taken_at: string } | null | undefined;
  const body = (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-2xs muted">
        <span className="badge-neutral font-mono">#{e.seq}</span>{fmtTime(e.ts)} · {e.actor}
      </div>
      {e.report_id && (
        <div>
          <div className="mb-3 flex items-center justify-between"><span className="label">Traceability · update #{e.report_id}</span>
            <button className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => nav(`/updates?report=${e.report_id}`)}>Open update</button></div>
          {chain === null ? <LoadingBlock rows={4} /> : <Trace entries={chain} />}
        </div>
      )}
      {photo && (
        <div className="flex items-start gap-3 rounded-xl border p-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <img src={apiUrl(`/api/photos/${photo.id}`)} alt="Photo evidence" className="h-20 w-20 rounded-lg object-cover" />
          <div className="space-y-0.5 text-xs">
            <p className="font-medium">Photo evidence</p>
            <p className="muted">{fmtTime(photo.taken_at)}</p>
            <p className="font-mono muted">sha256 {shortHash(photo.sha256)}</p>
            <p className="muted">{photo.lat !== null ? <><MapPin className="inline h-3 w-3" /> {photo.lat?.toFixed(5)}, {photo.lon?.toFixed(5)}</> : "no GPS (not permitted)"}</p>
          </div>
        </div>
      )}
      <div>
        <div className="label mb-2">Hashed payload</div>
        <pre className="max-h-72 overflow-auto rounded-xl bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-200 ring-1 ring-white/5">{JSON.stringify(e.payload, null, 2)}</pre>
        <p className="mt-2 flex flex-wrap items-center gap-1 font-mono text-2xs muted"><Link2 className="h-3 w-3" /> prev {shortHash(e.prev_hash)} → {shortHash(e.hash)}</p>
      </div>
    </div>
  );
  if (embedded) return body;
  return <Card title={kindTitle(e.kind)} subtitle={e.activity_id ?? undefined}><div className="max-h-[calc(100dvh-14rem)] overflow-y-auto pr-1">{body}</div></Card>;
}
