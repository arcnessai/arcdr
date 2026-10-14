---
name: arcdr-mod
description: Put something new on arcdr's phone screen, or make the phone ring for it — find or build what reports the value to herdr (a Claude Code mod, a hook, or a script), then place it in arcdr's display spec and check it shows. Use for "폰에 브랜치 보여줘", "arcdr에 ~ 띄워줘", "테스트 깨지면 폰으로 알려줘", "모드 만들어서 arcdr에 붙여줘", "show X on my phone", "notify my phone when …", "add a mod to arcdr", "customize arcdr's display", "starter mod 설치".
---

# Wire a value to arcdr

arcdr draws what panes report to herdr (`herdr pane report-metadata … --token name=value`), placed by
`~/.config/arcdr/display.json`. A new thing on the phone is two halves: **something reports it**, and **the
spec places it**. Do both, then see it with your own eyes. Speak to the person in their language, in plain
words — they asked for a result on their phone, not for JSON.

The format and every place are in `docs/mods.md`. Read it before the first edit.

## 1. Ask only what you cannot see

Find out, in one short question if it is not already said:
- **What** they want to see or hear about — and whether it is a value to look at (a branch, a test result,
  a deploy state) or an event to be told about (tests failed, a deploy finished).
- **Where**, only if it matters to them. Otherwise pick the place yourself (below) and say where it went.

Then look before building:

```bash
bun run display tokens   # every value each agent and space reports right now
bun run display show     # the spec in use and where it came from
```

If the value is already reported (by `arcdr-report`, or one of their own mods), skip to step 3.

## 2. Make something report it

Pick the smallest source that can see the value:

| The value lives in | Source | How |
|---|---|---|
| Claude Code itself — tool calls, turns, the to-do list, context, cost, limits | **the starter mod** | `scripts/setup.sh mod` installs `mods/arcdr-report`; its tokens are listed in its README. Ask before installing: it loads into every new Claude Code session |
| Claude Code itself, and the starter mod does not report it | **a mod** | Copy the shape of `mods/arcdr-report` (its `report` / `reportArgs` path, the `isInteractive` and `HERDR_PANE_ID` guards, one report per change). Test with `claude plugin test .`; load it the way the person's other mods are loaded (`claude plugin list --json` shows each one's `installPath`) |
| The shell, at moments Claude Code marks — after a turn, after an edit, at start | **a hook** | A command hook that runs `herdr pane report-metadata "$HERDR_PANE_ID" --source <name> --token <name>=<value>`; guard with `[ -n "$HERDR_PANE_ID" ]`. Show the person the hook and where it goes (their `settings.json`, or a plugin's `hooks/hooks.json`) and add it only on a yes |
| Outside Claude Code — CI, a server, a long build, a cron job | **a script** | Any process in a herdr pane can report about itself; one outside a pane names one (`herdr pane report-metadata <pane-id> …`) or a space (`herdr workspace report-metadata <space-id> …`). `herdr agent list` gives the ids |

Rules for anything you write:
- Report on change, not on a timer; times as epoch milliseconds (arcdr counts them).
- Token names: letters, digits, `.`, `_`, `-`; short and plain (`branch`, `deploy`, `tests`).
- A value meant to **ring the phone** is the token `notify`: each new value is one notification, and it is
  never drawn. Send `--token notify="Tests failed: 3"`; to send the same words twice, clear it in between
  (`--clear-token notify`) or give it `--ttl-ms`.
- Never write to the panes the person works in to try it out — no `report-metadata` with made-up values on
  their pane, no keys. Test a hook or script against a separate session (`herdr --session try server`) or
  wait for the real event.

## 3. Place it

Prefer the in-app editor when the person is at their phone: **Settings → Display → Customize** lists every
reported value; one tap picks the place, the look and the colour, with a live preview. Tell them that path.

Otherwise edit `~/.config/arcdr/display.json` yourself (if it does not exist, start from `bun run display
show` — that is the spec in use now). Where to put a value when they did not say:

| Kind of value | Place | Look |
|---|---|---|
| Short state per agent (stage, branch, test result) | `agent.line` | `chip` or `text` with a colour rule |
| What is happening now, in one session | `band` | `text`; `dots` for `3/7`, `meter` for percent, `ago` for a start time |
| About the account or the machine | `footer` | `text` dim, or `meter` |
| Something to be told about | `notify` token (step 2), or an `alerts` rule on an existing value | — |

Then:

```bash
bun run display check    # must print ✓; a ✗ line names the part and why
```

The server rereads the file on change; an open page picks it up within 30 seconds.

## 4. See it

- `bun run display tokens` shows the value arriving from the real source (after the event happened).
- Ask the person to look at the phone — or open the place yourself if they are away — and say exactly where
  it shows ("in the list, under each agent's name, as a green chip").
- If it does not show: the value is missing from `tokens` (the source did not report — check its guards and
  `HERDR_PANE_ID`), or `display check` dropped the part, or a rule hides it.

## Never

- Install the starter mod, add a hook to their settings, or load a new mod without a yes — each one runs in
  every session they start.
- Put secrets in a token. Tokens are shown on the phone and kept in herdr's memory.
- Edit `ARCDR_OWNERS`, the service, or Tailscale here; that is `arcdr-setup`'s.
