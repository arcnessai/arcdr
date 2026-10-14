---
name: arcdr-setup
description: Install arcdr on this machine so the person can watch and answer their herdr agents from a phone or another computer over Tailscale — checks herdr, installs and logs in Tailscale, turns on tailnet HTTPS, installs Bun, builds, writes the config, runs the service, publishes the tailnet address and verifies; also status, update and uninstall. Use for "set up arcdr", "install arcdr", "arcdr 설치", "폰에서 herdr 보기", "connect my phone to herdr", "Tailscale 연결", "arcdr status", "update arcdr", "uninstall arcdr".
---

# Set up arcdr

`scripts/setup.sh` does the work; this skill decides when to run it, hands the person what only they can do,
and asks what only they can decide. Speak to the person in their language.

## The end state

- herdr running, this machine logged in to the person's tailnet, tailnet HTTPS on.
- arcdr built, running as the systemd user service `arcdr` on `127.0.0.2:7420`.
- `tailscale serve` publishing it at `https://<machine>.<tailnet>.ts.net` — inside the tailnet only.
- The phone (or another computer) on the same Tailscale account, the address open, the app installed.

## Run it

1. `scripts/setup.sh status` — read which steps are done. It changes nothing.
2. `scripts/setup.sh all` — every step in order; a step already done is skipped, so rerunning is always safe.
3. Exit code **10** means a person has to act. The last line says what and carries the address.
   Give the person that address on its own line, wait until they say it is done, then run `all` again.
   Exit code **1** is a failure: read the `error:` line and the section below before trying anything else.

The steps that stop for a person, in order:

| Step | What the person does |
|---|---|
| `tailscale` (not installed, no root) | Runs the installer themselves: suggest `! curl -fsSL https://tailscale.com/install.sh \| sh` |
| `tailscale` (not logged in) | Opens the login address — with the account their phone will use |
| `https` (tailnet HTTPS off) | Opens the admin address and enables HTTPS. Tell them first: the machine's name is written to public certificate logs; the address still answers only inside the tailnet |

After `verify` passes, walk them through the phone: Tailscale app on with the same account → open the printed
address in Chrome → menu → *Install app*. On another computer: Tailscale on, open the address.

## Decide with the person, never by default

- **Who may come in.** `ARCDR_OWNERS` in `~/.config/arcdr/env` starts as their own login. Anyone added can type
  into their agents' terminals with their user's rights. Add a login only when they name it.
- **Port 443 already taken** (`https` stops with "already serves"). Offer `ARCDR_HTTPS_PORT=8443` and fix
  `ARCDR_PUBLIC_HOSTS` to `<machine>.<tailnet>.ts.net:8443`; never turn the other mapping off.
- **A machine they log out of** (a server, not WSL or a desktop): `service` prints the `loginctl enable-linger`
  command. It needs root and changes how their account runs; ask before suggesting they run it.
- **Installing Tailscale or Bun** when the person only asked for status. Report; install on a yes.

## Never

- `tailscale funnel`, or any bind that is not loopback — the owner check trusts a header only `tailscale serve`
  on this machine can set.
- Editing `ARCDR_OWNERS` to get past a 403.
- Sending keys or text to the person's agent panes to test. To test input, start a separate session
  (`herdr --session <name> server`) and point a second arcdr at it with `HERDR_SOCKET_PATH`.

## When it does not work

| Symptom | Cause | Fix |
|---|---|---|
| `herdr is installed but its server is not running` | herdr not started | Start herdr, rerun |
| `systemd user manager is not running` on WSL | systemd off | `[boot] systemd=true` in `/etc/wsl.conf`, `wsl --shutdown` from Windows, rerun |
| Phone: page does not load | Tailscale app off, or the PC asleep | Turn the app on; keep the PC awake (on a laptop, closing the lid sleeps it) |
| 403 "no Tailscale identity" | Opened by IP or `localhost`, not the tailnet name | Use the `https://…ts.net` address |
| 403 "… is not allowed here" | Another Tailscale account | Log the phone in with the owner's account — or the person adds that login |
| 421 "unexpected host" | `ARCDR_PUBLIC_HOSTS` does not match the address used | Fix it (with `:port` when not 443), `systemctl --user restart arcdr` |
| Service will not stay up | Read `journalctl --user -u arcdr -n 30` | Usually a missing config value or a port already in use |

Server log: `journalctl --user -u arcdr -f`. Every refused request is logged with its reason.

## Update and uninstall

- Update: `git pull`, then `scripts/setup.sh build && scripts/setup.sh service` (rebuilds and restarts).
- Uninstall: `scripts/setup.sh uninstall` stops the service and releases the tailnet port;
  `--purge` also removes the config. Tailscale and Bun stay; ask before removing either.
