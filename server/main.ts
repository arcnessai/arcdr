import { join } from "node:path";
import { judge } from "./access";
import { createApp, type Backend } from "./app";
import { completeFile, filterSlash, slashCommands } from "./complete";
import { loadConfig } from "./config";
import { existsSync, statSync } from "node:fs";
import { closePane, createTab, HerdrError, moveTab, readScreen, sendInput, sendKeys, startClaude, typeMessage } from "./herdr";
import { pastSessions } from "./sessions";
import { SnapshotHub } from "./hub";
import { herdrProcesses, LiveSessions } from "./live";
import { displayLoader, saveDisplay } from "./display";
import { loadVapid, notification, Notifier, PushStore, webPushDeliver } from "./push";
import { findTranscript, readFrom, readTail } from "./transcript";
import { ShortcutStore } from "./shortcuts";
import { sweepUploads } from "./uploads";

const cfg = loadConfig();
// A pane's session read from its own Claude Code, not only from what herdr was told (server/live.ts).
const live = new LiveSessions(herdrProcesses(cfg.socketPath), join(process.env.HOME ?? "/root", ".claude", "sessions"));
const hub = new SnapshotHub(cfg.socketPath, 1000, (snap) => live.apply(snap));
const home = process.env.HOME ?? "/root";

const herdrBackend: Backend = {
  snapshot: () => hub.current(),
  subscribe: (fn) => hub.subscribe(fn),
  readScreen: (pane) => readScreen(cfg.socketPath, pane),
  prompt: (pane, text) => typeMessage(cfg.socketPath, pane, text),
  sendInput: (pane, text, keys) => sendInput(cfg.socketPath, pane, text, keys),
  sendKeys: (pane, keys) => sendKeys(cfg.socketPath, pane, keys),
  transcript(agent, offset, file) {
    if (!agent.sessionId) return null;
    const path = findTranscript(cfg.transcriptRoots, agent.sessionId);
    if (!path) return null;
    // A different file name means the session changed (/clear, resume): start again from its tail.
    return file === `${agent.sessionId}.jsonl` && offset > 0 ? readFrom(path, offset) : { ...readTail(path), reset: true };
  },
  pastSessions: (cwd, open) => pastSessions(cfg.transcriptRoots, cwd, open),
  async startSession(space, cwd, label, resume) {
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new HerdrError("bad_cwd", `no such folder: ${cwd}`);
    if (resume && !pastSessions(cfg.transcriptRoots, cwd, new Set(), 10_000).some((s) => s.id === resume)) {
      throw new HerdrError("bad_resume", "that conversation is not in this folder");
    }
    const pane = await createTab(cfg.socketPath, space, cwd, label);
    // The new tab's shell needs a moment to reach its prompt before herdr will start an agent in it.
    await Bun.sleep(800);
    await startClaude(cfg.socketPath, pane, resume ? ["--resume", resume] : []);
    return pane;
  },
  closePane: (pane) => closePane(cfg.socketPath, pane),
  moveAgent: (agent, before) => moveTab(cfg.socketPath, agent.tab, before?.tab ?? null),
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
// What to show besides the conversation: ~/.config/arcdr/display.json, else herdr's own sidebar rows.
const displayFile = join(cfg.configDir, "display.json");
const display = displayLoader(displayFile, join(home, ".config/herdr/config.toml"));
const notifier = new Notifier(pushStore, deliver, () => display().spec.alerts ?? []);
hub.subscribe((event, data) => {
  if (event === "snapshot") notifier.observe(JSON.parse(data));
});

// Files added from a phone, where the agent can read them (Remote Control keeps its own under ~/.claude/uploads).
const uploadsRoot = join(home, ".claude", "uploads", "arcdr");
sweepUploads(uploadsRoot);
setInterval(() => sweepUploads(uploadsRoot), 6 * 3600_000);

const handle = createApp({
  backend: herdrBackend,
  machine: cfg.machine,
  distDir: cfg.distDir,
  gate: (req, remote) => judge({ method: req.method, remote, headers: req.headers }, cfg),
  display,
  saveDisplay: (spec) => saveDisplay(displayFile, spec),
  uploadsRoot,
  shortcuts: new ShortcutStore(join(cfg.configDir, "shortcuts.json")),
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
