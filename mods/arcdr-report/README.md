# arcdr-report

A Claude Code mod that tells herdr what each session is doing, so [arcdr](../../README.md) can show it on
your phone. It draws nothing in the terminal and writes nothing but herdr's pane metadata
(`herdr pane report-metadata --source arcdr-report`).

## What it reports

| Token | Example | When |
|---|---|---|
| `tool` | `Edit search/rank.ts`, `Bash bun test`, `Grep retry` | the call at work; cleared when the turn ends |
| `turnStart` | `1792400000000` (epoch ms) | when the turn began; cleared when it ends |
| `todo` | `3/7` | the model's to-do list (TodoWrite or the Task tools); a finished list goes when the turn ends |
| `todoNow` | `Writing the tests` | the item in progress |
| `context` | `42` | context window used, percent |
| `cost` | `1.23` | the session's cost in USD, where Claude Code keeps one |
| `branch` | `main` | `git branch --show-current`, read at start and at each turn |
| `limit5h` · `limit5hReset` | `58` · `2026-10-14T15:20:00Z` | the 5-hour usage window and when it resets |
| `limitWeek` · `limitWeekReset` | `38` · `2026-10-21T02:00:00Z` | the weekly window |

Only the main conversation counts — a subagent's calls are its own work. A burst of calls is one report
(at most one every half second), carrying only what changed. Nothing is sent outside a herdr pane
(`HERDR_PANE_ID` unset) or in an unattended run (`claude -p`), and leaving a session clears what it
reported.

`tool` shows a command's first line as typed, the way the terminal does: whatever you would not want on
your phone's screen, keep out of command lines.

## Install

From a clone of arcdr:

```bash
claude plugin marketplace add /path/to/arcdr
claude plugin install arcdr-report@arcdr
```

New sessions load it; running ones after `/reload-plugins`. To update, `git pull` the clone and run
`/reload-plugins` — the plugin is read from the folder itself.

## Uninstall

```bash
claude plugin uninstall arcdr-report@arcdr
```

## Develop

```bash
claude plugin validate .
claude plugin test .
```
