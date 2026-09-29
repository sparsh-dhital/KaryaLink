import { Clapperboard, Loader2, Play, Square } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type DemoStep } from "../api";
import { dataBus, demoRegistry, sleep } from "../lib/demo";
import { stopSpeaking } from "../lib/speech";
import { Modal, useToast } from "./ui";

interface DemoCtx { open: () => void; running: boolean }
const Ctx = createContext<DemoCtx>({ open: () => undefined, running: false });
export const useDemo = () => useContext(Ctx);

class Stopped extends Error {}

export function DemoProvider({ children, onMetaChange }: { children: ReactNode; onMetaChange: () => void }) {
  const [intro, setIntro] = useState(false);
  const [running, setRunning] = useState(false);
  const [narr, setNarr] = useState<{ i: number; n: number; title: string; text: string } | null>(null);
  const [done, setDone] = useState<{ notes: string[]; error?: string; seconds: number } | null>(null);
  const stop = useRef(false);
  const navigate = useNavigate();
  const toast = useToast();

  const check = () => { if (stop.current) throw new Stopped(); };
  const wait = async (ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { check(); await sleep(Math.min(200, end - Date.now())); } };

  const run = useCallback(async () => {
    setIntro(false);
    setDone(null);
    setRunning(true);
    stop.current = false;
    const t0 = Date.now();
    let notes: string[] = [];
    try {
      setNarr({ i: 0, n: 0, title: "Load schedule", text: "Resetting the demo database and loading the GGS-7 schedule: 444 L5/L6 activities across 6 units and 6 disciplines, with WBS L1-L6 and logic links." });
      await api.demoReset();
      navigate("/");
      onMetaChange();
      dataBus.emit();
      await wait(4500);
      const script = await api.demoScript();
      notes = script.notes;
      const steps = script.steps;
      for (let i = 0; i < steps.length; i++) {
        check();
        const s: DemoStep = steps[i];
        setNarr({ i: i + 1, n: steps.length, title: titleFor(s), text: s.narration });
        await runStep(s);
        dataBus.emit();
        await wait(1400);
      }
      setDone({ notes, seconds: Math.round((Date.now() - t0) / 1000) });
    } catch (e) {
      if (!(e instanceof Stopped)) setDone({ notes, error: e instanceof Error ? e.message : String(e), seconds: Math.round((Date.now() - t0) / 1000) });
    } finally {
      stopSpeaking();
      setRunning(false);
      setNarr(null);
      dataBus.emit();
    }

    async function runStep(s: DemoStep) {
      switch (s.type) {
        case "chat":
        case "voice": {
          navigate(`/supervisor?who=${s.who}`);
          const h = await demoRegistry.get("supervisor");
          await wait(700);
          h.setLang(s.lang || "en-IN");
          await wait(500);
          if (s.type === "chat") await h.typeAndSend(s.text || "");
          else await h.simulateVoice(s.text || "");
          check();
          if (s.spoken_answer && s.type === "voice") { await wait(1500); await h.simulateVoice(s.spoken_answer); }
          else if (s.answer_value) { await wait(1800); await h.tapOption(s.answer_value); }
          return;
        }
        case "upload_sample": {
          navigate(`/supervisor?who=${s.who}`);
          const h = await demoRegistry.get("supervisor");
          await wait(700);
          h.setLang(s.lang || "en-IN");
          await h.uploadFile(await api.sampleFile(s.sample || ""));
          await wait(2500);
          return;
        }
        case "planner_reassign": {
          navigate("/planner");
          const p = await demoRegistry.get("planner");
          await wait(800);
          await p.select(s.report_id!);
          await p.reassign(s.report_id!, s.activity_id!);
          return;
        }
        case "planner_batch": {
          navigate("/planner");
          const p = await demoRegistry.get("planner");
          await wait(1200);
          const r = await api.demoBatch(s.n ?? 25);
          toast("info", `Scripted planner (synthetic truth): ${r.approve} approved, ${r.reassign} reassigned, ${r.new_activity} new activities, ${r.skipped} skipped`);
          await p.refresh();
          await wait(2500);
          return;
        }
        case "end_of_day": {
          navigate(`/supervisor?who=${s.who}`);
          const h = await demoRegistry.get("supervisor");
          await wait(700);
          h.setLang(s.lang || "en-IN");
          await h.endOfDay();
          await wait(1500);
          await h.tapOption("progress");
          await wait(1200);
          await h.tapOption("stop");
          return;
        }
        case "retrain": {
          navigate("/evaluation");
          const ev = await demoRegistry.get("evaluation");
          await wait(2500);
          await ev.retrain();
          await wait(3000);
          return;
        }
        case "metrics": {
          navigate("/evaluation");
          const ev = await demoRegistry.get("evaluation");
          ev.setSplit("test");
          await wait(5000);
          ev.setSplit("hard");
          await wait(5000);
          return;
        }
      }
    }
  }, [navigate, onMetaChange, toast]);

  return (
    <Ctx.Provider value={{ open: () => setIntro(true), running }}>
      {children}
      <Modal open={intro} onClose={() => setIntro(false)} title="Demo Day - scripted 3-minute scenario">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Reset the demo database and load the schedule</li>
          <li>Supervisor 1 (piping) types a formal English update → auto-applied</li>
          <li>Supervisor 2 uploads a daily report file</li>
          <li>Supervisor 3 (civil) speaks Hinglish → assistant replies aloud</li>
          <li>An ambiguous update → one clarifying question, answered by voice</li>
          <li>An out-of-order hydrotest → sequence warning, confirmed and logged</li>
          <li>Unplanned work → new-activity proposal</li>
          <li>Planner correction (R), scripted planner clears the queue</li>
          <li>End-of-day missing-update chaser</li>
          <li>Retrain with corrections → evaluation page</li>
        </ol>
        <p className="mt-3 text-xs muted">Everything runs through the real engine and API. Turn your speakers on - replies are spoken with the browser voice. The reset clears changes you made.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setIntro(false)}>Cancel</button>
          <button className="btn-primary" onClick={() => void run()}><Play className="h-4 w-4" /> Start Demo Day</button>
        </div>
      </Modal>
      <Modal open={!!done} onClose={() => setDone(null)} title={done?.error ? "Demo stopped with an error" : "Demo Day complete"}>
        {done?.error ? <p className="text-sm text-rose-600 dark:text-rose-300">{done.error}</p>
          : <p className="text-sm">Scenario finished in {done?.seconds}s. The metrics shown were measured live on the synthetic benchmark.</p>}
        {done && done.notes.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs muted">{done.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <div className="mt-4 flex justify-end"><button className="btn-primary" onClick={() => setDone(null)}>Close</button></div>
      </Modal>
      {running && (
        <div className="fixed inset-x-0 bottom-0 z-[55] p-3 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(720px,92vw)] sm:-translate-x-1/2 sm:p-0">
          <div className="card flex items-start gap-3 border-brand-300 px-4 py-3 shadow-lg dark:border-brand-500/40">
            <Clapperboard className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-brand-700 dark:text-brand-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> DEMO DAY {narr ? (narr.n ? `· step ${narr.i}/${narr.n}` : "· setup") : ""} · {narr?.title}
              </div>
              <p className="mt-0.5 text-sm">{narr?.text}</p>
              {narr && <div className="mt-2 h-1 overflow-hidden rounded bg-ink-100 dark:bg-ink-800"><div className="h-full bg-brand-500 transition-all" style={{ width: `${(narr.i / narr.n) * 100}%` }} /></div>}
            </div>
            <button className="btn-secondary btn-sm" onClick={() => { stop.current = true; stopSpeaking(); }}><Square className="h-3.5 w-3.5" /> Stop</button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

function titleFor(s: DemoStep): string {
  return ({
    formal: "Formal English update", file: "Daily report file", hinglish: "Hinglish voice update", clarify: "Clarification",
    sequence: "Out-of-order warning", new: "New-activity flag", correction: "Planner correction", planner_batch: "Planner clears queue",
    eod: "End-of-day chaser", retrain: "Retrain", metrics: "Evaluation",
  } as Record<string, string>)[s.id] ?? s.id;
}
