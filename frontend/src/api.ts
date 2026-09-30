import { API_BASE, apiUrl } from "./lib/config";
import type {
  Activity, ActualEventRow, AssistantContext, ChatMsg, ReportStats, DelayFlag, GanttRow, HistoryRow, LedgerItem, Meta, Metrics, Report, Summary, Thresholds, WbsNodeT,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(
      import.meta.env.DEV
        ? "Cannot reach the KaryaLink server. Is `npm run dev` running?"
        : API_BASE
          ? `Cannot reach the KaryaLink API at ${API_BASE}. It may be waking up (free tier, ~1 min) or not deployed - check ${API_BASE}/api/health.`
          : "The KaryaLink API address is not configured: set VITE_API_URL to the Render service URL and redeploy.",
      0,
    );
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* not json */ }
    throw new ApiError(msg, res.status);
  }
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  meta: () => request<Meta>("/api/meta"),
  summary: () => request<Summary>("/api/dashboard/summary"),
  delays: (discipline?: string) => request<DelayFlag[]>(`/api/dashboard/delays${q({ discipline })}`),
  warnings: () => request<{ id: number; report_id: number; activity_id: string; type: string; message: string; status: string; resolved_by: string | null; created_at: string }[]>("/api/dashboard/warnings"),
  scurve: (discipline?: string) => request<{ date: string; planned: number; actual?: number }[]>(`/api/dashboard/scurve${q({ discipline })}`),
  gantt: (discipline?: string, area?: string) => request<GanttRow[]>(`/api/plan-vs-actual${q({ discipline, area, limit: 80 })}`),
  wbs: (discipline?: string) => request<{ roots: WbsNodeT[] }>(`/api/rollup${q({ discipline })}`),
  activities: (params: { q?: string; discipline?: string; area?: string; limit?: number }) =>
    request<Activity[]>(`/api/activities${q(params)}`),
  activity: (id: string) => request<Activity & { events: unknown[] }>(`/api/activities/${encodeURIComponent(id)}`),

  queue: () => request<{ planner: Report[]; supervisor: Report[] }>("/api/queue"),
  reports: (params: { q?: string; status?: string; decision?: string; channel?: string; limit?: number; offset?: number }) =>
    request<{ total: number; items: Report[] }>(`/api/reports${q(params)}`),
  reportStats: () => request<ReportStats>("/api/reports/stats"),
  activityDetail: (id: string) => request<Activity & { events: ActualEventRow[] }>(`/api/activities/${encodeURIComponent(id)}`),
  report: (id: number) => request<Report>(`/api/reports/${id}`),
  submitReport: (body: { text: string; reporter?: string; reporter_discipline?: string | null; channel?: string; photo_id?: number | null }) =>
    request<Report>("/api/reports", json(body)),
  action: (id: number, body: { action: string; activity_id?: string; planner?: string; name?: string; parent_wbs?: string }) =>
    request<Report>(`/api/reports/${id}/action`, json(body)),
  bulkApprove: (min_confidence: number) => request<{ approved: number[]; count: number }>("/api/queue/bulk-approve", json({ min_confidence })),
  uploadReportFile: (file: File, reporter: string, discipline?: string | null, photoId?: number | null) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("reporter", reporter);
    if (discipline) fd.append("reporter_discipline", discipline);
    if (photoId) fd.append("photo_id", String(photoId));
    return request<{ reports: Report[]; informational_lines: string[] }>("/api/reports/upload", { method: "POST", body: fd });
  },
  uploadPhoto: (file: File, lat?: number, lon?: number) => {
    const fd = new FormData();
    fd.append("file", file);
    if (lat !== undefined) fd.append("lat", String(lat));
    if (lon !== undefined) fd.append("lon", String(lon));
    return request<{ id: number; sha256: string; url: string; taken_at: string; lat: number | null; lon: number | null }>("/api/photos", { method: "POST", body: fd });
  },

  chat: (body: { session_id: string; text: string; lang: string; reporter: string; discipline?: string | null; photo_id?: number | null; channel?: string }) =>
    request<{ messages: ChatMsg[] }>("/api/assistant/message", json(body)),
  chatAnswer: (body: { session_id: string; value: string; lang: string; reporter: string; label?: string }) =>
    request<{ messages: ChatMsg[] }>("/api/assistant/answer", json(body)),
  chatUpload: (file: File, body: { session_id: string; lang: string; reporter: string; discipline?: string | null; photo_id?: number | null }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("session_id", body.session_id);
    fd.append("lang", body.lang);
    fd.append("reporter", body.reporter);
    if (body.discipline) fd.append("discipline", body.discipline);
    if (body.photo_id) fd.append("photo_id", String(body.photo_id));
    return request<{ messages: ChatMsg[] }>("/api/assistant/upload", { method: "POST", body: fd });
  },
  chatClear: (sid: string) => request<{ ok: boolean }>(`/api/assistant/history/${encodeURIComponent(sid)}`, { method: "DELETE" }),
  chatContext: (sid: string, discipline?: string | null) =>
    request<AssistantContext>(`/api/assistant/context/${encodeURIComponent(sid)}${q({ discipline })}`),
  revert: (id: number, reason?: string) => request<Report>(`/api/reports/${id}/revert`, json({ actor: "Planner (R. Sharma)", reason: reason ?? "reverted by planner" })),
  endOfDay: (body: { session_id: string; lang: string; reporter: string; discipline?: string | null }) =>
    request<{ messages: ChatMsg[] }>("/api/assistant/end-of-day", json(body)),
  chatHistory: (sid: string) => request<ChatMsg[]>(`/api/assistant/history/${encodeURIComponent(sid)}`),

  metrics: (split: "test" | "hard") => request<Metrics>(`/api/metrics?split=${split}`),
  history: () => request<HistoryRow[]>("/api/metrics/history"),
  retrain: () => request<{ version: string; round: number; n_corrections: number; n_learned_terms: number }>("/api/retrain", { method: "POST" }),
  learning: () => request<{ corrections: number; pending_corrections: number; learned_lexicon: Record<string, string>;
    recent: { id: number; text: string; kind: string; predicted: string | null; correct: string | null; by: string; used_in: string | null }[] }>("/api/learning/state"),
  setThresholds: (t: Thresholds) => request<{ thresholds: Thresholds }>("/api/settings/thresholds", { ...json(t), method: "PUT" }),

  audit: (params: { limit?: number; offset?: number; kind?: string; report_id?: number }) =>
    request<{ total: number; kinds: string[]; items: LedgerItem[] }>(`/api/audit${q(params)}`),
  verify: () => request<{ ok: boolean; entries: number; head?: string; broken_at?: number; reason?: string; checked_at: string }>("/api/audit/verify"),

  importSchedule: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ activities_added: number; activities_updated: number; wbs_nodes: number; source: string }>("/api/schedule/import", { method: "POST", body: fd });
  },
  ask: (question: string) => request<{ answer: string; note?: string; scope?: string; n_completed?: number; histogram?: { bin: string; count: number }[]; examples?: string[] }>("/api/memory/ask", json({ question })),

  demoReset: () => request<{ model: string }>("/api/demo/reset", { method: "POST" }),
  demoScript: () => request<{ steps: DemoStep[]; notes: string[] }>("/api/demo/script"),
  demoBatch: (n: number) => request<Record<string, number>>("/api/demo/planner-batch", json({ n })),
  sampleFile: async (name: string): Promise<File> => {
    const res = await fetch(apiUrl(`/api/samples/${encodeURIComponent(name)}`));
    if (!res.ok) throw new ApiError(`Sample ${name} not available`, res.status);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || "text/plain" });
  },
};

export interface DemoStep {
  id: string; type: string; narration: string; who?: string; reporter?: string; discipline?: string; lang?: string;
  text?: string; expected?: string; answer_value?: string; spoken_answer?: string; sample?: string;
  report_id?: number; activity_id?: string; n?: number;
}

function q(params: Record<string, string | number | undefined | null>): string {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
}
