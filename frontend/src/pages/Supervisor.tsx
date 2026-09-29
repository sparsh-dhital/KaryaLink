import clsx from "clsx";
import {
  Camera, CheckCheck, ClipboardList, FileUp, Loader2, MapPin, Mic, MicOff, Moon, Send, Volume2, VolumeX, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DecisionBadge, ErrorBanner, useToast } from "../components/ui";
import { dataBus, demoRegistry, sleep } from "../lib/demo";
import { DISC } from "../lib/format";
import { listen, recognitionSupported, speak, stopSpeaking, synthesisSupported } from "../lib/speech";
import type { ChatMsg } from "../types";

export const PERSONAS: Record<string, { name: string; discipline: string }> = {
  piping: { name: "Anil Borah", discipline: "PIP" },
  electrical: { name: "Priya Das", discipline: "ELE" },
  civil: { name: "Rakesh Gogoi", discipline: "CIV" },
  instrumentation: { name: "Imran Hussain", discipline: "INS" },
  mechanical: { name: "Suresh Nair", discipline: "MEC" },
  hse: { name: "Kavita Saikia", discipline: "HSE" },
};

type Photo = { id: number; url: string; lat: number | null; lon: number | null; sha256: string };

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p), () => resolve(null), { timeout: 4000, maximumAge: 60000 });
  });
}

export default function Supervisor() {
  const [params, setParams] = useSearchParams();
  const who = params.get("who") && PERSONAS[params.get("who")!] ? params.get("who")! : "piping";
  const persona = PERSONAS[who];
  const sid = `sup-${who}`;
  const [lang, setLang] = useState<string>(() => localStorage.getItem("sitesync-lang") || "en-IN");
  const [voiceOn, setVoiceOn] = useState<boolean>(() => localStorage.getItem("sitesync-voice") !== "off");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [demoTap, setDemoTap] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const micOk = recognitionSupported();
  const langRef = useRef(lang);
  langRef.current = lang;
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  useEffect(() => { localStorage.setItem("sitesync-lang", lang); }, [lang]);
  useEffect(() => { localStorage.setItem("sitesync-voice", voiceOn ? "on" : "off"); if (!voiceOn) stopSpeaking(); }, [voiceOn]);

  const loadHistory = useCallback(() => {
    api.chatHistory(sid).then(setMsgs).catch(setError);
  }, [sid]);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, interim, busy]);

  const pendingIdx = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") return -1;
      if (msgs[i].payload?.question && msgs[i].payload.options?.length) return i;
    }
    return -1;
  }, [msgs]);

  const speakReplies = useCallback(async (replies: ChatMsg[]) => {
    if (!voiceRef.current) return;
    for (const m of replies) {
      if (m.payload?.channel !== "silent") await speak(m.text, m.lang || langRef.current);
    }
  }, []);

  const receive = useCallback(async (replies: ChatMsg[]) => {
    setMsgs((xs) => [...xs, ...replies]);
    dataBus.emit();
    await speakReplies(replies);
  }, [speakReplies]);

  const send = useCallback(async (raw: string, channel: "chat" | "voice" = "chat") => {
    const t = raw.trim();
    if (!t || busy) return;
    setError(null);
    setBusy(true);
    const local: ChatMsg = { id: `local-${Date.now()}`, role: "user", text: t, lang: langRef.current, report_id: null,
      payload: { photo_id: photo?.id ?? null, channel } };
    setMsgs((xs) => [...xs, local]);
    setText("");
    setInterim("");
    const ph = photo;
    setPhoto(null);
    try {
      const r = await api.chat({ session_id: sid, text: t, lang: langRef.current, reporter: persona.name,
        discipline: persona.discipline, photo_id: ph?.id ?? null, channel });
      setBusy(false);
      await receive(r.messages);
    } catch (e) {
      setError(e);
      setPhoto(ph);
      setBusy(false);
    }
  }, [busy, photo, sid, persona, receive]);

  const answer = useCallback(async (value: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.chatAnswer({ session_id: sid, value, lang: langRef.current, reporter: persona.name });
      const opt = msgs[pendingIdx]?.payload.options?.find((o) => o.value === value);
      setMsgs((xs) => [...xs, { id: `local-a-${Date.now()}`, role: "user", text: opt?.label ?? value, lang: langRef.current,
        report_id: null, payload: { channel: "tap" } }]);
      setBusy(false);
      await receive(r.messages);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }, [sid, persona, msgs, pendingIdx, receive]);

  const startMic = useCallback(() => {
    if (listening) { stopRef.current(); return; }
    stopSpeaking();
    setError(null);
    setInterim("");
    setListening(true);
    stopRef.current = listen(langRef.current, {
      onInterim: setInterim,
      onFinal: (t) => { void send(t, "voice"); },
      onError: (m) => setError(new Error(m)),
      onEnd: () => setListening(false),
    });
  }, [listening, send]);

  const attachPhoto = async (file: File) => {
    setPhotoBusy(true);
    setError(null);
    try {
      const pos = await getPosition();
      const r = await api.uploadPhoto(file, pos?.coords.latitude, pos?.coords.longitude);
      setPhoto({ id: r.id, url: r.url, lat: r.lat, lon: r.lon, sha256: r.sha256 });
      toast("ok", pos ? "Photo attached with GPS location" : "Photo attached (no GPS - permission denied or unavailable)");
    } catch (e) {
      setError(e);
    } finally {
      setPhotoBusy(false);
    }
  };

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setBusy(true);
    setMsgs((xs) => [...xs, { id: `local-f-${Date.now()}`, role: "user", text: `📎 Uploaded ${file.name}`, lang: langRef.current,
      report_id: null, payload: { channel: "file" } }]);
    try {
      const r = await api.uploadReportFile(file, persona.name, persona.discipline, photo?.id ?? null);
      const n = r.reports.length;
      const auto = r.reports.filter((x) => x.status === "applied").length;
      const review = r.reports.filter((x) => x.status.startsWith("awaiting")).length;
      const hi = langRef.current.startsWith("hi");
      const summary = hi
        ? `File se ${n} progress lines mili: ${auto} auto-apply, ${review} planner review ke liye. ${r.informational_lines.length} info lines log me rakhi.`
        : `I read ${n} progress lines from ${file.name}: ${auto} applied automatically, ${review} sent for planner review. ${r.informational_lines.length} informational line(s) were kept in the log, not dropped.`;
      const detail = r.reports.map((x) => `• ${x.text} → ${x.decision === "AUTO_APPLY" ? "applied" : x.decision.toLowerCase().replace("_", " ")}`).join("\n");
      setBusy(false);
      const now = Date.now();
      const replies: ChatMsg[] = [{ id: `local-s-${now}`, role: "assistant", text: summary, lang: langRef.current, report_id: null, payload: {} }];
      if (detail) replies.push({ id: `local-d-${now}`, role: "assistant", text: detail, lang: langRef.current, report_id: null, payload: { channel: "silent" } });
      await receive(replies);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }, [persona, photo, receive]);

  const endOfDay = useCallback(async () => {
    setError(null);
    setBusy(true);
    setMsgs((xs) => [...xs, { id: `local-e-${Date.now()}`, role: "user", text: langRef.current.startsWith("hi") ? "Din khatam - check karo" : "End of day check", lang: langRef.current, report_id: null, payload: {} }]);
    try {
      const r = await api.endOfDay({ session_id: sid, lang: langRef.current, reporter: persona.name, discipline: persona.discipline });
      setBusy(false);
      await receive(r.messages);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }, [sid, persona, receive]);

  // ---- Demo Day hooks: drive the same UI paths a person would use
  const sendRef = useRef(send); sendRef.current = send;
  const answerRef = useRef(answer); answerRef.current = answer;
  const uploadRef = useRef(uploadFile); uploadRef.current = uploadFile;
  const eodRef = useRef(endOfDay); eodRef.current = endOfDay;
  useEffect(() => demoRegistry.register("supervisor", {
    async typeAndSend(t) {
      for (let i = 1; i <= t.length; i += Math.max(1, Math.round(t.length / 60))) { setText(t.slice(0, i)); await sleep(22); }
      setText(t);
      await sleep(350);
      await sendRef.current(t, "chat");
    },
    async simulateVoice(t) {
      stopSpeaking();
      setListening(true);
      const words = t.split(/\s+/);
      for (let i = 1; i <= words.length; i++) { setInterim(words.slice(0, i).join(" ")); await sleep(170); }
      await sleep(400);
      setListening(false);
      await sendRef.current(t, "voice");
    },
    async tapOption(v) { setDemoTap(v); await sleep(900); setDemoTap(null); await answerRef.current(v); },
    async uploadFile(f) { await uploadRef.current(f); },
    async endOfDay() { await eodRef.current(); },
    setLang(l) { setLang(l); langRef.current = l; },
  }), []);

  const hi = lang.startsWith("hi");
  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-2xl flex-col lg:h-[calc(100dvh-4rem)]">
      {/* persona + controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 bg-white px-3 py-2 dark:border-ink-800 dark:bg-ink-900">
        <select className="select w-auto py-1.5 text-sm" value={who} onChange={(e) => setParams({ who: e.target.value })} aria-label="Supervisor">
          {Object.entries(PERSONAS).map(([k, p]) => <option key={k} value={k}>{p.name} · {DISC[p.discipline]}</option>)}
        </select>
        <div className="flex overflow-hidden rounded-lg border border-ink-200 text-xs font-semibold dark:border-ink-700" role="group" aria-label="Language">
          {[["en-IN", "EN"], ["hi-IN", "हिंदी"]].map(([v, l]) => (
            <button key={v} onClick={() => setLang(v)} className={clsx("px-2.5 py-1.5", lang === v ? "bg-brand-600 text-white" : "hover:bg-ink-100 dark:hover:bg-ink-800")}>{l}</button>
          ))}
        </div>
        <button className="btn-ghost btn-sm" onClick={() => setVoiceOn((v) => !v)} disabled={!synthesisSupported()}
          title={voiceOn ? "Assistant speaks replies" : "Assistant is muted"}>
          {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          <span className="hidden sm:inline">{voiceOn ? "Voice on" : "Muted"}</span>
        </button>
        <span className={clsx("ml-auto text-[11px] font-medium", micOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
          {micOk ? "● Mic ready" : "Mic not supported"}
        </span>
      </div>

      {!micOk && (
        <div className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          Voice input isn't supported in this browser (Chrome and Edge support it). You can type updates - everything else works the same.
        </div>
      )}

      {/* transcript */}
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {msgs.length === 0 && (
          <div className="card mx-auto max-w-md p-4 text-center text-sm">
            <p className="font-semibold">{hi ? `Namaste ${persona.name.split(" ")[0]}!` : `Hi ${persona.name.split(" ")[0]}, I'm your Site Assistant.`}</p>
            <p className="mt-1 muted">{hi ? "Mic dabakar progress boliye ya type kariye." : "Tap the mic and say your progress, or type it."}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {(hi ? ["kal F-12 ka dhalai ho gaya 42 cum", "line 1022 ke 3 spool erect ho gaye"] :
                ['3 of 12 spools erected on line 24"-P-1021 today', "CT-B-07 cable pulling started"]).map((s) => (
                <button key={s} className="chip-brand cursor-pointer hover:opacity-80" onClick={() => setText(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <Bubble key={m.id} m={m} active={i === pendingIdx && !busy} onOption={answer} demoTap={demoTap} />
        ))}
        {listening && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-sm border-2 border-dashed border-brand-400 bg-brand-50 px-3.5 py-2 text-sm text-brand-900 dark:bg-brand-500/10 dark:text-brand-100">
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> {hi ? "Sun raha hoon…" : "Listening…"} ({lang})
              </div>
              {interim || <span className="muted">{hi ? "boliye…" : "speak now…"}</span>}
            </div>
          </div>
        )}
        {busy && <div className="flex items-center gap-2 text-xs muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {hi ? "Samajh raha hoon…" : "Linking to schedule…"}</div>}
        <div ref={endRef} />
      </div>

      {error ? <div className="px-3 pb-2"><ErrorBanner error={error} /></div> : null}

      {/* composer */}
      <div className="border-t border-ink-200 bg-white px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 dark:border-ink-800 dark:bg-ink-900">
        {photo && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-ink-50 p-1.5 pr-2 text-xs dark:bg-ink-800">
            <img src={photo.url} alt="attached evidence" className="h-10 w-10 rounded object-cover" />
            <span className="flex-1">Photo evidence attached {photo.lat !== null ? <span className="text-emerald-600 dark:text-emerald-400"><MapPin className="inline h-3 w-3" /> GPS</span> : <span className="muted">(no GPS)</span>}</span>
            <button className="btn-ghost btn-sm" onClick={() => setPhoto(null)} aria-label="Remove photo"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <button type="button" className="btn-secondary px-2.5" onClick={() => photoInput.current?.click()} disabled={photoBusy} aria-label="Attach photo" title="Attach photo evidence">
            {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </button>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachPhoto(f); e.target.value = ""; }} />
          <input className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder={hi ? "Progress likhiye… (jaise: CT-B-07 cable pulling shuru)" : "Type progress… e.g. F-12 pour done 42 cum"} aria-label="Message" />
          <button type="submit" className="btn-primary px-3" disabled={busy || !text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
        </form>
        <div className="mt-3 flex items-center justify-between">
          <button className="btn-ghost btn-sm" onClick={() => fileInput.current?.click()} disabled={busy} title="Upload daily report (.txt) or spreadsheet (.csv/.xlsx)">
            <FileUp className="h-4 w-4" /> {hi ? "File" : "Report file"}
          </button>
          <input ref={fileInput} type="file" accept=".txt,.csv,.xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ""; }} />
          <div className="relative">
            {listening && <span className="absolute inset-0 animate-pulsering rounded-full bg-rose-500/40" />}
            <button onClick={startMic} disabled={!micOk || busy}
              className={clsx("relative flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-300",
                listening ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-600 hover:bg-brand-700", (!micOk || busy) && "opacity-50")}
              aria-label={listening ? "Stop listening" : "Start voice input"} title={micOk ? (listening ? "Stop" : `Speak (${lang})`) : "Mic not supported in this browser"}>
              {micOk ? <Mic className="h-7 w-7" /> : <MicOff className="h-7 w-7" />}
            </button>
          </div>
          <button className="btn-ghost btn-sm" onClick={endOfDay} disabled={busy} title="Compare today's planned activities with reports received">
            <Moon className="h-4 w-4" /> {hi ? "Din khatam" : "End of day"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, active, onOption, demoTap }: { m: ChatMsg; active: boolean; onOption: (v: string) => void; demoTap: string | null }) {
  const mine = m.role === "user";
  return (
    <div className={clsx("flex animate-slideup", mine ? "justify-end" : "justify-start")}>
      <div className={clsx("max-w-[88%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
        mine ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm border border-ink-200 bg-white dark:border-ink-700 dark:bg-ink-800")}>
        {!mine && m.payload?.decision && (
          <div className="mb-1 flex items-center gap-2">
            {m.payload.status === "applied" && m.payload.decision !== "AUTO_APPLY"
              ? <span className="chip-pos">Applied · {m.payload.decision === "CONFIRM_SEQUENCE" ? "sequence confirmed" : "clarified"}</span>
              : <DecisionBadge kind={m.payload.decision} />}
            {typeof m.payload.confidence === "number" && <span className="text-[11px] muted">{Math.round(m.payload.confidence * 100)}% confidence</span>}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        {mine && m.payload?.photo_id ? (
          <img src={`/api/photos/${m.payload.photo_id}`} alt="evidence" className="mt-2 max-h-40 rounded-lg object-cover" />
        ) : null}
        {mine && m.payload?.channel === "voice" && <p className="mt-0.5 text-[10px] opacity-75"><Mic className="inline h-3 w-3" /> voice</p>}
        {!mine && m.payload?.gaps && m.payload.gaps.length > 3 && (
          <details className="mt-1 text-xs muted"><summary className="cursor-pointer">All {m.payload.gaps.length} gaps</summary>
            <ul className="mt-1 list-disc pl-4">{m.payload.gaps.map((g) => <li key={g.activity_id}>{g.name}</li>)}</ul></details>
        )}
        {!mine && m.payload?.options && m.payload.options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.payload.options.map((o) => (
              <button key={o.value} disabled={!active} onClick={() => onOption(o.value)}
                className={clsx("rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  active ? "border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-200"
                    : "border-ink-200 text-ink-400 dark:border-ink-700",
                  demoTap === o.value && active && "ring-4 ring-brand-400 scale-105")}>
                {o.value === "confirm" && <CheckCheck className="mr-1 inline h-3.5 w-3.5" />}
                {o.value === "progress" && <ClipboardList className="mr-1 inline h-3.5 w-3.5" />}
                {o.label}
              </button>
            ))}
          </div>
        )}
        {!mine && synthesisSupported() && m.payload?.channel !== "silent" && (
          <button className="mt-1 text-[11px] muted hover:text-brand-600" onClick={() => void speak(m.text, m.lang)} aria-label="Play reply">
            <Volume2 className="inline h-3 w-3" /> play
          </button>
        )}
      </div>
    </div>
  );
}
