# Security

arcdr lets whoever gets in type into terminals that run as your user, so its whole design is a narrow way in
(see the Security section of the README).

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Do not
open a public issue. Include what you did, what you could reach, and the arcdr version (`/api/health` shows
the build).

You will get an answer within a few days. Fixes go out as a new release, with credit if you want it.

## In scope

- Getting past the owner check (`Tailscale-User-Login`, `ARCDR_OWNERS`) or the host and origin checks
- Sending keys outside the allow list, or text into a pane through a route that should refuse it
- Reading files outside what the file preview allows, or uploads outside their folder
- HTML or script injection through transcript text, mod-reported values or file names
- The push endpoint or the display and shortcut files being made to do more than they say
