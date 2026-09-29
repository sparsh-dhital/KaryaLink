// Browser Web Speech API helpers (SpeechRecognition + speechSynthesis). Typed fallback shims included
// because SpeechRecognition is not part of TypeScript's DOM lib.

interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SRResultList { length: number; [i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SRErrorEvent { error: string }
interface SRInstance {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null; onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SRInstance;

function ctor(): SRCtor | null {
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const recognitionSupported = (): boolean => ctor() !== null;
export const synthesisSupported = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window;

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export function listen(lang: string, h: ListenHandlers): () => void {
  const C = ctor();
  if (!C) {
    h.onError("Speech recognition is not supported in this browser. Please type instead.");
    h.onEnd();
    return () => undefined;
  }
  const rec = new C();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    h.onInterim((finalText + " " + interim).trim());
  };
  rec.onerror = (e) => {
    const map: Record<string, string> = {
      "not-allowed": "Microphone permission was denied. Allow the mic or type your update.",
      "no-speech": "No speech detected - try again, or type your update.",
      "audio-capture": "No microphone found. Please type your update.",
      network: "Speech service unavailable (browser speech may need internet). Please type your update.",
    };
    h.onError(map[e.error] || `Speech recognition error: ${e.error}`);
  };
  rec.onend = () => {
    if (finalText.trim()) h.onFinal(finalText.trim());
    h.onEnd();
  };
  try {
    rec.start();
  } catch (err) {
    h.onError(String(err));
    h.onEnd();
  }
  return () => {
    try { rec.stop(); } catch { /* already stopped */ }
  };
}

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

export function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const vs = voices();
  const base = lang.slice(0, 2).toLowerCase();
  return vs.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    || vs.find((v) => v.lang.toLowerCase().startsWith(base))
    || vs.find((v) => v.lang.toLowerCase() === "en-in")
    || vs.find((v) => v.lang.toLowerCase().startsWith("en"));
}

/** Speak text; resolves when finished (or after a safety timeout). */
export function speak(text: string, lang: string, maxMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    if (!synthesisSupported() || !text) return resolve();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(lang);
      if (v) u.voice = v;
      u.lang = v?.lang || lang;
      u.rate = 1.02;
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, Math.min(maxMs, 1500 + text.length * 75));
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

export function stopSpeaking(): void {
  if (synthesisSupported()) window.speechSynthesis.cancel();
}
