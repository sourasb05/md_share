fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((me) => {
  if (me) document.getElementById("who").textContent = `You're signed in as ${me.email}.`;
}).catch(() => {});
