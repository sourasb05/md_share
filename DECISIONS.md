# Decisions

- 2026-10-08 — Sync server: Hocuspocus 4.7 (open source, MIT) instead of a hand-written WebSocket server.
- 2026-10-08 — Audience: research group first, internal testing; public later.
- 2026-10-08 — LaTeX math (KaTeX, `$...$` and `$$...$$`) is part of the MVP.
- 2026-10-08 — Self-hosted. SQLite for now; move to PostgreSQL if several servers are needed.
- 2026-10-08 — Access for the MVP: one shared group password; personal accounts in M4.
- 2026-10-08 — Security hardening (before M4), no new dependencies:
  - Server-side sessions in SQLite (only SHA-256 of the token stored), 7-day expiry, real logout that
    also disconnects open editors. `SESSION_SECRET` is no longer used. Changing `GROUP_PASSWORD`
    ends all sessions (a salted scrypt fingerprint of it is kept in the `meta` table).
  - Listen on 127.0.0.1 by default; refuse to listen elsewhere without a password; password ≥ 12 chars.
  - Login throttling: 5 failures per IP per 15 min (in memory). Client IP via Express `trust proxy`
    (`TRUST_PROXY`, default loopback) so it can't be spoofed by clients.
  - Origin must match Host for every non-GET request and for the WebSocket handshake
    (rejected in Hocuspocus `onUpgrade`, before any document is loaded). Cookies stay SameSite=Lax so
    shared note links still open while logged in.
  - CSP: connect-src only our own ws(s) origin; images only self/data/blob (external images blocked
    to prevent read-tracking); form-action 'self'. style-src keeps 'unsafe-inline' because
    CodeMirror and KaTeX need inline styles.
  - DOMPurify also forbids <style> and form controls in notes.
  - Docker: non-root user, read-only root filesystem, all capabilities dropped, no-new-privileges.
  - Not done: per-note size cap (rejecting Yjs updates could leave a note stuck); waits for M4/M6.
- 2026-10-08 — AI rephrase (select text → Claude suggests a rewrite):
  - New dependency `@anthropic-ai/sdk` (official client: typed errors, retries, timeouts) instead of
    hand-written HTTP calls.
  - The server only returns a suggestion; the browser applies it through CodeMirror → yCollab → Yjs,
    so it syncs like any edit, is undoable, and no server-side text editing is needed. Yjs relative
    positions track the selection; if the text changed meanwhile, the replacement is refused.
  - Model `claude-opus-5-5` at effort `low` (simple task), overridable with `AI_MODEL`; server-side
    refusal fallback (`fallbacks: "default"`) enabled.
  - Off unless `ANTHROPIC_API_KEY` is set. Same access checks as other routes, max 4000 characters,
    10 requests per person per minute. Only the selection is sent to Anthropic.
- 2026-10-08 — Editor redesign: formatting toolbar, text colour and highlight, personal appearance.
  - Colours are written into the Markdown as `<span style="color:#hex">` / `<mark style="background-color:#hex">`
    (portable, visible to everyone). The sanitiser keeps only `color`/`background-color` with hex values in
    note HTML; KaTeX's own output keeps its layout styles, and `#preview` has `contain: paint` so nothing
    in a note can draw outside the page.
  - Fonts, text size, theme (Auto/Light/Paper/Dark) and page width are per-person settings in
    localStorage, applied before first paint by `public/theme.js` (an external script, CSP-safe).
  - Fonts are self-hosted (the CSP blocks font CDNs): new devDependencies @fontsource-variable/inter,
    source-serif-4, literata, jetbrains-mono and @fontsource/atkinson-hyperlegible, copied by the build
    (latin subset, ~460 KB total). @codemirror/language and @lezer/highlight are now declared
    explicitly (they were already installed via CodeMirror) for the theme-aware syntax colours.
  - All toolbar actions are CodeMirror changes, so they sync through Yjs and are undoable.
- 2026-10-08 — Published to a public GitHub repo. `.gitignore` keeps out `.env*` (except `.env.example`),
  `data/` and any `*.sqlite*`, build output and test screenshots; commits use the GitHub noreply email.
  Added SECURITY.md (private vulnerability reporting). README now combines the product overview and the
  technical guide; screenshots live in docs/images/.
