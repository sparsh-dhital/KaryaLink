import clsx from "clsx";
import { ClipboardCheck, Inbox, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ConfidenceIndicator, Trace, UpdateItem, UPDATE_STATE, decisionHeadline } from "../components/domain";
import {
  Card, EmptyState, ErrorBanner, EVIDENCE_LEGEND, EvidenceText, LoadingBlock, Modal, PageHeader, ReasonChips, Segmented, useToast,
} from "../components/ui";
import { dataBus } from "../lib/demo";
import { DISC, PHASE, fmtDate, fmtTime } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { LedgerItem, Meta, Report } from "../types";
import { apiUrl } from "../lib/config";

type Filter = "all" | "applied" | "awaiting_planner" | "awaiting_supervisor" | "new_activity_created" | "closed";
const PAGE_SIZE = 30;

export default function Updates({ meta }: { meta: Meta | null }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [channel, setChannel] = useState("");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [items, setItems] = useState<Report[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selected = params.get("report") ? Number(params.get("report")) : null;
  const th = meta?.thresholds.auto_apply ?? 0.8;

  useEffect(() => { const t = setTimeout(() => setQDeb(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const status = filter === "all" ? undefined : filter === "closed" ? "rejected,reverted" : filter;

  const load = useCallback(async (offset = 0) => {
    try {
      const r = await api.reports({ status, channel: channel || undefined, q: qDeb || undefined, limit: PAGE_SIZE, offset });
      const rows = r.items;
      setItems((cur) => (offset === 0 ? rows : [...(cur ?? []), ...rows]));
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [status, channel, qDeb]);
  useEffect(() => { setItems(null); void load(0); }, [load]);
  useEffect(() => dataBus.on(() => { void load(0); }), [load]);

  const pick = (id: number | null) => setParams(id ? { report: String(id) } : {}, { replace: true });

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Overview" title="Site updates"
        description="Every progress report from the field - chat, voice, spreadsheets and daily-report files - with where KaryaLink linked it, how confident it was, and what happened next. Nothing is ever silently dropped." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="-mx-1 overflow-x-auto px-1">
          <Segmented ariaLabel="Outcome" value={filter} onChange={setFilter} size="sm" options={[
            { value: "all", label: "All" }, { value: "applied", label: "Schedule updated" }, { value: "awaiting_planner", label: "Needs review" },
            { value: "awaiting_supervisor", label: "Awaiting clarification" }, { value: "new_activity_created", label: "New activity" }, { value: "closed", label: "Rejected / undone" },
          ]} />
        </div>
        <div className="flex flex-1 gap-2 lg:justify-end">
          <select className="select h-8 w-auto text-xs" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
            <option value="">All channels</option>
            {["chat", "voice", "spreadsheet", "file", "email", "chaser"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 subtle" />
            <input className="input h-8 pl-8 text-xs" placeholder="Search text or reporter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search updates" />
          </div>
        </div>
      </div>
      <ErrorBanner error={error} onRetry={() => void load(0)} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card pad={false} title={`${total} update${total === 1 ? "" : "s"}`} subtitle="Newest first">
          <div className="px-2 pb-2">
            {items === null ? <div className="p-3"><LoadingBlock rows={8} /></div> : items.length === 0 ? (
              <EmptyState icon={<Inbox className="h-5 w-5" />} title="No site updates match" hint="Once supervisors submit progress, KaryaLink automatically analyses it and links it to the schedule." />
            ) : (
              <>
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {items.map((r) => <li key={r.id}><UpdateItem r={r} threshold={th} onClick={() => pick(r.id)} active={selected === r.id} /></li>)}
                </ul>
                {items.length < total && (
                  <div className="p-3 text-center">
                    <button className="btn-secondary btn-sm" disabled={loadingMore} onClick={async () => { setLoadingMore(true); await load(items.length); setLoadingMore(false); }}>
                      {loadingMore ? "Loading…" : `Load more (${total - items.length} left)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
        <div className="hidden xl:block">
          <div className="sticky top-20">
            {selected ? <ReportDetail id={selected} threshold={th} onClose={() => pick(null)} /> : (
              <Card><EmptyState icon={<Inbox className="h-5 w-5" />} title="Select an update" hint="See the evidence, the AI match and its confidence, and the full traceability chain." /></Card>
            )}
          </div>
        </div>
      </div>
      <div className="xl:hidden">
        <Modal open={!!selected} onClose={() => pick(null)} title={selected ? `Update #${selected}` : ""} wide>
          {selected && <ReportDetail id={selected} threshold={th} embedded onClose={() => pick(null)} />}
        </Modal>
      </div>
    </div>
  );
}

export function ReportDetail({ id, threshold, embedded, onClose }: { id: number; threshold: number; embedded?: boolean; onClose: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [trail, setTrail] = useState<LedgerItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const load = useCallback(() => {
    Promise.all([api.report(id), api.audit({ report_id: id, limit: 50 })])
      .then(([rep, a]) => { setR(rep); setTrail([...a.items].reverse()); setError(null); })
      .catch(setError);
  }, [id]);
  useEffect(() => { setR(null); load(); }, [load]);

  const fields = useMemo(() => {
    const ext = r?.extraction;
    if (!ext) return [];
    return [
      ["Phase", ext.phase ? PHASE[String(ext.phase.value)] ?? String(ext.phase.value) : null],
      ["Status", ext.status ? String(ext.status.value) : null],
      ["Tag", ext.tags.length ? ext.tags.map((t) => t.value).join(", ") : null],
      ["Quantity", ext.quantity ? `${ext.quantity.value}${ext.quantity.total ? ` of ${ext.quantity.total}` : ""} ${ext.quantity.unit ?? ""}` : null],
      ["Date", `${fmtDate(String(ext.date.value))}${ext.date.source === "assumed" ? " (assumed)" : ""}`],
      ["Discipline", ext.discipline ? DISC[String(ext.discipline.value)] ?? String(ext.discipline.value) : null],
    ] as [string, string | null][];
  }, [r]);

  const undo = async () => {
    if (!r) return;
    setBusy(true);
    try {
      await api.revert(r.id);
      toast("ok", `Update #${r.id} undone - the reversal is logged in the audit trail`);
      load();
      dataBus.emit();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!r) return <Card><LoadingBlock rows={8} /></Card>;
  const st = UPDATE_STATE[r.status] ?? { label: r.status, cls: "badge-neutral" };
  const top = r.candidates?.[0];
  const used = new Set((r.evidence_spans ?? []).map((s) => s.field));
  const body = (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={st.cls}>{st.label}</span>
          <span className="text-2xs muted">{r.reporter} · {r.channel} · {fmtTime(r.created_at)}</span>
        </div>
        <div className="mt-3 rounded-xl border p-3.5 text-[14px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <EvidenceText text={r.text} spans={r.evidence_spans ?? []} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(EVIDENCE_LEGEND).filter(([k]) => used.has(k)).map(([k, l]) => <mark key={k} className={clsx("ev text-[10.5px]", `ev-${k}`)}>{l}</mark>)}
        </div>
        {r.photo_id && <img src={apiUrl(`/api/photos/${r.photo_id}`)} alt="Photo evidence" className="mt-3 max-h-44 rounded-xl border object-cover" style={{ borderColor: "var(--border)" }} />}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {fields.map(([k, v]) => (
          <div key={k}><dt className="label">{k}</dt><dd className={clsx("mt-0.5 text-[13px]", !v && "muted italic")}>{v ?? "not found"}</dd></div>
        ))}
      </dl>

      {top && (
        <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
          <div className="label">AI match · {decisionHeadline(r.decision)}</div>
          <div className="mt-1.5 text-[13.5px] font-semibold text-ink-900 dark:text-white">{top.activity.name}</div>
          <div className="text-2xs muted font-mono">{top.activity_id} · {top.activity.area}</div>
          <div className="mt-3"><ConfidenceIndicator value={top.confidence} threshold={threshold} /></div>
          <div className="mt-3"><ReasonChips reasons={top.reasons} max={6} /></div>
        </div>
      )}
      {(r.warnings?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
          {r.warnings!.map((w, i) => <p key={i}>{w.message}</p>)}
        </div>
      )}

      <div>
        <div className="label mb-3">Traceability</div>
        <Trace received={{ ts: r.created_at, who: r.reporter, channel: r.channel, text: r.text }} entries={trail} />
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        {r.status.startsWith("awaiting") && <button className="btn-primary btn-sm" onClick={() => nav("/planner")}><ClipboardCheck className="h-3.5 w-3.5" /> Open in review queue</button>}
        {r.status === "applied" && <button className="btn-secondary btn-sm" onClick={undo} disabled={busy}><RotateCcw className="h-3.5 w-3.5" /> Undo this update</button>}
        {r.activity_id && <button className="btn-ghost btn-sm" onClick={() => nav(`/schedule?activity=${encodeURIComponent(r.activity_id!)}`)}>View activity</button>}
      </div>
    </div>
  );
  if (embedded) return body;
  return (
    <Card title={`Update #${r.id}`} subtitle={r.external_id ? `Backlog item ${r.external_id}` : undefined}
      actions={<button className="btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>}>
      <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto pr-1">{body}</div>
    </Card>
  );
}
