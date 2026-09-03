---
name: webmcp-playground
description: 'One-command, disposable WordPress Playground for testing the frontend-only ChatGPT Work and Codex Site tools adapter — no MySQL, local install, companion plugin, or build. Boots a real-HTTP WP 7.0 with the adapter mounted and active, then drives its tools via the webmcp-playwright skill. Use when the user wants a throwaway adapter test, smoke test, or repeatable setup. Triggers: "test in playground", "easy way to test", "try the plugin", "webmcp playground".'
---

# ChatGPT Work and Codex Site tools in Playground

The fastest way to test the WordPress Site tools built for ChatGPT Work and Codex.
No MySQL or local database setup, no `wp server`, no build step. One script boots a real-HTTP WordPress 7.0 in
[WordPress Playground](https://wordpress.github.io/wordpress-playground/) with
`webmcp-adapter` mounted and active, then uses the
[webmcp-playwright](../webmcp-playwright/SKILL.md) skill to list and execute the tools.

The product acceptance target is ChatGPT Work or Codex in the ChatGPT desktop
app's built-in browser. Playground plus system Chrome is a deterministic page-side
regression harness; it does not reproduce the desktop product's discovery, safety,
or activity-review UI.

## Why this works (the important part)

`@wp-playground/cli server` serves WordPress over a **real HTTP port** (`:9400`) — NOT the
`playground.wordpress.net` iframe. This provides a normal top-level localhost
document for page-side WebMCP regression tests. The plugin is **mounted live** from
the repo before installation so the activation blueprint works on a fresh port.
Edits to PHP or `src/adapter.js` show up on reload — the same no-build flow as the
local site.

## Prerequisites

- **Node.js ≥ 22** (`node -v`).
- **Current system Chrome** installed (the driver launches it with WebMCP enabled —
  Playwright's bundled Chromium does not have the API). Nothing else to install: the script
  runs `npm install` for Playwright into the webmcp-playwright skill on first use, and
  Playground downloads WP itself.

## Quick start

From the repository root:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh test
```

That boots Playground (first run downloads WP, ~1 min), opens the existing post editor,
lists the registered tools, and executes one read tool. Expected: 17 tools (two
admin base tools plus all 15 editor tools) and an `editor-context` result.
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
.agents/skills/webmcp-playground/webmcp-playground.sh call webmcp.editor-context '{}'
```

## Options (env)

- `PORT` (9400), `WP` (7.0), `PHP` (8.3), `PW_VERSION` (latest `@wp-playground/cli`).
- `HEADLESS=0` — run the driver's Chrome headed (visible) instead of headless.

All 15 editor tools are exposed on compatible block-editor screens. Each `save-post`
call still needs the trusted-click in-page confirmation.

## What this skill does NOT do

It only manages the Playground backend and runs the driver. The actual WebMCP mechanics
(launch Chrome with WebMCP, log in, list/execute tools, assert UI, and test the confirmation
modal) live in the [webmcp-playwright](../webmcp-playwright/SKILL.md) skill. For custom
Playwright scripts or testing the gate end to end, use that skill directly against
`WP_URL=http://127.0.0.1:9400`.

## The blueprint is reusable on its own

[blueprint.json](blueprint.json) activates the adapter and lands on the frontend.
It is a standard Playground blueprint — you can also paste it into the live editor at
`playground.wordpress.net` (it would need the plugins fetched from a URL rather than mounted
from disk, but the steps are the shareable part).
It also seeds the three retired exposure/confirmation options with restrictive or
unsafe legacy values so the live suite proves the runtime ignores them.

## Teardown

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh down
```

Playground is fully ephemeral — its SQLite database lives only in a temp dir and is gone on
`down`. Nothing touches your real database or the local install.

## Gotchas

- First boot downloads `wordpress-7.0.zip`; later boots are cached and fast.
- Numeric `WP` values resolve through the exact WordPress.org release archive so
  the compatibility target cannot drift to a newer core version.
- The script records and validates the process it starts. It refuses to reuse or
  stop an unknown process that already owns the configured port.
- Compatible block-editor screens expose the complete 17-tool inventory;
  `save-post` still requires its in-page confirmation.
