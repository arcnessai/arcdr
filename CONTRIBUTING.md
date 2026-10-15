# Contributing to arcdr

Thanks for looking. Issues and pull requests are welcome — small ones especially.

## Run it

```bash
bun install
bun run demo     # the screens with made-up agents on http://127.0.0.1:7430, no herdr needed
bun run check    # prettier + types + tests; must pass before a pull request
```

Against a real herdr, start a separate session so nothing you try reaches the panes you work in, and point a
second server at it. Requests must come through `tailscale serve` (the owner check reads the identity header it
sets), so publish the second server on another port:

```bash
herdr --session try server &
HERDR_SOCKET_PATH=~/.config/herdr/sessions/try/herdr.sock ARCDR_PORT=7499 ARCDR_OWNERS=you@example.com \
  ARCDR_PUBLIC_HOSTS=your-machine.your-tailnet.ts.net:8443 bun run server/main.ts
tailscale serve --bg --https=8443 http://127.0.0.2:7499
```

## Where things are

- `server/` — the Bun server. `app.ts` holds every route over a `Backend`; `main.ts` wires herdr's socket and
  the transcripts; `screen.ts` turns a terminal menu into choices; `spec.ts` is the display spec.
- `web/` — the Preact page. `chat.tsx` is a conversation, `app.tsx` the layouts and panes.
- `mods/arcdr-report/` — the starter Claude Code mod (`claude plugin test .` inside it).
- `docs/mods.md` — how mods reach the phone. Change it with the code it describes.

## Rules that keep it safe

- Anything that sends keys or text to a pane is refused unless it is on the allow list in `server/app.ts`.
  Ctrl+C stays off it.
- Transcript text is never rendered as HTML.
- A new route that writes needs a test in `server/app.test.ts`.
- UI strings go in all four languages in `web/i18n.ts`.

## Commits

English, one change per commit, the subject says what changed and the body says why.
