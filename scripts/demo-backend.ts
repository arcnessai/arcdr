/**
 * The made-up machine behind both demos: five agents in two spaces, their conversations, a question waiting
 * for an answer, file changes, and the band and footer a mod would report. Sending, choosing and starting
 * sessions act on this state, in memory. No node:* imports, so the same module runs under Bun
 * (scripts/demo.ts) and in the browser (web/demo/, the static demo).
 */
import type { AppOptions, Backend } from "../server/app";
import type { Shortcut } from "../server/shortcuts";
import type { Agent, Snapshot } from "../server/herdr";
import { filterSlash, slashCommands } from "../server/complete";
import { parseMenu } from "../server/screen";
import type { DisplaySpec } from "../server/spec";
import type { ChatItem } from "../server/transcript";

/** What createApp needs from a demo, besides where its files are and who may come in. */
export type Demo = Pick<AppOptions, "backend" | "display" | "saveDisplay" | "shortcuts">;

export function createDemo(): Demo {
  const now = Date.now();

  const agent = (
    pane: string,
    space: string,
    tab: number,
    label: string,
    status: Agent["status"],
    tokens: Record<string, string>,
    conversation = "",
  ): Agent => ({
    pane,
    space,
    tab: `${space}:t${tab}`,
    tabNumber: tab,
    tabLabel: label,
    title: label,
    conversation,
    status,
    kind: "claude",
    tokens,
    sessionId: null,
    cwd: "/home/demo/shop",
  });

  const usage = {
    account: "demo@example.com (Max)",
    limit5h: "42",
    limit5hReset: new Date(now + 95 * 60_000).toISOString(),
    limitWeek: "18",
    limitWeekReset: new Date(now + 4 * 86_400_000).toISOString(),
  };

  const agents: Agent[] = [
    agent(
      "w1:p1",
      "w1",
      1,
      "Checkout retries",
      "blocked",
      {
        tree: "12",
        stage: "◇ waiting on you",
        skill: "start",
        progress: "3/5",
        doing: "Asking which retry policy to use",
        since: String(now - 4 * 60_000),
        context: "38",
        ...usage,
      },
      "Retry policy for payments",
    ),
    agent(
      "w1:p2",
      "w1",
      2,
      "Search ranking",
      "working",
      {
        tree: "14",
        stage: "● working",
        skill: "start",
        progress: "2/6",
        doing: "Writing the ranking tests",
        detail: "5 changes",
        context: "61",
        ...usage,
      },
      "Boost exact matches",
    ),
    agent(
      "w1:p3",
      "w1",
      3,
      "Dark mode tokens",
      "done",
      {
        tree: "9",
        stage: "◆ before landing",
        skill: "start",
        progress: "6/6",
        doing: "All checks pass",
        detail: "3 commits",
        context: "24",
        ...usage,
      },
      "Theme tokens for dark mode",
    ),
    agent("w1:p4", "w1", 4, "Flaky upload test", "working", {
      tree: "15",
      stage: "◐ gate running",
      skill: "land",
      progress: "2/3",
      doing: "Landing after the gate",
      since: String(now - 7 * 60_000),
      context: "83",
      ...usage,
    }),
    agent("w2:p1", "w2", 1, "Release notes 2.4", "idle", { stage: "✓ done", context: "12", ...usage }, "Draft the 2.4 notes"),
  ];

  const snapshot = (): Snapshot => ({
    version: "0.9.3",
    spaces: [
      {
        id: "w1",
        number: 1,
        label: "shop",
        status: "blocked",
        tokens: { agents: `${agents.filter((a) => a.space === "w1").length} agents` },
      },
      {
        id: "w2",
        number: 2,
        label: "docs",
        status: "idle",
        tokens: { agents: `${agents.filter((a) => a.space === "w2").length} agent` },
      },
    ],
    agents: [...agents],
  });

  let seq = 0;
  const id = () => `d${++seq}`;
  const user = (text: string): ChatItem => ({ id: id(), kind: "user", text, at: null });
  const said = (text: string): ChatItem => ({ id: id(), kind: "assistant", text, at: null });
  const tool = (
    name: string,
    summary: string,
    detail = "",
    change?: { path: string; old: string; new: string; created?: boolean },
  ): ChatItem => ({
    id: id(),
    kind: "tool",
    name,
    summary,
    detail,
    at: null,
    ...(change && {
      change: {
        path: change.path,
        edits: [{ old: change.old, new: change.new }],
        created: change.created ?? false,
        clipped: false,
      },
    }),
  });

  const transcripts: Record<string, ChatItem[]> = {
    "w1:p1": [
      user("/start checkout retries"),
      said(
        "Taking **Checkout retries**. Payments that fail with a timeout are retried with no limit today, so a slow provider can charge twice.",
      ),
      tool("Read", "payments/retry.ts", "/home/demo/shop/payments/retry.ts"),
      tool("Grep", "retryPayment", "retryPayment  in  /home/demo/shop"),
      tool("Edit", "payments/retry.ts", "", {
        path: "/home/demo/shop/payments/retry.ts",
        old: "export async function retryPayment(p: Payment) {\n  while (true) {\n    const r = await charge(p);\n    if (r.ok) return r;\n  }\n}",
        new: "export async function retryPayment(p: Payment, tries = 3) {\n  for (let i = 0; i < tries; i++) {\n    const r = await charge(p, { idempotencyKey: p.id });\n    if (r.ok) return r;\n    await sleep(backoff(i));\n  }\n  throw new RetryExhausted(p.id);\n}",
      }),
      said(
        "The loop now stops after three tries, waits longer each time, and sends an idempotency key so the provider never charges twice.\n\n| Case | Before | After |\n|---|---|---|\n| Provider timeout | retried forever | 3 tries, then an error |\n| Double charge | possible | prevented by the key |\n\nOne decision is yours — see below.",
      ),
      {
        id: id(),
        kind: "ask",
        at: null,
        questions: [
          {
            question: "Which retry policy should checkout use?",
            options: ["Three tries with backoff (Recommended)", "Five tries, no backoff", "No retries — show the error"],
            multi: false,
          },
        ],
      },
    ],
    "w1:p2": [
      user("Exact matches should come first in search."),
      said("Looking at how results are scored now."),
      tool("Bash", "Run the search tests", "bun test search"),
      tool("Edit", "search/rank.ts", "", {
        path: "/home/demo/shop/search/rank.ts",
        old: "score = tfidf(doc, q)",
        new: "score = tfidf(doc, q) + (doc.title === q ? 10 : 0)",
      }),
      said("Exact title matches now get a fixed boost. Writing tests for ties next."),
    ],
    "w1:p3": [
      user("Move the dark mode colours to tokens."),
      said("Done — every colour is a `--color-*` token now, and the checks pass. Ready to land."),
    ],
    "w1:p4": [
      user("/land"),
      said("The gate is running on the merge result."),
      tool("Bash", "Run the gate", "./gate --stage land"),
    ],
    "w2:p1": [
      user("Draft the 2.4 release notes."),
      said("Drafted in `/home/demo/docs/releases/2.4.md`. See https://example.com/changelog for the format."),
    ],
  };

  const MENU = `
● One decision is yours.
${"─".repeat(40)}
 ☐ Retry policy

Which retry policy should checkout use?

❯ 1. Three tries with backoff (Recommended)
  2. Five tries, no backoff
  3. No retries — show the error
  4. Type something.

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

  const screens: Record<string, string> = { "w1:p1": MENU };
  const listeners = new Set<(e: "snapshot" | "down", d: string) => void>();
  const publish = () => listeners.forEach((fn) => fn("snapshot", JSON.stringify(snapshot())));

  function setStatus(pane: string, status: Agent["status"], tokens?: Record<string, string>) {
    const i = agents.findIndex((a) => a.pane === pane);
    if (i >= 0) agents[i] = { ...agents[i]!, status, tokens: { ...agents[i]!.tokens, ...tokens } };
    publish();
  }

  function reply(pane: string, text: string) {
    setStatus(pane, "working");
    setTimeout(() => {
      transcripts[pane]?.push(said(text));
      setStatus(pane, "done");
    }, 1600);
  }

  const backend: Backend = {
    snapshot: async () => snapshot(),
    subscribe(fn) {
      listeners.add(fn);
      fn("snapshot", JSON.stringify(snapshot()));
      return () => listeners.delete(fn);
    },
    readScreen: async (pane) =>
      screens[pane] ??
      `● ${agents.find((a) => a.pane === pane)?.tokens.doing ?? ""}\n\n❯ \n  ⏵⏵ accept edits on (shift+tab to cycle)`,
    async prompt(pane, text) {
      transcripts[pane]?.push(user(text));
      reply(pane, "(demo) Got it — this is where the agent would answer.");
    },
    async sendInput(pane, text) {
      transcripts[pane]?.push(user(text));
    },
    async sendKeys(pane, keys) {
      const menu = screens[pane] ? parseMenu(screens[pane]!) : null;
      if (!menu || keys.at(-1) !== "enter") return;
      const moved = keys.filter((k) => k === "down").length - keys.filter((k) => k === "up").length;
      const choice = menu.choices[menu.cursor + moved];
      delete screens[pane];
      transcripts[pane]?.push(user(choice?.label ?? ""));
      setStatus(pane, "working", { stage: "● working", doing: "Applying the chosen policy" });
      reply(pane, `(demo) Going with **${choice?.label}**.`);
    },
    transcript(agent, offset) {
      const items = transcripts[agent.pane] ?? [];
      return {
        items: items.slice(offset),
        offset: items.length,
        reset: offset === 0,
        clipped: false,
        file: `${agent.pane}.jsonl`,
      };
    },
    complete: (_agent, kind, query) =>
      kind === "slash" ? filterSlash(slashCommands("/nonexistent", "/nonexistent", 0), query) : [],
    pastSessions: () => [
      { id: "00000000-0000-4000-8000-000000000001", title: "Refund flow cleanup", at: now - 3 * 3600_000 },
      { id: "00000000-0000-4000-8000-000000000002", title: "Cart page performance", at: now - 2 * 86_400_000 },
    ],
    async startSession(space, cwd, label) {
      const n = agents.filter((a) => a.space === space).length + 1;
      const pane = `${space}:p${n + 10}`;
      agents.push({ ...agent(pane, space, n + 10, label ?? "New session", "idle", { ...usage }), cwd });
      transcripts[pane] = [];
      publish();
      return pane;
    },
    async closePane(pane) {
      const i = agents.findIndex((a) => a.pane === pane);
      if (i >= 0) agents.splice(i, 1);
      publish();
    },
  };

  let display: DisplaySpec = {
    agent: {
      badge: { from: "token:tree", color: "cyan", bold: true },
      name: ["field:tab", "field:title"],
      line: [
        {
          from: "token:stage",
          color: "purple",
          rules: [
            { startsWith: "◐", color: "yellow" },
            { startsWith: "◆", color: "cyan" },
            { startsWith: "✓", color: "green", bold: true },
            { startsWith: "◇", color: "pink", bold: true },
          ],
        },
        { from: "field:conversation", dim: true, max: 80 },
      ],
    },
    space: { line: [{ from: "token:agents", dim: true }] },
    band: [
      {
        left: [
          { from: "token:skill", as: "chip", color: "claude" },
          { from: "token:progress", as: "dots", color: "suggestion" },
          { from: "token:doing", max: 80 },
        ],
        right: [
          { from: "token:detail", dim: true },
          { from: "token:since", as: "ago", dim: true },
        ],
      },
      {
        right: [
          {
            from: "token:context",
            as: "meter",
            prefix: "context ",
            color: "dim",
            rules: [
              { above: 80, color: "error", bold: true },
              { above: 60, color: "warning" },
            ],
          },
        ],
      },
    ],
    footer: {
      left: [{ from: "token:account", dim: true }],
      right: [
        { from: "token:limit5h", as: "meter", prefix: "5h ", color: "dim", rules: [{ above: 80, color: "error" }] },
        { from: "token:limit5hReset", as: "ago", dim: true },
        { from: "token:limitWeek", as: "meter", prefix: "week ", color: "dim" },
      ],
    },
  };

  // Kept in memory: the demo writes nothing to disk.
  let shortcuts: Shortcut[] = [
    { text: "/compact", label: "", send: true },
    { text: "/start ", label: "next unit", send: false },
    { text: "Summarise what changed and what is left.", label: "status", send: true },
  ];

  return {
    backend,
    display: () => ({ spec: display, origin: "file", errors: [] }),
    saveDisplay: (spec) => void (display = spec),
    shortcuts: {
      list: () => shortcuts,
      save: (list) => void (shortcuts = list),
    },
  };
}
