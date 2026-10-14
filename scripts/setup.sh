#!/usr/bin/env bash
# Sets arcdr up on this machine, one idempotent step at a time.
#
#   scripts/setup.sh status      what is done and what is not; changes nothing
#   scripts/setup.sh all         every step in order, skipping what is already done
#   scripts/setup.sh <step>      one step: check tailscale bun build config https service verify
#   scripts/setup.sh mod         install the starter mod arcdr-report into Claude Code (not part of all: ask first)
#   scripts/setup.sh unmod       uninstall it
#   scripts/setup.sh uninstall   stop and remove the service and its tailnet address (--purge: the config too)
#
# Exit codes: 0 done · 1 failed · 10 a person has to act first (the last line says what); run it again after.
#
# Environment: ARCDR_HTTPS_PORT (tailnet HTTPS port, default 443) · ARCDR_BUN_VERSION (default 1.4.2)
#              ARCDR_TS_HOSTNAME (machine name on the tailnet, used only on first login)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
ENV_FILE="$CONFIG_HOME/arcdr/env"
UNIT="$CONFIG_HOME/systemd/user/arcdr.service"
BUN_VERSION="${ARCDR_BUN_VERSION:-1.4.2}"
HTTPS_PORT="${ARCDR_HTTPS_PORT:-443}"
NEEDS_PERSON=10

ok() { printf '  ✓ %s\n' "$*"; }
no() { printf '  ✗ %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\nerror: %s\n' "$*" >&2; exit 1; }
person() { printf '\n→ %s\n' "$*"; exit "$NEEDS_PERSON"; }
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@" 2>/dev/null || return 99; fi; }
is_wsl() { grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; }

env_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }
bind_host() { local v; v="$(env_get ARCDR_HOST)"; echo "${v:-127.0.0.2}"; }
bind_port() { local v; v="$(env_get ARCDR_PORT)"; echo "${v:-7420}"; }
backend() { echo "http://$(bind_host):$(bind_port)"; }
bun_bin() { command -v bun 2>/dev/null || { [ -x "$HOME/.local/bin/bun" ] && echo "$HOME/.local/bin/bun"; } || true; }

# One field out of `tailscale status --json`, by a Python expression over d.
ts() { tailscale status --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || true; }
ts_state() { ts 'd.get("BackendState","")'; }
ts_dns() { ts 'd["Self"]["DNSName"].rstrip(".")'; }
ts_login() { ts 'd["User"][str(d["Self"]["UserID"])]["LoginName"]'; }
ts_certs() { ts '",".join(d.get("CertDomains") or [])'; }
public_host() { if [ "$HTTPS_PORT" = 443 ]; then ts_dns; else echo "$(ts_dns):$HTTPS_PORT"; fi; }

# What `tailscale serve` sends the tailnet HTTPS port to, or nothing.
served_target() {
  tailscale serve status --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin) or {}
for host, web in (d.get('Web') or {}).items():
    if host.endswith(':$HTTPS_PORT'):
        print(((web.get('Handlers') or {}).get('/') or {}).get('Proxy',''))
" 2>/dev/null || true
}

# ---------------------------------------------------------------- steps

step_check() {
  echo "check — what arcdr needs on this machine"
  [ "$(uname -s)" = Linux ] || die "arcdr's setup covers Linux and WSL; this is $(uname -s)"
  for c in curl python3; do command -v "$c" >/dev/null || die "$c is missing"; done
  ok "Linux$(is_wsl && echo ' (WSL)'), curl, python3"
  systemctl --user show-environment >/dev/null 2>&1 ||
    die "the systemd user manager is not running$(is_wsl && echo ' — on WSL set systemd=true under [boot] in /etc/wsl.conf and restart WSL')"
  ok "systemd user manager"
  command -v herdr >/dev/null || die "herdr is not installed (https://herdr.dev)"
  herdr workspace list >/dev/null 2>&1 || die "herdr is installed but its server is not running — start herdr first"
  ok "herdr $(herdr --version 2>/dev/null | awk '{print $2}') with a running server"
}

step_tailscale() {
  echo "tailscale — this machine on your tailnet"
  if ! command -v tailscale >/dev/null; then
    local installer
    installer="$(mktemp)"
    curl -fsSL https://tailscale.com/install.sh -o "$installer"
    if ! as_root sh "$installer"; then
      rm -f "$installer"
      person "Installing Tailscale needs root. Run it yourself, then run this again:  curl -fsSL https://tailscale.com/install.sh | sh"
    fi
    rm -f "$installer"
  fi
  systemctl is-active --quiet tailscaled || as_root systemctl enable --now tailscaled ||
    person "Start the Tailscale daemon, then run this again:  sudo systemctl enable --now tailscaled"
  ok "tailscale $(tailscale version 2>/dev/null | head -1)"

  if [ "$(ts_state)" = Running ]; then
    ok "logged in as $(ts_login) — this machine is $(ts_dns)"
    return
  fi
  local log
  log="$(mktemp)"
  local args=(up)
  [ -n "${ARCDR_TS_HOSTNAME:-}" ] && args+=(--hostname "$ARCDR_TS_HOSTNAME")
  (as_root tailscale "${args[@]}" >"$log" 2>&1 &)
  for _ in $(seq 1 20); do grep -q 'https://login.tailscale.com' "$log" && break; sleep 1; done
  local url
  url="$(grep -o 'https://login.tailscale.com[^ ]*' "$log" | head -1)"
  [ -n "$url" ] || { cat "$log"; die "tailscale up gave no login address"; }
  person "Log this machine in to Tailscale: open $url — then run this again. Use the same account as the phone."
}

step_bun() {
  echo "bun — the runtime arcdr's server runs on"
  local bin
  bin="$(bun_bin)"
  if [ -n "$bin" ]; then
    ok "bun $("$bin" --version) at $bin"
    return
  fi
  local arch asset dir dl
  arch="$(uname -m)"
  case "$arch" in
    x86_64) asset="bun-linux-x64"; grep -qw avx2 /proc/cpuinfo || asset="bun-linux-x64-baseline" ;;
    aarch64 | arm64) asset="bun-linux-aarch64" ;;
    *) die "no Bun build for $arch" ;;
  esac
  dl="$(mktemp -d)"
  curl -fsSL -o "$dl/$asset.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$asset.zip"
  curl -fsSL -o "$dl/SHASUMS256.txt" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/SHASUMS256.txt"
  (cd "$dl" && grep " $asset.zip\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "Bun download does not match its published checksum"
  dir="$HOME/.local/share/bun/$BUN_VERSION"
  mkdir -p "$dir" "$HOME/.local/bin"
  python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$dl/$asset.zip" "$dir"
  chmod +x "$dir/$asset/bun"
  ln -sf "$dir/$asset/bun" "$HOME/.local/bin/bun"
  rm -rf "$dl"
  ok "bun $BUN_VERSION installed at $HOME/.local/bin/bun (checksum verified)"
}

step_build() {
  echo "build — dependencies, tests, the web bundle"
  local bin
  bin="$(bun_bin)"
  [ -n "$bin" ] || die "bun is missing — run: scripts/setup.sh bun"
  (cd "$ROOT" && "$bin" install --frozen-lockfile >/dev/null) || die "bun install failed"
  (cd "$ROOT" && "$bin" run test >/dev/null 2>&1) || die "tests failed — run 'bun run test' in $ROOT to see which"
  (cd "$ROOT" && "$bin" run build >/dev/null 2>&1) || die "build failed"
  ok "installed, tests pass, dist/ built"
}

step_config() {
  echo "config — who may come in, and under which name"
  if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE exists"
    note "owners: $(env_get ARCDR_OWNERS) · address: $(env_get ARCDR_PUBLIC_HOSTS) · server: $(backend)"
    return
  fi
  [ "$(ts_state)" = Running ] || die "Tailscale is not logged in — run: scripts/setup.sh tailscale"
  local login host machine
  login="$(ts_login)"
  host="$(public_host)"
  machine="$(ts 'd["Self"]["HostName"]')"
  [ -n "$login" ] && [ -n "$host" ] || die "could not read this machine's Tailscale login and name"
  mkdir -p "$(dirname "$ENV_FILE")"
  (umask 077 && cat >"$ENV_FILE" <<EOF
# Tailscale logins allowed in. Whoever is listed can type into your agents' terminals.
ARCDR_OWNERS=$login
ARCDR_PUBLIC_HOSTS=$host
ARCDR_MACHINE=$machine
EOF
  )
  ok "wrote $ENV_FILE"
  note "only $login can open it; add another login to ARCDR_OWNERS only for someone you would hand your terminal to"
}

step_https() {
  echo "https — the tailnet address (tailscale serve, never funnel)"
  [ "$(ts_state)" = Running ] || die "Tailscale is not logged in — run: scripts/setup.sh tailscale"
  local current
  current="$(served_target)"
  if [ "$current" = "$(backend)" ]; then
    ok "https://$(public_host) → $(backend)"
    return
  fi
  [ -z "$current" ] ||
    die "tailnet port $HTTPS_PORT already serves $current — pick another, e.g. ARCDR_HTTPS_PORT=8443 scripts/setup.sh all (and fix ARCDR_PUBLIC_HOSTS in $ENV_FILE)"
  local out
  out="$(timeout 15 tailscale serve --bg --https="$HTTPS_PORT" "$(backend)" 2>&1 || true)"
  if grep -q 'login.tailscale.com' <<<"$out"; then
    local url
    url="$(grep -o 'https://login.tailscale.com[^ ]*' <<<"$out" | head -1)"
    person "Turn on HTTPS for your tailnet: open $url and enable it, then run this again. (The machine name $(ts_dns) will appear in public certificate logs; the address still answers only inside your tailnet.)"
  fi
  [ "$(served_target)" = "$(backend)" ] || { echo "$out"; die "tailscale serve did not take"; }
  ok "https://$(public_host) → $(backend) (tailnet only)"
}

step_service() {
  echo "service — arcdr as a systemd user service"
  local bin
  bin="$(bun_bin)"
  [ -n "$bin" ] || die "bun is missing — run: scripts/setup.sh bun"
  [ -f "$ENV_FILE" ] || die "no config — run: scripts/setup.sh config"
  [ -d "$ROOT/dist" ] || die "not built — run: scripts/setup.sh build"
  mkdir -p "$(dirname "$UNIT")"
  sed -e "s|@ROOT@|$ROOT|g" -e "s|@BUN@|$bin|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@PATH@|$(dirname "$bin"):/usr/local/bin:/usr/bin:/bin|g" \
    "$ROOT/deploy/arcdr.service" >"$UNIT"
  systemctl --user daemon-reload
  systemctl --user enable arcdr.service >/dev/null 2>&1
  systemctl --user restart arcdr.service
  sleep 2
  systemctl --user is-active --quiet arcdr.service || {
    journalctl --user -u arcdr --no-pager -n 15
    die "the service did not stay up"
  }
  ok "running on $(backend)"
  if ! is_wsl && [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]; then
    note "on a machine you log out of, keep it running with: sudo loginctl enable-linger $USER"
  fi
}

step_verify() {
  echo "verify — the server answers, and only through the tailnet"
  local host login body
  host="$(env_get ARCDR_PUBLIC_HOSTS | cut -d, -f1)"
  login="$(env_get ARCDR_OWNERS | cut -d, -f1)"
  body="$(curl -s --max-time 5 -H "Host: $host" -H "Tailscale-User-Login: $login" "$(backend)/api/health" || true)"
  grep -q '"herdr"' <<<"$body" || die "no answer from $(backend)/api/health: ${body:-nothing}"
  ok "health: $body"
  local denied
  denied="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Host: $host" "$(backend)/api/health" || true)"
  [ "$denied" = 403 ] || die "a request without a Tailscale login got $denied, not 403"
  ok "a request without a Tailscale login is refused"
  if is_wsl && [ "$(bind_host)" = 127.0.0.1 ]; then
    no "bound to 127.0.0.1: WSL forwards that to Windows, so Windows programs reach it — set ARCDR_HOST=127.0.0.2"
  fi
  [ "$(served_target)" = "$(backend)" ] || die "the tailnet address is not set — run: scripts/setup.sh https"
  echo
  echo "Open on the phone (Tailscale app on, same account):  https://$(public_host)"
  echo "In Chrome's menu choose 'Install app' to put it on the home screen."
}

step_status() {
  echo "arcdr setup status"
  local s
  command -v herdr >/dev/null && herdr workspace list >/dev/null 2>&1 && ok "herdr running" || no "herdr not running"
  if command -v tailscale >/dev/null; then
    s="$(ts_state)"
    [ "$s" = Running ] && ok "tailscale logged in as $(ts_login) ($(ts_dns))" || no "tailscale: ${s:-not running}"
    [ -n "$(ts_certs)" ] && ok "tailnet HTTPS on" || no "tailnet HTTPS off"
  else
    no "tailscale not installed"
  fi
  [ -n "$(bun_bin)" ] && ok "bun $("$(bun_bin)" --version)" || no "bun not installed"
  [ -d "$ROOT/dist" ] && ok "built" || no "not built"
  [ -f "$ENV_FILE" ] && ok "config $ENV_FILE" || no "no config"
  systemctl --user is-active --quiet arcdr.service 2>/dev/null && ok "service running" || no "service not running"
  [ "$(served_target)" = "$(backend)" ] && ok "https://$(public_host)" || no "no tailnet address"
  command -v claude >/dev/null && mod_installed && ok "starter mod arcdr-report" || note "starter mod arcdr-report not installed (optional: scripts/setup.sh mod)"
}

mod_installed() { claude plugin list --json 2>/dev/null | grep -q '"arcdr-report@arcdr"'; }

step_mod() {
  echo "mod — arcdr-report, so the phone shows what each session is doing"
  command -v claude >/dev/null || die "claude (Claude Code) is not on PATH"
  if mod_installed; then ok "installed"; return; fi
  claude plugin marketplace add "$ROOT" >/dev/null 2>&1 || claude plugin marketplace list 2>/dev/null | grep -q arcdr ||
    die "could not add $ROOT as a plugin marketplace"
  claude plugin install arcdr-report@arcdr >/dev/null || die "could not install arcdr-report@arcdr"
  ok "installed — new Claude Code sessions load it; running ones after /reload-plugins"
}

step_unmod() {
  echo "unmod — remove the starter mod"
  if mod_installed; then claude plugin uninstall arcdr-report@arcdr >/dev/null && ok "removed"; else ok "not installed"; fi
}

step_uninstall() {
  echo "uninstall — stop arcdr and take its tailnet address down"
  systemctl --user disable --now arcdr.service >/dev/null 2>&1 || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
  ok "service removed"
  if [ "$(served_target)" = "$(backend)" ]; then
    tailscale serve --https="$HTTPS_PORT" off >/dev/null
    ok "tailnet port $HTTPS_PORT released"
  fi
  if [ "${1:-}" = --purge ]; then
    rm -f "$ENV_FILE" && rmdir "$(dirname "$ENV_FILE")" 2>/dev/null || true
    ok "config removed"
  fi
  note "Tailscale and Bun stay installed; remove them separately if nothing else uses them."
}

case "${1:-status}" in
  status) step_status ;;
  check) step_check ;;
  tailscale) step_tailscale ;;
  bun) step_bun ;;
  build) step_build ;;
  config) step_config ;;
  https) step_https ;;
  service) step_service ;;
  verify) step_verify ;;
  mod) step_mod ;;
  unmod) step_unmod ;;
  uninstall) step_uninstall "${2:-}" ;;
  all)
    step_check
    step_tailscale
    step_bun
    step_build
    step_config
    step_https
    step_service
    step_verify
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
