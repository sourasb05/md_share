const params = new URLSearchParams(location.search);
const next = params.get("next") || "/";
const $ = (id) => document.getElementById(id);
$("next").value = next;

const ERRORS = {
  domain: "That address can't sign in here. Use an address at one of the allowed domains.",
  rate: "Too many sign-in attempts. Wait 15 minutes and try again.",
  mail: "We couldn't send the email. Try again, or ask your administrator to check the mail settings.",
  link: "That sign-in link has expired or was already used. Request a new one below.",
  github: "GitHub sign-in didn't complete. Try again.",
  github_email: "Your GitHub account has no verified email address at an allowed domain. Add one under GitHub → Settings → Emails, or sign in by email.",
};
const err = params.get("error");
if (err) { $("err").textContent = ERRORS[err] || "Sign-in failed. Try again."; $("err").hidden = false; }
const sent = params.get("sent");
if (sent) {
  $("sent").textContent = `Check your inbox at ${sent}. The link works once and expires in 15 minutes.`;
  $("sent").hidden = false;
  $("email").value = sent;
  $("send").textContent = "Send another link";
}

fetch("/api/auth/config").then((r) => r.json()).then((c) => {
  if (c.domains?.length) {
    $("domains").textContent = `Use your ${c.domains.map((d) => "@" + d).join(" or ")} email address.`;
    $("email").placeholder = `you@${c.domains[0]}`;
  }
  if (c.github) {
    $("github").href = `/auth/github?next=${encodeURIComponent(next)}`;
    $("github-wrap").hidden = false;
  }
}).catch(() => {});
