---
name: webmcp-playwright
description: Drive and test this plugin's WebMCP tools with Playwright. Launches the real system Chrome (channel 'chrome') with the WebMCP flag, lists and executes the registered abilities, and runs UI assertions on the wp-admin surfaces (settings, activity screen, confirmation modal). Use when the user asks to test the WebMCP adapter with Playwright, write Playwright tests for it, drive the tools from a script, or says "webmcp playwright".
---

# WebMCP with Playwright

The WebMCP adapter registers WordPress abilities as WebMCP tools on wp-admin pages.
This skill drives those tools — and the surrounding admin UI — with Playwright.

Background: [architecture](../../../docs/architecture.md),
[development](../../../docs/development.md),
[.hyper/memory/webmcp-playground-testing.md](../../../.hyper/memory/webmcp-playground-testing.md).

## The one rule that makes or breaks this

WebMCP lives in **real Chrome 149+**, behind a launch flag. It is NOT in Playwright's
bundled Chromium, and NOT in the Playwright MCP server's managed browser. To see the API
you MUST launch the **system Chrome** and pass the flag:

```js
const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',                                          // system Chrome, not bundled
  headless: false,                                            // headless: true also works
  args: ['--enable-features=WebMCPTesting,DevToolsWebMCPSupport'],
});
```

That flag exposes `navigator.modelContextTesting` (`listTools()` / `executeTool()`), so
tools can be listed and run without a live AI agent. Verified working headed AND headless,
Chrome 149. If `navigator.modelContextTesting` is `undefined`, the flag did not apply —
you are almost certainly on bundled Chromium or a non-`chrome` channel.

## One-time setup

Install Playwright into THIS skill directory (it resolves `playwright` from its own
`node_modules` regardless of where you run it). No browser download — we use system Chrome:

```bash
cd .claude/skills/webmcp-playwright
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i
```

`node_modules/` is gitignored. Real Chrome must be installed at the usual OS path.

## A WordPress backend must be running

Point the driver at any WP 7.0 site that has both plugins active. Two common backends:

- **Local install (default):** `wp server --host=localhost --port=8080` from the project
  root. `WP_URL=http://localhost:8080`.
- **Playground (disposable):** a real-HTTP WP, no iframe. From the project root:

  ```bash
  PLUGINS="$PWD/wp-content/plugins"
  npx @wp-playground/cli@latest server --wp=7.0 --php=8.3 --port=9400 \
    --blueprint=/tmp/wpwebmcp-playground/blueprint.json \
    --mount="$PLUGINS/abilities-catalog:/wordpress/wp-content/plugins/abilities-catalog" \
    --mount="$PLUGINS/webmcp-adapter:/wordpress/wp-content/plugins/webmcp-adapter"
  ```

  The blueprint activates both plugins (and can preset gate options via `setSiteOptions`).
  Then `WP_URL=http://127.0.0.1:9400`. See the playground-testing memory note for the full
  blueprint and why a blueprint is optional but convenient.

## Driving the tools — the driver CLI

`driver.mjs` launches Chrome with the flag, logs in, opens wp-admin, waits for the async
ability store, then runs your command. Run from the project root:

```bash
WP_URL=http://localhost:8080 \
  node .claude/skills/webmcp-playwright/driver.mjs names           # tool names (sorted)
node .claude/skills/webmcp-playwright/driver.mjs list              # full tools + schemas
node .claude/skills/webmcp-playwright/driver.mjs call users-get-current-user '{}'
```

Config via env: `WP_URL`, `WP_USER`/`WP_PASS` (admin/admin), `CHROME_CHANNEL` (chrome),
`PROFILE_DIR` (a persistent profile — keeps the login cookie across runs), `HEADLESS=1`.

`executeTool` wants a JSON **string** argument; `{}` is fine when nothing is required.
Build args to match each tool's `inputSchema` from `list`.

## Writing custom Playwright scripts (UI + tools together)

For anything beyond list/call — asserting on the admin UI, testing the gate end to end,
exercising the confirmation modal — write a Playwright script using the launch block above.
The page exposes both normal DOM and the WebMCP testing API, so you can mix them:

```js
// after login + goto /wp-admin/
const tools = await page.evaluate(() => navigator.modelContextTesting.listTools());

// flip a gate in the UI, then confirm a write tool appears
await page.goto(`${WP_URL}/wp-admin/options-general.php?page=webmcp-adapter`);
await page.check('#webmcp_enable_write_tools');
await page.click('#submit');                                       // saves the option
// reload wp-admin and re-list — content-create-post should now be present
```

### Confirmation modal: Playwright clicks ARE trusted

The destructive/dangerous confirmation gate keys on `event.isTrusted`, so the in-page
agent's synthetic clicks cannot self-approve. **Playwright's `page.click()` dispatches a
trusted event (`isTrusted === true`)** — verified. So Playwright CAN approve the modal:

```js
await page.click('[data-webmcp-confirm-accept]');   // cancel: [data-webmcp-confirm-cancel]
```

This is a capability for testing the full destructive path. It is also the same accepted
automation gap as raw CDP: at the `isTrusted` level, Playwright is indistinguishable from a
human. Do not treat "modal approved under Playwright" as proof of human approval. See
[.hyper/memory/webmcp-human-only-confirmation-gate.md](../../../.hyper/memory/webmcp-human-only-confirmation-gate.md).

## Gotchas

- `navigator.modelContext` (the non-testing API) may be `undefined` even when
  `navigator.modelContextTesting` is present — drive the testing API for list/execute.
- Tools are per-page and ephemeral. After any navigation, re-wait for the store and
  re-list. The store loads asynchronously — poll `listTools()` until non-empty (the driver
  does this).
- The persistent `PROFILE_DIR` keeps the WP session cookie; the driver only re-logs in when
  it lands on `wp-login.php`. Delete the profile dir to force a clean login.
- After editing `src/adapter.js` (served raw, no build), reload — or bump
  `WEBMCP_ADAPTER_VERSION` so the `?ver=` changes — before re-listing.
- Which tools appear depends on the three write-gate settings and the per-ability dangerous
  opt-in. Do not assume a fixed count; reads always show, writes/destructive/dangerous only
  when their gates are on.

## Cleanup

```bash
rm -rf "${PROFILE_DIR:-$TMPDIR/webmcp-pw-profile}"   # drop the Playwright Chrome profile
pkill -f "wp-playground"                              # if you started Playground
```

## Lighter alternative

For quick list/call without Playwright, the repo ships a raw-CDP CLI:
`wp-content/plugins/webmcp-adapter/tools/webmcp.mjs` (driven by the `webmcp-agent` skill).
It keeps one debug Chrome alive across calls over a remote-debugging port. Use Playwright
(this skill) when you also need UI assertions, auto-waiting, or real test structure.
