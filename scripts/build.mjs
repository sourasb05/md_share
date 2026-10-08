// Cross-platform build: bundle browser code and copy KaTeX CSS + fonts and the editor's web fonts.
import { build } from "esbuild";
import fs from "node:fs";
await build({
  entryPoints: ["src/editor.js", "src/home.js"], bundle: true, minify: true,
  format: "esm", splitting: true, chunkNames: "chunks/[name]-[hash]", outdir: "public",
});
fs.rmSync("public/katex", { recursive: true, force: true });
fs.mkdirSync("public/katex", { recursive: true });
fs.copyFileSync("node_modules/katex/dist/katex.min.css", "public/katex/katex.min.css");
fs.cpSync("node_modules/katex/dist/fonts", "public/katex/fonts", { recursive: true });

// Self-hosted fonts (the CSP only allows fonts from our own server). Latin subset only.
const FONTS = [
  // [family, package, file prefix, variable?]
  ["Inter", "@fontsource-variable/inter", "inter", true],
  ["Source Serif 4", "@fontsource-variable/source-serif-4", "source-serif-4", true],
  ["Literata", "@fontsource-variable/literata", "literata", true],
  ["JetBrains Mono", "@fontsource-variable/jetbrains-mono", "jetbrains-mono", true],
  ["Atkinson Hyperlegible", "@fontsource/atkinson-hyperlegible", "atkinson-hyperlegible", false],
];
fs.rmSync("public/fonts", { recursive: true, force: true });
fs.mkdirSync("public/fonts", { recursive: true });
let css = "";
for (const [family, pkg, prefix, variable] of FONTS) {
  const faces = variable
    ? [["wght-normal", "normal", "100 900"], ["wght-italic", "italic", "100 900"]]
    : [["400-normal", "normal", "400"], ["700-normal", "normal", "700"], ["400-italic", "italic", "400"]];
  for (const [suffix, style, weight] of faces) {
    const file = `${prefix}-latin-${suffix}.woff2`;
    fs.copyFileSync(`node_modules/${pkg}/files/${file}`, `public/fonts/${file}`);
    css += `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${file}) format("woff2")}\n`;
  }
}
fs.writeFileSync("public/fonts/fonts.css", css);
console.log("Built public/editor.js, public/home.js, KaTeX assets and fonts");
