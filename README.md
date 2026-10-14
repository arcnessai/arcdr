<div align="center">

<img src="web/icon.svg" width="76" alt="" />

# arcdr

**Your herdr, on your phone — mods and all.**<br/>
Every Claude Code session herdr runs, shown the way herdr shows it, with whatever your mods report.
Answer its questions and keep it moving from your phone or any other computer, over your own Tailscale network.

[![herdr](https://img.shields.io/badge/herdr-native-8be9fd?style=flat-square)](https://herdr.dev)
[![Claude Code mods](https://img.shields.io/badge/Claude%20Code-mods%20welcome-bd93f9?style=flat-square)](docs/mods.md)
[![Tailscale](https://img.shields.io/badge/Tailscale-tailnet%20only-5b97e8?style=flat-square)](https://tailscale.com)
[![PWA](https://img.shields.io/badge/PWA-installable-ff79c6?style=flat-square)](#on-the-phone)
[![Bun](https://img.shields.io/badge/Bun-1.4-f2a65e?style=flat-square)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/license-MIT-50fa7b?style=flat-square)](LICENSE)

**English** · [한국어](README.ko.md)

<img src="docs/images/hero.png" alt="arcdr on a laptop and a phone: the agent list, a question with tap-to-answer choices, the band a mod reports" />

</div>

---

## Start with one sentence

Open Claude Code anywhere on the machine that runs herdr and say:

> **Set up arcdr from https://github.com/arcnessai/arcdr**

or, in Korean, *"https://github.com/arcnessai/arcdr 셋팅해줘"*. Already have a clone? Open it and say *"set it up"*.

The [`arcdr-setup`](.claude/skills/arcdr-setup/SKILL.md) skill clones it, installs what is missing, starts the
service, hands you the two links only you can open (the Tailscale login and its HTTPS switch), and asks before
anything that is yours to decide. At the end it offers the starter mod, so the phone shows more than the chat
from the first minute.

<a id="on-the-phone"></a>
**On the phone:** Tailscale app on with the same account → open `https://<machine>.<tailnet>.ts.net` in Chrome →
**Install app**. Another computer: Tailscale on, open the same address.

## Built around herdr and your mods

Most remote views of Claude Code show one conversation. arcdr shows **your workspace** — the one herdr
already arranges and your mods already annotate.

<table>
<tr>
<td width="50%" valign="top">

### herdr-native

- **The list is herdr's sidebar.** arcdr reads your `rows_by_agent` from herdr's own config: the same tree
  numbers, the same stage colours, the same order. Nothing to set up.
- **Spaces and tabs as herdr has them.** Start a session in a new herdr tab, resume an old conversation,
  close one — from the phone.
- **Status from herdr's agent detection.** The one waiting on you turns pink and your phone buzzes.
- **Sessions on any Claude account.** Each pane keeps the account it runs as; arcdr only asks who you are on
  Tailscale.

</td>
<td width="50%" valign="top">

### Your mods, on the phone

| In the terminal, a mod draws… | arcdr shows it… |
|---|---|
| a token in herdr's sidebar row | before or under the agent's name |
| the band above the prompt | above the message box |
| the prompt footer | below the message box |
| a notice | as a phone notification |
| a registered command | in the `/` suggestions |

Same values, same places, the way you arranged them.

</td>
</tr>
</table>

### Four ways to put something on the phone

| | |
|---|---|
| 🧩 **The starter mod** | `scripts/setup.sh mod` installs [`arcdr-report`](mods/arcdr-report/README.md). From then on each session shows the tool at work (`Edit rank.ts`), how long it has been at it, its to-do list as `●●●○○ 3/5`, the context used, branch, cost and usage limits. No code. |
| 💬 **Just ask** | In this repository, tell Claude Code *"show my git branch on the phone"* or *"ping my phone when the tests fail"*. The [`arcdr-mod`](.claude/skills/arcdr-mod/SKILL.md) skill finds or writes the hook or mod that reports it, places it, and checks it shows. |
| 🎨 **Tap it in** | **Settings → Display → Customize** lists every value your mods send. Pick where it goes and how it looks (chip, dots, bar, "4 min ago"), with a live preview. |
| 🔔 **Ring the phone** | Any mod, hook or script: `herdr pane report-metadata "$HERDR_PANE_ID" --token notify="Deploy finished"` — and it arrives as a notification. |

<table>
<tr>
<td width="50%"><img src="docs/images/phone-display.png" alt="The display editor: a value's place, look and colour, with a live preview" /></td>
<td width="50%"><img src="docs/images/phone-arcness.png" alt="A chat with the band and footer a mod reports" /></td>
</tr>
<tr>
<td><b>Customize from the phone</b><br/>Every value your mods report, its place and its look, previewed as you tap.</td>
<td><b>The band, off the terminal</b><br/>What your mods draw above Claude Code's prompt, above the message box.</td>
</tr>
</table>

The full format, every place, and a worked example: **[docs/mods.md](docs/mods.md)**.

## What else you can do

<table>
<tr>
<td width="33%"><img src="docs/images/phone-agents.png" alt="Agent list" /></td>
<td width="33%"><img src="docs/images/phone-question.png" alt="A question with choices" /></td>
<td width="33%"><img src="docs/images/phone-tray.png" alt="The ＋ tray: key buttons, photos, camera, files, saved commands" /></td>
</tr>
<tr>
<td><b>Every session at a glance</b><br/>Spaces, agents, status, the stage your mod reports.</td>
<td><b>Answer with a tap</b><br/>Permission prompts, questions, plan approvals, folder trust — as buttons. The screen is read again right before the keys go out.</td>
<td><b>＋ for everything else</b><br/>Key buttons, photos from the gallery, the camera, files, and the skills and commands you use most.</td>
</tr>
</table>

<details>
<summary><b>The whole list</b></summary>

| | |
|---|---|
| **Chat** | The conversation as chat: Markdown, tables, code; tool calls folded into one line; links open in a new tab |
| **Sending** | Sending → typed in → queued (while the agent works) → received; *send queued now*; a draft kept per session; Korean IME–safe |
| **Completion** | `/` for built-in commands, skills and your mods' commands; `@` for files |
| **Commands** | Skills and commands you use often, kept on the server so the phone and the laptop show the same; a tap puts one in the box or sends it |
| **Attachments** | ＋ → Photos (straight to the gallery), Camera (on a phone) or Files; paste a screenshot, or drop a file; saved where the agent reads it, sent as `@path` |
| **Changes** | Each edit as a diff, every file the conversation touched, a file viewer |
| **Keys** | Esc, arrows, Tab, ⇧Tab, Enter; Ctrl+C is left out on purpose (twice exits Claude Code) |
| **Screen** | The terminal as it is now, wrapped for a phone |
| **Session** | Permission-mode and model chips, interrupt, `/compact`, `/context`, `/usage`, rewind, `/clear` |
| **Sessions** | Start one in any folder (optionally with a first message), resume an earlier conversation, close one |
| **Notifications** | Web Push when an agent needs you or finishes, when a mod sends `notify`, or when a value matches your rule |
| **Looks** | Phone and desktop layouts; themes: Auto, Dracula, Light, Arcness, Arcness Light, Nord; English, 한국어, 日本語, 简体中文 |

</details>

<p align="center">
<img src="docs/images/desktop-light.png" width="80%" alt="arcdr on a desktop, Arcness Light theme" />
</p>

## Set up by hand

You need [herdr](https://herdr.dev) running Claude Code on a Linux or WSL machine with systemd.

```bash
git clone https://github.com/arcnessai/arcdr && cd arcdr
scripts/setup.sh status   # what is done, what is left
scripts/setup.sh all      # every step; stops with exit code 10 when you have to open a link
scripts/setup.sh mod      # optional: the starter mod
```

It checks herdr, installs and logs in Tailscale, turns on tailnet HTTPS, installs Bun (checksum verified), runs
the tests and builds, writes `~/.config/arcdr/env`, starts a systemd user service, and publishes it with
`tailscale serve`.

**Just look around:** `bun install && bun run demo` — made-up agents on http://127.0.0.1:7430, no herdr needed.

## How it works

```mermaid
flowchart LR
  phone["📱 Phone / 💻 browser"] -- "Tailscale (WireGuard)" --> serve["tailscale serve<br/>HTTPS · tailnet only"]
  serve --> server["arcdr server<br/>127.0.0.2:7420"]
  server -- "socket: session.snapshot · pane.read<br/>agent.prompt · pane.send_keys" --> herdr["herdr"]
  herdr --> panes["Claude Code sessions"]
  server -- "reads" --> logs[("~/.claude/projects<br/>transcripts")]
  mods["your mods · hooks · scripts"] -- "report-metadata" --> herdr
```

The server asks herdr for a snapshot once a second while a page is open (and for notifications), streams
changes to the page, reads each session's transcript from where its last read ended, and turns the visible
terminal into choices when a menu is on it. `display.json` decides where each reported value is drawn. arcdr
installs nothing into herdr or Claude Code; the starter mod is yours to add or leave out.

## Security

Whoever gets in can type into your agents' terminals, which run as your user. So there is one way in, kept narrow.

<details>
<summary><b>The model, step by step</b></summary>

- **Loopback only.** The server binds `127.0.0.2`. WSL forwards `127.0.0.1` listeners to Windows; it does not
  forward `127.0.0.2` (measured), so Windows programs cannot reach it.
- **Your Tailscale identity.** Every request must carry `Tailscale-User-Login`, which only `tailscale serve` on
  this machine sets, and name a login in `ARCDR_OWNERS`. Never `tailscale funnel`.
- **Same-origin writes.** Writes need an `Origin` of the published host; `Host` must be that name.
- **Keys from a list.** No Ctrl+C. Choosing re-reads the screen and refuses if the option changed.
- **Nothing rendered as HTML.** Transcripts carry text from anywhere; Markdown is built as elements. Strict CSP.
- **Files.** Uploads: images, PDF, text; content checked against the type; 15 MB; swept after 14 days.
  Preview: refuses `~/.ssh`, `~/.claude.json`, login files, `.env`, key files, judged after following links.
- **What you save.** Commands and display settings are checked whole before they are written; a display file
  replaced from the phone stays beside it as `display.json.bak`.
- **Push.** Subscriptions only to browser push services; payloads encrypted for the browser.

</details>

## Configuration

`~/.config/arcdr/env` (the setup writes it):

| Variable | Default | |
|---|---|---|
| `ARCDR_OWNERS` | — | Tailscale logins allowed in, comma-separated. Required |
| `ARCDR_PUBLIC_HOSTS` | — | The name `tailscale serve` publishes, with `:port` when not 443 |
| `ARCDR_MACHINE` | hostname | Shown on the connect screen |
| `ARCDR_HOST` · `ARCDR_PORT` | `127.0.0.2` · `7420` | Loopback only |
| `ARCDR_TRANSCRIPT_ROOTS` | `~/.claude/projects` | Where transcripts are |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | herdr's socket |

Beside it: `display.json` (what shows where — [docs/mods.md](docs/mods.md)) and `shortcuts.json` (your commands).

## Compared with

| | SSH app + herdr | Claude Remote Control | **arcdr** |
|---|:-:|:-:|:-:|
| Sessions of several Claude accounts in one list | ✓ | one account at a time | ✓ |
| The list as herdr's sidebar shows it | as terminal text | – | ✓ |
| What your mods report, placed where you want | as terminal text | – | ✓ |
| No Claude login on the phone | ✓ | – | ✓ |
| Choices as buttons | – | ✓ | ✓ |
| Conversation as chat, edits as diffs | – | ✓ | ✓ |

## Development

```bash
bun run test             # access gate, menus, transcripts, display spec and editor, push, uploads, routes
bun run typecheck
bun run check            # prettier + types + tests
bun run demo             # the screens with made-up agents
bun run display tokens   # what your panes report right now
scripts/setup.sh build && scripts/setup.sh service   # rebuild and restart your install
```

`server/` — Bun server: `app.ts` routes over a `Backend`, `main.ts` wires herdr. `web/` — the Preact page.
`mods/arcdr-report/` — the starter mod (`claude plugin test .` inside it). To test input, use a separate herdr
session (`herdr --session test server`), never the panes you work in.

## License

[MIT](LICENSE) © 2026 Arcness
