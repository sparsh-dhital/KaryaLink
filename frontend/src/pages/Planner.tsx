import clsx from "clsx";
import { AlertTriangle, Check, ChevronRight, FilePlus2, Image as ImageIcon, Inbox, Mic, RefreshCw, Search, Shuffle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import {
  Card, ConfidenceBar, DecisionBadge, EmptyState, ErrorBanner, EVIDENCE_LEGEND, EvidenceText, Modal, ReasonChips, Spinner,
  StatusBadge, useToast,
} from "../components/ui";
import { dataBus, demoRegistry, sleep } from "../lib/demo";
import { DISC, PHASE, fmtDate } from "../lib/format";
import type { Activity, Meta, Report } from "../types";

export default function Planner({ meta }: { meta: Meta | null }) {
  const [tab, setTab] = useState<"planner" | "supervisor">("planner");
  const [queue, setQueue] = useState<{ planner: Report[]; supervisor: Report[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [newModal, setNewModal] = useState(false);
  const [bulkMin, setBulkMin] = useState(0.6);
  const [flash, setFlash] = useState<string | null>(null);
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

  const items = useMemo(() => {
    const xs = queue ? queue[tab] : [];
    return filter === "all" ? xs : xs.filter((r) => r.decision === filter);
  }, [queue, tab, filter]);
  const sel = items.find((r) => r.id === selId) ?? items[0] ?? null;
  useEffect(() => { if (sel && sel.id !== selId) setSelId(sel.id); }, [sel, selId]);

  const act = useCallback(async (action: string, activityId?: string, extra?: { name?: string; parent_wbs?: string }) => {
    if (!sel || busy) return;
    setBusy(true);
    try {
      const idx = items.findIndex((r) => r.id === sel.id);
      const r = await api.action(sel.id, { action, activity_id: activityId, planner: "Planner (R. Sharma)", ...extra });
      const label = { approve: "Approved", reassign: "Reassigned", reject: "Rejected", new_activity: "New activity created" }[action];
      toast(action === "reject" ? "warn" : "ok", `${label}: report #${r.id}${r.activity_id ? ` → ${r.activity_id}` : ""}. Stored as a correction for learning.`);
      const q = await load();
      const next = q ? (filter === "all" ? q[tab] : q[tab].filter((x) => x.decision === filter)) : [];
      setSelId(next[Math.min(idx, next.length - 1)]?.id ?? null);
      dataBus.emit();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [sel, busy, items, load, filter, tab, toast]);

  // keyboard shortcuts
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
      toast("ok", `Bulk-approved ${r.count} review item(s) ≥ ${Math.round(bulkMin * 100)}%`);
      await load();
      dataBus.emit();
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-3 sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Planner review console</h1>
          <p className="text-sm muted">Items the engine was not sure about, sorted by calibrated confidence. Every action is logged and becomes training data.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs muted">
          <span className="kbd">A</span> approve <span className="kbd">R</span> reassign <span className="kbd">X</span> reject <span className="kbd">N</span> new activity <span className="kbd">J</span>/<span className="kbd">K</span> move
        </div>
      </div>
      <ErrorBanner error={error} onRetry={() => void load()} />
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        {/* queue */}
        <Card pad={false} title={
          <div className="flex gap-1">
            {(["planner", "supervisor"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={clsx("rounded-md px-2.5 py-1 text-xs font-semibold", tab === t ? "bg-brand-600 text-white" : "hover:bg-ink-100 dark:hover:bg-ink-800")}>
                {t === "planner" ? "Planner queue" : "Awaiting supervisor"} ({queue?.[t].length ?? 0})
              </button>
            ))}
          </div>
        } actions={<button className="btn-ghost btn-sm" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></button>}>
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2 dark:border-ink-800">
            <select className="select py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by decision">
              <option value="all">All decisions</option>
              <option value="REVIEW">Planner review</option>
              <option value="NEW_ACTIVITY">New activity</option>
              <option value="CONFIRM_SEQUENCE">Sequence check</option>
              <option value="CLARIFY">Clarify</option>
            </select>
          </div>
          {tab === "planner" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2 text-xs dark:border-ink-800">
              <span className="muted">Bulk approve reviews ≥</span>
              <input type="range" min={0.3} max={0.95} step={0.05} value={bulkMin} onChange={(e) => setBulkMin(Number(e.target.value))} className="w-24 accent-brand-600" aria-label="Bulk approve threshold" />
              <span className="w-9 font-semibold tabular-nums">{Math.round(bulkMin * 100)}%</span>
              <button className="btn-success btn-sm ml-auto" disabled={!bulkCount || busy} onClick={bulk}>Approve {bulkCount}</button>
            </div>
          )}
          {!queue ? <Spinner className="p-4" /> : items.length === 0 ? (
            <EmptyState icon={<Inbox className="h-8 w-8" />} title="Queue is clear" hint="New low-confidence or unmatched reports will appear here." />
          ) : (
            <ul className="scrollbar-thin max-h-[65vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
              {items.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelId(r.id)} className={clsx("w-full px-3 py-2.5 text-left transition",
                    sel?.id === r.id ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-ink-50 dark:hover:bg-ink-800/60")}>
                    <div className="flex items-center justify-between gap-2">
                      <DecisionBadge kind={r.decision} />
                      <span className="text-[11px] muted">#{r.id} · {fmtDate(r.report_date)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">{r.text}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1"><ConfidenceBar value={r.decision === "NEW_ACTIVITY" ? (r.candidates?.[0]?.confidence ?? 0) : r.confidence} threshold={threshold} /></div>
                      {r.channel === "voice" && <Mic className="h-3 w-3 muted" />}
                      {r.photo_id && <ImageIcon className="h-3 w-3 muted" />}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* detail */}
        {sel ? <Detail r={sel} threshold={threshold} busy={busy} flash={flash}
          onApprove={() => void act("approve")} onReassign={() => setPicker(true)} onReject={() => void act("reject")}
          onNew={() => setNewModal(true)} onAssign={(id, rank) => void act(rank === 0 ? "approve" : "reassign", rank === 0 ? undefined : id)} />
          : <Card><EmptyState title="Select an item" hint="Pick a report from the queue to see evidence and candidates." /></Card>}
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
    ["Tags", ext.tags.length ? ext.tags.map((t) => `${t.value} (${t.type})`).join(", ") : null, ext.tags.map((t) => t.evidence).join(", ") || null],
    ["Quantity", ext.quantity ? `${ext.quantity.value}${ext.quantity.total ? ` of ${ext.quantity.total}` : ""} ${ext.quantity.unit ?? ""} · ${ext.quantity.mode}` : null, ext.quantity?.evidence ?? null],
    ["Date", `${fmtDate(String(ext.date.value))}${ext.date.source === "assumed" ? " (assumed = report date)" : ""}`, ext.date.evidence],
    ["Area", ext.area ? String(ext.area.value) : null, ext.area?.evidence ?? null],
    ["Discipline", ext.discipline ? DISC[String(ext.discipline.value)] ?? String(ext.discipline.value) : null, ext.discipline?.evidence ?? null],
  ] : [];
  const usedFields = new Set((r.evidence_spans ?? []).map((s) => s.field));
  return (
    <div className="space-y-4">
      <Card title={<span className="flex flex-wrap items-center gap-2">Report #{r.id} <DecisionBadge kind={r.decision} /> <StatusBadge status={r.status} /></span>}
        actions={<span className="text-xs muted">{r.reporter} · {r.channel}{r.external_id ? ` · ${r.external_id}` : ""}</span>}>
        <div className="rounded-lg bg-ink-50 p-3 text-[15px] dark:bg-ink-800/60">
          <EvidenceText text={r.text} spans={r.evidence_spans ?? []} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(EVIDENCE_LEGEND).filter(([k]) => usedFields.has(k)).map(([k, l]) => <mark key={k} className={clsx("ev text-[11px]", `ev-${k}`)}>{l}</mark>)}
        </div>
        {r.photo_id && <img src={`/api/photos/${r.photo_id}`} alt="photo evidence" className="mt-3 max-h-48 rounded-lg border border-ink-200 object-cover dark:border-ink-700" />}
        {ext && (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {fields.map(([k, v, ev]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-20 shrink-0 muted">{k}</dt>
                <dd className={clsx(!v && "muted italic")}>{v ?? "not found"}{ev && v ? <span className="ml-1 text-xs muted">“{ev}”</span> : null}</dd>
              </div>
            ))}
          </dl>
        )}
        {ext?.corrections && ext.corrections.length > 0 && (
          <p className="mt-2 text-xs muted">Typos normalised: {ext.corrections.map((c) => `${c.from}→${c.to}`).join(", ")}</p>
        )}
        {r.warnings && r.warnings.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {r.warnings.map((w, i) => (
              <div key={i} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}
              </div>
            ))}
          </div>
        )}
        {r.supervisor_note && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{r.supervisor_note}</p>}
        {dd?.kind === "NEW_ACTIVITY" && dd.proposal && (
          <div className="mt-3 rounded-lg border border-dashed border-ink-300 p-3 text-sm dark:border-ink-600">
            <p className="font-medium">Proposed new activity</p>
            <p className="muted">Under WBS <span className="font-mono">{dd.proposal.parent_wbs ?? "-"}</span></p>
          </div>
        )}
        {dd?.question && r.status === "awaiting_planner" && <p className="mt-2 text-sm"><span className="muted">Question for supervisor: </span>{dd.question}</p>}

        {r.status.startsWith("awaiting") && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-ink-800">
            <button className="btn-success" disabled={busy || !r.candidates?.length && r.decision !== "NEW_ACTIVITY"} onClick={onApprove}>
              <Check className="h-4 w-4" /> {r.decision === "NEW_ACTIVITY" ? "Approve new activity" : "Approve top"} <span className="kbd bg-white/20 text-white border-white/30">A</span>
            </button>
            <button className={clsx("btn-secondary", flash === "r" && "ring-4 ring-brand-400")} disabled={busy} onClick={onReassign}>
              <Shuffle className="h-4 w-4" /> Reassign <span className="kbd">R</span>
            </button>
            <button className="btn-secondary" disabled={busy} onClick={onReject}><X className="h-4 w-4" /> Reject <span className="kbd">X</span></button>
            <button className="btn-secondary" disabled={busy} onClick={onNew}><FilePlus2 className="h-4 w-4" /> New activity <span className="kbd">N</span></button>
          </div>
        )}
      </Card>

      <Card title="Top candidates (calibrated confidence)" actions={<span className="text-[11px] muted">marker = auto-apply threshold {Math.round(threshold * 100)}%</span>}>
        {!r.candidates?.length ? <EmptyState title="No candidates" hint="Nothing in the schedule resembles this report." /> : (
          <ol className="space-y-3">
            {r.candidates.slice(0, 3).map((c, i) => (
              <li key={c.activity_id} className={clsx("rounded-lg border p-3", i === 0 ? "border-brand-300 dark:border-brand-500/40" : "border-ink-200 dark:border-ink-700")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium"><span className="mr-1.5 text-xs muted">#{i + 1}</span>{c.activity.name}</p>
                    <p className="text-xs muted"><span className="font-mono">{c.activity_id}</span> · {DISC[c.activity.discipline]} · {c.activity.area} · plan {fmtDate(c.activity.planned_start)} → {fmtDate(c.activity.planned_finish)}</p>
                  </div>
                  {r.status.startsWith("awaiting") && (
                    <button className="btn-secondary btn-sm" disabled={busy} onClick={() => onAssign(c.activity_id, i)}>
                      Assign here <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="my-2"><ConfidenceBar value={c.confidence} threshold={threshold} /></div>
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
    <Modal open={open} onClose={onClose} title="Reassign to activity" wide>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 muted" />
        <input autoFocus className="input pl-9" placeholder="Search by tag, name or activity ID (e.g. P-1022, F-12, cable pulling)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {report?.candidates && !q && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold muted">Engine candidates</p>
          <div className="flex flex-wrap gap-1.5">
            {report.candidates.map((c) => (
              <button key={c.activity_id} className="chip-brand cursor-pointer" onClick={() => onPick({ ...(c.activity as Activity) })}>
                {c.activity.tag} · {PHASE[c.activity.phase] ?? c.activity.phase} ({Math.round(c.confidence * 100)}%)
              </button>
            ))}
          </div>
        </div>
      )}
      <ErrorBanner error={err} />
      <ul className="mt-3 max-h-[50vh] divide-y divide-ink-100 overflow-y-auto dark:divide-ink-800">
        {rows === null ? <Spinner className="p-3" /> : rows.length === 0 ? <EmptyState title="No matching activities" /> : rows.map((a) => (
          <li key={a.activity_id}>
            <button className="w-full px-2 py-2 text-left hover:bg-ink-50 dark:hover:bg-ink-800" onClick={() => onPick(a)}>
              <p className="text-sm font-medium">{a.name}</p>
              <p className="text-xs muted"><span className="font-mono">{a.activity_id}</span> · {a.area} · {a.pct.toFixed(0)}% · plan {fmtDate(a.planned_start)}</p>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function NewActivityModal({ open, onClose, report, onCreate }: { open: boolean; onClose: () => void; report: Report; onCreate: (name: string, parent: string) => void }) {
  const prop = report.decision_detail?.proposal;
  const topParent = report.candidates?.[0]?.activity.parent_wbs.split(".").slice(0, 4).join(".") ?? "";
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  useEffect(() => {
    if (open) {
      setName((prop?.name ?? report.text).slice(0, 120));
      setParent(prop?.parent_wbs ?? topParent);
    }
  }, [open, prop, report, topParent]);
  return (
    <Modal open={open} onClose={onClose} title="Create new (unplanned) activity">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && parent.trim()) onCreate(name.trim(), parent.trim()); }}>
        <label className="block text-sm"><span className="muted">Activity name</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></label>
        <label className="block text-sm"><span className="muted">WBS parent (L4 work package)</span>
          <input className="input mt-1 font-mono" value={parent} onChange={(e) => setParent(e.target.value)} required /></label>
        <p className="text-xs muted">The report is applied to the new activity and logged; the correction teaches the model that this wording was not planned work.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary">Create & apply</button></div>
      </form>
    </Modal>
  );
}
