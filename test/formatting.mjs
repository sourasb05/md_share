// Toolbar formatting, colours/highlights, appearance settings and colour sanitising, in a real browser.
// Usage: start the server (no password), then: BASE=http://localhost:3000 [SHOTS=dir] node test/formatting.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3000";
const SHOTS = process.env.SHOTS || "";
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, ...(ok ? {} : { detail: String(detail) }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const A = await ctx.newPage();
const B = await (await browser.newContext()).newPage();
const errors = [];
for (const p of [A, B]) p.on("pageerror", (e) => errors.push(e.message));
await A.goto(`${BASE}/new`);
await B.goto(A.url());
for (const p of [A, B]) await p.waitForFunction(() => window.__mdshare?.provider.isSynced);

const text = () => A.evaluate(() => window.__mdshare.ytext.toString());
const setText = (t) => A.evaluate((s) => { const y = window.__mdshare.ytext; y.delete(0, y.length); y.insert(0, s); }, t);
const select = (phrase) => A.evaluate((s) => {
  const { view, ytext } = window.__mdshare; const i = ytext.toString().indexOf(s);
  view.dispatch({ selection: { anchor: i, head: i + s.length } }); view.focus();
}, phrase);

await A.waitForTimeout(300);
check("Rephrase button hidden when the server has no AI key", !(await A.locator("#rephrase").isVisible()));
await setText("# Notes\n\nThe loss went down after warmup.\n\n- first item\n- second item\n");

// Bold toggles on and off
await select("loss");
await A.click('[data-cmd="bold"]');
check("bold wraps selection", (await text()).includes("The **loss** went"));
await A.click('[data-cmd="bold"]');
check("bold again removes it", (await text()).includes("The loss went"));

// Text colour from the palette, then change it, then remove it
await select("went down");
await A.click('[data-pop="pop-color"]');
await A.click('#pop-color .sw[title="Red"]');
check("text colour inserts a span", (await text()).includes('<span style="color:#e5484d">went down</span>'), await text());
await A.waitForTimeout(150);
check("preview shows the colour", await A.evaluate(() => getComputedStyle(document.querySelector("#preview span[style]")).color === "rgb(229, 72, 77)"));
check("other person sees the colour", await B.waitForFunction(() => document.querySelector('#preview span[style*="color"]'), null, { timeout: 4000 }).then(() => true, () => false));
await A.click('[data-pop="pop-color"]');
await A.click('#pop-color .sw[title="Blue"]');
check("picking another colour replaces it (no nesting)", (await text()).includes('<span style="color:#0090ff">went down</span>') && !(await text()).includes("#e5484d"), await text());
await A.click('[data-pop="pop-color"]');
await A.click('#pop-color [data-clear="text"]');
check("remove colour unwraps", (await text()).includes("The loss went down after"), await text());

// Highlight across list lines keeps the list markers outside
await select("first item\n- second item");
await A.click('[data-pop="pop-highlight"]');
await A.click('#pop-highlight .sw[title="Yellow"]');
const t1 = await text();
check("highlight each list line, markers kept", t1.includes('- <mark style="background-color:#fff3a3">first item</mark>\n- <mark style="background-color:#fff3a3">second item</mark>'), t1);
await A.waitForTimeout(150);
check("preview list still has 2 items, highlighted", await A.evaluate(() => document.querySelectorAll("#preview li mark").length === 2));
await A.keyboard.press("ControlOrMeta+z");
check("Ctrl+Z undoes the highlight", !(await text()).includes("<mark"), await text());

// Keyboard highlight shortcut uses the last highlight colour
await select("warmup");
await A.keyboard.press("ControlOrMeta+Shift+h");
check("Ctrl+Shift+H highlights", (await text()).includes('<mark style="background-color:#fff3a3">warmup</mark>'), await text());

// Headings, lists, math, table
await select("The loss");
await A.click('[data-cmd="h2"]');
check("H2 turns the line into a heading", /\n## The loss went/.test(await text()));
await A.click('[data-cmd="h2"]');
check("H2 again turns it back", /\nThe loss went/.test(await text()));
await select("first item");
await A.click('[data-cmd="ol"]');
check("numbered list replaces bullet", (await text()).includes("1. first item"), await text());
await select("warmup");
await A.click('[data-cmd="math"]');
check("inline math wraps", (await text()).includes("$warmup$") || (await text()).includes('$<mark'), await text());

// Sanitiser: only colours survive in inline styles
await setText('# S\n\n<span style="position:fixed;top:0;left:0;width:100vw;height:100vh;background-color:#ff0000;color:#00ff00">overlay</span>\n\n<mark style="background-image:url(https://evil.example/x.png)">img</mark>\n\nMath: $x^2$\n');
await A.waitForTimeout(200);
const styles = await A.evaluate(() => [...document.querySelectorAll("#preview span[style], #preview mark[style]")].filter((e) => !e.closest(".katex")).map((e) => e.getAttribute("style")));
check("only colour CSS survives in notes", styles.length === 1 && styles[0] === "background-color:#ff0000;color:#00ff00", JSON.stringify(styles));
check("KaTeX still renders", await A.evaluate(() => !!document.querySelector("#preview .katex")));

// Appearance: personal, applied instantly, remembered
await setText("# Appearance\n\nSome text with <mark style=\"background-color:#fff3a3\">a highlight</mark> and <span style=\"color:#e5484d\">red words</span>.\n\n> A quote.\n\n$$\\int_0^1 x\\,dx = \\tfrac12$$\n");
await A.click("#appearance-btn");
await A.selectOption("#ap-preview-font", "book");
await A.click('#ap-theme [data-v="dark"]');
await A.click('#ap-size [data-v="l"]');
check("theme switches to dark", (await A.evaluate(() => document.documentElement.dataset.theme)) === "dark");
check("preview font changes", (await A.evaluate(() => getComputedStyle(document.querySelector("#preview")).fontFamily)).includes("Literata"));
check("other person's view unchanged", (await B.evaluate(() => document.documentElement.dataset.theme)) === undefined);
await A.keyboard.press("Escape");
if (SHOTS) await A.screenshot({ path: `${SHOTS}/dark.png` });
await A.reload();
await A.waitForFunction(() => window.__mdshare?.provider.isSynced);
check("settings remembered after reload", (await A.evaluate(() => document.documentElement.dataset.theme)) === "dark");
await A.click("#appearance-btn");
await A.click('#ap-theme [data-v="light"]');
await A.selectOption("#ap-preview-font", "serif");
await A.click('#ap-size [data-v="m"]');
await A.keyboard.press("Escape");
await setText("# Group meeting — 8 Oct\n\n## Results\n\nThe validation **loss** dropped to <mark style=\"background-color:#fff3a3\">0.142 after warmup</mark>, and <span style=\"color:#e5484d\">the gradient spikes are gone</span>.\n\n- Learning rate $\\eta = 3\\times10^{-4}$\n- Batch size 256\n\n> Next: try cosine decay.\n\n$$\n\\mathcal{L}(\\theta) = \\frac{1}{n}\\sum_i \\ell(x_i, y_i; \\theta)\n$$\n");
await A.waitForTimeout(300);
await select("the gradient spikes are gone");
await A.click('[data-pop="pop-highlight"]');
if (SHOTS) await A.screenshot({ path: `${SHOTS}/light.png` });
await A.keyboard.press("Escape");
check("no browser errors", errors.length === 0, errors.join("; "));
await browser.close();

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
