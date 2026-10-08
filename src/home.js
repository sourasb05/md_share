// Home page: "My notes" and "Shared with me".
const $ = (id) => document.getElementById(id);
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
const SHARE_LABEL = { private: "Private", link_view: "Link: can view", link_edit: "Link: can edit" };
const ROLE_LABEL = { viewer: "Can view", editor: "Can edit", owner: "Co-owner" };
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

function render(list, items, empty, meta) {
  list.replaceChildren();
  if (!items.length) { list.append(el("li", { className: "muted empty" }, empty)); return; }
  for (const n of items) {
    list.append(el("li", {},
      el("a", { href: `/n/${n.id}`, textContent: n.title }),
      el("span", { className: "note-meta" }, ...meta(n).map((m) => el("span", { className: m.badge ? "badge" : "muted", textContent: m.text })))));
  }
}

Promise.all([fetch("/api/me").then((r) => r.json()), fetch("/api/notes").then((r) => r.json())]).then(([me, notes]) => {
  if (!me.local) { $("me").textContent = me.email; $("me").hidden = false; $("logout").hidden = false; }
  render($("mine"), notes.mine, "No notes yet. Create one with New note.",
    (n) => [{ text: SHARE_LABEL[n.share_mode] || "", badge: true }, { text: ago(n.updated_at) }]);
  render($("shared"), notes.shared, me.local ? "Sharing needs sign-in to be set up on this server." : "Notes others share with you, or that you open from a link, appear here.",
    (n) => [{ text: ROLE_LABEL[n.role] || "", badge: true }, { text: n.owner_email ? `by ${n.owner_email}` : "" }, { text: ago(n.updated_at) }]);
}).catch(() => {
  for (const id of ["mine", "shared"]) $(id).replaceChildren(el("li", { className: "muted", textContent: "Could not load notes." }));
});
