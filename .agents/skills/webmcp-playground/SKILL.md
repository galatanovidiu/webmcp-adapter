---
name: webmcp-playground
description: One-command, disposable WordPress Playground for testing the WebMCP adapter — no MySQL, no local install, no build. Boots a real-HTTP WP 7.0 with both plugins mounted and active, then drives the WebMCP tools via the webmcp-playwright skill. Use when the user (or anyone trying the plugin) wants an easy, throwaway way to test the adapter, run a smoke test, or hand someone a repeatable test setup. Triggers: "test in playground", "easy way to test", "try the plugin", "webmcp playground".
---

# WebMCP in Playground (easy, disposable test)

The fastest way to see the WebMCP adapter working — for you or anyone else with the repo.
No database, no `wp server`, no build step. One script boots a real-HTTP WordPress 7.0 in
[WordPress Playground](https://wordpress.github.io/wordpress-playground/) with
`abilities-catalog` and `webmcp-adapter` mounted and active, then uses the
[webmcp-playwright](../webmcp-playwright/SKILL.md) skill to list and execute the tools.

## Why this works (the important part)

`@wp-playground/cli server` serves WordPress over a **real HTTP port** (`:9400`) — NOT the
`playground.wordpress.net` iframe. So it looks like a normal localhost site, and WebMCP
behaves exactly as on a full install. The plugins are **mounted live** from the repo, so
edits to PHP or `src/adapter.js` show up on reload — same no-build flow as the local site.

## Prerequisites

- **Node.js ≥ 20.18** (`node -v`).
- **Real Google Chrome 149+** installed (the driver launches it with the WebMCP flag —
  Playwright's bundled Chromium does not have the API). Nothing else to install: the script
  runs `npm install` for Playwright into the webmcp-playwright skill on first use, and
  Playground downloads WP itself.

## Quick start

From anywhere (paths resolve relative to the script):

```bash
.claude/skills/webmcp-playground/webmcp-playground.sh test
```

That boots Playground (first run downloads WP, ~1 min), lists the registered tools, and
executes one read tool. Expected: ~64 read tools and a `users-get-current-user` result.
The server stays up afterward so you can keep poking.

## Commands

| Command | What it does |
|---|---|
| `webmcp-playground.sh up` | Start Playground in the background, wait until ready |
| `webmcp-playground.sh test` | `up` + smoke test (count tools, run one read tool) |
| `webmcp-playground.sh tools` | `up` + print the registered WebMCP tool names (JSON) |
| `webmcp-playground.sh call <name> '<json>'` | `up` + execute one tool |
| `webmcp-playground.sh status` | Is Playground running? |
| `webmcp-playground.sh down` | Stop Playground |

Example:

```bash
.claude/skills/webmcp-playground/webmcp-playground.sh call content-list-posts '{"per_page":3}'
```

## Options (env)

- `ENABLE_WRITES=1` — also expose the non-destructive **write** tools (64 → ~109). The
  script injects a `setSiteOptions` step that turns on `webmcp_enable_write_tools`. Default
  is reads-only, matching the plugin's secure default.
- `PORT` (9400), `WP` (7.0), `PHP` (8.3), `PW_VERSION` (latest `@wp-playground/cli`).
- `HEADLESS=0` — run the driver's Chrome headed (visible) instead of headless.

To exercise **destructive** or **dangerous** tools, enable them on the settings screen in
the browser (`/wp-admin/options-general.php?page=webmcp-adapter`, admin / admin) — they are
intentionally not auto-enabled, and each call needs an in-page confirmation.

## What this skill does NOT do

It only manages the Playground backend and runs the driver. The actual WebMCP mechanics
(launch Chrome with the flag, login, listTools/executeTool, UI assertions, the confirmation
modal) live in the [webmcp-playwright](../webmcp-playwright/SKILL.md) skill. For custom
Playwright scripts or testing the gate end to end, use that skill directly against
`WP_URL=http://127.0.0.1:9400`.

## The blueprint is reusable on its own

[blueprint.json](blueprint.json) activates both plugins and lands on the settings screen.
It is a standard Playground blueprint — you can also paste it into the live editor at
`playground.wordpress.net` (it would need the plugins fetched from a URL rather than mounted
from disk, but the steps are the shareable part).

## Teardown

```bash
.claude/skills/webmcp-playground/webmcp-playground.sh down
```

Playground is fully ephemeral — its SQLite database lives only in a temp dir and is gone on
`down`. Nothing touches your real database or the local install.

## Gotchas

- First boot downloads `wordpress-7.0.zip`; later boots are cached and fast.
- If `down` leaves the port busy, `lsof -ti tcp:9400 | xargs kill` clears it.
- The tool count depends on the gate: reads always show; writes only with `ENABLE_WRITES=1`
  (or the UI toggle); destructive/dangerous only after the extra settings + opt-in.
- See [.hyper/memory/webmcp-playground-testing.md](../../../.hyper/memory/webmcp-playground-testing.md)
  for the underlying findings (WP 7.0 is a real release, dbDelta works on SQLite, etc.).
