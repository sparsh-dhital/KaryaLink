export type Discipline = "CIV" | "PIP" | "ELE" | "INS" | "MEC" | "HSE";
export type DecisionKind = "AUTO_APPLY" | "CLARIFY" | "REVIEW" | "CONFIRM_SEQUENCE" | "NEW_ACTIVITY";

export interface Reason { label: string; polarity: "+" | "-" | "0" }

export interface ActivityLite {
  activity_id: string; name: string; discipline: Discipline; area: string; tag: string; tag_type: string;
  phase: string; planned_start: string; planned_finish: string; quantity: number; unit: string;
  parent_wbs: string; level: number; credit_method: string;
}

export interface Activity extends ActivityLite {
  area_name: string; wbs_code: string; duration: number; weight: number; predecessors: string[];
  pct: number; qty_done: number; actual_start: string | null; actual_finish: string | null;
  last_update: string | null; source: string;
}

export interface Candidate {
  activity_id: string; activity: ActivityLite; confidence: number; raw_score: number;
  features: Record<string, number>; reasons: Reason[];
}

export interface Field {
  value: unknown; start: number | null; end: number | null; evidence: string | null; source?: string;
  [k: string]: unknown;
}

export interface Extraction {
  phase: Field | null; phases_all: string[]; status: Field | null; tags: (Field & { type: string })[];
  quantity: (Field & { total: number | null; unit: string | null; mode: string }) | null;
  granular_ids: Field[]; date: Field; area: Field | null; discipline: Field | null; new_work_cue: Field | null;
  corrections: { from: string; to: string }[]; extractor: string; llm_status?: string;
  llm_rejected?: { field: string; value: string; evidence: string | null; reason: string }[];
}

export interface Span { field: string; start: number; end: number; value: unknown }

export interface Option { value: string; label: string }

export interface DecisionDetail {
  kind: DecisionKind; activity_id: string | null; confidence: number; message?: string; question?: string;
  question_hi?: string; options?: Option[]; clarify_type?: string;
  proposal?: { name: string; parent_wbs: string | null; discipline: string | null; area: string | null };
  warnings?: SeqWarning[];
}

export interface SeqWarning { type: string; message: string; message_hi?: string; predecessor_id?: string }

export interface Report {
  id: number; external_id: string | null; text: string; reporter: string; reporter_discipline: string | null;
  channel: string; report_date: string; created_at: string; status: string; decision: DecisionKind;
  confidence: number; activity_id: string | null; model_version: string; photo_id: number | null;
  source_file: string | null; resolved_by: string | null;
  candidates?: Candidate[]; decision_detail?: DecisionDetail; warnings?: SeqWarning[]; evidence_spans?: Span[];
  extraction?: Extraction; supervisor_note?: string | null;
  activity_name?: string | null; top_candidate?: { activity_id: string; name: string; confidence: number } | null;
}

export interface ReportStats {
  total: number; by_day: { date: string; total: number; auto: number; review: number }[];
  by_channel: Record<string, number>; by_decision: Record<string, number>; by_status: Record<string, number>;
}

export interface ActualEventRow {
  id: number; activity_id: string; report_id: number | null; event: string; event_date: string; qty_value: number | null;
  qty_mode: string | null; pct_before: number; pct_after: number; credit_note: string; confidence: number; approver: string;
  model_version: string; source: string; created_at: string;
}

export interface AreaSummary {
  area: string; name: string; actual_pct: number; planned_pct: number; variance: number;
  status: "complete" | "on_track" | "at_risk" | "behind"; activities: number; completed: number; in_progress: number;
  red_flags: number; amber_flags: number; current_phase: string | null; last_update: string | null;
}

export interface ChatItem {
  activity_id?: string | null; name: string; tag?: string; pct?: number | null; planned_start?: string; planned_finish?: string;
  actual_start?: string | null; actual_finish?: string | null; last_update?: string | null; flag?: string | null;
  detail?: string; updated_today?: boolean; title?: string;
}

export interface Suggestion { label: string; text: string }

export interface ChatMsg {
  id: number | string; role: "user" | "assistant"; text: string; lang: string; report_id: number | null;
  payload: {
    kind?: "update" | "question" | "status" | "list" | "help" | "why" | "memory" | "info";
    options?: Option[]; question?: boolean; decision?: DecisionKind; confidence?: number; activity_id?: string;
    activity_name?: string; pct?: number; photo_id?: number | null; channel?: string; status?: string;
    gaps?: { activity_id: string; name: string }[]; chaser_activity?: string; title?: string;
    items?: (ChatItem & { title?: string; detail?: string })[]; suggestions?: Suggestion[]; set_lang?: string;
    reasons?: Reason[]; note?: string;
  };
  created_at?: string;
}

export interface AssistantContext {
  data_date: string; planned_today: (ChatItem & { updated_today: boolean })[]; planned_total: number; pending_today: number;
  delays: number; my_updates_today: number; my_applied_today: number; last_activity: ChatItem | null; pending: string | null;
}

export interface Meta {
  version: string; project: string; data_date: string; model_version: string | null; llm_enabled: boolean;
  llm_model: string | null; thresholds: Thresholds; disciplines: Record<Discipline, string>; areas: string[];
  rules_of_credit: Record<string, { basis: string; steps: Record<string, number> }>;
  delay_rules: { due_window_days: number; amber_days: number; red_days: number };
}

export interface Thresholds { auto_apply: number; review: number; margin: number; clarify_gap: number }

export interface Summary {
  project: string; data_date: string; actual_pct: number; planned_pct: number; spi: number | null;
  activities: number; completed: number; in_progress: number; not_started: number; new_activities: number;
  reports_total: number; queue_planner: number; queue_supervisor: number; auto_applied: number;
  delays_red: number; delays_amber: number; open_warnings: number;
  by_discipline: Record<string, { actual_pct: number; planned_pct: number; activities: number }>;
  by_area: AreaSummary[]; updates_today: number; linked_today: number;
}

export interface DelayFlag {
  activity_id: string; name: string; discipline: string; area: string; planned_start: string; planned_finish: string;
  pct: number; last_update: string | null; level: "amber" | "red"; reasons: string[]; days_silent: number;
}

export interface GanttRow {
  activity_id: string; name: string; discipline: string; area: string; planned_start: string; planned_finish: string;
  actual_start: string | null; actual_finish: string | null; pct: number; planned_pct: number; flag: string | null;
}

export interface WbsNodeT {
  code: string; name: string; level: number; actual_pct: number; planned_pct: number; children: WbsNodeT[];
  activities: { activity_id: string; name: string; pct: number; planned_pct: number; level: number;
    actual_start: string | null; actual_finish: string | null; flag: string | null }[];
}

export interface Metrics {
  split: string; n: number; n_planned: number; n_new: number; top1_accuracy: number; top3_recall: number;
  top5_recall: number; auto_apply_threshold: number; precision_at_auto: number | null; coverage_auto: number;
  new_activity_recall: number | null; new_activity_precision: number | null; event_type_accuracy: number | null;
  event_type_extracted: number; date_accuracy: number | null; decisions: Record<DecisionKind, number>;
  curve: { threshold: number; coverage: number; precision: number | null }[];
  calibration: { bin: string; mean_conf: number; accuracy: number; n: number }[];
  confusion: Record<string, Record<string, number>>; per_discipline: Record<string, { n: number; top1: number }>;
  errors: { report_id: string; text: string; truth: string; predicted: string | null; confidence: number; decision: string }[];
  model_version: string; computed_at: string; label: string;
}

export interface HistoryRow {
  version: string; round: number; kind: string; created_at: string; n_corrections: number; n_learned_terms: number;
  is_active: boolean;
  test: { top1_accuracy: number; top3_recall: number; precision_at_auto: number | null; coverage_auto: number; new_activity_recall: number | null; n: number };
  hard: { top1_accuracy: number; top3_recall: number; precision_at_auto: number | null; coverage_auto: number; new_activity_recall: number | null; n: number };
}

export interface LedgerItem {
  seq: number; ts: string; kind: string; report_id: number | null; activity_id: string | null; actor: string;
  payload: Record<string, unknown>; prev_hash: string; hash: string;
}
