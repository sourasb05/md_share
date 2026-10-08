// Security checks: starts its own password-protected server on a temporary database and tries
// to get in without permission over HTTP and WebSocket.
// Usage: npm run build && node test/security.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = 3999, BASE = `http://localhost:${PORT}`, WS = `ws://localhost:${PORT}/collab`;
const PASSWORD = "correct-horse-battery";
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mdshare-sec-"));
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });

function start(env) {
  const p = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT: String(PORT), DATA_DIR, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  const ready = new Promise((resolve, reject) => {
    p.stdout.on("data", () => out.includes("MdShare running") && resolve(p));
    p.on("exit", (code) => reject(Object.assign(new Error(`server exited ${code}: ${out}`), { code })));
  });
  return { p, ready, output: () => out };
}
const stop = (p) => new Promise((r) => { p.on("exit", r); p.kill(); });

const get = (url, headers = {}) => fetch(BASE + url, { headers, redirect: "manual" });
const post = (url, body, headers = {}) => fetch(BASE + url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, redirect: "manual" });
const ORIGIN = { Origin: BASE };
async function login(password = PASSWORD) {
  const r = await post("/login", `password=${encodeURIComponent(password)}`, ORIGIN);
  const c = r.headers.get("set-cookie") || "";
  return { res: r, cookie: c.split(";")[0], raw: c };
}
// Resolves "open" or "rejected"
function tryWs(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS, { headers });
    ws.onopen = () => { ws.close(); resolve("open"); };
    ws.onerror = () => resolve("rejected");
  });
}

// 1. Unsafe setups refuse to start
for (const [name, env] of [
  ["refuses network listen without password", { HOST: "0.0.0.0", GROUP_PASSWORD: "" }],
  ["refuses short password", { GROUP_PASSWORD: "short" }],
]) {
  const s = start(env);
  const code = await s.ready.then((p) => stop(p).then(() => 0), (e) => e.code);
  check(name, code === 1, `exit code ${code}`);
}

let srv = start({ GROUP_PASSWORD: PASSWORD });
await srv.ready;

// 2. Logged out: nothing readable over HTTP or WebSocket
const r404 = await get("/");
check("home redirects to login", r404.status === 302 && r404.headers.get("location").startsWith("/login"));
check("note list needs login", (await get("/api/notes")).status === 401);
check("POST /api/notes needs login", (await post("/api/notes", "", ORIGIN)).status === 401);
check("WebSocket without login rejected", (await tryWs({ Origin: BASE })) === "rejected");

// 3. Login
const wrong = await login("not-the-password");
check("wrong password rejected", wrong.res.headers.get("location").includes("error=1") && !wrong.raw);
check("login without Origin blocked", (await post("/login", `password=${PASSWORD}`)).status === 403);
check("login from another site blocked", (await post("/login", `password=${PASSWORD}`, { Origin: "http://evil.example" })).status === 403);
const { cookie, raw } = await login();
check("login sets HttpOnly SameSite cookie", /HttpOnly/.test(raw) && /SameSite=Lax/.test(raw));
const H = { Cookie: cookie };

// 4. Logged in
check("note list readable when logged in", (await get("/api/notes", H)).status === 200);
const created = await post("/api/notes", "", { ...H, ...ORIGIN });
const { id } = await created.json();
check("create note when logged in", created.status === 201 && /^[A-Za-z0-9]{10}$/.test(id));
check("note page loads when logged in", (await get(`/n/${id}`, H)).status === 200);
check("download when logged in", (await get(`/api/notes/${id}/download`, H)).status === 200);
check("logged-out note page redirects", (await get(`/n/${id}`)).status === 302);
check("logged-out download refused", (await get(`/api/notes/${id}/download`)).status === 401);
check("POST without Origin blocked", (await post("/api/notes", "", H)).status === 403);
check("POST from another site blocked", (await post("/api/notes", "", { ...H, Origin: "http://evil.example" })).status === 403);
const before = (await (await get("/api/notes", H)).json()).length;
await get("/new", { ...H, "Sec-Fetch-Site": "cross-site" });
check("cross-site link can't create notes", (await (await get("/api/notes", H)).json()).length === before);
check("WebSocket with login opens", (await tryWs({ ...H, Origin: BASE })) === "open");
check("WebSocket from another site rejected", (await tryWs({ ...H, Origin: "http://evil.example" })) === "rejected");
check("WebSocket without Origin rejected", (await tryWs(H)) === "rejected");
check("forged cookie rejected", (await get("/api/notes", { Cookie: "mdshare_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status === 401);

// 5. Headers
const h = (await get("/", H)).headers;
const csp = h.get("content-security-policy") || "";
check("CSP blocks inline scripts and framing", csp.includes("script-src 'self'") && !csp.includes("unsafe-eval") && csp.includes("frame-ancestors 'none'"));
check("CSP only allows our own WebSocket", csp.includes(`ws://localhost:${PORT}`) && !/ ws: | wss: /.test(csp));
check("pages are not cached", h.get("cache-control") === "no-store");

// 6. Browser: malicious Markdown is neutralised, and logging out cuts the live connection
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const dialogs = [];
page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
await page.goto(`${BASE}/n/${id}`);
await page.fill("input[name=password]", PASSWORD);
await page.click("button[type=submit]");
await page.waitForURL(`**/n/${id}`);
await page.waitForFunction(() => window.__mdshare?.provider.isSynced);
await page.evaluate(() => {
  const t = window.__mdshare.ytext;
  t.delete(0, t.length);
  t.insert(0, '# x\n\n<script>alert(1)</script><img src=x onerror="alert(2)"><style>body{display:none}</style>' +
    '<form action="https://evil.example"><input name=pw><button>Go</button></form><a href="javascript:alert(3)">l</a><iframe src="https://evil.example"></iframe>');
});
await page.waitForTimeout(500);
const bad = await page.evaluate(() => {
  const p = document.querySelector("#preview");
  return ["script", "style", "form", "input", "button", "iframe", "[onerror]", "a[href^='javascript']"].filter((s) => p.querySelector(s));
});
check("malicious HTML stripped from preview", bad.length === 0 && dialogs.length === 0, `found ${bad} dialogs ${dialogs}`);

const other = await (await browser.newContext()).newPage(); // a second, independent login to stay connected
await other.goto(`${BASE}/login`);
await other.fill("input[name=password]", PASSWORD);
await other.click("button[type=submit]");
await other.goto(`${BASE}/n/${id}`);
await other.waitForFunction(() => window.__mdshare?.provider.isSynced);
await page.evaluate(() => fetch("/logout", { method: "POST" }));
await page.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
check("logging out disconnects the open editor", page.url().includes("/login"), page.url());
check("other people stay connected", (await other.evaluate(() => window.__mdshare.provider.isSynced)) && !other.url().includes("/login"));
await browser.close();
await post("/logout", "", { ...H, ...ORIGIN });
check("cookie refused after logout", (await get("/api/notes", H)).status === 401);

// 7. Password guessing is throttled
const fresh = await login(); // a valid session made before the attack
let lastLocation = "";
for (let i = 0; i < 6; i++) lastLocation = (await login("guess-" + i)).res.headers.get("location");
check("6th wrong guess is throttled", lastLocation.includes("error=2"), lastLocation);
const afterBlock = await login();
check("even the right password waits out the block", !afterBlock.raw);

// 8. Changing the password logs everyone out
await stop(srv.p);
srv = start({ GROUP_PASSWORD: PASSWORD + "-new" });
await srv.ready;
check("password change ends old sessions", (await get("/api/notes", { Cookie: fresh.cookie })).status === 401);
await stop(srv.p);

fs.rmSync(DATA_DIR, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
