// Bundles the static, serverless demo into dist-demo/: the app plus the real server routes and the made-up
// agents of scripts/demo-backend.ts, all running in the page (web/demo/). Node-only modules are swapped for
// the small stand-ins in web/demo/stubs. Paths are relative, so it works under any folder, such as GitHub
// Pages' /arcdr/.
//
//   bun run build:demo && python3 -m http.server -d dist-demo 8080
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const web = join(root, "web");
const out = join(root, "dist-demo");
const stubs = join(web, "demo", "stubs");
const version = `demo-${Date.now().toString(36)}`;

const STUBS: Record<string, string> = { fs: "fs.ts", path: "path.ts", net: "net.ts", os: "os.ts", "web-push": "web-push.ts" };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(web, "demo", "main.ts")],
  outdir: out,
  naming: "app.js",
  target: "browser",
  minify: true,
  define: { __BUILD__: JSON.stringify(version), "process.env.HOME": JSON.stringify("/home/demo") },
  plugins: [
    {
      name: "browser-stubs",
      setup(build) {
        build.onResolve({ filter: /^(node:)?(fs|path|net|os)$|^web-push$/ }, (args) => ({
          path: join(stubs, STUBS[args.path.replace(/^node:/, "")]!),
        }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const html = readFileSync(join(web, "index.html"), "utf8")
  .replace(/\s*<link rel="manifest"[^>]*>/, "")
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replace(
    "<title>arcdr</title>",
    '<title>arcdr — demo</title>\n    <meta name="description" content="arcdr, the herdr client for your phone, running against made-up agents in your browser." />',
  )
  .replaceAll("__VERSION__", version);
writeFileSync(join(out, "index.html"), html);
for (const name of ["style.css", "icon.svg", "icon-192.png", "icon-512.png"]) copyFileSync(join(web, name), join(out, name));

const size = readdirSync(out).reduce((n, f) => n + statSync(join(out, f)).size, 0);
console.log(
  `built dist-demo/ (${version}, ${(size / 1024).toFixed(0)} KB, app.js ${(statSync(join(out, "app.js")).size / 1024).toFixed(0)} KB)`,
);
