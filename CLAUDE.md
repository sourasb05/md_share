# Instructions for AI coding assistants working on MdShare

MdShare is a HackMD-style collaborative Markdown editor for a research group (internal first,
public later). The engineering plan is the source of truth for scope and milestones.

## Hard rules
- Real-time text goes ONLY through Yjs via Hocuspocus. Never write custom merge/diff/OT logic,
  never edit note text on the server except through a Yjs document.
- The Yjs document (Hocuspocus `documents` table) is the source of truth; `notes.markdown` is a
  derived copy for listing, search and download.
- Every route and the WebSocket (`onConnect`) must check access. Add a test whenever you add a route.
- Rendered Markdown must go through DOMPurify. Keep the Content-Security-Policy strict
  (no inline scripts).
- Do not add dependencies without saying why. Keep plain JavaScript (ES modules) unless asked.
- One milestone per session. Finish with `npm run build`, start the server, run
  `node test/two-users.mjs`, and report the result.
- Log important choices in DECISIONS.md.

## Next milestone: M4 — personal sign-in, My Notes, sharing
- Replace the shared group password with per-person sign-in (email magic link or university/GitHub
  OAuth); keep an email allowlist so only the group can join.
- Tables: users, note_members(note_id, user_id, role viewer|editor|owner); notes.owner_id, notes.share_mode
  (private | link_view | link_edit).
- Viewers connect read-only (Hocuspocus `connection.readOnly = true` in onAuthenticate/onConnect).
- Home page: "My notes" and "Shared with me".
- Done when: a logged-out browser cannot read a private note over HTTP or WebSocket, and a viewer's
  edits are rejected — both covered by Playwright tests.
