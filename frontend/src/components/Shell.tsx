import clsx from "clsx";
import {
  AlertTriangle, BarChart3, Bell, CalendarRange, ChevronRight, ClipboardCheck, Clapperboard, CornerDownLeft, FileText,
  HelpCircle, Inbox, LayoutDashboard, Menu, Moon, Search, Settings, ShieldCheck, Sparkles, Sun, X, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { dataBus } from "../lib/demo";
import { fmtDate } from "../lib/format";
import type { Activity, Meta, Report, Summary } from "../types";
import { useDemo } from "./DemoRunner";
import { Modal } from "./ui";

export type NavItem = { to: string; label: string; short: string; icon: LucideIcon; badge?: "queue"; desc: string };
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Overview", items: [
    { to: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard, desc: "Project intelligence at a glance" },
    { to: "/updates", label: "Site Updates", short: "Updates", icon: Inbox, desc: "Every report and how it was linked" },
    { to: "/schedule", label: "Schedule", short: "Schedule", icon: CalendarRange, desc: "L1-L6 WBS, plan vs actual timeline" },
  ] },
  { group: "Intelligence", items: [
    { to: "/supervisor", label: "AI Assistant", short: "Assistant", icon: Sparkles, desc: "Talk to the site assistant" },
    { to: "/planner", label: "Review Queue", short: "Review", icon: ClipboardCheck, badge: "queue", desc: "Approve, reassign or reject uncertain links" },
    { to: "/evaluation", label: "Reports", short: "Reports", icon: BarChart3, desc: "Operations and AI matching accuracy" },
  ] },
  { group: "Governance", items: [
    { to: "/audit", label: "Audit Trail", short: "Audit", icon: ShieldCheck, desc: "Hash-chained decision ledger" },
    { to: "/settings", label: "Settings", short: "Settings", icon: Settings, desc: "Thresholds, data import / export, demo" },
  ] },
];
export const FLAT = NAV.flatMap((g) => g.items);
const MOBILE_PRIMARY = ["/", "/updates", "/supervisor", "/planner"];

export function currentNav(pathname: string): NavItem | undefined {
  return FLAT.find((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("karyalink-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", dark ? "#0b0c11" : "#ffffff");
  }, [dark]);
  return [dark, setDark] as const;
}

/** Live counts that drive the badge and notifications - all from real endpoints. */
export function useSignals() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.summary().then((x) => { if (alive) setS(x); }).catch(() => undefined);
    load();
    const t = setInterval(load, 20000);
    const off = dataBus.on(load);
    return () => { alive = false; clearInterval(t); off(); };
  }, []);
  return s;
}

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className="shrink-0">
      <defs><linearGradient id="kl-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8e80fb" /><stop offset="1" stopColor="#5241c9" /></linearGradient></defs>
      <rect width="32" height="32" rx="8" fill="url(#kl-g)" />
      <path d="M10.5 21.5 21.5 10.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".9" />
      <circle cx="10" cy="22" r="3.4" fill="#fff" />
      <circle cx="22" cy="10" r="3.4" fill="none" stroke="#fff" strokeWidth="2.4" />
      <circle cx="22" cy="10" r="1.2" fill="#fbbf24" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-ink-900 dark:text-white">KaryaLink</div>
        <div className="text-[11px] muted">Site-to-Schedule Intelligence</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sidebar
export function Sidebar({ meta, signals }: { meta: Meta | null; signals: Summary | null }) {
  const demo = useDemo();
  const queue = signals ? signals.queue_planner + signals.queue_supervisor : 0;
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[256px] flex-col border-r lg:flex" style={{ background: "var(--sidebar)", borderColor: "var(--border)" }}>
      <div className="flex h-16 items-center px-5"><Brand /></div>
      <div className="mx-4 mb-5 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        <div className="flex items-center justify-between">
          <span className="label">Project</span>
          <span className="badge-neutral">synthetic</span>
        </div>
        <div className="mt-1 truncate text-[13px] font-medium text-ink-900 dark:text-ink-50">GGS-7 Gas Gathering Station</div>
        <div className="mt-0.5 text-[11px] muted">6 units · data date {meta ? fmtDate(meta.data_date) : "…"}</div>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Main">
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] subtle">{g.group}</div>
            <ul className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon, badge }) => (
                <li key={to}>
                  <NavLink to={to} end={to === "/"} className={({ isActive }) => clsx(
                    "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-150",
                    isActive ? "bg-brand-50 text-brand-800 dark:bg-brand-500/[0.12] dark:text-white"
                      : "text-ink-600 hover:bg-[var(--hover)] hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100")}>
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-500" />}
                        <Icon className={clsx("h-[17px] w-[17px] transition-colors", isActive ? "text-brand-600 dark:text-brand-400" : "text-ink-400 group-hover:text-ink-600 dark:text-ink-500 dark:group-hover:text-ink-300")} />
                        <span className="flex-1">{label}</span>
                        {badge === "queue" && queue > 0 && (
                          <span className="num rounded-md bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">{queue}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="p-3">
        <div className="relative overflow-hidden rounded-xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
          <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-brand-500/20 blur-2xl" />
          <div className="relative flex items-center gap-2 text-[13px] font-semibold text-ink-900 dark:text-white"><Clapperboard className="h-4 w-4 text-brand-500" /> Demo Day</div>
          <p className="relative mt-1 text-[11.5px] leading-4 muted">Scripted 3-minute run through the real engine - reset, voice, review, retrain.</p>
          <button className="btn-primary btn-sm relative mt-3 w-full" onClick={demo.open} disabled={demo.running}>{demo.running ? "Running…" : "Start scenario"}</button>
        </div>
        <div className="mt-3 flex items-center gap-2 px-1.5 text-[11px] muted">
          <span className={clsx("dot", meta ? "bg-emerald-500" : "bg-ink-500")} />
          Model {meta?.model_version ?? "…"} · {meta?.llm_enabled ? "LLM assist (evidence-checked)" : "offline engine"}
        </div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ top bar
export function Topbar({ signals, dark, toggleDark, onSearch, onHelp, onMenu }: {
  signals: Summary | null; dark: boolean; toggleDark: () => void; onSearch: () => void; onHelp: () => void; onMenu: () => void;
}) {
  const loc = useLocation();
  const cur = currentNav(loc.pathname);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl sm:px-6 lg:h-16 lg:px-8"
      style={{ background: "color-mix(in srgb, var(--bg) 82%, transparent)", borderColor: "var(--border)" }}>
      <button className="btn-ghost btn-sm btn-icon lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
      <div className="lg:hidden"><BrandMark size={28} /></div>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="hidden muted sm:inline">GGS-7</span>
        <ChevronRight className="hidden h-3.5 w-3.5 subtle sm:inline" />
        <span className="truncate font-medium text-ink-900 dark:text-white">{cur?.label ?? "KaryaLink"}</span>
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={onSearch} className="hidden h-9 w-60 items-center gap-2 rounded-lg border px-3 text-[13px] text-ink-400 transition hover:border-[var(--border-strong)] md:flex"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Search (Ctrl K)">
          <Search className="h-4 w-4 shrink-0" /> <span className="flex-1 truncate whitespace-nowrap text-left">Search…</span>
          <span className="kbd">Ctrl</span><span className="kbd">K</span>
        </button>
        <button className="btn-ghost btn-sm btn-icon md:hidden" onClick={onSearch} aria-label="Search"><Search className="h-[18px] w-[18px]" /></button>
        <Notifications signals={signals} />
        <button className="btn-ghost btn-sm btn-icon" onClick={onHelp} aria-label="Help and shortcuts" title="Help & shortcuts"><HelpCircle className="h-[18px] w-[18px]" /></button>
        <Profile dark={dark} toggleDark={toggleDark} />
      </div>
    </header>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return ref;
}

function Popover({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("absolute right-0 top-11 z-50 rounded-xl shadow-pop animate-fadein", className)}
      style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}>{children}</div>
  );
}

function Notifications({ signals }: { signals: Summary | null }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway(open, close);
  const nav = useNavigate();
  const items = useMemo(() => {
    if (!signals) return [];
    const out: { tone: string; title: string; detail: string; to: string }[] = [];
    if (signals.queue_planner) out.push({ tone: "amber", title: `${signals.queue_planner} update${signals.queue_planner > 1 ? "s" : ""} need planner review`, detail: "Uncertain or unplanned links, sorted by confidence", to: "/planner" });
    if (signals.queue_supervisor) out.push({ tone: "brand", title: `${signals.queue_supervisor} waiting for a supervisor answer`, detail: "Clarification or sequence confirmation pending", to: "/planner" });
    if (signals.open_warnings) out.push({ tone: "amber", title: `${signals.open_warnings} open sequence warning${signals.open_warnings > 1 ? "s" : ""}`, detail: "Reported out of logic order", to: "/schedule?view=warnings" });
    if (signals.delays_red) out.push({ tone: "red", title: `${signals.delays_red} activities flagged red`, detail: "Overdue, or due soon with no update", to: "/schedule?view=delays" });
    return out;
  }, [signals]);
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost btn-sm btn-icon relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${items.length})`} aria-expanded={open}>
        <Bell className="h-[18px] w-[18px]" />
        {items.length > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[9.5px] font-bold text-white ring-2 ring-[var(--bg)]">{items.length}</span>}
      </button>
      {open && (
        <Popover className="w-[340px]">
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-[13px] font-semibold">Needs attention</span>
            <span className="text-2xs muted">live from the project</span>
          </div>
          {items.length === 0 ? <p className="px-4 py-6 text-center text-xs muted">All clear - nothing needs attention.</p> : (
            <ul className="p-1.5">
              {items.map((n) => (
                <li key={n.title}>
                  <button onClick={() => { setOpen(false); nav(n.to); }} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left hover:bg-[var(--hover)]">
                    <span className={clsx("mt-1.5 dot", n.tone === "red" ? "bg-rose-500" : n.tone === "amber" ? "bg-amber-500" : "bg-brand-500")} />
                    <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{n.title}</span><span className="block text-2xs muted">{n.detail}</span></span>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 subtle" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </div>
  );
}

function Profile({ dark, toggleDark }: { dark: boolean; toggleDark: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickAway(open, close);
  const nav = useNavigate();
  const demo = useDemo();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="ml-1 flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 transition hover:bg-[var(--hover)]" aria-label="Account menu" aria-expanded={open}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[11px] font-semibold text-white">RS</span>
        <span className="hidden text-left leading-tight xl:block"><span className="block text-xs font-semibold text-ink-900 dark:text-ink-50">R. Sharma</span><span className="block text-[10.5px] muted">Planner</span></span>
      </button>
      {open && (
        <Popover className="w-60 p-1.5">
          <div className="px-2.5 py-2">
            <div className="text-[13px] font-semibold">R. Sharma</div>
            <div className="text-2xs muted">Planner · demo persona (no login in this prototype)</div>
          </div>
          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
          <MenuButton icon={dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} onClick={() => { toggleDark(); }}>{dark ? "Light appearance" : "Dark appearance"}</MenuButton>
          <MenuButton icon={<Settings className="h-4 w-4" />} onClick={() => { setOpen(false); nav("/settings"); }}>Settings</MenuButton>
          <MenuButton icon={<Clapperboard className="h-4 w-4" />} onClick={() => { setOpen(false); demo.open(); }}>Run Demo Day</MenuButton>
        </Popover>
      )}
    </div>
  );
}

function MenuButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-700 hover:bg-[var(--hover)] dark:text-ink-200">
      <span className="subtle">{icon}</span>{children}
    </button>
  );
}

// ------------------------------------------------------------------ mobile navigation
export function MobileNav({ signals, drawer, setDrawer }: { signals: Summary | null; drawer: boolean; setDrawer: (v: boolean) => void }) {
  const queue = signals ? signals.queue_planner + signals.queue_supervisor : 0;
  const loc = useLocation();
  const inMore = !MOBILE_PRIMARY.some((p) => (p === "/" ? loc.pathname === "/" : loc.pathname.startsWith(p)));
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
        style={{ background: "color-mix(in srgb, var(--sidebar) 92%, transparent)", borderColor: "var(--border)" }} aria-label="Primary">
        {FLAT.filter((i) => MOBILE_PRIMARY.includes(i.to)).map(({ to, short, icon: Icon, badge }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => clsx(
            "relative flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors",
            isActive ? "text-brand-600 dark:text-brand-400" : "text-ink-500")}>
            <Icon className="h-5 w-5" />
            {short}
            {badge === "queue" && queue > 0 && <span className="num absolute right-[calc(50%-22px)] top-1.5 rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-[14px] text-white">{queue}</span>}
          </NavLink>
        ))}
        <button onClick={() => setDrawer(true)} className={clsx("flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] font-medium", inMore ? "text-brand-600 dark:text-brand-400" : "text-ink-500")}>
          <Menu className="h-5 w-5" /> More
        </button>
      </nav>
      {drawer && (
        <div className="fixed inset-0 z-[60] bg-ink-950/50 backdrop-blur-[2px] animate-fadein lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col animate-slideup" style={{ background: "var(--sidebar)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex h-14 items-center justify-between border-b px-4" style={{ borderColor: "var(--border)" }}>
              <Brand />
              <button className="btn-ghost btn-sm btn-icon" onClick={() => setDrawer(false)} aria-label="Close navigation"><X className="h-4 w-4" /></button>
            </div>
            <nav className="flex-1 space-y-5 overflow-y-auto p-3" aria-label="All pages">
              {NAV.map((g) => (
                <div key={g.group}>
                  <div className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] subtle">{g.group}</div>
                  {g.items.map(({ to, label, icon: Icon, desc }) => (
                    <NavLink key={to} to={to} end={to === "/"} onClick={() => setDrawer(false)} className={({ isActive }) => clsx(
                      "flex items-center gap-3 rounded-lg px-2.5 py-2.5", isActive ? "bg-brand-50 text-brand-800 dark:bg-brand-500/[0.12] dark:text-white" : "text-ink-700 dark:text-ink-300")}>
                      <Icon className="h-[18px] w-[18px] text-ink-400" />
                      <span><span className="block text-sm font-medium">{label}</span><span className="block text-2xs muted">{desc}</span></span>
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ command palette (Ctrl K)
type Hit = { kind: "page" | "action" | "activity" | "report"; label: string; hint: string; icon: ReactNode; run: () => void };

export function CommandPalette({ open, onClose, toggleDark }: { open: boolean; onClose: () => void; toggleDark: () => void }) {
  const [q, setQ] = useState("");
  const [acts, setActs] = useState<Activity[]>([]);
  const [reps, setReps] = useState<Report[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const demo = useDemo();
  useEffect(() => { if (open) { setQ(""); setIdx(0); setActs([]); setReps([]); } }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setActs([]); setReps([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      Promise.all([api.activities({ q: q.trim(), limit: 6 }), api.reports({ q: q.trim(), limit: 4 })])
        .then(([a, r]) => { setActs(a); setReps(r.items); }).catch(() => undefined).finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback((to: string) => { onClose(); nav(to); }, [nav, onClose]);
  const hits: Hit[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const pages: Hit[] = FLAT.map((i) => ({ kind: "page" as const, label: i.label, hint: i.desc, icon: <i.icon className="h-4 w-4" />, run: () => go(i.to) }));
    const actions: Hit[] = [
      { kind: "action", label: "Run Demo Day", hint: "Scripted 3-minute scenario", icon: <Clapperboard className="h-4 w-4" />, run: () => { onClose(); demo.open(); } },
      { kind: "action", label: "Toggle dark / light appearance", hint: "Appearance", icon: <Moon className="h-4 w-4" />, run: () => { toggleDark(); onClose(); } },
      { kind: "action", label: "Ask the AI Assistant", hint: "Report progress or ask about the schedule", icon: <Sparkles className="h-4 w-4" />, run: () => go("/supervisor") },
    ];
    const f = (h: Hit) => !ql || h.label.toLowerCase().includes(ql) || h.hint.toLowerCase().includes(ql);
    return [
      ...pages.filter(f), ...actions.filter(f),
      ...acts.map((a) => ({ kind: "activity" as const, label: a.name, hint: `${a.activity_id} · ${a.area} · ${a.pct.toFixed(0)}%`, icon: <CalendarRange className="h-4 w-4" />, run: () => go(`/schedule?activity=${encodeURIComponent(a.activity_id)}`) })),
      ...reps.map((r) => ({ kind: "report" as const, label: r.text, hint: `Report #${r.id} · ${r.reporter}`, icon: <FileText className="h-4 w-4" />, run: () => go(`/updates?report=${r.id}`) })),
    ];
  }, [q, acts, reps, go, onClose, demo, toggleDark]);
  useEffect(() => { setIdx(0); }, [q]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); hits[idx]?.run(); }
    else if (e.key === "Escape") onClose();
  };
  const groups: [Hit["kind"], string][] = [["page", "Pages"], ["action", "Actions"], ["activity", "Schedule activities"], ["report", "Site updates"]];
  let n = -1;
  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center bg-ink-950/50 p-4 pt-[12vh] backdrop-blur-[2px] animate-fadein" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl shadow-pop animate-slideup" style={{ background: "var(--elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search">
        <div className="flex items-center gap-3 border-b px-4" style={{ borderColor: "var(--border)" }}>
          <Search className="h-[18px] w-[18px] subtle" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search"
            placeholder="Search pages, activities (e.g. P-1022, F-12), reports…" className="h-14 flex-1 bg-transparent text-sm focus:outline-none" />
          {loading && <span className="text-2xs muted">searching…</span>}
          <span className="kbd">Esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {hits.length === 0 ? <p className="px-3 py-8 text-center text-[13px] muted">No results for “{q}”.</p> : groups.map(([k, title]) => {
            const g = hits.filter((h) => h.kind === k);
            if (!g.length) return null;
            return (
              <div key={k} className="mb-1">
                <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] subtle">{title}</div>
                {g.map((h) => {
                  n += 1;
                  const i = n;
                  return (
                    <button key={`${k}-${h.label}-${i}`} onMouseEnter={() => setIdx(i)} onClick={h.run}
                      className={clsx("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", idx === i && "bg-brand-50 dark:bg-brand-500/[0.12]")}>
                      <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md border", idx === i ? "border-brand-200 text-brand-600 dark:border-brand-500/30 dark:text-brand-300" : "subtle")}
                        style={idx === i ? undefined : { borderColor: "var(--border)" }}>{h.icon}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{h.label}</span><span className="block truncate text-2xs muted">{h.hint}</span></span>
                      {idx === i && <CornerDownLeft className="h-3.5 w-3.5 subtle" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-2 text-2xs muted" style={{ borderColor: "var(--border)" }}>
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span><span><span className="kbd">Enter</span> open</span><span className="ml-auto">KaryaLink search</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ help
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const flow = ["Site update", "Extraction", "AI activity linking", "L5/L6 schedule", "Confidence", "Update · Ask · Review", "Progress", "Audit"];
  const keys: [string, string][] = [["Ctrl K", "Search everything"], ["Space (hold)", "Talk to the AI Assistant"], ["A / R / X / N", "Approve · reassign · reject · new activity (Review Queue)"], ["J / K", "Next / previous review item"], ["Esc", "Close dialogs"]];
  return (
    <Modal open={open} onClose={onClose} title="How KaryaLink works" description="Ask, don't guess: confident links apply automatically; uncertain ones ask the supervisor or a planner." wide>
      <ol className="flex flex-wrap items-center gap-1.5">
        {flow.map((f, i) => (
          <li key={f} className="flex items-center gap-1.5">
            <span className="rounded-lg border px-2.5 py-1 text-xs font-medium" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>{f}</span>
            {i < flow.length - 1 && <ChevronRight className="h-3.5 w-3.5 subtle" />}
          </li>
        ))}
      </ol>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <div className="label mb-2">Keyboard</div>
          <ul className="space-y-1.5 text-[13px]">
            {keys.map(([k, d]) => <li key={k} className="flex items-start gap-3"><span className="kbd shrink-0 px-1.5">{k}</span><span className="muted">{d}</span></li>)}
          </ul>
        </div>
        <div>
          <div className="label mb-2">Talking to the assistant</div>
          <ul className="space-y-1.5 text-[13px] muted">
            <li>“F-12 pour done, 42 cum” · “line 1021 ke 3 spool erect ho gaye”</li>
            <li>“status of line 1022?” · “what is delayed?” · “aaj kya plan hai?”</li>
            <li>“undo” · “why?” · “no, it was line 1022”</li>
            <li>Several updates in one message, follow-ups like “aur 2 ho gaye”</li>
          </ul>
        </div>
      </div>
      <div className="mt-5"><AlertNote /></div>
    </Modal>
  );
}

function AlertNote() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs muted" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      All project data in this prototype is synthetic. Accuracy numbers are measured live on a held-out synthetic benchmark.
    </div>
  );
}
