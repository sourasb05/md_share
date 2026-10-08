// AI rephrase: route access checks + a two-browser end-to-end run against a fake Anthropic API
// (no real API key or cost). Usage: npm run build && node test/rephrase.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const MOCK_PORT = 3998, PORT = 3997, BASE = `http://localhost:${PORT}`;
const PASSWORD = "correct-horse-battery";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mdshare-ai-"));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, ...(ok ? {} : { detail: String(detail) }) });

// ---- Fake Anthropic Messages API ----
const calls = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    const json = JSON.parse(body || "{}");
    calls.push({ url: req.url, headers: req.headers, body: json });
    const prompt = json.messages?.[0]?.content || "";
    if (prompt.includes("SLOW")) await new Promise((r) => setTimeout(r, 1500));
    const refuse = prompt.includes("REFUSE");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: json.model,
      content: refuse ? [] : [{ type: "text", text: "a clearer sentence" }],
      stop_reason: refuse ? "refusal" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

function start(env) {
  const p = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, GROUP_PASSWORD: PASSWORD, ANTHROPIC_API_KEY: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  return new Promise((resolve, reject) => {
    p.stdout.on("data", () => out.includes("MdShare running") && resolve(p));
    p.on("exit", (code) => reject(new Error(`server exited ${code}: ${out}`)));
  });
}
const stop = (p) => new Promise((r) => { p.on("exit", r); p.kill(); });
const ORIGIN = { Origin: BASE };
const get = (url, headers = {}) => fetch(BASE + url, { headers, redirect: "manual" });
const rephrase = (body, headers = {}) => fetch(BASE + "/api/rephrase", {
  method: "POST", headers: { "Content-Type": "application/json", ...ORIGIN, ...headers }, body: JSON.stringify(body), redirect: "manual",
});
async function login() {
  const r = await fetch(BASE + "/login", { method: "POST", body: `password=${PASSWORD}`, headers: { "Content-Type": "application/x-www-form-urlencoded", ...ORIGIN }, redirect: "manual" });
  return { Cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}

// 1. No API key: feature reports itself off
let srv = await start({});
let H = await login();
check("without a key, /api/ai says off", (await (await get("/api/ai", H)).json()).rephrase === false);
check("without a key, rephrase returns 503", (await rephrase({ text: "hello" }, H)).status === 503);
await stop(srv);

// 2. With a key (pointed at the fake API)
srv = await start({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, AI_PER_MINUTE: "6" });
check("logged-out /api/ai refused", (await get("/api/ai")).status === 401);
check("logged-out rephrase refused", (await rephrase({ text: "hello" })).status === 401);
H = await login();
check("with a key, /api/ai says on", (await (await get("/api/ai", H)).json()).rephrase === true);
check("rephrase from another site blocked", (await rephrase({ text: "hello" }, { ...H, Origin: "http://evil.example" })).status === 403);
check("empty selection rejected", (await rephrase({ text: "  " }, H)).status === 400);
check("over-long selection rejected", (await rephrase({ text: "x".repeat(4001) }, H)).status === 413);
check("over-long extra request rejected", (await rephrase({ text: "hi", request: "x".repeat(201) }, H)).status === 400);
check("validation failures never reach the AI", calls.length === 0, calls.length);

const ok = await rephrase({ text: "  The results was good.\n", request: "more formal" }, H);
const okBody = await ok.json();
check("rephrase returns the suggestion", ok.status === 200 && okBody.text === "  a clearer sentence\n", JSON.stringify(okBody));
const call = calls.at(-1) || { headers: {}, body: {} };
check("uses Claude Opus 5.5 at low effort", call.body.model === "claude-opus-5-5" && call.body.output_config?.effort === "low", JSON.stringify(call.body));
check("refusal fallback enabled", call.body.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(call.headers["anthropic-beta"] || ""), call.headers["anthropic-beta"]);
check("API key sent only to the AI service", call.headers["x-api-key"] === "test-key");
check("selection and extra request are in the prompt", call.body.messages[0].content.includes("The results was good.") && call.body.messages[0].content.includes("more formal"));
check("refusal reported as 422", (await rephrase({ text: "REFUSE this" }, H)).status === 422);

// 3. Browser: select, rephrase, replace; Bob sees it; undo works; concurrent edit is detected
const browser = await chromium.launch();
async function person() {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  return page;
}
const A = await person(), B = await person();
const errors = [];
for (const p of [A, B]) p.on("pageerror", (e) => errors.push(e.message));
await A.goto(`${BASE}/new`);
await B.goto(A.url());
for (const p of [A, B]) await p.waitForFunction(() => window.__mdshare?.provider.isSynced);
const ORIGINAL = "# Test\n\nThe results was good and we liked it.\n";
await A.evaluate((t) => { const y = window.__mdshare.ytext; y.delete(0, y.length); y.insert(0, t); }, ORIGINAL);
await B.waitForFunction((t) => window.__mdshare.ytext.toString() === t, ORIGINAL);
const select = (page, phrase) => page.evaluate((s) => {
  const { view, ytext } = window.__mdshare; const i = ytext.toString().indexOf(s);
  view.dispatch({ selection: { anchor: i, head: i + s.length } });
}, phrase);

check("Rephrase button visible", await A.locator("#rephrase").isVisible());
await select(A, "The results was good");
await A.click("#rephrase");
await A.waitForSelector("#ai-replace:not([disabled])");
check("panel shows suggestion", (await A.inputValue("#ai-result")) === "a clearer sentence");
await A.click("#ai-replace");
const EXPECTED = "# Test\n\na clearer sentence and we liked it.\n";
await B.waitForFunction((t) => window.__mdshare.ytext.toString() === t, EXPECTED, { timeout: 5000 }).catch(() => {});
check("replacement syncs to the other person", (await B.evaluate(() => window.__mdshare.ytext.toString())) === EXPECTED);
await A.keyboard.press("ControlOrMeta+z");
await B.waitForFunction((t) => window.__mdshare.ytext.toString() === t, ORIGINAL, { timeout: 5000 }).catch(() => {});
check("Ctrl+Z undoes the replacement for everyone", (await B.evaluate(() => window.__mdshare.ytext.toString())) === ORIGINAL);

// Bob edits the selected words while the AI is still working
await A.evaluate(() => { const y = window.__mdshare.ytext; y.insert(y.length, "SLOW part to rewrite.\n"); });
await B.waitForFunction(() => window.__mdshare.ytext.toString().includes("SLOW part"));
await select(A, "SLOW part to rewrite.");
await A.click("#rephrase");
await B.evaluate(() => { const y = window.__mdshare.ytext; const i = y.toString().indexOf("part"); y.delete(i, 4); y.insert(i, "bit"); });
await A.waitForSelector("#ai-replace:not([disabled])");
await A.click("#ai-replace");
const statusText = await A.textContent("#ai-status");
const after = await A.evaluate(() => window.__mdshare.ytext.toString());
check("concurrent edit detected, nothing overwritten", /changed that text/.test(statusText) && after.includes("SLOW bit to rewrite.") && !after.includes("a clearer"), `${statusText} | ${after}`);
check("no browser errors", errors.length === 0, errors.join("; "));
await browser.close();

// 4. Cost guard: per-person limit (6 per minute in this test)
let last = 0;
for (let i = 0; i < 6; i++) last = (await rephrase({ text: `try ${i}` }, H)).status;
check("per-person rate limit kicks in", last === 429, last);

await stop(srv);
mock.close();
fs.rmSync(DATA_DIR, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
