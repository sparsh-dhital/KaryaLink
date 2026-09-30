import clsx from "clsx";
import {
  AlertTriangle, ArrowUp, Camera, Check, CalendarClock, FileUp, Headphones, ListChecks, Loader2, MapPin, Mic, MicOff,
  MoreHorizontal, Paperclip, RotateCcw, Sparkles, Square, Trash2, Volume2, VolumeX, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Alert, DecisionBadge, Modal, ProgressBar, ReasonChips, useToast } from "../components/ui";
import { dataBus, demoRegistry, sleep } from "../lib/demo";
import { DISC, fmtDate, fmtTime } from "../lib/format";
import { listen, micLevel, onSpeakingChange, recognitionSupported, speak, stopSpeaking, synthesisSupported } from "../lib/speech";
import type { AssistantContext, ChatItem, ChatMsg, Suggestion } from "../types";

export const PERSONAS: Record<string, { name: string; discipline: string }> = {
  piping: { name: "Anil Borah", discipline: "PIP" },
  electrical: { name: "Priya Das", discipline: "ELE" },
  civil: { name: "Rakesh Gogoi", discipline: "CIV" },
  instrumentation: { name: "Imran Hussain", discipline: "INS" },
  mechanical: { name: "Suresh Nair", discipline: "MEC" },
  hse: { name: "Kavita Saikia", discipline: "HSE" },
};

type Photo = { id: number; url: string; lat: number | null; lon: number | null };
type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const IDLE_SUGGESTIONS: Record<string, Suggestion[]> = {
  en: [{ label: "What's planned today?", text: "what is planned today" }, { label: "What's delayed?", text: "what is delayed" },
    { label: "My updates today", text: "what did i report today" }, { label: "End of day", text: "end of day" },
    { label: "What can you do?", text: "help" }],
  hi: [{ label: "Aaj ka plan", text: "aaj kya plan hai" }, { label: "Kya delay hai?", text: "kya delay hai" },
    { label: "Mere updates", text: "maine aaj kya report kiya" }, { label: "Din khatam", text: "din khatam" },
    { label: "Madad", text: "madad" }],
};

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { timeout: 4000, maximumAge: 60000 });
  });
}

const initials = (n: string) => n.split(" ").map((p) => p[0]).slice(0, 2).join("");

export default function Supervisor() {
  const [params, setParams] = useSearchParams();
  const who = params.get("who") && PERSONAS[params.get("who")!] ? params.get("who")! : "piping";
  const persona = PERSONAS[who];
  const sid = `sup-${who}`;
  const toast = useToast();

  const [lang, setLang] = useState<string>(() => localStorage.getItem("karyalink-lang") || "en-IN");
  const [voiceOn, setVoiceOn] = useState<boolean>(() => localStorage.getItem("karyalink-voice") !== "off");
  const [handsFree, setHandsFree] = useState<boolean>(() => localStorage.getItem("karyalink-handsfree") !== "off");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [demoTap, setDemoTap] = useState<string | null>(null);
  const [ctx, setCtx] = useState<AssistantContext | null>(null);
  const [menu, setMenu] = useState(false);
  const [todaySheet, setTodaySheet] = useState(false);

  const stopListenRef = useRef<() => void>(() => undefined);
  const stopLevelRef = useRef<() => void>(() => undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const micOk = recognitionSupported();
  const hi = lang.startsWith("hi");

  // live refs so async voice callbacks always see current settings
  const R = useRef({ lang, voiceOn, handsFree, persona, sid, photo });
  R.current = { lang, voiceOn, handsFree, persona, sid, photo };

  useEffect(() => { localStorage.setItem("karyalink-lang", lang); }, [lang]);
  useEffect(() => { localStorage.setItem("karyalink-voice", voiceOn ? "on" : "off"); if (!voiceOn) stopSpeaking(); }, [voiceOn]);
  useEffect(() => { localStorage.setItem("karyalink-handsfree", handsFree ? "on" : "off"); }, [handsFree]);
  useEffect(() => onSpeakingChange((s) => setState((cur) => (s ? "speaking" : cur === "speaking" ? "idle" : cur))), []);

  const loadCtx = useCallback(() => { api.chatContext(sid, persona.discipline).then(setCtx).catch(() => undefined); }, [sid, persona.discipline]);
  useEffect(() => {
    setLoaded(false);
    api.chatHistory(sid).then((h) => { setMsgs(h); setLoaded(true); }).catch((e) => { setError(String(e.message ?? e)); setLoaded(true); });
    loadCtx();
  }, [sid, loadCtx]);
  useEffect(() => dataBus.on(loadCtx), [loadCtx]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, interim, state]);
  useEffect(() => () => { stopListenRef.current(); stopLevelRef.current(); stopSpeaking(); }, []);

  const pendingIdx = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") return -1;
      if (msgs[i].payload?.question && msgs[i].payload.options?.length) return i;
    }
    return -1;
  }, [msgs]);
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const suggestions = pendingIdx >= 0 ? [] : (lastAssistant?.payload?.suggestions ?? IDLE_SUGGESTIONS[hi ? "hi" : "en"]);

  // ---------------------------------------------------------------- voice
  const startListening = useCallback((auto = false) => {
    if (!recognitionSupported()) { setError("Voice input isn't supported in this browser - Chrome and Edge support it. You can type instead."); return; }
    stopSpeaking();
    setError(null);
    setInterim("");
    setState("listening");
    stopLevelRef.current = micLevel(setLevel);
    stopListenRef.current = listen(R.current.lang, {
      onInterim: setInterim,
      onFinal: (t) => { void sendRef.current(t, "voice"); },
      onError: (m, code) => { if (!(auto && code === "no-speech")) setError(m); },
      onEnd: () => { stopLevelRef.current(); setLevel(0); setState((s) => (s === "listening" ? "idle" : s)); },
    });
  }, []);

  const receive = useCallback(async (replies: ChatMsg[]) => {
    setMsgs((xs) => [...xs, ...replies]);
    const sl = replies.find((r) => r.payload?.set_lang)?.payload.set_lang;
    if (sl) setLang(sl);
    dataBus.emit();
    loadCtx();
    if (R.current.voiceOn) {
      for (const m of replies) {
        if (m.payload?.channel === "silent") continue;
        await speak(m.text, m.lang || R.current.lang);
      }
    }
    setState((s) => (s === "thinking" || s === "speaking" ? "idle" : s));
    const last = replies[replies.length - 1];
    if (R.current.handsFree && R.current.voiceOn && last?.payload?.question && last.payload.options?.length && recognitionSupported()) {
      await sleep(250);
      startListening(true);
    }
  }, [loadCtx, startListening]);

  const send = useCallback(async (raw: string, channel: "chat" | "voice" = "chat") => {
    const t = raw.trim();
    const ph = R.current.photo;
    if (!t && !ph) return;
    setError(null);
    setState("thinking");
    setMsgs((xs) => [...xs, { id: `local-${Date.now()}`, role: "user", text: t || "📷 Photo", lang: R.current.lang, report_id: null,
      payload: { photo_id: ph?.id ?? null, channel }, created_at: new Date().toISOString() }]);
    setText("");
    setInterim("");
    setPhoto(null);
    try {
      const r = await api.chat({ session_id: R.current.sid, text: t, lang: R.current.lang, reporter: R.current.persona.name,
        discipline: R.current.persona.discipline, photo_id: ph?.id ?? null, channel });
      await receive(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhoto(ph);
      setState("idle");
    }
  }, [receive]);
  const sendRef = useRef(send);
  sendRef.current = send;

  const answer = useCallback(async (value: string, label: string) => {
    setError(null);
    setState("thinking");
    stopSpeaking();
    setMsgs((xs) => [...xs, { id: `local-a-${Date.now()}`, role: "user", text: label, lang: R.current.lang, report_id: null,
      payload: { channel: "tap" }, created_at: new Date().toISOString() }]);
    try {
      const r = await api.chatAnswer({ session_id: R.current.sid, value, label, lang: R.current.lang, reporter: R.current.persona.name });
      await receive(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }, [receive]);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setState("thinking");
    setMsgs((xs) => [...xs, { id: `local-f-${Date.now()}`, role: "user", text: `📎 ${file.name}`, lang: R.current.lang, report_id: null,
      payload: { channel: "file" }, created_at: new Date().toISOString() }]);
    try {
      const r = await api.chatUpload(file, { session_id: R.current.sid, lang: R.current.lang, reporter: R.current.persona.name,
        discipline: R.current.persona.discipline, photo_id: R.current.photo?.id ?? null });
      setPhoto(null);
      await receive(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }, [receive]);

  const endOfDay = useCallback(async () => {
    setError(null);
    setState("thinking");
    setMsgs((xs) => [...xs, { id: `local-e-${Date.now()}`, role: "user", text: R.current.lang.startsWith("hi") ? "Din khatam - check karo" : "End of day check",
      lang: R.current.lang, report_id: null, payload: { channel: "eod" }, created_at: new Date().toISOString() }]);
    try {
      const r = await api.endOfDay({ session_id: R.current.sid, lang: R.current.lang, reporter: R.current.persona.name, discipline: R.current.persona.discipline });
      await receive(r.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }, [receive]);

  const attachPhoto = async (file: File) => {
    setPhotoBusy(true);
    setError(null);
    try {
      const pos = await getPosition();
      const r = await api.uploadPhoto(file, pos?.coords.latitude, pos?.coords.longitude);
      setPhoto({ id: r.id, url: r.url, lat: r.lat, lon: r.lon });
      toast("ok", pos ? "Photo attached with GPS location" : "Photo attached (GPS unavailable or not permitted)");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const clearChat = async () => {
    setMenu(false);
    try {
      await api.chatClear(sid);
      setMsgs([]);
      loadCtx();
      toast("ok", "Conversation cleared (reports and the audit trail are kept)");
    } catch (e) {
      toast("err", e instanceof Error ? e.message : String(e));
    }
  };

  // Space = push-to-talk on desktop (only when not typing)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) return;
      e.preventDefault();
      startListening();
    };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") stopListenRef.current(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [startListening]);

  // ---------------------------------------------------------------- Demo Day hooks (drive the same UI paths)
  const answerRef = useRef(answer); answerRef.current = answer;
  const uploadRef = useRef(uploadFile); uploadRef.current = uploadFile;
  const eodRef = useRef(endOfDay); eodRef.current = endOfDay;
  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  useEffect(() => demoRegistry.register("supervisor", {
    async typeAndSend(t) {
      for (let i = 1; i <= t.length; i += Math.max(1, Math.round(t.length / 60))) { setText(t.slice(0, i)); await sleep(22); }
      setText(t);
      await sleep(350);
      await sendRef.current(t, "chat");
    },
    async simulateVoice(t) {
      stopSpeaking();
      setState("listening");
      const words = t.split(/\s+/);
      for (let i = 1; i <= words.length; i++) { setInterim(words.slice(0, i).join(" ")); setLevel(0.3 + Math.random() * 0.6); await sleep(170); }
      await sleep(400);
      setLevel(0);
      await sendRef.current(t, "voice");
    },
    async tapOption(v) {
      const opts = [...msgsRef.current].reverse().find((m) => m.payload?.options?.length)?.payload.options ?? [];
      const label = opts.find((o) => o.value === v)?.label ?? v;
      setDemoTap(v); await sleep(900); setDemoTap(null);
      await answerRef.current(v, label);
    },
    async uploadFile(f) { await uploadRef.current(f); },
    async endOfDay() { await eodRef.current(); },
    setLang(l) { setLang(l); R.current.lang = l; },
  }), []);

  // a question handed over from elsewhere (dashboard ask box / search): send it once history is loaded
  const askedRef = useRef<string | null>(null);
  useEffect(() => {
    const ask = params.get("ask");
    if (!loaded || !ask || askedRef.current === ask) return;
    askedRef.current = ask;
    setParams({ who }, { replace: true });
    void sendRef.current(ask, "chat");
  }, [loaded, params, setParams, who]);

  const busy = state === "thinking";
  const insert = (t: string) => { setText((cur) => (cur ? cur.trimEnd() + " " : "") + t); inputRef.current?.focus(); };

  return (
    <div className="flex h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-4rem)]">
      <section className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{initials(persona.name)}</div>
            <select className="select h-9 w-auto max-w-[200px] border-transparent bg-transparent pl-0 font-semibold shadow-none hover:bg-ink-50 dark:hover:bg-ink-850"
              value={who} onChange={(e) => setParams({ who: e.target.value })} aria-label="Signed-in supervisor">
              {Object.entries(PERSONAS).map(([k, p]) => <option key={k} value={k}>{p.name} · {DISC[p.discipline]}</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="flex rounded-lg bg-ink-100 p-0.5 text-xs font-semibold dark:bg-ink-850" role="group" aria-label="Language">
              {[["en-IN", "EN"], ["hi-IN", "हिंदी"]].map(([v, l]) => (
                <button key={v} onClick={() => setLang(v)} className={clsx("h-7 rounded-md px-2.5 transition",
                  lang === v ? "bg-white text-ink-900 shadow-xs dark:bg-ink-700 dark:text-white" : "text-ink-500")}>{l}</button>
              ))}
            </div>
            <button className={clsx("btn-ghost btn-sm btn-icon", voiceOn && "text-brand-600 dark:text-brand-400")} onClick={() => setVoiceOn((v) => !v)}
              disabled={!synthesisSupported()} title={voiceOn ? "Replies are spoken aloud" : "Replies are muted"} aria-pressed={voiceOn} aria-label="Speak replies">
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button className={clsx("btn-ghost btn-sm btn-icon", handsFree && voiceOn && "text-brand-600 dark:text-brand-400")} onClick={() => setHandsFree((v) => !v)}
              title={handsFree ? "Hands-free: mic reopens after each question" : "Hands-free off"} aria-pressed={handsFree} aria-label="Hands-free mode">
              <Headphones className="h-4 w-4" />
            </button>
            <button className="btn-ghost btn-sm btn-icon xl:hidden" onClick={() => setTodaySheet(true)} aria-label="Today's context"><CalendarClock className="h-4 w-4" /></button>
            <div className="relative">
              <button className="btn-ghost btn-sm btn-icon" onClick={() => setMenu((m) => !m)} aria-label="More"><MoreHorizontal className="h-4 w-4" /></button>
              {menu && (
                <div className="absolute right-0 top-10 z-30 w-52 rounded-xl p-1 shadow-pop animate-fadein" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <MenuItem icon={<ListChecks className="h-4 w-4" />} onClick={() => { setMenu(false); void endOfDay(); }}>{hi ? "Din khatam check" : "End-of-day check"}</MenuItem>
                  <MenuItem icon={<Trash2 className="h-4 w-4" />} onClick={clearChat}>{hi ? "Chat saaf karein" : "Clear conversation"}</MenuItem>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* transcript */}
        <div className="flex-1 overflow-y-auto" onClick={() => menu && setMenu(false)}>
          <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-5 sm:px-5">
            {loaded && msgs.length === 0 && <Welcome name={persona.name} hi={hi} micOk={micOk} onPick={(t) => void send(t)} />}
            {msgs.map((m, i) => (
              <Bubble key={m.id} m={m} active={i === pendingIdx && !busy} onOption={answer} demoTap={demoTap} onInsert={insert} />
            ))}
            {state === "listening" && <ListeningBubble text={interim} level={level} lang={lang} hi={hi} />}
            {busy && (
              <div className="flex items-center gap-2.5 pl-11 text-xs muted animate-fadein">
                <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
                {hi ? "Schedule se mila raha hoon…" : "Linking to the schedule…"}
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* composer */}
        <div className="border-t px-3 pb-3 pt-2.5 sm:px-5" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
          <div className="mx-auto w-full max-w-3xl">
            {error && <div className="mb-2"><Alert tone="warn" action={<button className="subtle" onClick={() => setError(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>}>{error}</Alert></div>}
            {suggestions.length > 0 && state !== "listening" && (
              <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                {suggestions.map((s) => (
                  <button key={s.label} disabled={busy} onClick={() => (s.text === "end of day" || s.text === "din khatam" ? void endOfDay() : void send(s.text))}
                    className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700 disabled:opacity-50 dark:text-ink-200 dark:hover:border-brand-500/50 dark:hover:text-brand-200"
                    style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}>
                    {s.label === "Undo" && <RotateCcw className="mr-1 inline h-3 w-3" />}{s.label}
                  </button>
                ))}
              </div>
            )}
            {photo && (
              <div className="mb-2 flex items-center gap-2.5 rounded-xl border p-1.5 pr-2 text-xs" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <img src={photo.url} alt="Attached evidence" className="h-10 w-10 rounded-lg object-cover" />
                <span className="flex-1">{hi ? "Photo evidence judi" : "Photo evidence attached"} · {photo.lat !== null
                  ? <span className="text-emerald-600 dark:text-emerald-400"><MapPin className="inline h-3 w-3" /> GPS</span> : <span className="muted">no GPS</span>}</span>
                <button className="btn-ghost btn-xs btn-icon" onClick={() => setPhoto(null)} aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
              </div>
            )}
            {state === "listening" ? (
              <div className="flex items-center gap-3 rounded-2xl border-2 border-rose-400/60 px-3 py-2.5 shadow-xs" style={{ background: "var(--surface)" }}>
                <LevelBars level={level} />
                <span className="flex-1 truncate text-[13px] muted">{hi ? "Boliye… ruk jaane par main samajh lunga" : "Listening… I'll stop when you pause"}</span>
                <button className="btn-secondary btn-sm" onClick={() => { stopListenRef.current(); setInterim(""); }}>{hi ? "Ruko" : "Stop"}</button>
              </div>
            ) : (
              <form className="flex items-end gap-2 rounded-2xl border px-2 py-2 shadow-xs transition focus-within:border-brand-400 focus-within:shadow-ring"
                style={{ background: "var(--surface)", borderColor: "var(--border-strong)" }}
                onSubmit={(e) => { e.preventDefault(); void send(text); }}>
                <AttachMenu busy={busy || photoBusy} hi={hi} onPhoto={() => photoInput.current?.click()} onFile={() => fileInput.current?.click()} photoBusy={photoBusy} />
                <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachPhoto(f); e.target.value = ""; }} />
                <input ref={fileInput} type="file" accept=".txt,.csv,.xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ""; }} />
                <textarea ref={inputRef} rows={1} value={text} disabled={busy}
                  onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${Math.min(120, e.currentTarget.scrollHeight)}px`; }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }}
                  placeholder={hi ? "Progress likhiye ya sawaal puchiye…" : "Report progress or ask a question…"}
                  className="max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-5 text-ink-900 placeholder:text-ink-400 focus:outline-none dark:text-ink-50"
                  aria-label="Message" />
                {state === "speaking" && (
                  <button type="button" className="btn-secondary btn-sm h-10 shrink-0" onClick={() => stopSpeaking()} title="Stop speaking">
                    <Square className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{hi ? "Chup" : "Stop"}</span>
                  </button>
                )}
                {text.trim() || photo ? (
                  <button type="submit" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-xs transition hover:bg-brand-700 disabled:opacity-50"
                    disabled={busy} aria-label="Send"><ArrowUp className="h-5 w-5" /></button>
                ) : (
                  <MicButton ok={micOk} busy={busy} onClick={() => startListening()} hi={hi} lang={lang} />
                )}
              </form>
            )}
            <p className="mt-1.5 hidden text-center text-[11px] subtle sm:block">
              {micOk ? (hi ? "Mic dabayein ya Space dabaye rakhein · Enter se bhejein" : "Tap the mic or hold Space to talk · Enter to send · Shift+Enter for a new line")
                : "Voice input isn't available in this browser (Chrome and Edge support it) - typing works the same."}
            </p>
          </div>
        </div>
      </section>

      <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l xl:flex" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <ContextPanel ctx={ctx} hi={hi} onPick={insert} onAsk={(t) => void send(t)} />
      </aside>
      <Modal open={todaySheet} onClose={() => setTodaySheet(false)} title={hi ? "Aaj" : "Today"}>
        <ContextPanel ctx={ctx} hi={hi} embedded onPick={(t) => { setTodaySheet(false); insert(t); }} onAsk={(t) => { setTodaySheet(false); void send(t); }} />
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ pieces
function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-ink-850">
      <span className="text-ink-400">{icon}</span>{children}
    </button>
  );
}

function AttachMenu({ busy, hi, onPhoto, onFile, photoBusy }: { busy: boolean; hi: boolean; onPhoto: () => void; onFile: () => void; photoBusy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50 dark:hover:bg-ink-850 dark:hover:text-ink-100"
        onClick={() => setOpen((o) => !o)} disabled={busy} aria-label="Attach">
        {photoBusy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Paperclip className="h-[18px] w-[18px]" />}
      </button>
      {open && (
        <div className="absolute bottom-12 left-0 z-30 w-56 rounded-xl p-1 shadow-pop animate-fadein" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          onMouseLeave={() => setOpen(false)}>
          <MenuItem icon={<Camera className="h-4 w-4" />} onClick={() => { setOpen(false); onPhoto(); }}>{hi ? "Photo evidence (GPS ke saath)" : "Photo evidence (with GPS)"}</MenuItem>
          <MenuItem icon={<FileUp className="h-4 w-4" />} onClick={() => { setOpen(false); onFile(); }}>{hi ? "Report file (.txt / .xlsx)" : "Daily report or spreadsheet"}</MenuItem>
        </div>
      )}
    </div>
  );
}

function MicButton({ ok, busy, onClick, hi, lang }: { ok: boolean; busy: boolean; onClick: () => void; hi: boolean; lang: string }) {
  return (
    <button type="button" onClick={onClick} disabled={!ok || busy}
      className={clsx("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-xs transition sm:h-11 sm:w-11",
        ok ? "bg-gradient-to-b from-brand-500 to-brand-700 hover:from-brand-500 hover:to-brand-600" : "bg-ink-300 dark:bg-ink-700", busy && "opacity-60")}
      aria-label={ok ? `Speak (${lang})` : "Voice input not supported"} title={ok ? (hi ? "Boliye" : `Speak (${lang})`) : "Voice input not supported in this browser"}>
      {ok ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
    </button>
  );
}

function LevelBars({ level }: { level: number }) {
  return (
    <div className="relative flex h-8 w-8 items-center justify-center">
      <span className="absolute inset-0 animate-pulsering rounded-full bg-rose-500/40" />
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-white">
        <span className="flex h-3.5 items-center gap-[2px]">
          {[0.6, 1, 0.75].map((k, i) => (
            <span key={i} className="w-[3px] rounded-full bg-white transition-[height] duration-75" style={{ height: `${Math.max(3, Math.min(14, (level * k) * 14 + 3))}px` }} />
          ))}
        </span>
      </span>
    </div>
  );
}

function ListeningBubble({ text, level, lang, hi }: { text: string; level: number; lang: string; hi: boolean }) {
  return (
    <div className="flex justify-end animate-fadein">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-rose-300 bg-rose-50/60 px-4 py-2.5 text-sm text-ink-800 dark:border-rose-400/40 dark:bg-rose-500/5 dark:text-ink-100">
        <div className="mb-1 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-300">
          <span className="flex h-2.5 items-end gap-[2px]">{[0.5, 1, 0.7].map((k, i) => <span key={i} className="w-[2px] rounded-full bg-current" style={{ height: `${Math.max(3, level * k * 10 + 2)}px` }} />)}</span>
          {hi ? "Sun raha hoon" : "Listening"} · {lang}
        </div>
        {text || <span className="muted">{hi ? "boliye…" : "speak now…"}</span>}
      </div>
    </div>
  );
}

function Welcome({ name, hi, micOk, onPick }: { name: string; hi: boolean; micOk: boolean; onPick: (t: string) => void }) {
  const ex = hi
    ? [["Progress", "kal F-12 ka dhalai ho gaya 42 cum"], ["Sawaal", "line 1022 kitna hua?"], ["Plan", "aaj kya plan hai?"], ["Delay", "kya delay hai?"]]
    : [["Report", '3 of 12 spools erected on line 24"-P-1021 today'], ["Ask", "status of line 1022?"], ["Plan", "what is planned today?"], ["Risks", "what is delayed?"]];
  return (
    <div className="mx-auto max-w-lg py-8 text-center animate-slideup">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-pop">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-ink-900 dark:text-white">{hi ? `Namaste ${name.split(" ")[0]}` : `Good day, ${name.split(" ")[0]}`}</h2>
      <p className="mt-1 text-[13px] muted">
        {hi ? "Main aapka Site Assistant hoon. Progress boliye, sawaal puchiye, ya file bhejiye - main schedule se jod dunga."
          : "I'm your Site Assistant. Speak or type progress, ask about the schedule, or send a report file - I'll link it to the right activity."}
      </p>
      <div className="mt-5 grid grid-cols-1 gap-2 text-left sm:grid-cols-2">
        {ex.map(([k, t]) => (
          <button key={t} onClick={() => onPick(t)} className="group rounded-xl border p-3 text-left transition hover:border-brand-300 hover:shadow-card dark:hover:border-brand-500/40"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="label mb-1 group-hover:text-brand-600 dark:group-hover:text-brand-300">{k}</div>
            <div className="text-[13px] text-ink-800 dark:text-ink-100">{t}</div>
          </button>
        ))}
      </div>
      {!micOk && <p className="mt-4 text-xs text-amber-700 dark:text-amber-300">Mic not supported in this browser - typing works the same.</p>}
    </div>
  );
}

function Avatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white">
      <Sparkles className="h-4 w-4" />
    </div>
  );
}

function Flag({ level }: { level?: string | null }) {
  if (!level) return null;
  return <span className={level === "red" ? "badge-danger" : "badge-warning"}><AlertTriangle className="h-3 w-3" />{level}</span>;
}

function ItemRow({ it, onInsert }: { it: ChatItem; onInsert?: (t: string) => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink-800 dark:text-ink-100">{it.name}</span>
          <Flag level={it.flag} />
        </div>
        {(it.detail || it.planned_finish) && <div className="truncate text-2xs muted">{it.detail ?? `plan finish ${fmtDate(it.planned_finish)}`}</div>}
      </div>
      {typeof it.pct === "number" && (
        <div className="flex w-24 shrink-0 items-center gap-2"><ProgressBar value={it.pct} size="sm" tone={it.pct >= 100 ? "good" : "brand"} /><span className="w-8 text-right text-2xs font-semibold num">{Math.round(it.pct)}%</span></div>
      )}
      {onInsert && it.activity_id && (
        <button className="btn-ghost btn-xs shrink-0" onClick={() => onInsert(`${it.tag ?? it.name} `)} title="Report on this">Report</button>
      )}
    </li>
  );
}

function Bubble({ m, active, onOption, demoTap, onInsert }: {
  m: ChatMsg; active: boolean; onOption: (v: string, label: string) => void; demoTap: string | null; onInsert: (t: string) => void;
}) {
  const mine = m.role === "user";
  const p = m.payload ?? {};
  if (mine) {
    return (
      <div className="flex justify-end animate-slideup">
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm leading-6 text-white shadow-xs">
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
            {p.photo_id ? <img src={`/api/photos/${p.photo_id}`} alt="Evidence" className="mt-2 max-h-44 rounded-lg object-cover" /> : null}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1.5 pr-1 text-2xs subtle">
            {p.channel === "voice" && <><Mic className="h-3 w-3" /> voice ·</>}
            {p.channel === "tap" && <><Check className="h-3 w-3" /> tapped ·</>}
            {m.created_at && fmtTime(m.created_at)}
          </div>
        </div>
      </div>
    );
  }
  const applied = p.status === "applied";
  return (
    <div className="flex gap-3 animate-slideup">
      <Avatar />
      <div className="min-w-0 max-w-[88%] flex-1">
        <div className="rounded-2xl rounded-tl-md border px-4 py-3 text-sm leading-6 text-ink-800 shadow-xs dark:text-ink-100"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          {p.decision && (
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              {applied && p.decision !== "AUTO_APPLY"
                ? <span className="badge-success"><Check className="h-3 w-3" />{p.decision === "CONFIRM_SEQUENCE" ? "Applied · sequence confirmed" : p.decision === "REVIEW" ? "Applied · corrected" : "Applied · clarified"}</span>
                : p.status === "reverted" ? <span className="badge-neutral"><RotateCcw className="h-3 w-3" />Undone</span>
                : <DecisionBadge kind={p.decision} />}
              {typeof p.confidence === "number" && <span className="text-2xs muted num">{Math.round(p.confidence * 100)}% confidence</span>}
            </div>
          )}
          <p className="whitespace-pre-wrap break-words">{m.text}</p>

          {(p.kind === "update" && typeof p.pct === "number" && p.activity_name) && (
            <div className="mt-2.5 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium">{p.activity_name}</span><span className="font-semibold num">{Math.round(p.pct)}%</span></div>
              <ProgressBar value={p.pct} size="sm" tone={p.pct >= 100 ? "good" : "brand"} />
            </div>
          )}
          {(p.kind === "status" || p.kind === "list") && p.items && p.items.length > 0 && (
            <div className="mt-2.5 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
              {p.title && <div className="label border-b px-3 py-1.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>{p.title}</div>}
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {p.items.slice(0, 8).map((it, i) => <ItemRow key={`${it.activity_id ?? i}-${i}`} it={it} />)}
              </ul>
            </div>
          )}
          {p.kind === "help" && p.items && (
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
              {p.items.map((it) => (
                <button key={it.title} onClick={() => onInsert(it.detail?.split(" · ")[0].split(" (")[0] ?? "")}
                  className="rounded-lg border px-3 py-2 text-left transition hover:border-brand-300 dark:hover:border-brand-500/40" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <div className="text-xs font-semibold text-ink-800 dark:text-ink-100">{it.title}</div>
                  <div className="truncate text-2xs muted">{it.detail}</div>
                </button>
              ))}
            </div>
          )}
          {p.kind === "why" && p.reasons && <div className="mt-2.5"><ReasonChips reasons={p.reasons} /></div>}
          {p.options && p.options.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {p.options.map((o) => (
                <button key={o.value} disabled={!active} onClick={() => onOption(o.value, o.label)}
                  className={clsx("h-8 rounded-lg border px-3 text-xs font-semibold transition",
                    active ? (o.value === "none" || o.value === "reject" || o.value === "skip" || o.value === "stop"
                      ? "border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-850"
                      : "border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-500/20")
                      : "cursor-default border-ink-100 text-ink-400 dark:border-ink-800 dark:text-ink-600",
                    demoTap === o.value && active && "scale-105 ring-4 ring-brand-300/60")}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 pl-1 text-2xs subtle">
          {m.created_at && fmtTime(m.created_at)}
          {synthesisSupported() && p.channel !== "silent" && (
            <button className="inline-flex items-center gap-1 hover:text-brand-600" onClick={() => void speak(m.text, m.lang)} aria-label="Play reply aloud">
              <Volume2 className="h-3 w-3" /> play
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ ctx, hi, onPick, onAsk, embedded }: {
  ctx: AssistantContext | null; hi: boolean; onPick: (t: string) => void; onAsk: (t: string) => void; embedded?: boolean;
}) {
  if (!ctx) return <div className="p-5"><div className="skeleton h-24" /></div>;
  return (
    <div className={clsx(!embedded && "p-5")}>
      <div className="label">{hi ? "Aaj" : "Today"} · {fmtDate(ctx.data_date)}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat label={hi ? "Planned" : "Planned"} value={ctx.planned_total} />
        <MiniStat label={hi ? "Update baaki" : "No update yet"} value={ctx.pending_today} tone={ctx.pending_today ? "warn" : "good"} />
        <MiniStat label={hi ? "Mere updates" : "My updates"} value={`${ctx.my_applied_today}/${ctx.my_updates_today}`} />
        <MiniStat label={hi ? "Delay flags" : "Delay flags"} value={ctx.delays} tone={ctx.delays ? "bad" : "good"} onClick={() => onAsk(hi ? "kya delay hai" : "what is delayed")} />
      </div>
      {ctx.last_activity && (
        <div className="mt-5">
          <div className="label mb-2">{hi ? "Pichla kaam" : "Last activity"}</div>
          <div className="rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <div className="text-[13px] font-medium">{ctx.last_activity.name}</div>
            <div className="mt-2 flex items-center gap-2"><ProgressBar value={ctx.last_activity.pct ?? 0} size="sm" /><span className="text-2xs font-semibold num">{Math.round(ctx.last_activity.pct ?? 0)}%</span></div>
            <p className="mt-2 text-2xs muted">{hi ? "Follow-up ke liye bas boliye: “aur 2 ho gaye”" : "Follow up without the tag: “2 more done”"}</p>
          </div>
        </div>
      )}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between"><span className="label">{hi ? "Aaj ke planned kaam" : "Planned for you today"}</span></div>
        {ctx.planned_today.length === 0 ? <p className="text-xs muted">{hi ? "Aaj kuch planned nahi." : "Nothing planned today."}</p> : (
          <ul className="space-y-1">
            {ctx.planned_today.map((a) => (
              <li key={a.activity_id ?? a.name}>
                <button onClick={() => onPick(`${a.tag ?? a.name} `)} className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50 dark:hover:bg-ink-850"
                  title={hi ? "Is kaam ka update likhein" : "Start an update for this activity"}>
                  <span className={clsx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", a.updated_today ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink-300 dark:border-ink-600")}>
                    {a.updated_today && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink-800 dark:text-ink-100">{a.name}</span>
                    <span className="block text-2xs muted">{Math.round(a.pct ?? 0)}% · {hi ? "due" : "due"} {fmtDate(a.planned_finish)}</span>
                  </span>
                  {a.flag && <span className={clsx("dot", a.flag === "red" ? "bg-rose-500" : "bg-amber-500")} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-5 rounded-xl border border-dashed p-3 text-2xs leading-5 muted" style={{ borderColor: "var(--border-strong)" }}>
        <div className="mb-1 font-semibold text-ink-700 dark:text-ink-200">{hi ? "Aap yeh bhi keh sakte hain" : "You can also say"}</div>
        “undo” · “why?” · “no, it was line 1022” · “F-12 pour done and CT-B-07 pulling started” · “hindi mein bolo”
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone, onClick }: { label: string; value: ReactNode; tone?: "good" | "warn" | "bad"; onClick?: () => void }) {
  const c = tone === "bad" ? "text-rose-600 dark:text-rose-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "text-ink-900 dark:text-white";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={clsx("rounded-xl border px-3 py-2 text-left", onClick && "transition hover:border-brand-300")} style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <div className="text-2xs muted">{label}</div>
      <div className={clsx("text-lg font-semibold num", c)}>{value}</div>
    </Tag>
  );
}
