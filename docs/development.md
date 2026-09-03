# Developing WordPress Site tools for ChatGPT Work and Codex

The product and acceptance target is ChatGPT Work and Codex Site tools in the
ChatGPT desktop app's built-in browser. System Chrome remains useful only as a
deterministic protocol regression harness.

## Local environment with wp-env

The repository's [`.wp-env.json`](../.wp-env.json) boots WordPress 7.0 and mounts
only this plugin:

```json
{
  "core": "WordPress/WordPress#7.0",
  "plugins": ["."],
  "port": 8888,
  "testsEnvironment": false
}
```

Requirements: Docker and Node.js 22 or later.

```bash
npx wp-env start
```

- Site: <http://localhost:8888>
- Admin: <http://localhost:8888/wp-admin/>
- Credentials: `admin` / `password`

Useful checks:

```bash
npx wp-env run cli wp core version
npx wp-env run cli wp plugin list --status=active
npx wp-env stop
```

The adapter deliberately does not install or load an abilities catalog. Only
frontend abilities marked `clientRegistered` are projected into WebMCP.

## Disposable WordPress Playground

When Docker is unavailable or port 8888 is busy, use the committed Playground
workflow:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh up
```

It starts a real-HTTP WordPress 7.0 instance, mounts this plugin live, activates it,
and reports the localhost URL. The SQLite state is disposable. Run `down` when
finished.

## Test in ChatGPT Work or Codex

Use GPT-5.6 Sol or GPT-5.6 Terra in the latest ChatGPT desktop app. Confirm **Enable
site tools** is on under **Settings → Browser → Permissions**.

1. Start wp-env or Playground.
2. Open the direct wp-admin URL in the ChatGPT desktop app's built-in browser. Do
   not embed it in an iframe.
3. On the Dashboard, inspect Site tools. The default inventory must stabilize at
   exactly seven `webmcp-*` read tools.
4. Run `webmcp-editor-context`; it must return `inEditor: false`.
5. Open `/wp-admin/post-new.php?post_type=page`, rediscover the tools, and run
   `webmcp-editor-context` plus `webmcp-read-blocks`. The context must report
   `inEditor: true`.

For the write path, enable **Enable write tools** under **Settings → WebMCP** and
reload the editor. The inventory must contain 15 tools. Exercise an unsaved
`insert-blocks → read-blocks → undo` sequence and verify the editor returns to its
initial state.

For the persistence path, also enable **Enable destructive tools**. The inventory
must contain 16 tools, including `webmcp-save-post`. Verify the decline path before
approving a save in a disposable environment.

After each navigation or reload, fetch the tools again. WebMCP registrations belong
to one document and old handles become stale.

## Test with system Chrome

The committed drivers use current system Chrome and prefer the standard imperative
API:

- `document.modelContext.getTools()`
- `document.modelContext.executeTool(registeredTool, inputObject)`

Chrome 149's `modelContextTesting` hook remains a fallback and still receives a
JSON string. A transitional Chrome build may expose the standard API while still
expecting that older string input. The harness detects the input shape once with
the harmless `webmcp-editor-context` read and never retries a write after an
execution error. Playwright's bundled
Chromium is not a substitute for system Chrome.

```bash
WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs names

WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs call webmcp-editor-context '{}'
```

The driver fails when WebMCP is unavailable or the page registers zero tools. It
normalizes Chrome builds that expose `inputSchema` as a JSON string.

For the larger editor flow:

```bash
WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/verify-frontend.mjs
```

The raw CDP CLI provides the same list/call primitives:

```bash
WP_URL=http://localhost:8888 WP_USER=admin WP_PASS=password \
  node tools/webmcp.mjs setup
node tools/webmcp.mjs list
node tools/webmcp.mjs call webmcp-editor-context '{}'
```

## Regression checklist

- Only records with `clientRegistered: true` and without `serverRegistered: true`
  become tools, even if another plugin populates the shared store.
- The default inventory is 7 tools; write mode is 15; write plus destructive mode
  is 16.
- The inventory stays available after the store settles and remains frontend-only.
- No request is made to `/wp-abilities/v1/abilities`.
- Registration rejection does not cause an unhandled promise rejection or mark the
  ability as successfully registered.
- Structured ability results remain structured in ChatGPT Work and Codex.
- When the browser forwards the callback signal, cancelling an invocation removes
  a pending confirmation. Record clients that cancel only the outer call without
  forwarding a signal.
- Tool discovery and execution work after a full navigation and rediscovery.

## Cache and cleanup

`src/adapter.js` is served raw with no build step. Reload after changing it; the
plugin version is also used as the module cache key.

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh down
npx wp-env stop
```

For current ChatGPT Work and Codex availability and limitations, see the
[official Site tools documentation](https://learn.chatgpt.com/docs/webmcp).
