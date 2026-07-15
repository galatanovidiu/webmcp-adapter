#!/usr/bin/env bash
#
# webmcp-playground.sh — one-command, disposable WordPress Playground for testing the
# WebMCP adapter. Boots a real-HTTP WP 7.0 with both plugins mounted and active, then
# delegates all tool-driving to the sibling webmcp-playwright skill (system Chrome +
# the WebMCP flag). No MySQL, no local install, no build step.
#
# Usage (run from anywhere — paths resolve relative to this script):
#   ./webmcp-playground.sh up        Start Playground (background), wait until ready
#   ./webmcp-playground.sh test      up + smoke test (list tools, run one read tool)
#   ./webmcp-playground.sh tools     up + print the registered WebMCP tool names
#   ./webmcp-playground.sh call <name> '<json>'   up + execute one tool
#   ./webmcp-playground.sh status    Is Playground running?
#   ./webmcp-playground.sh down      Stop Playground
#
# Env (optional):
#   PORT=9400              Playground HTTP port
#   WP=7.0  PHP=8.3        version pins
#   ENABLE_WRITES=1        also expose non-destructive write tools (default: reads only)
#   PW_VERSION=latest      @wp-playground/cli version (default: latest)
#   CATALOG_DIR=<path>     abilities-catalog repo (default: sibling of this adapter repo,
#                          i.e. ../abilities-catalog). Override if it lives elsewhere.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This script lives in webmcp-adapter/.claude/skills/webmcp-playground/. The adapter repo root
# is three levels up; abilities-catalog is a separate, sibling repo (override with CATALOG_DIR).
ADAPTER_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CATALOG_DIR="${CATALOG_DIR:-$ADAPTER_DIR/../abilities-catalog}"
PW_SKILL="$SCRIPT_DIR/../webmcp-playwright"
DRIVER="$PW_SKILL/driver.mjs"

PORT="${PORT:-9400}"
WP="${WP:-7.0}"
PHP="${PHP:-8.3}"
PW_VERSION="${PW_VERSION:-latest}"
WP_URL="http://127.0.0.1:$PORT"

RUNDIR="${TMPDIR:-/tmp}/webmcp-playground"
LOG="$RUNDIR/server.log"
mkdir -p "$RUNDIR"

note() { printf '\033[36m›\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

server_up() { curl -fsS -o /dev/null "$WP_URL/" 2>/dev/null; }

check_node() {
	command -v node >/dev/null || die "Node.js not found. Install Node >= 20.18."
	command -v npx  >/dev/null || die "npx not found (comes with Node)."
}

# The webmcp-playwright skill owns the Playwright dependency. Install it on first use.
ensure_playwright() {
	[ -f "$DRIVER" ] || die "Driver not found at $DRIVER — is the webmcp-playwright skill present?"
	if [ ! -d "$PW_SKILL/node_modules/playwright" ]; then
		note "Installing Playwright into the webmcp-playwright skill (system Chrome, no browser download)…"
		( cd "$PW_SKILL" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >/dev/null 2>&1 ) \
			|| die "npm install failed in $PW_SKILL"
	fi
}

# Build the blueprint to use: the committed reads-only one, or a temp copy that also
# enables write tools when ENABLE_WRITES=1.
resolve_blueprint() {
	local base="$SCRIPT_DIR/blueprint.json"
	[ -f "$base" ] || die "blueprint.json missing next to this script."
	if [ "${ENABLE_WRITES:-0}" = "1" ] || [ "${ENABLE_WRITES:-}" = "true" ]; then
		local out="$RUNDIR/blueprint-writes.json"
		node -e '
			const fs = require("fs");
			const bp = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
			bp.steps.push({ step: "setSiteOptions", options: { webmcp_enable_write_tools: "1" } });
			fs.writeFileSync(process.argv[2], JSON.stringify(bp, null, 2));
		' "$base" "$out"
		echo "$out"
	else
		echo "$base"
	fi
}

cmd_up() {
	check_node
	if server_up; then note "Playground already running at $WP_URL"; return 0; fi
	[ -d "$ADAPTER_DIR" ] || die "Missing adapter plugin dir: $ADAPTER_DIR"
	[ -d "$CATALOG_DIR" ] || die "Missing abilities-catalog. Expected sibling at $CATALOG_DIR (override with CATALOG_DIR=/path/to/abilities-catalog)."
	CATALOG_DIR="$(cd "$CATALOG_DIR" && pwd)"
	local blueprint; blueprint="$(resolve_blueprint)"

	note "Booting Playground (WP $WP, PHP $PHP, port $PORT)… first run downloads WP, ~1 min."
	nohup npx "@wp-playground/cli@$PW_VERSION" server \
		--wp="$WP" --php="$PHP" --port="$PORT" \
		--blueprint="$blueprint" \
		--mount="$CATALOG_DIR:/wordpress/wp-content/plugins/abilities-catalog" \
		--mount="$ADAPTER_DIR:/wordpress/wp-content/plugins/webmcp-adapter" \
		>"$LOG" 2>&1 &
	disown || true

	local i
	for i in $(seq 1 120); do
		server_up && break
		sleep 2
		if [ "$i" = "120" ]; then die "Playground did not come up in time. See $LOG"; fi
	done
	note "Ready: $WP_URL  (admin / admin)"
	note "Settings: $WP_URL/wp-admin/options-general.php?page=webmcp-adapter"
	[ "${ENABLE_WRITES:-0}" = "1" ] && note "Write tools: ENABLED for this run." || true
}

cmd_down() {
	local pids
	pids="$(lsof -ti "tcp:$PORT" 2>/dev/null || true)"
	if [ -n "$pids" ]; then
		# shellcheck disable=SC2086
		kill $pids 2>/dev/null || true
		note "Stopped Playground on port $PORT."
	else
		note "Nothing listening on port $PORT."
	fi
	pkill -f "wp-playground.*server" 2>/dev/null || true
}

cmd_status() {
	if server_up; then note "UP  — $WP_URL"; else note "DOWN — $WP_URL"; fi
}

run_driver() {
	ensure_playwright
	WP_URL="$WP_URL" HEADLESS="${HEADLESS:-1}" node "$DRIVER" "$@"
}

cmd_tools() { cmd_up; run_driver names; }

cmd_call() {
	[ -n "${1:-}" ] || die "Usage: $0 call <tool-name> '<json-args>'"
	local args="${2:-}"
	[ -n "$args" ] || args='{}'
	cmd_up
	run_driver call "$1" "$args"
}

cmd_test() {
	cmd_up
	ensure_playwright
	note "Listing tools…"
	local n
	n="$(run_driver names | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log("?")}})')"
	note "Registered WebMCP tools: $n"
	note "Executing a read tool (users-get-current-user)…"
	run_driver call users-get-current-user '{}'
	note "Smoke test passed. Playground stays up at $WP_URL — run '$0 down' to stop."
}

main() {
	local cmd="${1:-}"; shift || true
	case "$cmd" in
		up)     cmd_up ;;
		down)   cmd_down ;;
		status) cmd_status ;;
		tools)  cmd_tools ;;
		call)   cmd_call "$@" ;;
		test)   cmd_test ;;
		*)
			sed -n '3,30p' "$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")" | sed 's/^# \{0,1\}//'
			exit 1 ;;
	esac
}
main "$@"
