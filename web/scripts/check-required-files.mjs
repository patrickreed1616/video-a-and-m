#!/usr/bin/env node
// Site required-files check (adapted from the shared "Site required-files check" skill for a Vite PWA).
// Every page, image, stylesheet, script and in-site link referenced by HTML/CSS must exist, every #anchor
// must resolve, the required files below must be present, and (for a build) every manifest icon must exist.
// Usage: node scripts/check-required-files.mjs        -> checks the source tree (npm prebuild)
//        node scripts/check-required-files.mjs dist   -> checks the built site (npm postbuild)
// Exit code 1 on any problem.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] === "dist" ? "dist" : "source";
const root = mode === "dist" ? join(appRoot, "dist") : appRoot;
if (!existsSync(root)) { console.error(`Nothing to check: ${root} does not exist`); process.exit(1); }

// Root-absolute URLs ("/x") are served from the site root; in the source tree Vite serves public/ there too.
const servedRoots = mode === "dist" ? [root] : [root, join(root, "public")];

const skip = new Set([".git", ".vercel", "node_modules", "scripts", "dist", "dev-dist"]);
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (skip.has(n)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root);
const html = files.filter((f) => extname(f) === ".html");
const css = files.filter((f) => extname(f) === ".css");
const problems = [];
const used = new Set();
const ids = new Map();
const idsOf = (f) => {
  if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(f);
};
const isExternal = (u) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u) && !u.startsWith("file:");

function locate(from, pathPart) {
  const clean = decodeURI(pathPart.split("?")[0]);
  if (clean.startsWith("/")) {
    for (const base of servedRoots) { const p = join(base, clean); if (existsSync(p)) return p; }
    return join(servedRoots[0], clean);
  }
  return resolve(dirname(from), clean);
}

function checkRef(from, raw, kind) {
  const u = raw.trim();
  if (!u || isExternal(u) || u.startsWith("data:") || u.startsWith("#")) return;
  const [pathPart, hash] = u.split("#");
  const target = pathPart ? locate(from, pathPart) : from;
  const rel = relative(root, from);
  if (!target.startsWith(root)) return problems.push(`${rel}: ${kind} "${u}" points outside the site`);
  if (!existsSync(target)) return problems.push(`${rel}: missing ${kind} "${u}"`);
  used.add(target);
  if (hash && extname(target) === ".html" && !idsOf(target).has(hash)) problems.push(`${rel}: broken anchor "${u}"`);
}

for (const f of html) {
  const s = readFileSync(f, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of s.matchAll(/\s(href|src|poster|data-src)="([^"]*)"/g)) checkRef(f, m[2], m[1]);
  for (const m of s.matchAll(/\ssrcset="([^"]*)"/g)) for (const c of m[1].split(",")) checkRef(f, c.trim().split(/\s+/)[0], "srcset");
  for (const m of s.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) if (!m[2].startsWith("#")) checkRef(f, m[2], "url()");
  const seen = new Set();
  for (const m of s.matchAll(/\sid="([^"]+)"/g)) { if (seen.has(m[1])) problems.push(`${relative(root, f)}: duplicate id "${m[1]}"`); seen.add(m[1]); }
  if (!/<title>[^<]+<\/title>/.test(s)) problems.push(`${relative(root, f)}: missing <title>`);
}
for (const f of css) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) if (!m[2].startsWith("#") && !m[2].startsWith("data:")) checkRef(f, m[2], "url()");
}

const required = mode === "dist"
  ? ["index.html", "manifest.webmanifest", "sw.js", "registerSW.js", "favicon.svg",
     "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/icon.svg",
     "music/catalog.json"]
  : ["index.html", "vite.config.ts", "vercel.json", "src/main.tsx", "src/App.tsx", "src/styles.css",
     "public/favicon.svg", "public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/icon-maskable-512.png",
     "public/icons/apple-touch-icon.png", "public/icons/icon.svg", "public/music/catalog.json"];
for (const r of required) if (!existsSync(join(root, r))) problems.push(`required file missing: ${r}`);

// Built manifest: every icon it lists must exist.
if (mode === "dist" && existsSync(join(root, "manifest.webmanifest"))) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons ?? []) {
    const p = join(root, icon.src.replace(/^\//, ""));
    if (!existsSync(p)) problems.push(`manifest icon missing: ${icon.src}`); else used.add(p);
  }
  if (!manifest.name || !manifest.short_name || manifest.display !== "standalone") problems.push("manifest needs name, short_name and display: standalone");
}

// The music catalog must parse and its example rows must stay labelled.
const catalogPath = join(root, mode === "dist" ? "music/catalog.json" : "public/music/catalog.json");
if (existsSync(catalogPath)) {
  try {
    const cat = JSON.parse(readFileSync(catalogPath, "utf8"));
    for (const t of cat.tracks ?? []) {
      if (!t.example && !existsSync(join(dirname(catalogPath), t.file))) problems.push(`catalog track "${t.id}" is not marked example but ${t.file} is missing`);
    }
  } catch (e) { problems.push(`music/catalog.json is not valid JSON: ${e.message}`); }
}

const unused = files.filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f) && !used.has(f)).map((f) => relative(root, f));

console.log(`[${mode}] Checked ${html.length} pages, ${css.length} stylesheets, ${used.size} referenced local files, ${required.length} required files.`);
if (unused.length) console.log(`Note: images not referenced from HTML/CSS (may be used by the manifest/JS): ${unused.join(", ")}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n  - ` + problems.join("\n  - ")); process.exit(1); }
console.log("All referenced and required files exist. OK");
