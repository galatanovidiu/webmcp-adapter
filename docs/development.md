# Development — local environment and testing

How to run this project and test the WebMCP adapter in real Chrome. For the design, see
[architecture.md](architecture.md).

## Local environment (wp-env)

The standalone way to run the adapter is [`wp-env`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-env/)
(Docker-backed, no MySQL or Herd to manage). This repo ships a [`.wp-env.json`](../.wp-env.json)
that boots WordPress 7.0 (for the Abilities API) and mounts **both** plugins:

```jsonc
{
  "core": "WordPress/WordPress#7.0",
  "plugins": [ ".", "../abilities-catalog" ],   // this adapter + the sibling catalog repo
  "port": 8888
}
```

This assumes `abilities-catalog` is checked out as a **sibling** directory next to this repo:

```
parent/
  webmcp-adapter/      ← this repo (.wp-env.json lives here)
  abilities-catalog/   ← the companion catalog repo
```

Requirements: Docker (running) and Node ≥ 20. Then, from this repo root:

```bash
npm install -g @wordpress/env   # or use npx wp-env below
npx wp-env start                # first run pulls WP 7.0 + Docker images, ~1–2 min
```

- Site: http://localhost:8888 — admin: http://localhost:8888/wp-admin/
- Default credentials: `admin` / `password`.
- Both plugins are auto-activated by wp-env.

Run WP-CLI inside the container with `npx wp-env run cli wp <command>`:

```bash
npx wp-env run cli wp core version                 # 7.0
npx wp-env run cli wp plugin list --status=active  # webmcp-adapter + abilities-catalog
npx wp-env run cli wp eval 'do_action("wp_abilities_api_init"); foreach(wp_get_abilities() as $a){ echo $a->get_name()."\n"; }'
```

Stop or reset the environment:

```bash
npx wp-env stop       # stop (keeps data)
npx wp-env destroy    # remove the environment entirely
```

> Adjust `core` in `.wp-env.json` if you need a different WordPress build; the Abilities API
> requires WordPress 7.0 or later.

### One-command alternative (no Docker): WordPress Playground

For a throwaway, no-Docker run, the local `webmcp-playground` skill boots a real-HTTP WP 7.0 via
`@wp-playground/cli` with both plugins mounted and drives the tools with Playwright + system Chrome:

```bash
.claude/skills/webmcp-playground/webmcp-playground.sh test
```

It expects `abilities-catalog` as a sibling (override with `CATALOG_DIR=/path`). This tooling is
local-only (the `.claude/` directory is gitignored), so it does not ship inside the repo.

## Testing the adapter in real Chrome

Playwright's bundled Chromium does **not** have the WebMCP API. Use real Chrome with the testing
flag. The testing flag also enables `navigator.modelContextTesting` (`listTools` / `executeTool`),
so tools can be listed and run without a live AI agent.

### Easy path: the CLI

A small CLI wraps all of the below. From this repo root:

```bash
WEBMCP="tools/webmcp.mjs"
WP_URL=http://localhost:8888 WP_USER=admin WP_PASS=password \
  node "$WEBMCP" setup               # launch Chrome (if down), log in, open wp-admin, wait for tools
node "$WEBMCP" list                  # discover tools + schemas
node "$WEBMCP" call <name> '<json>'  # execute a tool
```

Config is via env (`CDP_PORT`, `WP_URL`, `WP_USER`, `WP_PASS`, `CHROME_BIN`, `CHROME_PROFILE`),
all with defaults — set `WP_URL`/`WP_USER`/`WP_PASS` to match your environment (wp-env defaults to
`http://localhost:8888` and `admin` / `password`). The `webmcp-agent` skill drives this flow. The
sections below document the underlying mechanism the CLI uses.

### 1. Launch Chrome with the flag and a debug port

Use a throwaway profile so the normal Chrome profile is untouched. Launch detached so it survives
across shell invocations.

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
nohup "$CHROME" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/wpwebmcp-chrome-profile \
  --enable-features=WebMCPTesting,DevToolsWebMCPSupport \
  --no-first-run --no-default-browser-check \
  about:blank >/tmp/wpwebmcp-chrome.log 2>&1 &
disown
sleep 4
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9222/json/version   # expect 200
```

### 2. Drive it over the DevTools Protocol

Connect with a small Node script (Node ≥ 20 has a built-in `WebSocket`). The pattern:

1. `GET http://localhost:9222/json` → find the `page` target, read `webSocketDebuggerUrl`.
2. Connect the WebSocket; send `{id, method, params}`, match responses by `id`.
3. `Page.enable`, `Runtime.enable`. Optionally `Network.enable` +
   `Network.setCacheDisabled {cacheDisabled:true}` to force a fresh `adapter.js`.
4. `Page.navigate` to `wp-login.php`, set `#user_login` / `#user_pass`, submit the form via
   `Runtime.evaluate`. The login is a **session cookie**: it clears when Chrome restarts, so
   re-login each fresh Chrome, or tick "remember me".
5. `Page.navigate` to `/wp-admin/`, wait for the abilities REST fetch + adapter to run.
6. `Runtime.evaluate` with `awaitPromise:true`:
   `await navigator.modelContextTesting.listTools()` to see registered tools, and
   `await navigator.modelContextTesting.executeTool(name, '{}')` to run one.

Notes that cost time to discover:
- `executeTool` wants a JSON **string** argument, not an object.
- Inside the MCP `browser_run_code_unsafe` sandbox, `require` and dynamic `import` are unavailable,
  so Playwright's `connectOverCDP` cannot be used there. Drive CDP from a standalone Node script
  instead.
- A page navigated to `/wp-admin/` while logged out redirects to the login page, which has no
  script modules — so an empty import map usually means "not logged in".

### 3. Verify after editing adapter.js

`adapter.js` is served raw (no build step). After editing, reload with the cache disabled (step 3
above) or bump `WEBMCP_ADAPTER_VERSION` so the `?ver=` changes. Confirm on a cold load that
`listTools()` returns the expected tools.

## Cleaning up

```bash
pkill -f "remote-debugging-port=9222"   # stop the test Chrome
rm -rf /tmp/wpwebmcp-chrome-profile /tmp/cdp-*.mjs
npx wp-env stop                         # stop the wp-env environment
```
