// A demo of arcdr without herdr: the made-up agents of scripts/demo-backend.ts behind the real server.
// Local only, no login: http://127.0.0.1:7430 — the same agents run in the browser as the static demo
// (bun run build:demo).
//
//   bun run demo
import { join } from "node:path";
import { createApp } from "../server/app";
import { createDemo } from "./demo-backend";

const port = Number(process.env.PORT ?? 7430);

const handle = createApp({
  ...createDemo(),
  machine: "demo-laptop",
  distDir: join(import.meta.dir, "..", "dist"),
  // The demo listens on 127.0.0.1 only and holds nothing real.
  gate: () => ({ ok: true, login: "demo@example.com" }),
});

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: (req, srv) => handle(req, srv.requestIP(req)?.address ?? null, (r) => srv.timeout(r, 0)),
});
console.log(`arcdr demo on http://127.0.0.1:${port}`);
