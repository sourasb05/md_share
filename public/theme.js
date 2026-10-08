// Personal appearance settings (theme, fonts, size, width), applied before first paint.
// Plain script (no module) so it runs while <head> loads; settings live only in this browser.
(function () {
  var FONTS = {
    mono: { label: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
    sans: { label: "Inter", stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
    serif: { label: "Source Serif", stack: '"Source Serif 4", Georgia, "Times New Roman", serif' },
    book: { label: "Literata", stack: '"Literata", Georgia, serif' },
    readable: { label: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif' },
    system: { label: "System", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  };
  var SIZES = { s: [13.5, 15], m: [14.5, 17], l: [16, 18.5], xl: [18, 20.5] }; // [editor, preview] px
  var WIDTHS = { narrow: "740px", wide: "1000px" };
  var DEFAULTS = { editorFont: "mono", previewFont: "serif", size: "m", theme: "system", width: "narrow" };

  function get() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem("mdshare_prefs") || "{}") || {}; } catch (e) {}
    var out = {};
    for (var k in DEFAULTS) out[k] = p[k] || DEFAULTS[k];
    if (!FONTS[out.editorFont]) out.editorFont = DEFAULTS.editorFont;
    if (!FONTS[out.previewFont]) out.previewFont = DEFAULTS.previewFont;
    if (!SIZES[out.size]) out.size = DEFAULTS.size;
    if (!WIDTHS[out.width]) out.width = DEFAULTS.width;
    return out;
  }
  function apply(p) {
    var root = document.documentElement;
    if (p.theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", p.theme);
    root.style.setProperty("--font-editor", FONTS[p.editorFont].stack);
    root.style.setProperty("--font-preview", FONTS[p.previewFont].stack);
    root.style.setProperty("--fs-editor", SIZES[p.size][0] + "px");
    root.style.setProperty("--fs-preview", SIZES[p.size][1] + "px");
    root.style.setProperty("--measure", WIDTHS[p.width]);
  }
  function set(changes) {
    var p = get();
    for (var k in changes) p[k] = changes[k];
    try { localStorage.setItem("mdshare_prefs", JSON.stringify(p)); } catch (e) {}
    apply(p);
    return p;
  }
  apply(get());
  window.mdsharePrefs = { FONTS: FONTS, get: get, set: set };
})();
