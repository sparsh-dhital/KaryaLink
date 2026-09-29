import type { DecisionKind } from "../types";

export const DISC: Record<string, string> = {
  CIV: "Civil", PIP: "Piping", ELE: "Electrical", INS: "Instrumentation", MEC: "Mechanical", HSE: "HSE",
};

// Validated categorical palette (fixed order, follows the entity; see index.css tokens)
export const DISC_COLOR: Record<string, string> = {
  PIP: "var(--series-1)", ELE: "var(--series-2)", INS: "var(--series-3)", CIV: "var(--series-4)",
  MEC: "var(--series-5)", HSE: "var(--series-6)", NEW: "var(--chart-muted)",
};
export const DISC_ORDER = ["PIP", "ELE", "INS", "CIV", "MEC", "HSE"];

export const PHASE: Record<string, string> = {
  excavation: "Excavation", pcc: "PCC", rebar: "Rebar & formwork", pour: "Concrete pour", backfill: "Backfilling",
  fabrication: "Fabrication", erection: "Erection", welding: "Welding", hydrotest: "Hydrotest", install: "Installation",
  cable_pull: "Cable pulling", termination: "Termination", hookup: "Hook-up", loop_check: "Loop check",
  setting: "Setting", alignment: "Alignment", grouting: "Grouting", barricading: "Barricading", audit: "Audit",
};

export const DECISION_LABEL: Record<DecisionKind, string> = {
  AUTO_APPLY: "Auto-applied", CLARIFY: "Clarify", REVIEW: "Planner review", CONFIRM_SEQUENCE: "Sequence check",
  NEW_ACTIVITY: "New activity",
};

export const STATUS_LABEL: Record<string, string> = {
  applied: "Applied", awaiting_planner: "Awaiting planner", awaiting_supervisor: "Awaiting supervisor",
  rejected: "Rejected", new_activity_created: "New activity created", processing: "Processing",
};

export const pct = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined || Number.isNaN(x) ? "-" : `${(x * 100).toFixed(digits)}%`;

export const pct100 = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined ? "-" : `${x.toFixed(digits)}%`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
