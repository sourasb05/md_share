// M4: personal sign-in, "My notes" / "Shared with me", private / view / edit links.
// Proves that a signed-out browser can't read a private note over HTTP or WebSocket, that a viewer's
// edits are rejected by the server, and that sharing changes reach open editors immediately.
// Runs its own server (and a fake GitHub). Usage: npm run build && node test/access.mjs
import http from "node:http";
import fs from "node:fs";
import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { chromium } from "playwright";
import { startServer, signInFetch, signInBrowser, tempDir, reporter } from "./helpers.mjs";

const PORT = 3991, GH_PORT = 3992, BASE = `http://localhost:${PORT}`, WS = `ws://localhost:${PORT}/collab`;
const DATA_DIR = tempDir("mdshare-m4-");
const { check, finish } = reporter();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(50); } return false; };

// ---- Fake GitHub OAuth + API ----
const GH_USERS = {
  dana: { profile: { id: 101, login: "dana", name: "Dana Lee" }, emails: [{ email: "dana@lab.test", verified: true, primary: true }] },
  gus: { profile: { id: 102, login: "gus", name: "Gus" }, emails: [{ email: "gus@gmail.example", verified: true, primary: true }, { email: "gus@lab.test", verified: false, primary: false }] },
};
let nextGithubUser = "dana";
const gh = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${GH_PORT}`);
  if (url.pathname === "/login/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri"));
    back.search = new URLSearchParams({ code: `code-${nextGithubUser}`, state: url.searchParams.get("state") });
    res.writeHead(302, { Location: back.toString() }); return res.end();
  }
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (url.pathname === "/login/oauth/access_token") {
      const b = JSON.parse(body || "{}");
      const ok = b.client_secret === "gh-secret" && b.code?.startsWith("code-");
      return res.end(JSON.stringify(ok ? { access_token: `tok-${b.code.slice(5)}` } : { error: "bad_verification_code" }));
    }
    const who = GH_USERS[(req.headers.authorization || "").replace("Bearer tok-", "")];
    if (!who) { res.statusCode = 401; return res.end("{}"); }
    res.end(JSON.stringify(url.pathname === "/user" ? who.profile : who.emails));
  });
});
await new Promise((r) => gh.listen(GH_PORT, "127.0.0.1", r));

let srv = startServer({
  PORT: String(PORT), DATA_DIR, ALLOWED_DOMAINS: "lab.test", PUBLIC_URL: BASE,
  GITHUB_CLIENT_ID: "gh-id", GITHUB_CLIENT_SECRET: "gh-secret",
  GITHUB_OAUTH_URL: `http://localhost:${GH_PORT}`, GITHUB_API_URL: `http://localhost:${GH_PORT}`,
});
await srv.ready;
const ORIGIN = { Origin: BASE };
const get = (p, cookie) => fetch(BASE + p, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
const postForm = (p, body, headers = ORIGIN) => fetch(BASE + p, { method: "POST", redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body) });

// A raw Yjs client with someone's cookie, to test the WebSocket without the app's own page
function connectAs(cookie, noteId) {
  const doc = new Y.Doc();
  const state = { failed: false, synced: false, scope: null };
  class CookieSocket extends WebSocket { constructor(url) { super(url, { headers: { ...(cookie ? { Cookie: cookie } : {}), Origin: BASE } }); } }
  const websocketProvider = new HocuspocusProviderWebsocket({ url: WS, WebSocketPolyfill: CookieSocket, maxAttempts: 1 });
  const provider = new HocuspocusProvider({
    websocketProvider, name: noteId, document: doc,
    onAuthenticationFailed: () => (state.failed = true),
    onAuthenticated: ({ scope }) => (state.scope = scope),
    onSynced: () => (state.synced = true),
  });
  provider.attach();
  return { doc, text: doc.getText("markdown"), state, close: () => { provider.destroy(); websocketProvider.destroy(); } };
}

// ---------- 1. Who may sign in ----------
const cfg = await (await get("/api/auth/config")).json();
check("config lists the allowed domain and GitHub", cfg.domains[0] === "lab.test" && cfg.github === true && cfg.local === false, JSON.stringify(cfg));
let mark = srv.output().length;
const outside = await postForm("/auth/email", { email: "eve@evil.test" });
check("address outside the domain is refused", outside.headers.get("location").includes("error=domain") && !(await srv.linkFor("eve@evil.test", { after: mark, timeout: 300 })));
check("look-alike domain refused (lab.test.evil.test)", (await postForm("/auth/email", { email: "x@lab.test.evil.test" })).headers.get("location").includes("error=domain"));
check("sign-in request from another site blocked", (await postForm("/auth/email", { email: "a@lab.test" }, { Origin: "http://evil.example" })).status === 403);

mark = srv.output().length;
await postForm("/auth/email", { email: "Zoe@Lab.Test" });
const zoeLink = await srv.linkFor("zoe@lab.test", { after: mark });
check("email is normalised and a link is issued", !!zoeLink);
const zoeToken = new URL(zoeLink).searchParams.get("token");
check("opening the link twice doesn't use it up (mail scanners)", (await get(`/auth/email/verify?token=${zoeToken}`)).status === 200 && (await get(`/auth/email/verify?token=${zoeToken}`)).status === 200);
const firstUse = await postForm("/auth/email/verify", { token: zoeToken });
check("confirming the link signs in", (firstUse.headers.get("set-cookie") || "").startsWith("mdshare_session="));
const secondUse = await postForm("/auth/email/verify", { token: zoeToken });
check("a link works only once", secondUse.headers.get("location").includes("error=link") && !secondUse.headers.get("set-cookie"));
check("a made-up token is refused", (await postForm("/auth/email/verify", { token: "A".repeat(43) })).headers.get("location").includes("error=link"));
check("subdomain address allowed (cs.lab.test)", !!(await signInFetch(BASE, srv, "carol@cs.lab.test")));

// ---------- 2. Private note: invisible to signed-out people and to other members of the domain ----------
const browser = await chromium.launch();
const ctxA = await browser.newContext(), ctxB = await browser.newContext(), ctxC = await browser.newContext(), ctxOut = await browser.newContext();
const A = await ctxA.newPage(), B = await ctxB.newPage(), C = await ctxC.newPage();
const errors = [];
for (const p of [A, B, C]) p.on("pageerror", (e) => errors.push(e.message));
await signInBrowser(A, BASE, srv, "alice@lab.test");
check("Alice signs in through the pages", new URL(A.url()).pathname === "/");
await A.goto(`${BASE}/new`);
const noteId = new URL(A.url()).pathname.split("/").pop();
await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
await A.evaluate(() => { const t = window.__mdshare.ytext; t.delete(0, t.length); t.insert(0, "# Budget\n\nTOP SECRET numbers\n"); });
const aliceCookie = (await ctxA.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
check("new notes are private", (await (await get(`/api/notes/${noteId}`, aliceCookie)).json()).share_mode === "private");
await until(async () => (await (await get(`/api/notes/${noteId}/download`, aliceCookie)).text()).includes("TOP SECRET"), 6000);

const outPage = await (await get(`/n/${noteId}`)).text();
check("signed out: note page redirects to sign-in", (await get(`/n/${noteId}`)).headers.get("location")?.startsWith("/login") && !outPage.includes("TOP SECRET"));
check("signed out: note API refused", (await get(`/api/notes/${noteId}`)).status === 401);
check("signed out: download refused", (await get(`/api/notes/${noteId}/download`)).status === 401);
const outSock = await new Promise((resolve) => { const ws = new WebSocket(WS, { headers: ORIGIN }); ws.onopen = () => { ws.close(); resolve("open"); }; ws.onerror = () => resolve("rejected"); });
check("signed out: WebSocket refused at the handshake", outSock === "rejected");
const outBrowser = await ctxOut.newPage();
await outBrowser.goto(`${BASE}/n/${noteId}`);
check("signed-out browser lands on sign-in and never sees the text", outBrowser.url().includes("/login") && !(await outBrowser.content()).includes("TOP SECRET"));

const bobCookie = await signInFetch(BASE, srv, "bob@lab.test");
check("other member: note page is 403", (await get(`/n/${noteId}`, bobCookie)).status === 403);
check("other member: note API and download refused", (await get(`/api/notes/${noteId}`, bobCookie)).status === 403 && (await get(`/api/notes/${noteId}/download`, bobCookie)).status === 403);
const bobRaw = connectAs(bobCookie, noteId);
await until(() => bobRaw.state.failed || bobRaw.state.synced, 4000);
check("other member: WebSocket refused for this note, no content received", bobRaw.state.failed && !bobRaw.text.toString().includes("TOP SECRET"), JSON.stringify(bobRaw.state));
bobRaw.close();

// ---------- 3. Viewer: can read, edits rejected by the server ----------
await A.click("#share");
await A.waitForSelector("#share-owner-ui:not([hidden])");
await A.fill("#share-email", "bob@lab.test");
await A.selectOption("#share-role", "viewer");
await A.click("#share-add button[type=submit]");
await A.waitForSelector('#share-people li:has-text("bob@lab.test")');
check("owner adds Bob as viewer from the Share dialog", true);
await A.fill("#share-email", "mallory@evil.test");
await A.click("#share-add button[type=submit]");
await A.waitForSelector("#share-error:not([hidden])");
check("can't share with an address outside the domain", (await A.textContent("#share-error")).includes("lab.test"));
await A.keyboard.press("Escape");

await signInBrowser(B, BASE, srv, "bob@lab.test");
await B.goto(`${BASE}/n/${noteId}`);
await B.waitForFunction(() => window.__mdshare?.provider.isSynced && window.__mdshare.provider.authorizedScope);
check("viewer can read the note", (await B.evaluate(() => window.__mdshare.ytext.toString())).includes("TOP SECRET"));
check("viewer gets a read-only editor, no toolbar, 'View only' badge",
  (await B.getAttribute(".cm-content", "contenteditable")) === "false" && !(await B.isVisible(".toolbar")) && (await B.isVisible("#role-badge")));
await B.evaluate(() => window.__mdshare.ytext.insert(0, "HACKED BY VIEWER ")); // bypass the UI on purpose
await wait(2500);
check("viewer's forced edit never reaches the owner", !(await A.evaluate(() => window.__mdshare.ytext.toString())).includes("HACKED"));
check("viewer's forced edit is never saved", !(await (await get(`/api/notes/${noteId}/download`, aliceCookie)).text()).includes("HACKED"));
const bobViewer = connectAs(bobCookie, noteId);
await until(() => bobViewer.state.synced, 4000);
check("server tells a raw viewer client it is read-only", bobViewer.state.scope === "readonly", bobViewer.state.scope);
bobViewer.text.insert(0, "RAW VIEWER EDIT ");
await wait(1500);
check("raw viewer client's edit is rejected too", !(await A.evaluate(() => window.__mdshare.ytext.toString())).includes("RAW VIEWER"));
bobViewer.close();
await B.goto(`${BASE}/`);
await B.waitForSelector("#shared li a");
check("note appears under Bob's 'Shared with me' as Can view", (await B.textContent("#shared")).includes("Budget") && (await B.textContent("#shared")).includes("Can view"));
await A.goto(`${BASE}/`);
await A.waitForSelector("#mine li a");
check("note appears under Alice's 'My notes' as Private", (await A.textContent("#mine")).includes("Budget") && (await A.textContent("#mine")).includes("Private"));

// ---------- 4. Changing access reaches open editors ----------
await A.goto(`${BASE}/n/${noteId}`); await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
await B.goto(`${BASE}/n/${noteId}`); await B.waitForFunction(() => window.__mdshare?.provider.isSynced);
await A.click("#share");
await A.waitForSelector('#share-people li:has-text("bob@lab.test") select');
await A.selectOption('#share-people li:has-text("bob@lab.test") select', "editor");
check("Bob's open editor becomes editable after promotion", await B.waitForFunction(() => document.querySelector(".cm-content")?.getAttribute("contenteditable") === "true", null, { timeout: 6000 }).then(() => true, () => false));
await B.evaluate(() => window.__mdshare.ytext.insert(window.__mdshare.ytext.length, "Bob was here\n"));
check("Bob's edit now reaches Alice", await A.waitForFunction(() => window.__mdshare.ytext.toString().includes("Bob was here"), null, { timeout: 5000 }).then(() => true, () => false));
await A.click('#share-people li:has-text("bob@lab.test") button');
check("removing Bob shows him a 'removed' banner at once", await B.waitForSelector("#banner:not([hidden])", { timeout: 6000 }).then(async () => (await B.textContent("#banner")).includes("removed"), () => false));
await B.evaluate(() => window.__mdshare.ytext.insert(0, "AFTER REMOVAL ")).catch(() => {});
await wait(1500);
check("removed person's edits don't arrive", !(await A.evaluate(() => window.__mdshare.ytext.toString())).includes("AFTER REMOVAL"));
await A.keyboard.press("Escape");

// ---------- 5. Link sharing ----------
await A.click("#share");
await A.waitForSelector("#share-mode");
await A.selectOption("#share-mode", "link_view");
await wait(300);
await signInBrowser(C, BASE, srv, "carol@cs.lab.test");
await C.goto(`${BASE}/n/${noteId}`);
await C.waitForFunction(() => window.__mdshare?.provider.isSynced && window.__mdshare.provider.authorizedScope);
check("'anyone with the link can view': Carol can read, read-only", (await C.evaluate(() => window.__mdshare.provider.authorizedScope)) === "readonly" && (await C.evaluate(() => window.__mdshare.ytext.toString())).includes("TOP SECRET"));
await A.selectOption("#share-mode", "link_edit");
check("switching to 'can edit' upgrades Carol live", await C.waitForFunction(() => document.querySelector(".cm-content")?.getAttribute("contenteditable") === "true", null, { timeout: 6000 }).then(() => true, () => false));
const carolCookie = (await ctxC.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const carolHome = await (await get("/api/notes", carolCookie)).json();
check("opened link-shared note is listed under Carol's 'Shared with me'", carolHome.shared.some((n) => n.id === noteId && n.role === "editor" && n.owner_email === "alice@lab.test"), JSON.stringify(carolHome));
await A.selectOption("#share-mode", "private");
check("making it private again cuts Carol off at once", await C.waitForSelector("#banner:not([hidden])", { timeout: 6000 }).then(() => true, () => false));
check("private note disappears from Carol's list", !(await (await get("/api/notes", carolCookie)).json()).shared.some((n) => n.id === noteId));
check("only the owner can change sharing", (await fetch(`${BASE}/api/notes/${noteId}/share`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: carolCookie, ...ORIGIN }, body: JSON.stringify({ share_mode: "link_edit" }) })).status === 403);

// ---------- 6. GitHub sign-in ----------
const G = await (await browser.newContext()).newPage();
nextGithubUser = "dana";
await G.goto(`${BASE}/login?next=/`);
await G.click("#github");
await G.waitForURL(`${BASE}/`);
const dana = await G.evaluate(() => fetch("/api/me").then((r) => r.json()));
check("GitHub sign-in with a verified lab.test email works", dana.email === "dana@lab.test" && dana.name === "Dana Lee", JSON.stringify(dana));
const G2 = await (await browser.newContext()).newPage();
nextGithubUser = "gus";
await G2.goto(`${BASE}/login`);
await G2.click("#github");
await G2.waitForURL(/error=github_email/);
check("GitHub account without a verified lab.test email is refused", (await G2.textContent("#err")).includes("verified"));
const forged = await get(`/auth/github/callback?code=code-dana&state=forged`);
check("GitHub callback with a forged state is refused", forged.headers.get("location").includes("error=github") && !forged.headers.get("set-cookie")?.includes("mdshare_session=") );
check("no browser errors", errors.length === 0, errors.join("; "));
await browser.close();

// ---------- 7. Removing a domain locks its people out ----------
await srv.stop();
srv = startServer({ PORT: String(PORT), DATA_DIR, ALLOWED_DOMAINS: "other.test", PUBLIC_URL: BASE });
await srv.ready;
check("after the domain is removed, old sessions stop working", (await get("/api/notes", aliceCookie)).status === 401);
await srv.stop();
srv = startServer({ PORT: String(PORT), DATA_DIR, HOST: "0.0.0.0" });
const refused = await srv.ready.then(() => 0, (e) => e.code);
check("refuses to go on a network without ALLOWED_DOMAINS", refused === 1);
await srv.stop();
gh.close();
fs.rmSync(DATA_DIR, { recursive: true, force: true });
process.exit(finish());
