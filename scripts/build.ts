// Bundles web/ into dist/: app.js from the TSX, the static files copied with __VERSION__ filled in,
// so a new build changes every cached URL and the service worker's cache name.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const web = join(root, "web");
const dist = join(root, "dist");
const version = Date.now().toString(36);

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(web, "app.tsx")],
  outdir: dist,
  naming: "app.js",
  target: "browser",
  minify: true,
  define: { __BUILD__: JSON.stringify(version) },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const name of ["index.html", "sw.js"]) {
  writeFileSync(join(dist, name), readFileSync(join(web, name), "utf8").replaceAll("__VERSION__", version));
}
for (const name of ["style.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "badge-96.png"]) {
  copyFileSync(join(web, name), join(dist, name));
}

writeFileSync(join(dist, "version.txt"), version);
console.log(`built dist/ (version ${version})`);
