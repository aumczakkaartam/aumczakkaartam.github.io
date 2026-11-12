// Bouwt de drie Zakkaart-apps uit één bron (src/app.jsx + src/shell.html).
//   node build.mjs            → index.html, info.html, calculator.html, sw.js, manifesten
// De html-bestanden in de hoofdmap zijn GEGENEREERD: wijzig src/ en bouw opnieuw.
import { transformSync } from "@babel/core";
import { minify } from "terser";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const VERSIE = "November 2026 · v2.0";

const VARIANTS = {
  full: {
    out: "index.html", manifest: "manifest.webmanifest",
    title: "Zakkaart Anesthesiemedewerkers", short: "Zakkaart AM",
    icon: "icons/icon-full-512.png", touch: "apple-touch-icon.png",
    gateKey: "zk-am-unlocked-v1", passHash: "11232b2f4476255e9bfceded105b4841486050ab60817145a28956b154e59479",
    gateMark: "AM", gateSub: "Zakkaart Anesthesiemedewerkers",
  },
  info: {
    out: "info.html", manifest: "manifest-info.webmanifest",
    title: "Zakkaart Info", short: "Zakkaart Info",
    icon: "icons/icon-info-512.png", touch: "apple-touch-icon-info.png",
    gateKey: "zk-info-unlocked-v1", passHash: "660da25ea7051c6ade1b0bff0b63e59148e6a6bdc7f8273ae1ae522670108b77",
    gateMark: "Info", gateSub: "Zakkaart Info",
  },
  calc: {
    out: "calculator.html", manifest: "manifest-calc.webmanifest",
    title: "Zakkaart Calculator", short: "Zakkaart Calc",
    icon: "icons/icon-calc-512.png", touch: "apple-touch-icon-calculator.png",
    gateKey: "zk-am-unlocked-v1", passHash: "11232b2f4476255e9bfceded105b4841486050ab60817145a28956b154e59479",
    gateMark: "Calc", gateSub: "Zakkaart Calculator",
  },
};

// Regels tussen "#if a,b" en "#endif" blijven alleen staan voor de genoemde varianten ("!calc" = alle behalve calc).
function preprocess(src, variant) {
  const out = [];
  const stack = [];
  for (const line of src.split("\n")) {
    const mIf = line.match(/^\s*(?:\/\/|\{\/\*)\s*#if\s+([!\w,]+)/);
    if (mIf) {
      const names = mIf[1].split(",");
      const keep = names.some(n => (n.startsWith("!") ? n.slice(1) !== variant : n === variant));
      stack.push(keep);
      continue;
    }
    if (/^\s*(?:\/\/|\{\/\*)\s*#endif/.test(line)) {
      if (!stack.length) throw new Error("#endif zonder #if");
      stack.pop();
      continue;
    }
    if (stack.every(Boolean)) out.push(line);
  }
  if (stack.length) throw new Error("#if zonder #endif");
  return out.join("\n");
}

const dataUri = file => {
  const buf = fs.readFileSync(path.join(ROOT, "src/img", file));
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
};
const inlineSafe = js => js.replace(/<\/script/gi, "<\\/script");

const shell = read("src/shell.html");
const appSrc = read("src/app.jsx");
const vendor = ["vendor/react.production.min.js", "vendor/react-dom.production.min.js", "vendor/fuse.min.js"].map(read);
const built = [];

for (const [variant, v] of Object.entries(VARIANTS)) {
  let code = `const APP = ${JSON.stringify(variant)};\nconst VERSIE = ${JSON.stringify(VERSIE)};\n` + preprocess(appSrc, variant);
  code = transformSync(code, {
    presets: [["@babel/preset-react", { runtime: "classic" }]],
    babelrc: false, configFile: false, compact: false, comments: false, filename: "app.jsx",
  }).code;
  code = code.replace(/__IMG\("([^"]+)"\)/g, (_, f) => JSON.stringify(dataUri(f)));
  if (process.env.NO_MINIFY !== "1") {
    const res = await minify(code, { compress: { passes: 1 }, mangle: true, format: { comments: false } });
    code = res.code;
  }
  const scripts = [...vendor, code].map(js => `<script>${inlineSafe(js)}</script>`).join("\n");
  const html = shell
    .replace(/\{\{TITLE\}\}/g, v.title).replace(/\{\{SHORT\}\}/g, v.short)
    .replace(/\{\{ICON\}\}/g, v.icon).replace(/\{\{TOUCH\}\}/g, v.touch).replace(/\{\{MANIFEST\}\}/g, v.manifest)
    .replace(/\{\{GATE_KEY\}\}/g, v.gateKey).replace(/\{\{PASS_HASH\}\}/g, v.passHash)
    .replace(/\{\{GATE_MARK\}\}/g, v.gateMark).replace(/\{\{GATE_SUB\}\}/g, v.gateSub)
    .replace("{{SCRIPTS}}", () => scripts);
  fs.writeFileSync(path.join(ROOT, v.out), html);
  fs.writeFileSync(path.join(ROOT, v.manifest), JSON.stringify({
    name: v.title, short_name: v.short, start_url: "./" + (v.out === "index.html" ? "" : v.out), scope: "./",
    display: "standalone", orientation: "portrait", background_color: "#000000", theme_color: "#000000",
    icons: [{ src: v.icon, sizes: "512x512", type: "image/png", purpose: "any maskable" }],
  }, null, 2) + "\n");
  built.push({ file: v.out, kb: Math.round(html.length / 1024) });
}

// Service worker: versie = hash van de gebouwde bestanden, zodat een nieuwe build de cache ververst.
if (fs.existsSync(path.join(ROOT, "src/sw.js"))) {
  const hash = crypto.createHash("sha256");
  for (const v of Object.values(VARIANTS)) hash.update(fs.readFileSync(path.join(ROOT, v.out)));
  const assets = ["./", ...Object.values(VARIANTS).flatMap(v => ["./" + v.out, "./" + v.manifest, "./" + v.icon, "./" + v.touch])];
  fs.writeFileSync(path.join(ROOT, "sw.js"), read("src/sw.js")
    .replace("__CACHE_VERSION__", hash.digest("hex").slice(0, 12))
    .replace("__ASSETS__", JSON.stringify([...new Set(assets)])));
}

for (const b of built) console.log(`${b.file.padEnd(16)} ${b.kb} KB`);
