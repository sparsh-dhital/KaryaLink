// Capture screenshots of the key screens into docs/screenshots (requires `npm run dev` running
// and Playwright + Chromium: `npm i -D playwright && npx playwright install chromium`).
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "screenshots");
const BASE = process.env.SITESYNC_URL || "http://127.0.0.1:5173";
mkdirSync(out, { recursive: true });

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  .then((r) => { if (!r.ok) throw new Error(`${p} -> ${r.status}`); return r.json(); });
const get = (p) => fetch(BASE + p).then((r) => r.json());

console.log("[shots] resetting demo database…");
await post("/api/demo/reset");
const script = await get("/api/demo/script");
const step = (id) => script.steps.find((s) => s.id === id);

// populate a realistic supervisor conversation through the real assistant API
const civ = step("hinglish");
if (civ) await post("/api/assistant/message", { session_id: "sup-civil", text: "namaste", lang: "hi-IN", reporter: civ.reporter, discipline: civ.discipline });
if (civ) await post("/api/assistant/message", { session_id: "sup-civil", text: civ.text, lang: "hi-IN", reporter: civ.reporter, discipline: civ.discipline, channel: "voice" });
const cl = step("clarify");
if (cl) await post("/api/assistant/message", { session_id: "sup-civil", text: cl.text, lang: "hi-IN", reporter: civ?.reporter ?? "Rakesh Gogoi", discipline: cl.discipline, channel: "voice" });
const seq = step("sequence");
if (seq) await post("/api/assistant/message", { session_id: "sup-piping", text: seq.text, lang: "en-IN", reporter: seq.reporter, discipline: "PIP" });
const nw = step("new");
if (nw) await post("/api/assistant/message", { session_id: "sup-piping", text: nw.text, lang: "en-IN", reporter: nw.reporter, discipline: "PIP" });
await post("/api/demo/planner-batch", { n: 6 });
await post("/api/retrain");

async function launch() {
  // bundled Chromium first, then the system Edge / Chrome (no download needed)
  for (const opts of [{}, { channel: "msedge" }, { channel: "chrome" }]) {
    try { return await chromium.launch(opts); } catch { /* try next */ }
  }
  console.error("No usable browser. Run `npx playwright install chromium`, or install Edge/Chrome.");
  process.exit(1);
}
const browser = await launch();
async function shot(name, url, { width = 1440, height = 900, dark = false, wait = 2500, action } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.addInitScript((d) => localStorage.setItem("sitesync-theme", d ? "dark" : "light"), dark);
  await page.addInitScript(() => localStorage.setItem("sitesync-voice", "off"));
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  if (action) await action(page);
  await page.screenshot({ path: path.join(out, name), fullPage: false });
  console.log("[shots] saved", name);
  await ctx.close();
}

await shot("1-supervisor-mobile.png", "/supervisor?who=civil", { width: 390, height: 844 });
await shot("2-planner-console.png", "/planner");
await shot("3-dashboard.png", "/");
await shot("4-evaluation.png", "/evaluation", { wait: 3500 });
await shot("5-audit.png", "/audit", {
  action: async (p) => { const b = p.locator("li button[aria-expanded]").nth(1); if (await b.count()) await b.click(); await p.waitForTimeout(500); },
});
await shot("6-demo-day-dark.png", "/", {
  dark: true, wait: 1500,
  action: async (p) => {
    await p.getByRole("button", { name: /Demo Day/ }).first().click();
    await p.getByRole("button", { name: /Start Demo Day/ }).click();
    await p.waitForTimeout(34000);
  },
});
await browser.close();
console.log("[shots] resetting demo database after capture…");
await post("/api/demo/reset");
console.log("[shots] done ->", out);
