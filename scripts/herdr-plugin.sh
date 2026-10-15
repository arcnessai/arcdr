#!/usr/bin/env bash
# What arcdr's herdr plugin panes run (herdr-plugin.toml): herdr starts them in this repository's folder.
#
#   phone    the address to open on the phone, as a QR code
#   setup    scripts/setup.sh all, waiting for the person whenever it needs them
#   status   scripts/setup.sh status
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/arcdr/env"
bun_bin() { command -v bun 2>/dev/null || { [ -x "$HOME/.local/bin/bun" ] && echo "$HOME/.local/bin/bun"; } || true; }
hold() { printf '\n\033[2mPress any key to close.\033[0m'; read -r -n 1 -s; }

phone() {
  local host
  host="$( [ -f "$ENV_FILE" ] && sed -n 's/^ARCDR_PUBLIC_HOSTS=//p' "$ENV_FILE" | tail -1 | cut -d, -f1 )"
  if [ -z "$host" ]; then
    printf 'arcdr is not set up on this machine yet.\nOpen the plugin'"'"'s "Set up arcdr" pane, or run scripts/setup.sh all.\n'
    hold
    return
  fi
  local url="https://$host"
  printf '\n  \033[1mOpen arcdr on your phone\033[0m\n\n'
  if [ -n "$(bun_bin)" ]; then
    "$(bun_bin)" "$ROOT/scripts/qr.ts" "$url" | sed 's/^/  /'
  fi
  printf '\n  %s\n\n' "$url"
  printf '  1. On the phone, turn Tailscale on with this machine'"'"'s account.\n'
  printf '  2. Scan the code, or type the address, in Chrome or Safari.\n'
  printf '  3. Menu → Install app (an iPhone: Share → Add to Home Screen).\n'
  hold
}

setup() {
  local code
  while true; do
    "$ROOT/scripts/setup.sh" all
    code=$?
    # 10: a person has to open a link first; the line above says which. Then the same steps again.
    [ "$code" = 10 ] || break
    printf '\n\033[1mWhen that is done, press Enter to go on\033[0m (q to stop): '
    read -r answer
    [ "$answer" = q ] && break
  done
  [ "$code" = 0 ] && printf '\n\033[32mDone.\033[0m Open the "Open on your phone" pane for the address.\n'
  hold
}

case "${1:-}" in
  phone) phone ;;
  setup) setup ;;
  status) "$ROOT/scripts/setup.sh" status; hold ;;
  *) sed -n '2,7p' "$0"; exit 2 ;;
esac
