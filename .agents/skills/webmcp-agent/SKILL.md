---
name: webmcp-agent
description: Act as the WebMCP agent for this WordPress site — discover the page's WebMCP tools in Chrome and call them to satisfy a request. Use when the user asks to drive, test, or use the WebMCP tools/abilities in the browser, run a wp-admin action through WebMCP, or says "/webmcp" or "drive the webmcp tools".
---

# WebMCP agent

Claude Code is the WebMCP consumer here. The plugin's adapter registers WordPress
abilities as WebMCP tools on wp-admin pages. This skill drives Chrome over the
DevTools Protocol to discover and execute those tools, then reasons over the results.

Background: [architecture](../../../docs/architecture.md),
[development](../../../docs/development.md).

## Paths and config

Run all commands from the **project root** (the WordPress root). The CLI is referenced
relative to it, so nothing is machine-specific:

```bash
WEBMCP="wp-content/plugins/webmcp-adapter/tools/webmcp.mjs"
```

Everything else is configurable via env with sensible defaults: `CDP_PORT` (9222),
`WP_URL` (http://localhost:8080), `WP_USER`/`WP_PASS` (admin/admin), `CHROME_BIN`
(auto-detected per OS), `CHROME_PROFILE` (a throwaway dir under the system temp).

## Quick start

```bash
node "$WEBMCP" setup                  # launch Chrome if needed, log in, open wp-admin, wait for tools
node "$WEBMCP" list                   # discover tools + schemas
node "$WEBMCP" call <name> '<json>'   # execute a tool with JSON args
```

## Workflow

1. **Preflight the WP server.** `curl -s -o /dev/null -w "%{http_code}" "${WP_URL:-http://localhost:8080}/"`
   should be `200`/`302`. If not, start it from the project root:
   `wp server --host=localhost --port=8080 &`
2. **`setup`** — `ensure`s the debug Chrome (launches it with the WebMCP flag if the
   CDP port is down), logs in, loads wp-admin, and waits for the async ability store to
   populate. Confirm the returned `tools` array is non-empty.
3. **`list`** — read each tool's `name`, `description`, and `inputSchema`.
4. **Reason and act** — pick the tool(s) that satisfy the request, build args that fit
   the schema, run `call`, read the JSON result.
5. **Synthesize** — answer the user from the structured results, not the DOM.

## Gotchas

- `call` args must be a JSON **string** matching the tool's `inputSchema`. `{}` is fine
  when nothing is required.
- Tools are per-page and ephemeral. After any navigation, run `setup` again.
- The WP login is a session cookie; it clears when Chrome restarts. `setup` re-logs in.
- Only the debug Chrome (the `CDP_PORT`) is reachable, not the user's normal Chrome.
- After editing `adapter.js`, reload with cache disabled or bump `WEBMCP_ADAPTER_VERSION`.
- If `setup` reports Chrome did not open the port, set `CHROME_BIN` to the browser path.

## What tools exist

Whatever abilities are registered client-side. Today: `core-get-site-info`,
`core-get-environment-info` (read-only). New abilities appear automatically — no adapter
change needed. Re-run `list` to see the current set.
