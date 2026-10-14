import { join } from "node:path";
import { judge } from "./access";
import { createApp, type Backend } from "./app";
import { completeFile, filterSlash, slashCommands } from "./complete";
import { loadConfig } from "./config";
import { prompt, readScreen, sendInput, sendKeys } from "./herdr";
import { SnapshotHub } from "./hub";
import { loadVapid, notification, Notifier, PushStore, webPushDeliver } from "./push";
import { findTranscript, readFrom, readTail } from "./transcript";

const cfg = loadConfig();
const hub = new SnapshotHub(cfg.socketPath);
const home = process.env.HOME ?? "/root";

const herdrBackend: Backend = {
  snapshot: () => hub.current(),
  subscribe: (fn) => hub.subscribe(fn),
  readScreen: (pane) => readScreen(cfg.socketPath, pane),
  prompt: (pane, text) => prompt(cfg.socketPath, pane, text),
  sendInput: (pane, text, keys) => sendInput(cfg.socketPath, pane, text, keys),
  sendKeys: (pane, keys) => sendKeys(cfg.socketPath, pane, keys),
  transcript(agent, offset, file) {
    if (!agent.sessionId) return null;
    const path = findTranscript(cfg.transcriptRoots, agent.sessionId);
    if (!path) return null;
    // A different file name means the session changed (/clear, resume): start again from its tail.
    return file === `${agent.sessionId}.jsonl` && offset > 0 ? readFrom(path, offset) : { ...readTail(path), reset: true };
  },
  complete(agent, kind, query) {
    if (!agent.cwd) return [];
    return kind === "file" ? completeFile(agent.cwd, query) : filterSlash(slashCommands(agent.cwd, home), query);
  },
};

// Notifications: keys and subscriptions live next to the config. The hub keeps polling for the notifier
// even when no page is open — that is when a phone most needs to hear.
const vapid = loadVapid(join(cfg.configDir, "vapid.json"));
const pushStore = new PushStore(join(cfg.configDir, "push.json"));
const deliver = webPushDeliver(vapid, `https://${cfg.publicHosts[0] ?? "localhost"}`);
const notifier = new Notifier(pushStore, deliver);
hub.subscribe((event, data) => {
  if (event === "snapshot") notifier.observe(JSON.parse(data));
});

const handle = createApp({
  backend: herdrBackend,
  machine: cfg.machine,
  distDir: cfg.distDir,
  gate: (req, remote) => judge({ method: req.method, remote, headers: req.headers }, cfg),
  push: {
    publicKey: vapid.publicKey,
    get: (endpoint) => pushStore.get(endpoint),
    save: (sub) => pushStore.save(sub),
    remove: (endpoint) => pushStore.remove(endpoint),
    test: (sub) =>
      notifier.send(
        sub,
        JSON.stringify({
          ...notification({ pane: "test", tabLabel: "arcdr", title: "", kind: "", tokens: {} }, "test", sub.lang),
          url: "/#/",
        }),
        false,
      ),
  },
});

const server = Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  idleTimeout: 60,
  fetch: (req, srv) => handle(req, srv.requestIP(req)?.address ?? null, (r) => srv.timeout(r, 0)),
});

console.log(`arcdr listening on http://${server.hostname}:${server.port} for ${cfg.owners.join(", ")}`);
