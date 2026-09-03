# Develop and verify WordPress Site tools

The acceptance target is ChatGPT Work and Codex Site tools in the ChatGPT desktop
app's built-in browser. Current system Chrome provides deterministic page-side
regression coverage; it does not replace product acceptance.

## Requirements

- WordPress 7.0 or later;
- PHP 8.1 or later;
- Node.js 22 or later;
- current system Chrome for deterministic suites; and
- the latest ChatGPT desktop app with Site tools available for built-in-browser
  acceptance.

Run `npm ci` once before repository checks. The Playwright skill installs its own
library dependency without downloading a browser:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  npm install --prefix .agents/skills/webmcp-playwright
```

## Local WordPress environments

The repository's [`.wp-env.json`](../.wp-env.json) mounts only this plugin and
tracks the WordPress 7.0 branch:

```bash
npx wp-env start
npx wp-env run cli wp core version
npx wp-env run cli wp plugin list --status=active
```

The default site is <http://localhost:8888>; wp-env credentials are
`admin` / `password`.

Use the committed Playground workflow for the exact acceptance version and the
provider fixture:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh test
```

It boots a real-HTTP WordPress 7.0.4/PHP 8.3 process at
<http://127.0.0.1:9400>, mounts the adapter and acceptance fixture before
installation, verifies the runtime version, lists the 17 editor tools, and calls
`webmcp.editor-context`. The SQLite database is disposable.

## Quick deterministic checks

The Playwright driver opens any same-origin page and uses current system Chrome:

```bash
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node .agents/skills/webmcp-playwright/driver.mjs names \
  --url /wp-admin/

WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node .agents/skills/webmcp-playwright/driver.mjs call \
  webmcp.get-page-context '{}' --url /wp-admin/

WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node .agents/skills/webmcp-playwright/driver.mjs names \
  --url / --anonymous
```

The driver prefers `document.modelContext.getTools()` and
`document.modelContext.executeTool(tool, inputObject)`. It detects transitional
string-input behavior once with a harmless readonly no-input tool. Chrome 149's
testing API remains fallback-only.

The raw CDP CLI provides the same primitives in one persistent Chrome profile:

```bash
export WP_URL=http://127.0.0.1:9400 WP_USER=admin WP_PASS=password
node tools/webmcp.mjs setup /wp-admin/
node tools/webmcp.mjs list
node tools/webmcp.mjs call webmcp.get-page-context '{}'
node tools/webmcp.mjs setup '/wp-admin/post-new.php?post_type=page'
node tools/webmcp.mjs call webmcp.editor-context '{}'
```

`tools/webmcp.mjs batch` runs same-page calls only. Use normal browser navigation
between pages, then list the new document's tools.

## Complete deterministic acceptance

Run pure tests and repository formatting first:

```bash
npm test
npm run test:php
npm run format
git diff --check
```

With the WordPress 7.0.4 Playground server running, execute every system-Chrome
suite:

```bash
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-page-scoping.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-destinations.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-general-form.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-activity-ui.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node .agents/skills/webmcp-playwright/verify-frontend.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-observability.mjs
WP_URL=http://127.0.0.1:9400 HEADLESS=1 \
  node tools/verify-provider-fixture.mjs
```

The page-scoping suite covers Dashboard, General Settings, post, page, compatible
custom-post-type and Site editors, a Site Editor in-shell route change, both
fixture pages, authenticated/anonymous home and singular pages, and three
authentication screens. Other suites cover rendered destination navigation,
General Settings staging, minimized activity accessibility, editor operations,
confirmation and cancellation, observability, and provider removal/restoration.

Run the PHP-in-WordPress migration/retention test in its own disposable runtime:

```bash
npx @wp-playground/cli@latest php \
  --wp=https://wordpress.org/wordpress-7.0.4.zip \
  --php=8.3 \
  --blueprint=.agents/skills/webmcp-playground/blueprint.json \
  --mount-before-install="$PWD:/wordpress/wp-content/plugins/webmcp-adapter" \
  --mount-before-install="$PWD/tests/fixtures/webmcp-provider:/wordpress/wp-content/plugins/webmcp-provider" \
  -- /wordpress/wp-content/plugins/webmcp-adapter/tools/verify-observability.php
```

Run uninstall verification last in another fresh disposable process. It
intentionally deletes this plugin's table, options, scheduled event, and rate-limit
transients inside that process:

```bash
npx @wp-playground/cli@latest php \
  --wp=https://wordpress.org/wordpress-7.0.4.zip \
  --php=8.3 \
  --blueprint=.agents/skills/webmcp-playground/blueprint.json \
  --mount-before-install="$PWD:/wordpress/wp-content/plugins/webmcp-adapter" \
  --mount-before-install="$PWD/tests/fixtures/webmcp-provider:/wordpress/wp-content/plugins/webmcp-provider" \
  -- /wordpress/wp-content/plugins/webmcp-adapter/tools/verify-uninstall.php
```

## Built-in-browser acceptance

Open each target directly in Codex's built-in browser, wait for registration to
settle, inspect Site tools, and rediscover after every navigation or reload.

Verify:

1. anonymous home and Sample Page: two exact tools;
2. authenticated home and Sample Page: three exact tools and rendered toolbar
   destinations;
3. Dashboard: two exact tools and a returned admin URL that normal browser
   navigation can open;
4. General Settings: three exact tools, partial staging, visible review feedback,
   reload discard, no persistence, and Administration Email redaction;
5. post, page, and `webmcp_note` editors: 17 exact tools, readonly calls, and an
   unsaved insert/read/undo round trip;
6. Site Editor: 17 exact tools before and after the visible **Pages** in-shell
   route change;
7. the primary and secondary fixture pages: four and three exact tools,
   read/write/reversal, and removal/restoration after the documented settling
   interval;
8. login, password-reset, and registration screens: no Site tools and no plugin
   activity UI; and
9. consequential save decline and approval only in the disposable environment,
   using the normal built-in review and trusted in-page confirmation.

Do not replace a rejected built-in-browser call with a hidden execution path.
Record product safety-review, discovery, and callback-cancellation limitations
exactly as observed.

## What each suite protects

- Provenance filtering and zero server Ability-catalog requests.
- Dot-projected names, collision rejection, registration failure, removal,
  replacement, stale-handle rejection, and late registration.
- Exact page inventories with no post-type list.
- Structured results and accurate `title`, schema, `readOnlyHint`, and
  `untrustedContentHint` mapping.
- General Settings validation, native events, preset/custom formats, feedback
  cleanup, no submission/request/persistence, and sensitive redaction.
- Editor read/write/undo and consequential decline/approval/cancellation/expiry.
- Minimized accessible activity UI, isolated styles, session state, and safe
  untrusted-text rendering.
- Authenticated and anonymous ingestion, payload and rate bounds, exporter hook,
  retention, additive legacy migration, and safe administrator review.
- Upgrade preservation and uninstall-only deletion of retired option values.

## Cleanup

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh down
npx wp-env stop
```

`src/adapter.js` is served raw. There is no build step; reload after a source
change or change the plugin version when preparing a release.
