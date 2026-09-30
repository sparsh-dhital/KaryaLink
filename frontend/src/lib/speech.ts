// Browser Web Speech API helpers (SpeechRecognition + speechSynthesis) with the reliability fixes
// the Site Assistant needs: typed shims, friendly errors, sentence-chunked TTS (Chrome truncates long
// utterances), Hinglish-aware voice choice, a speaking-state subscription and a live mic level meter.

interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null; onspeechend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SRInstance;

function ctor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const recognitionSupported = (): boolean => ctor() !== null;
export const synthesisSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string, code: string) => void;
  onEnd: () => void;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission was denied. Allow the mic in the address bar, or type your update.",
  "service-not-allowed": "Speech recognition is blocked in this browser. Please type your update.",
  "no-speech": "I didn't hear anything - tap the mic and try again.",
  "audio-capture": "No microphone was found. Please type your update.",
  network: "The browser's speech service is unreachable (it needs internet). Please type your update.",
  "language-not-supported": "This browser can't recognise that language. Switch language or type instead.",
};

/** Start one recognition turn. Returns stop(). Silence ends the turn automatically. */
export function listen(lang: string, h: ListenHandlers, { maxMs = 15000 } = {}): () => void {
  const C = ctor();
  if (!C) {
    h.onError("Speech recognition is not supported in this browser (use Chrome or Edge). You can type instead.", "unsupported");
    h.onEnd();
    return () => undefined;
  }
  const rec = new C();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let interimText = "";
  let ended = false;
  const guard = setTimeout(() => { try { rec.stop(); } catch { /* noop */ } }, maxMs);
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    interimText = interim;
    h.onInterim((finalText + interim).trim());
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    h.onError(ERRORS[e.error] || `Speech recognition error: ${e.error}`, e.error);
  };
  rec.onend = () => {
    if (ended) return;
    ended = true;
    clearTimeout(guard);
    // some engines end without flagging the last chunk final - keep what the user saw
    const text = (finalText || interimText).trim();
    if (text) h.onFinal(text);
    h.onEnd();
  };
  try {
    rec.start();
  } catch (err) {
    clearTimeout(guard);
    h.onError(String(err), "start-failed");
    h.onEnd();
  }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

/** Live microphone level (0..1) for the listening indicator. Returns stop(). Silently no-ops if unavailable. */
export function micLevel(onLevel: (v: number) => void): () => void {
  let stopped = false;
  let raf = 0;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!md?.getUserMedia) return () => undefined;
  md.getUserMedia({ audio: true }).then((s) => {
    if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(s).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (stopped) return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) sum += ((b - 128) / 128) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }).catch(() => undefined);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => undefined);
    onLevel(0);
  };
}

// ------------------------------------------------------------------ text to speech
let voicesCache: SpeechSynthesisVoice[] = [];
function voices(): SpeechSynthesisVoice[] {
  if (!synthesisSupported()) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) voicesCache = v;
  return voicesCache;
}
if (synthesisSupported()) {
  window.speechSynthesis.onvoiceschanged = () => { voices(); };
}

const hasDevanagari = (t: string) => /[ऀ-ॿ]/.test(t);

/** Devanagari -> Hindi voice. Romanised Hinglish reads far better with an Indian-English voice. */
export function pickVoice(lang: string, text = ""): SpeechSynthesisVoice | undefined {
  const vs = voices();
  const by = (pred: (v: SpeechSynthesisVoice) => boolean) => vs.find(pred);
  const lc = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  if (hasDevanagari(text)) return by((v) => lc(v).startsWith("hi")) || by((v) => lc(v) === "en-in");
  if (lang.toLowerCase().startsWith("hi")) return by((v) => lc(v) === "en-in") || by((v) => lc(v).startsWith("hi")) || by((v) => lc(v).startsWith("en"));
  return by((v) => lc(v) === lang.toLowerCase()) || by((v) => lc(v) === "en-in") || by((v) => lc(v).startsWith("en"));
}

type SpeakListener = (speaking: boolean) => void;
const speakListeners = new Set<SpeakListener>();
let speaking = false;
let speakToken = 0;
function setSpeaking(v: boolean) {
  if (speaking === v) return;
  speaking = v;
  speakListeners.forEach((l) => l(v));
}
export function onSpeakingChange(l: SpeakListener): () => void {
  speakListeners.add(l);
  return () => { speakListeners.delete(l); };
}

function chunks(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?।]+[.!?।]*\s*/g) || [text];
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1] + p).length < 180) out[out.length - 1] += p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Speak text; resolves when finished, interrupted, or after a safety timeout. */
export async function speak(text: string, lang: string): Promise<void> {
  if (!synthesisSupported() || !text.trim()) return;
  const token = ++speakToken;
  window.speechSynthesis.cancel();
  setSpeaking(true);
  const voice = pickVoice(lang, text);
  try {
    for (const part of chunks(text)) {
      if (token !== speakToken) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(part);
        if (voice) u.voice = voice;
        u.lang = voice?.lang || lang;
        u.rate = 1.03;
        const done = () => { clearTimeout(t); resolve(); };
        const t = setTimeout(done, 1200 + part.length * 80);
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      });
    }
  } finally {
    if (token === speakToken) setSpeaking(false);
  }
}

export function stopSpeaking(): void {
  speakToken++;
  if (synthesisSupported()) window.speechSynthesis.cancel();
  setSpeaking(false);
}
