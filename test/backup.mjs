// Backup and restore drill: back up a running server, change things, restore, and check the notes
// (both the saved text and the live Yjs document) come back exactly. Usage: npm run build && node test/backup.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { startServer, signInBrowser, tempDir, reporter } from "./helpers.mjs";

const PORT = 3994, BASE = `http://localhost:${PORT}`;
const DATA_DIR = tempDir("mdshare-bak-"), BACKUP_DIR = path.join(DATA_DIR, "backups");
const { check, finish } = reporter();
const ENV = { PORT: String(PORT), DATA_DIR, ALLOWED_DOMAINS: "lab.test", PUBLIC_URL: BASE };
const run = (script, args = [], env = {}) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], { env: { ...process.env, DATA_DIR, BACKUP_DIR, PORT: String(PORT), ...env }, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
};
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

let srv = startServer(ENV);
await srv.ready;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const A = await ctx.newPage();
await signInBrowser(A, BASE, srv, "alice@lab.test");
await A.goto(`${BASE}/new`);
const id = new URL(A.url()).pathname.split("/").pop();
await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
const ORIGINAL = "# Results\n\nThe loss is $\\mathcal{L} = 0.142$ after warmup.\n";
await A.evaluate((t) => { const y = window.__mdshare.ytext; y.delete(0, y.length); y.insert(0, t); }, ORIGINAL);
const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const saved = () => fetch(`${BASE}/api/notes/${id}/download`, { headers: { Cookie: cookie } }).then((r) => r.text());
check("note saved before the backup", await until(async () => (await saved()) === ORIGINAL));

// 1. Back up while the server is running
const b1 = run("scripts/backup.mjs");
const files = () => fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".sqlite")).sort();
check("backup runs while the server is up", b1.code === 0 && /Backup OK/.test(b1.out) && files().length === 1, b1.out);
check("backup file is private to the owner (mode 600)", (fs.statSync(path.join(BACKUP_DIR, files()[0])).mode & 0o777) === 0o600);
const backupFile = path.join(BACKUP_DIR, files()[0]);

// 2. Things change after the backup
await A.evaluate(() => window.__mdshare.ytext.insert(window.__mdshare.ytext.length, "CHANGED AFTER BACKUP\n"));
check("later change saved", await until(async () => (await saved()).includes("CHANGED AFTER BACKUP")));

// 3. Restore refuses while the server runs, and refuses damaged files
check("restore refuses while the server is running", run("scripts/restore.mjs", [backupFile, "--yes"]).code === 1);
check("restore needs --yes", run("scripts/restore.mjs", [backupFile]).code === 1);
const junk = path.join(DATA_DIR, "junk.sqlite");
fs.writeFileSync(junk, "this is not a database");
await browser.close();
await srv.stop();
check("restore refuses a damaged backup", run("scripts/restore.mjs", [junk, "--yes"]).code === 1);

// 4. Restore, restart, verify
const r = run("scripts/restore.mjs", [backupFile, "--yes"]);
check("restore succeeds with the server stopped", r.code === 0 && /Restored 1 notes/.test(r.out), r.out);
check("previous database kept for undo", fs.readdirSync(DATA_DIR).some((f) => f.startsWith("mdshare.sqlite.before-restore-")));
srv = startServer(ENV);
await srv.ready;
check("restored server starts and is healthy", (await (await fetch(`${BASE}/healthz`)).json()).status === "ok");
check("sessions from before the backup still work", (await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } })).status === 200);
check("saved text is back to the backed-up version", (await saved()) === ORIGINAL);
const b2 = await chromium.launch();
const c2 = await b2.newContext();
await c2.addCookies(cookie.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: BASE }; }));
const P = await c2.newPage();
await P.goto(`${BASE}/n/${id}`);
await P.waitForFunction(() => window.__mdshare?.provider.isSynced);
check("live document is back to the backed-up version", (await P.evaluate(() => window.__mdshare.ytext.toString())) === ORIGINAL);
await b2.close();
await srv.stop();

// 5. Old backups are pruned
for (let i = 0; i < 3; i++) run("scripts/backup.mjs", [], { BACKUP_KEEP: "2" });
check("only the newest BACKUP_KEEP backups are kept", files().length === 2, files().join(", "));

fs.rmSync(DATA_DIR, { recursive: true, force: true });
process.exit(finish());
