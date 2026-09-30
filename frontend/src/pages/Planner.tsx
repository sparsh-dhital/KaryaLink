import clsx from "clsx";
import { AlertTriangle, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronLeft, ChevronRight, FilePlus2, Image as ImageIcon, Inbox, Mic, RefreshCw, Search, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ConfidenceIndicator, decisionHeadline } from "../components/domain";
import {
  Card, DecisionBadge, EmptyState, ErrorBanner, EVIDENCE_LEGEND, EvidenceText, LoadingBlock, Modal, PageHeader, ReasonChips, Segmented,
  StatusBadge, useToast,
} from "../components/ui";
import { dataBus, demoRegistry, sleep } from "../lib/demo";
import { DISC, PHASE, fmtDate, fmtTime } from "../lib/format";
import { PAGE } from "../lib/layout";
import type { Activity, Meta, Report } from "../types";
import { apiUrl } from "../lib/config";

const PLANNER = "Planner (R. Sharma)";
const linkConf = (r: Report) => r.candidates?.[0]?.confidence ?? 0;

export default function Planner({ meta }: { meta: Meta | null }) {
  const [tab, setTab] = useState<"planner" | "supervisor">("planner");
  const [queue, setQueue] = useState<{ planner: Report[]; supervisor: Report[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<"desc" | "asc">("desc");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [newModal, setNewModal] = useState(false);
  const [bulkMin, setBulkMin] = useState(0.6);
  const [flash, setFlash] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const toast = useToast();
  const threshold = meta?.thresholds.auto_apply ?? 0.8;

  const load = useCallback(async () => {
    try {
      const q = await api.queue();
      setQueue(q);
      setError(null);
      return q;
    } catch (e) {
      setError(e);
      return null;
    }
  }, []);
  useEffect(() => { void load(); return dataBus.on(() => { void load(); }); }, [load]);

  const view = useCallback((q: { planner: Report[]; supervisor: Report[] } | null) => {
    const xs = q ? q[tab] : [];
    const f = filter === "all" ? xs : xs.filter((r) => r.decision === filter);
    return [...f].sort((a, b) => (sort === "desc" ? linkConf(b) - linkConf(a) : linkConf(a) - linkConf(b)) || a.id - b.id);
  }, [tab, filter, sort]);
  const items = useMemo(() => view(queue), [view, queue]);
  const sel = items.find((r) => r.id === selId) ?? items[0] ?? null;
  useEffect(() => { if (sel && sel.id !== selId) setSelId(sel.id); }, [sel, selId]);

  const act = useCallback(async (action: string, activityId?: string, extra?: { name?: string; parent_wbs?: string }) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const idx = items.findIndex((r) => r.id === sel.id);
      const r = await api.action(sel.id, { action, activity_id: activityId, planner: PLANNER, ...extra });
      const label = { approve: "Approved", reassign: "Reassigned", reject: "Rejected", new_activity: "New activity created" }[action];
      toast(action === "reject" ? "warn" : "ok", `${label}: update #${r.id}${r.activity_id ? ` → ${r.activity_id}` : ""}. Stored as a correction for learning.`);
      const next = view(await load());
      setSelId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      dataBus.emit();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sel, busy, items, load, view, toast]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (picker || newModal || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); void act("approve"); }
      else if (k === "r") { e.preventDefault(); setPicker(true); }
      else if (k === "x") { e.preventDefault(); void act("reject"); }
      else if (k === "n") { e.preventDefault(); setNewModal(true); }
      else if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const i = items.findIndex((r) => r.id === sel?.id);
        if (items[i + 1]) setSelId(items[i + 1].id);
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = items.findIndex((r) => r.id === sel?.id);
        if (i > 0) setSelId(items[i - 1].id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [act, items, sel, picker, newModal]);

  // Demo Day hooks
  const actRef = useRef(act); actRef.current = act;
  useEffect(() => demoRegistry.register("planner", {
    async select(id) { setTab("planner"); setFilter("all"); await load(); setSelId(id); await sleep(300); },
    async reassign(id, activityId) {
      setSelId(id);
      await sleep(1800);
      setFlash("r");
      setPicker(true);
      await sleep(1600);
      setPicker(false);
      setFlash(null);
      await actRef.current("reassign", activityId);
    },
    async refresh() { await load(); },
  }), [load]);

  const bulkCount = (queue?.planner ?? []).filter((r) => r.decision === "REVIEW" && r.confidence >= bulkMin).length;
  const bulk = async () => {
    setBusy(true);
    try {
      const r = await api.bulkApprove(bulkMin);
      toast("ok", `Bulk-approved ${r.count} review item(s) with confidence ≥ ${Math.round(bulkMin * 100)}%`);
      await load();
      dataBus.emit();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const detail = sel ? (
    <Detail r={sel} threshold={threshold} busy={busy} flash={flash}
      onApprove={() => void act("approve")} onReassign={() => setPicker(true)} onReject={() => void act("reject")}
      onNew={() => setNewModal(true)} onAssign={(id, rank) => void act(rank === 0 ? "approve" : "reassign", rank === 0 ? undefined : id)} />
  ) : <Card><EmptyState icon={<Inbox className="h-5 w-5" />} title="Nothing selected" hint="Pick an item from the queue to see its evidence and candidates." /></Card>;

  return (
    <div className={PAGE}>
      <PageHeader eyebrow="Intelligence" title="Review queue"
        description="Updates KaryaLink was not sure enough to apply on its own - ask, don't guess. Every decision here is logged and becomes training data."
        actions={<div className="hidden items-center gap-1.5 text-2xs muted md:flex">
          <span className="kbd">A</span> approve <span className="kbd">R</span> reassign <span className="kbd">X</span> reject <span className="kbd">N</span> new <span className="kbd">J</span><span className="kbd">K</span> move
        </div>} />
      <ErrorBanner error={error} onRetry={() => void load()} />
      <div className="grid gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <Card pad={false}>
          <div className="space-y-3 border-b p-3" style={{ borderColor: "var(--border)" }}>
            <Segmented ariaLabel="Queue" value={tab} onChange={setTab} size="sm" options={[
              { value: "planner", label: "Needs your review", count: queue?.planner.length },
              { value: "supervisor", label: "Awaiting supervisor", count: queue?.supervisor.length },
            ]} />
            <div className="flex items-center gap-2">
              <select className="select h-8 flex-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by decision">
                <option value="all">All reasons</option>
                <option value="REVIEW">Medium confidence</option>
                <option value="NEW_ACTIVITY">Possible new work</option>
                <option value="CONFIRM_SEQUENCE">Sequence exception</option>
                <option value="CLARIFY">Clarification</option>
              </select>
              <button className="btn-secondary btn-sm btn-icon" onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))} title={sort === "desc" ? "Highest confidence first" : "Lowest confidence first"} aria-label="Toggle sort">
                {sort === "desc" ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
              </button>
              <button className="btn-ghost btn-sm btn-icon" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            {tab === "planner" && (
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs" style={{ background: "var(--surface-2)" }}>
                <span className="muted">Bulk approve ≥</span>
                <input type="range" min={0.3} max={0.95} step={0.05} value={bulkMin} onChange={(e) => setBulkMin(Number(e.target.value))} className="w-20 flex-1 accent-brand-600" aria-label="Bulk approve threshold" />
                <span className="w-9 font-semibold num">{Math.round(bulkMin * 100)}%</span>
                <button className="btn-success btn-xs" disabled={!bulkCount || busy} onClick={bulk}>Approve {bulkCount}</button>
              </div>
            )}
          </div>
          {!queue ? <div className="p-4"><LoadingBlock rows={6} /></div> : items.length === 0 ? (
            <EmptyState icon={<Check className="h-5 w-5" />} title="Queue is clear" hint="New low-confidence or unmatched updates will appear here automatically." />
          ) : (
            <ul className="max-h-[68vh] divide-y overflow-y-auto" style={{ borderColor: "var(--border)" }}>
              {items.map((r, i) => {
                const top = r.candidates?.[0];
                return (
                  <li key={r.id}>
                    <button onClick={() => { setSelId(r.id); setMobileDetail(true); }} className={clsx("relative w-full px-4 py-3 text-left transition",
                      sel?.id === r.id ? "bg-brand-50/70 dark:bg-brand-500/[0.08]" : "hover:bg-[var(--hover)]")}>
                      {sel?.id === r.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand-500" />}
                      <div className="flex items-center gap-2 text-2xs muted">
                        <span className="font-semibold text-ink-700 num dark:text-ink-300">{String(i + 1).padStart(2, "0")}</span>
                        <DecisionBadge kind={r.decision} />
                        <span className="ml-auto">#{r.id} · {fmtDate(r.report_date)}</span>
                        {r.channel === "voice" && <Mic className="h-3 w-3" />}
                        {r.photo_id && <ImageIcon className="h-3 w-3" />}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-ink-900 dark:text-ink-50">“{r.text}”</p>
                      {top && <p className="mt-1 truncate text-2xs muted">Suggested: <span className="text-ink-700 dark:text-ink-200">{top.activity.name}</span></p>}
                      <div className="mt-2"><ConfidenceIndicator value={linkConf(r)} threshold={threshold} size="sm" /></div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="hidden min-w-0 lg:block">{detail}</div>
      </div>

      <div className="lg:hidden">
        <Modal open={mobileDetail && !!sel} onClose={() => setMobileDetail(false)} title={sel ? `Update #${sel.id}` : ""} wide>{detail}</Modal>
      </div>
      <ActivityPicker open={picker} onClose={() => setPicker(false)} report={sel}
        onPick={(a) => { setPicker(false); void act("reassign", a.activity_id); }} />
      {sel && <NewActivityModal open={newModal} onClose={() => setNewModal(false)} report={sel}
        onCreate={(name, parent) => { setNewModal(false); void act("new_activity", undefined, { name, parent_wbs: parent }); }} />}
    </div>
  );
}

function Detail({ r, threshold, busy, flash, onApprove, onReassign, onReject, onNew, onAssign }: {
  r: Report; threshold: number; busy: boolean; flash: string | null; onApprove: () => void; onReassign: () => void; onReject: () => void;
  onNew: () => void; onAssign: (id: string, rank: number) => void;
}) {
  const ext = r.extraction;
  const dd = r.decision_detail;
  const fields: [string, string | null, string | null][] = ext ? [
    ["Phase", ext.phase ? PHASE[String(ext.phase.value)] ?? String(ext.phase.value) : null, ext.phase?.evidence ?? null],
    ["Status", ext.status ? String(ext.status.value) : null, ext.status?.evidence ?? null],
    ["Tags", ext.tags.length ? ext.tags.map((t) => `${t.value} (${t.type.replace("_", " ")})`).join(", ") : null, ext.tags.map((t) => t.evidence).join(", ") || null],
    ["Quantity", ext.quantity ? `${ext.quantity.value}${ext.quantity.total ? ` of ${ext.quantity.total}` : ""} ${ext.quantity.unit ?? ""} · ${ext.quantity.mode.replace("_", " ")}` : null, ext.quantity?.evidence ?? null],
    ["Date", `${fmtDate(String(ext.date.value))}${ext.date.source === "assumed" ? " (assumed = report date)" : ""}`, ext.date.evidence],
    ["Area", ext.area ? String(ext.area.value) : null, ext.area?.evidence ?? null],
    ["Discipline", ext.discipline ? DISC[String(ext.discipline.value)] ?? String(ext.discipline.value) : null, ext.discipline?.evidence ?? null],
  ] : [];
  const used = new Set((r.evidence_spans ?? []).map((s) => s.field));
  const actionable = r.status.startsWith("awaiting");
  return (
    <div className="space-y-4">
      <Card title={<span className="flex flex-wrap items-center gap-2">Update #{r.id} <DecisionBadge kind={r.decision} /> <StatusBadge status={r.status} /></span>}
        subtitle={`${r.reporter} · ${r.channel} · ${fmtTime(r.created_at)}${r.external_id ? ` · backlog ${r.external_id}` : ""}`}>
        <div className="rounded-xl border p-4 text-[15px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <EvidenceText text={r.text} spans={r.evidence_spans ?? []} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(EVIDENCE_LEGEND).filter(([k]) => used.has(k)).map(([k, l]) => <mark key={k} className={clsx("ev text-[10.5px]", `ev-${k}`)}>{l}</mark>)}
        </div>
        {r.photo_id && <img src={apiUrl(`/api/photos/${r.photo_id}`)} alt="Photo evidence" className="mt-3 max-h-48 rounded-xl border object-cover" style={{ borderColor: "var(--border)" }} />}
        {ext && (
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-[13px] sm:grid-cols-2">
            {fields.map(([k, v, ev]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-20 shrink-0 text-xs muted">{k}</dt>
                <dd className={clsx("min-w-0", !v && "muted italic")}>{v ?? "not found"}{ev && v ? <span className="ml-1.5 text-2xs muted">“{ev}”</span> : null}</dd>
              </div>
            ))}
          </dl>
        )}
        {ext?.corrections && ext.corrections.length > 0 && <p className="mt-2 text-2xs muted">Typos normalised: {ext.corrections.map((c) => `${c.from} → ${c.to}`).join(", ")}</p>}
        {r.warnings && r.warnings.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {r.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}
              </div>
            ))}
          </div>
        )}
        {r.supervisor_note && <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-300">{r.supervisor_note}</p>}
        {dd?.kind === "NEW_ACTIVITY" && dd.proposal && (
          <div className="mt-4 rounded-xl border border-dashed p-3 text-[13px]" style={{ borderColor: "var(--border-strong)" }}>
            <p className="font-medium">Proposed new activity</p>
            <p className="muted">Under WBS <span className="font-mono text-xs">{dd.proposal.parent_wbs ?? "-"}</span></p>
          </div>
        )}
        {dd?.question && r.status === "awaiting_planner" && <p className="mt-3 text-[13px]"><span className="muted">Question for the supervisor: </span>{dd.question}</p>}
        {actionable && (
          <div className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap gap-2 border-t px-5 pb-1 pt-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <button className="btn-success" disabled={busy || (!r.candidates?.length && r.decision !== "NEW_ACTIVITY")} onClick={onApprove}>
              <Check className="h-4 w-4" /> {r.decision === "NEW_ACTIVITY" ? "Approve new activity" : "Approve match"} <span className="kbd border-white/30 bg-white/15 text-white">A</span>
            </button>
            <button className={clsx("btn-secondary", flash === "r" && "ring-4 ring-brand-400/60")} disabled={busy} onClick={onReassign}><Shuffle className="h-4 w-4" /> Reassign <span className="kbd">R</span></button>
            <button className="btn-secondary" disabled={busy} onClick={onReject}><X className="h-4 w-4" /> Reject <span className="kbd">X</span></button>
            <button className="btn-secondary" disabled={busy} onClick={onNew}><FilePlus2 className="h-4 w-4" /> New activity <span className="kbd">N</span></button>
          </div>
        )}
      </Card>

      <Card title="AI match candidates" subtitle={`Calibrated confidence · marker = auto-apply threshold ${Math.round(threshold * 100)}% · ${decisionHeadline(r.decision)}`}>
        {!r.candidates?.length ? <EmptyState title="No candidates" hint="Nothing in the schedule resembles this update." /> : (
          <ol className="space-y-3">
            {r.candidates.slice(0, 3).map((c, i) => (
              <li key={c.activity_id} className={clsx("rounded-xl border p-4 transition", i === 0 && "ring-1 ring-brand-200 dark:ring-brand-500/25")} style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold text-ink-900 dark:text-white"><span className="mr-2 text-xs muted num">#{i + 1}</span>{c.activity.name}</p>
                    <p className="mt-0.5 text-2xs muted"><span className="font-mono">{c.activity_id}</span> · {DISC[c.activity.discipline]} · {c.activity.area} · plan {fmtDate(c.activity.planned_start)} → {fmtDate(c.activity.planned_finish)}</p>
                  </div>
                  {actionable && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onAssign(c.activity_id, i)}>{i === 0 ? "Approve" : "Assign here"} <ChevronRight className="h-3.5 w-3.5" /></button>}
                </div>
                <div className="my-3 max-w-md"><ConfidenceIndicator value={c.confidence} threshold={threshold} /></div>
                <ReasonChips reasons={c.reasons} />
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function ActivityPicker({ open, onClose, onPick, report }: { open: boolean; onClose: () => void; onPick: (a: Activity) => void; report: Report | null }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (open) setQ(""); }, [open]);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.activities({ q, limit: 40, discipline: q ? undefined : report?.extraction?.discipline?.value as string | undefined })
        .then((r) => { setRows(r); setErr(null); }).catch(setErr);
    }, 200);
    return () => clearTimeout(t);
  }, [q, open, report]);
  return (
    <Modal open={open} onClose={onClose} title="Reassign to activity" description="The correction is stored and used the next time the model is retrained." wide>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 subtle" />
        <input autoFocus className="input pl-9" placeholder="Search by tag, name or activity ID (e.g. P-1022, F-12, cable pulling)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search activities" />
      </div>
      {report?.candidates && !q && (
        <div className="mt-4">
          <div className="label mb-2">Engine candidates</div>
          <div className="flex flex-wrap gap-1.5">
            {report.candidates.map((c) => (
              <button key={c.activity_id} className="badge-brand h-7 cursor-pointer hover:opacity-80" onClick={() => onPick({ ...(c.activity as Activity) })}>
                {c.activity.tag} · {PHASE[c.activity.phase] ?? c.activity.phase} · {Math.round(c.confidence * 100)}%
              </button>
            ))}
          </div>
        </div>
      )}
      <ErrorBanner error={err} />
      <ul className="mt-4 max-h-[50vh] divide-y overflow-y-auto" style={{ borderColor: "var(--border)" }}>
        {rows === null ? <li className="p-3"><LoadingBlock /></li> : rows.length === 0 ? <li><EmptyState title="No matching activities" /></li> : rows.map((a) => (
          <li key={a.activity_id}>
            <button className="w-full rounded-lg px-2 py-2.5 text-left hover:bg-[var(--hover)]" onClick={() => onPick(a)}>
              <p className="text-[13px] font-medium">{a.name}</p>
              <p className="text-2xs muted"><span className="font-mono">{a.activity_id}</span> · {a.area} · {a.pct.toFixed(0)}% · plan {fmtDate(a.planned_start)}</p>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function NewActivityModal({ open, onClose, report, onCreate }: { open: boolean; onClose: () => void; report: Report; onCreate: (name: string, parent: string) => void }) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  useEffect(() => {
    if (!open) return;
    const prop = report.decision_detail?.proposal;
    setName((prop?.name ?? report.text).slice(0, 120));
    setParent(prop?.parent_wbs ?? report.candidates?.[0]?.activity.parent_wbs.split(".").slice(0, 4).join(".") ?? "");
    // only reset when the dialog opens for a report, not on background refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report.id]);
  return (
    <Modal open={open} onClose={onClose} title="Create unplanned activity" description="The update is applied to the new activity and logged; the correction teaches the model this wording was not planned work.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && parent.trim()) onCreate(name.trim(), parent.trim()); }}>
        <label className="block"><span className="label">Activity name</span>
          <input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></label>
        <label className="block"><span className="label">WBS parent (L4 work package)</span>
          <input className="input mt-1.5 font-mono" value={parent} onChange={(e) => setParent(e.target.value)} required /></label>
        <div className="flex justify-end gap-2 pt-1"><button type="button" className="btn-secondary" onClick={onClose}><ChevronLeft className="h-4 w-4" /> Cancel</button><button className="btn-primary">Create & apply</button></div>
      </form>
    </Modal>
  );
}
