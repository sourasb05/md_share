const err = new URLSearchParams(location.search).get("error");
if (err) {
  const el = document.getElementById("err");
  if (err === "2") el.textContent = "Too many wrong attempts. Try again in 15 minutes.";
  el.hidden = false;
}
document.querySelector("form").action = "/login" + location.search.replace(/error=\d&?/, "").replace(/\?$/, "");
