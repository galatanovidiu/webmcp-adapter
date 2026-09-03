---
name: webmcp-playwright
description: Regression-test this plugin's frontend ChatGPT Work and Codex Site tools with Playwright and current system Chrome. Lists and executes tools through the standard document.modelContext API, with the Chrome 149 testing hook as a fallback, and can assert wp-admin settings, editor state, activity, and confirmation UI. Use for deterministic browser regression tests or when the user says "webmcp playwright".
---

# Testing ChatGPT Work and Codex Site tools with Playwright

This is the deterministic system-Chrome harness. ChatGPT Work and Codex Site tools
in the ChatGPT desktop built-in browser remain the product acceptance target.

Read [architecture](../../../docs/architecture.md) and
[development](../../../docs/development.md) before changing the runtime.

## Browser requirement

Use current system Chrome, not Playwright's bundled Chromium:

```js
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: true,
  args: ['--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport'],
});
```

Prefer the standard API:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find(({ name }) => name === 'webmcp.editor-context');
const result = await document.modelContext.executeTool(tool, {});
```

Current Chrome may expose `inputSchema` as a JSON string. Parse it before printing
or asserting it. Some builds also retain the earlier JSON-string input shape for
standard `executeTool`; detect that shape once with the harmless
`webmcp.editor-context` read and never retry a write after an execution error.
Chrome 149's `navigator.modelContextTesting.listTools()` and
`executeTool(name, jsonString)` remain fallback-only.

## Setup

Install Playwright in this skill directory without downloading browsers:

```bash
cd .agents/skills/webmcp-playwright
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
```

Start WordPress with only this plugin active:

```bash
npx wp-env start
```

Or use the disposable Playground:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh up
```

## Driver

From the repository root:

```bash
WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs names

WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs names --url /wp-admin/options-general.php

WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs names --url / --anonymous

WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs list --url /wp-admin/site-editor.php

WP_URL=http://localhost:8888 \
  node .agents/skills/webmcp-playwright/driver.mjs call webmcp.editor-context '{}' \
    --url /wp-admin/post-new.php?post_type=page
```

Configuration: `WP_URL`, `WP_USER`, `WP_PASS`, `CHROME_CHANNEL`,
`PROFILE_DIR`, and `HEADLESS=1`. `--url` accepts a path or an absolute URL on the
configured WordPress origin. The driver logs in before opening the requested page by
default; `--anonymous` clears cookies and opens it without logging in.

The driver must fail when WebMCP is unavailable or the page registers zero tools.
Listing tools must not depend on an editor-specific tool. Before a call through a
transitional standard API, the driver detects its input shape with a read-only tool
whose schema requires no arguments.

## Expected inventory

- Generic wp-admin: 2 base read tools.
- Compatible post and Site Editor screens: 17 tools (2 admin base plus all 15
  editor tools), including `save-post`.
- Anonymous frontend: 2 base reads; authenticated frontend: 3 base reads.
- No `core-*`, `og-*`, or other `serverRegistered` ability may appear.

The store can populate later, so poll until the frontend inventory stabilizes. A
second read after several seconds must return the same set.

## Custom UI tests

Use Playwright for tests that combine tool calls with the editor or page UI.
After login, open the intended editor URL directly, wait for the block tree to
settle, and then fetch tools.

Destructive calls show the plugin confirmation modal. Playwright clicks are trusted
browser events and can approve it:

```js
const resultPromise = executeTool('webmcp.save-post', {});
await page.click('[data-webmcp-confirm-accept]');
const result = await resultPromise;
```

A trusted automation click proves the action path, not human intent. Test the decline
path separately. Also test cancellation with an `AbortController`: record whether
the browser forwards a callback signal, require modal cleanup when it does, and
clean up the orphaned modal explicitly when it cancels only the outer invocation.

## Required regression coverage

- frontend provenance filter;
- write and destructive exposure gates;
- registration promise rejection without an unhandled rejection;
- late frontend registration without duplicates;
- `title`, schema, `readOnlyHint`, and `untrustedContentHint` mapping;
- structured tool results;
- Dashboard and post-editor context;
- insert/read/undo without persistence;
- save decline and approve;
- navigation followed by rediscovery;
- no request to `/wp-abilities/v1/abilities`.

## Gotchas

- Standard `executeTool` is specified to receive an input object. Detect and cache
  transitional string-input behavior with a read-only probe before executing a
  requested tool. The Chrome 149 testing fallback receives a JSON string.
- Tool handles are document-bound; fetch again after navigation or reload.
- Block `clientId` values change after an editor reparse; read immediately before
  targeted mutations.
- `src/adapter.js` is served raw. Reload after edits or bump the plugin version.
- Which tools appear depends on the two exposure settings.

## Cleanup

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh down
npx wp-env stop
```
