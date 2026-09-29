// Tiny registry that lets the Demo Day runner drive real pages (no fake UI): pages register
// handlers while mounted; the runner awaits them. Also a data-changed bus so views refetch.

export interface SupervisorHandler {
  typeAndSend(text: string): Promise<void>;
  simulateVoice(text: string): Promise<void>;
  tapOption(value: string): Promise<void>;
  uploadFile(file: File): Promise<void>;
  endOfDay(): Promise<void>;
  setLang(lang: string): void;
}
export interface PlannerHandler {
  select(reportId: number): Promise<void>;
  reassign(reportId: number, activityId: string): Promise<void>;
  refresh(): Promise<void>;
}
export interface EvalHandler {
  retrain(): Promise<void>;
  setSplit(s: "test" | "hard"): void;
  refresh(): Promise<void>;
}
type Handlers = { supervisor: SupervisorHandler; planner: PlannerHandler; evaluation: EvalHandler };

class Registry {
  private h: Partial<Handlers> = {};
  private waiters: { name: keyof Handlers; resolve: () => void }[] = [];

  register<K extends keyof Handlers>(name: K, handler: Handlers[K]): () => void {
    this.h[name] = handler;
    this.waiters.filter((w) => w.name === name).forEach((w) => w.resolve());
    this.waiters = this.waiters.filter((w) => w.name !== name);
    return () => { if (this.h[name] === handler) delete this.h[name]; };
  }

  async get<K extends keyof Handlers>(name: K, timeoutMs = 8000): Promise<Handlers[K]> {
    const cur = this.h[name];
    if (cur) return cur as Handlers[K];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name} page did not load`)), timeoutMs);
      this.waiters.push({ name, resolve: () => { clearTimeout(t); resolve(); } });
    });
    return this.h[name] as Handlers[K];
  }
}

export const demoRegistry = new Registry();

type Listener = () => void;
const listeners = new Set<Listener>();
export const dataBus = {
  emit() { listeners.forEach((l) => l()); },
  on(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
