// End-to-end: two independent browsers edit one note at the same time.
// Usage: BASE=http://localhost:3000 [PASSWORD=group-password] node test/two-users.mjs
import { chromium } from "playwright";
import os from "node:os";
const BASE = process.env.BASE || "http://localhost:3000";
const shots = process.env.SHOTS || os.tmpdir(); // keep screenshots out of the repo
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const A = await (await browser.newContext({ viewport: { width: 1400, height: 820 } })).newPage();
const B = await (await browser.newContext({ viewport: { width: 1400, height: 820 } })).newPage();
const errors = [];
for (const p of [A, B]) p.on("pageerror", (e) => errors.push(e.message));
if (process.env.PASSWORD) { // server started with GROUP_PASSWORD: each person logs in
  for (const p of [A, B]) {
    await p.goto(`${BASE}/login`);
    await p.fill("input[name=password]", process.env.PASSWORD);
    await p.click("button[type=submit]");
    await p.waitForURL(`${BASE}/`);
  }
}

await A.goto(`${BASE}/new`);
const url = A.url();
await B.goto(url);
for (const p of [A, B]) await p.waitForFunction(() => window.__mdshare && window.__mdshare.provider.isSynced);
await A.fill("#name", "Alice"); await A.press("#name", "Enter");
await B.fill("#name", "Bob"); await B.press("#name", "Enter");

// Replace content, then both type at once
await A.evaluate(() => { const t = window.__mdshare.ytext; t.delete(0, t.length); t.insert(0, "# Group meeting notes\n\n"); });
await B.waitForFunction(() => window.__mdshare.ytext.toString().startsWith("# Group meeting"));
await A.click(".cm-content"); await A.keyboard.press("Control+End");
await B.click(".cm-content"); await B.keyboard.press("Control+End");
await Promise.all([
  A.keyboard.type("Alice: the loss is $\\mathcal{L}(\\theta)=\\sum_i \\ell_i$.\n", { delay: 15 }),
  B.keyboard.type("Bob: agreed, see $$\\frac{a}{b}$$\n", { delay: 15 }),
]);
await A.waitForTimeout(800);
const ta = await A.evaluate(() => window.__mdshare.ytext.toString());
const tb = await B.evaluate(() => window.__mdshare.ytext.toString());
const results = {
  converged: ta === tb,
  hasAlice: ta.includes("Alice: the loss"),
  hasBob: ta.includes("Bob: agreed"),
  katexRendered: await A.locator("#preview .katex").count(),
  presenceA: await A.locator("#count").textContent(),
  remoteCursorOnA: await A.locator(".cm-ySelectionInfo").count(),
  title: await B.locator("#title").textContent(),
};
await A.screenshot({ path: `${shots}/alice.png` });
await B.screenshot({ path: `${shots}/bob.png` });
console.log(JSON.stringify({ url, results, errors, text: ta }, null, 2));
await browser.close();
