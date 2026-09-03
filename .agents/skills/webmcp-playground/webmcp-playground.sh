#!/usr/bin/env bash
#
# webmcp-playground.sh — one-command, disposable WordPress Playground for testing the
# WebMCP adapter. Boots a real-HTTP WP 7.0 with the plugin mounted and active, then
# delegates all tool-driving to the sibling webmcp-playwright skill (system Chrome +
# the WebMCP flag). No MySQL, no local install, no build step.
#
# Usage (run from the repository root):
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
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# This script lives in webmcp-adapter/.agents/skills/webmcp-playground/. The adapter
# repo root is three levels up.
ADAPTER_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PW_SKILL="$SCRIPT_DIR/../webmcp-playwright"
DRIVER="$PW_SKILL/driver.mjs"

PORT="${PORT:-9400}"
WP="${WP:-7.0}"
PHP="${PHP:-8.3}"
PW_VERSION="${PW_VERSION:-latest}"
WP_URL="http://127.0.0.1:$PORT"

RUNDIR="${TMPDIR:-/tmp}/webmcp-playground-$PORT"
LOG="$RUNDIR/server.log"
PIDFILE="$RUNDIR/server.pid"
mkdir -p "$RUNDIR"

note() { printf '\033[36m›\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

server_up() { curl -fsS -o /dev/null "$WP_URL/" 2>/dev/null; }

managed_pid() {
	[ -f "$PIDFILE" ] || return 1
	local pid command
	read -r pid < "$PIDFILE" || return 1
	case "$pid" in ''|*[!0-9]*) return 1 ;; esac
	kill -0 "$pid" 2>/dev/null || return 1
	command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
	case "$command" in
		*"@wp-playground/cli"*"server"*"--port=$PORT"*) printf '%s\n' "$pid" ;;
		*) return 1 ;;
	esac
}

check_node() {
	command -v node >/dev/null || die "Node.js not found. Install Node >= 22."
	command -v npx  >/dev/null || die "npx not found (comes with Node)."
	[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ] || die "Node.js 22 or later is required."
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
	if server_up; then
		managed_pid >/dev/null || die "Port $PORT is occupied by a process this script did not start; refusing to reuse it."
		note "Managed Playground already running at $WP_URL"
		return 0
	fi
	if managed_pid >/dev/null; then
		die "The managed Playground process exists but $WP_URL is not responding. Run '$0 down' before retrying."
	fi
	[ -d "$ADAPTER_DIR" ] || die "Missing adapter plugin dir: $ADAPTER_DIR"
	local blueprint; blueprint="$(resolve_blueprint)"

	note "Booting Playground (WP $WP, PHP $PHP, port $PORT)… first run downloads WP, ~1 min."
	nohup npx "@wp-playground/cli@$PW_VERSION" server \
		--wp="$WP" --php="$PHP" --port="$PORT" \
		--blueprint="$blueprint" \
		--mount="$ADAPTER_DIR:/wordpress/wp-content/plugins/webmcp-adapter" \
		>"$LOG" 2>&1 &
	local server_pid=$!
	printf '%s\n' "$server_pid" > "$PIDFILE"
	disown || true

	local i
	for i in $(seq 1 120); do
		server_up && break
		kill -0 "$server_pid" 2>/dev/null || die "Playground exited before it became ready. See $LOG"
		sleep 2
		if [ "$i" = "120" ]; then die "Playground did not come up in time. See $LOG"; fi
	done
	note "Ready: $WP_URL  (admin / admin)"
	note "Settings: $WP_URL/wp-admin/options-general.php?page=webmcp-adapter"
	[ "${ENABLE_WRITES:-0}" = "1" ] && note "Write tools: ENABLED for this run." || true
}

cmd_down() {
	local pid
	if pid="$(managed_pid)"; then
		kill "$pid"
		local i
		for i in $(seq 1 30); do
			kill -0 "$pid" 2>/dev/null || break
			sleep 0.2
		done
		if kill -0 "$pid" 2>/dev/null || server_up; then
			die "Managed Playground did not stop cleanly; ownership record kept at $PIDFILE."
		fi
		unlink "$PIDFILE" 2>/dev/null || true
		note "Stopped Playground on port $PORT."
	elif server_up; then
		die "Port $PORT is owned by an unknown process; refusing to stop it."
	else
		unlink "$PIDFILE" 2>/dev/null || true
		note "Nothing listening on port $PORT."
	fi
}

cmd_status() {
	if server_up && managed_pid >/dev/null; then
		note "UP (managed) — $WP_URL"
	elif server_up; then
		note "UP (unknown owner) — $WP_URL"
	else
		note "DOWN — $WP_URL"
	fi
}

run_driver() {
	ensure_playwright
	WP_URL="$WP_URL" WP_USER=admin WP_PASS=admin HEADLESS="${HEADLESS:-1}" node "$DRIVER" "$@"
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
	# A smoke test owns a fresh disposable state so gate values cannot leak from a
	# prior run. cmd_down refuses to touch an unknown process.
	cmd_down
	cmd_up
	ensure_playwright
	note "Listing tools…"
	local names expected
	names="$(run_driver names)"
	expected=7
	if [ "${ENABLE_WRITES:-0}" = "1" ] || [ "${ENABLE_WRITES:-}" = "true" ]; then expected=15; fi
	EXPECTED_COUNT="$expected" node -e '
		const fs = require("fs");
		const actual = JSON.parse(fs.readFileSync(0, "utf8")).sort();
		const reads = ["webmcp.editor-context","webmcp.get-theme-design-tokens","webmcp.list-block-types","webmcp.list-patterns","webmcp.list-templates","webmcp.navigate","webmcp.read-blocks"];
		const writes = ["webmcp.edit-post-attributes","webmcp.insert-blocks","webmcp.insert-pattern","webmcp.move-blocks","webmcp.remove-blocks","webmcp.replace-blocks","webmcp.undo","webmcp.update-block-attributes"];
		const expected = (Number(process.env.EXPECTED_COUNT) === 15 ? [...reads, ...writes] : reads).sort();
		if (JSON.stringify(actual) !== JSON.stringify(expected)) {
			console.error(`Expected ${expected.length} exact frontend tools, received ${actual.length}: ${actual.join(", ")}`);
			process.exit(1);
		}
	' <<< "$names"
	note "Registered exact frontend tool set: $expected"
	note "Executing a read tool (webmcp.editor-context)…"
	run_driver call webmcp.editor-context '{}'
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
