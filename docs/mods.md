# Showing what your mods report

arcdr shows more than the conversation: a number before each agent, a coloured stage under its name, a band
above the message box, a line under it, notifications. None of that is built in for one setup. Your mods
report values to herdr, and a display spec — `~/.config/arcdr/display.json` — says where each value goes
and how it is drawn.

```
Claude Code mod · hook · any script in a herdr pane
        │  herdr pane report-metadata --token stage=◆ landing
        ▼
herdr (pane title, pane tokens, space tokens, tab label, agent state)
        │  session snapshot, once a second
        ▼
arcdr server ── display.json ──▶ list rows · chat header · band · footer · notifications
```

## What a mod can report

Every herdr pane has `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID` and `HERDR_BIN_PATH` in its
environment, so anything running in it — a Claude Code mod, a hook, a shell script — can report about itself.

| Report | Command | Read in the spec as |
|---|---|---|
| A named value | `herdr pane report-metadata "$HERDR_PANE_ID" --source my-mod --token stage="◆ landing"` | `token:stage` |
| Remove a value | `… --clear-token stage` | (the part disappears) |
| A value that expires | `… --token build=green --ttl-ms 600000` | `token:build`, gone after 10 minutes |
| The pane's title | `… --title "unit 21 · skill import"` | `field:title` |
| The tab's name | `herdr tab rename "$HERDR_TAB_ID" "skill import"` | `field:tab` (the agent's name by default) |
| A space's value | `herdr workspace report-metadata "$HERDR_WORKSPACE_ID" --source my-mod --token agents="12 agents"` | `token:agents` in `space.line` |
| A custom agent's state | `herdr pane report-agent "$HERDR_PANE_ID" --source my-mod --agent my-agent --state blocked` | the status icon, and the *needs you* notification |

`--source` is any name up to 80 characters (letters, digits, `.:_-`). One report can carry many `--token`
flags; a token not mentioned keeps its value. Claude Code itself gives two more: `field:conversation` (the
title it gives the conversation) and `field:status` (`working`, `blocked`, `done`, `idle`).

### From a Claude Code mod

```ts
const pane = await $.env.get('HERDR_PANE_ID')
if (pane) {
  const herdr = (await $.env.get('HERDR_BIN_PATH')) || 'herdr'
  await $.process.run(
    [herdr, 'pane', 'report-metadata', pane, '--source', 'my-mod', '--token', `progress=${step}/${total}`],
    { timeoutMs: 5000 },
  )
}
```

Report when a value changes, not on a timer, and send times as when they began (epoch milliseconds) rather
than "3 minutes ago" — arcdr counts (`as: "ago"`), and a value that changes every minute makes everything
that watches it redraw every minute. Skip the report in unattended runs (`claude -p`): they can carry the
person's `HERDR_PANE_ID` and would write over their pane.

### From a hook

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command",
      "command": "herdr pane report-metadata \"$HERDR_PANE_ID\" --source branch --token branch=\"$(git branch --show-current)\"" }] }]
  }
}
```

## Where arcdr shows them

The places follow the ones a Claude Code mod draws into, so a mod's band can show up on a phone in the same
shape.

| arcdr | Spec key | What it mirrors |
|---|---|---|
| Value before the status icon (list, chat header) | `agent.badge` | A token before the tab name in herdr's sidebar row |
| The agent's name | `agent.name` | The tab label, the pane title |
| The line under the name | `agent.line` | herdr's second sidebar row |
| The line under a space's name | `space.line` | herdr's space rows |
| Rows above the message box | `band` | The `AbovePrompt` band |
| The row under the message box | `footer` | `SessionMode` and `PromptHint` in the prompt footer |
| Notifications | `alerts` | `InfoNotice` — but on the phone |
| `/` suggestions | `commands` | Commands a mod registers with `$.command.register` |

## The spec

`~/.config/arcdr/display.json`. The server rereads it when it changes; an open page picks it up within 30
seconds. Without the file, arcdr reads herdr's own sidebar rows (`[ui.sidebar.agents.rows_by_agent]` in
`~/.config/herdr/config.toml`) so the list looks as it does in herdr; without those, it shows the
conversation title under each name and any reported value as a chip in the band.
**Settings → Display** says which of the three is in use and lists what in the file it could not use.

```json
{
  "agent": {
    "badge": { "from": "token:tree", "color": "cyan", "bold": true },
    "name": ["field:tab", "field:title", "field:kind"],
    "line": [{ "from": "token:stage", "rules": [{ "startsWith": "◐", "color": "yellow" }] }]
  },
  "space": { "line": [{ "from": "token:agents", "dim": true }] },
  "band": [{ "left": [], "right": [] }],
  "footer": { "left": [], "right": [] },
  "alerts": [],
  "commands": []
}
```

### Parts

Each place holds parts. A part is one value, drawn one way — a small function from the value to what you see.

| Field | Meaning |
|---|---|
| `from` | `token:<name>`, `field:<tab\|title\|conversation\|kind\|status>`, `text:<words>`, or `tokens:rest` (every reported token no other part names, as chips) |
| `as` | `text` (default), `chip`, `badge`, `dots`, `meter`, `ago` |
| `color` | `cyan` `purple` `yellow` `green` `orange` `pink` `red` `text` `muted` `dim`, Claude Code's theme names (`claude` `suggestion` `success` `warning` `error` `subtle` `permission`), or `#rrggbb` |
| `bold`, `dim` | `true` or `false` |
| `prefix`, `suffix` | Words around the value |
| `max` | Longest value shown, in characters |
| `rules` | The first rule whose conditions all hold changes the style, the format, or hides the part |

| Format | Takes | Draws |
|---|---|---|
| `text` | anything | the value |
| `chip` | anything | the value in a pill |
| `badge` | a short value | bold, fixed width digits |
| `dots` | `3/7` | ●●●○○○○ 3/7 |
| `meter` | a number, 0–100 | a bar and the percentage |
| `ago` | epoch milliseconds or an ISO time | "5 minutes ago", "in 2 hours", in the viewer's language |

A colour name is a role, not a shade: each theme picks its own, so a value stays readable in light themes.

### Rules

```json
{ "from": "token:context", "as": "meter", "prefix": "context ",
  "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] }
```

Conditions: `startsWith`, `endsWith`, `equals`, `contains`, `matches` (a regular expression), `above`,
`below` (numbers). What a rule can set: `color`, `bold`, `dim`, `as`, `hide`. The default spec hides Claude
Code's placeholder title this way: `{ "from": "field:conversation", "rules": [{ "equals": "Claude Code", "hide": true }] }`.

### Alerts

```json
{ "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} is done — {value}" }] }
```

An alert rings when its value *starts* to meet its conditions — not while it keeps meeting them. `{name}` is
the agent's name, `{value}` the value. Each device that turned notifications on chooses in **Settings** whether
it hears them.

### Commands

```json
{ "commands": [{ "name": "start-status", "detail": "preview the band" }] }
```

Commands a mod registers live in its code, not in `.claude/commands`, so arcdr cannot find them on disk; list
them here and they join the `/` suggestions.

## A full example

Two mods: `start-status` draws a band above Claude Code's prompt (the unit, its step as dots, what it is
doing, the context used) and `usage-corner` puts the account and its usage limits in the prompt footer. Each
also reports what it draws:

```ts
// start-status: one report, only the tokens that changed
const tokens = {
  skill: run.skill,                           // "start"
  progress: `${progress.step}/${progress.total}`,
  doing: progress.doing,
  detail: phase.detail,                       // "4 commits"
  since: String(waitingSince),                // epoch ms; arcdr counts
  context: String(Math.round(percent)),
}
// usage-corner
const tokens = { account: 'me@example.com (Max 20x)', limit5h: '58', limit5hReset: '2026-10-14T15:20:00Z',
                 limitWeek: '38', limitWeekReset: '2026-10-21T02:00:00Z' }
```

and the spec draws them like the terminal does:

```json
{
  "band": [
    { "left": [
        { "from": "token:skill", "as": "chip", "color": "claude" },
        { "from": "token:progress", "as": "dots", "color": "suggestion" },
        { "from": "token:doing", "max": 80 } ],
      "right": [
        { "from": "token:detail", "dim": true },
        { "from": "token:since", "as": "ago", "dim": true } ] },
    { "right": [
        { "from": "token:context", "as": "meter", "prefix": "context ", "color": "dim",
          "rules": [{ "above": 80, "color": "error", "bold": true }, { "above": 60, "color": "warning" }] } ] }
  ],
  "footer": {
    "left": [{ "from": "token:account", "dim": true, "max": 60 }],
    "right": [
      { "from": "token:limit5h", "as": "meter", "prefix": "5h ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limit5hReset", "as": "ago", "dim": true },
      { "from": "token:limitWeek", "as": "meter", "prefix": "week ", "color": "dim", "rules": [{ "above": 80, "color": "error" }] },
      { "from": "token:limitWeekReset", "as": "ago", "dim": true } ]
  },
  "alerts": [{ "from": "token:stage", "startsWith": "✓", "body": "{name} finished its unit" }],
  "commands": [{ "name": "start-status", "detail": "preview the band" }]
}
```

## Checking

- **Settings → Display** — where the spec came from, and every part it dropped with the reason.
- `herdr agent list` — the `tokens` each pane reports right now.
- The values arcdr was given: the `agents[].tokens` in any snapshot on `/api/events`.
