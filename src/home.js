const list = document.getElementById("notes");
const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
fetch("/api/notes").then((r) => r.json()).then((notes) => {
  list.replaceChildren();
  if (!notes.length) { list.innerHTML = '<li class="muted">No notes yet. Create the first one.</li>'; return; }
  for (const n of notes) {
    const li = document.createElement("li");
    const a = Object.assign(document.createElement("a"), { href: `/n/${n.id}`, textContent: n.title });
    const t = Object.assign(document.createElement("span"), { className: "muted", textContent: ago(n.updated_at) });
    li.append(a, t); list.append(li);
  }
}).catch(() => { list.innerHTML = '<li class="muted">Could not load notes.</li>'; });
