# Page-scoped WebMCP handoff

Last updated: 3 September 2026.

## Current status

- Research complete:
  [`docs/page-scoped-webmcp-tools-research.md`](../../../docs/page-scoped-webmcp-tools-research.md).
- Grilling complete; the user confirmed shared understanding.
- Implementation plan approved as the next artifact:
  [`implementation-plan.md`](implementation-plan.md).
- Batch 0 merged through pull request #9.
- Batch 1 merged through pull request #10.
- Batch 2 merged through pull request #11.
- Batch 3 is complete on `feat/rendered-destinations`; editor gate removal has not
  started.
- The user authorized uninterrupted implementation, verification, pull requests,
  and merges through the remaining approved batches.

## Live evidence from the grilling session

- In the Codex in-app browser, the ordinary browser opened the public Sample Page
  without any WebMCP tool.
- After the user signed in, ordinary browser controls navigated Dashboard -> Pages
  -> Plugins.
- Direct browser navigation to
  `http://localhost:8888/wp-admin/options-discussion.php` opened Discussion
  Settings without a navigation tool.
- The authenticated public Sample Page exposed the WordPress admin toolbar with
  Dashboard/Edit Site/New/Edit Page actions.
- The General Settings DOM exposed its labeled controls and Save Changes action,
  supporting the one-form/one-staging-Ability design.
- The live `localhost:8888` runtime reported WordPress 7.1 and displayed an
  unrelated plugin-assets warning. Use the repository's disposable WordPress 7.0
  setup for canonical acceptance.

## Agreed first-version inventory

| Context                | Tool count |
| ---------------------- | ---------: |
| Anonymous frontend     |          2 |
| Logged-in frontend     |          3 |
| Generic wp-admin       |          2 |
| General Settings       |          3 |
| Block editor           |         17 |
| Site Editor            |         17 |
| Authentication screens |          0 |

There is no navigation-execution tool. Destination Abilities return URLs and the
normal browser opens them.

## Next action

Deliver and merge Batch 3, then start Batch 4 from updated trunk. Batch 4 owns the
always-exposed editor provider, settings removal, and consequential save policy.

## Session update: Batch 0

Date: 3 September 2026.

Batch and scope: Batch 0 only: characterize and protect the current runtime before
page-scoped restructuring.

Completed:

- Extended the system-Chrome driver with same-origin `--url` targeting and an
  `--anonymous` mode. Listing arbitrary pages no longer executes or depends on
  `webmcp-editor-context`; call-mode input-shape detection selects a read-only tool
  whose schema requires no arguments.
- Added pure, runtime-independent contracts and tests for slash-to-dot Ability-name
  projection, reverse conversion, and fail-closed risk classification.
- Added a six-page system-Chrome matrix with separate current-baseline and agreed
  contract modes. Each navigation verifies that it reached the requested path.
- Added the pre-existing approved research and implementation plan to the task
  branch unchanged so this handoff's owning links resolve in the pull request.
- Kept `src/adapter.js`, the built-in Ability registrations, exposure settings, and
  all editor callbacks unchanged.

Files changed:

- `.agents/skills/webmcp-playwright/driver.mjs`
- `.agents/skills/webmcp-playwright/SKILL.md`
- `src/adapter-contract.js`
- `tools/adapter-contract.test.mjs`
- `tools/verify-page-scoping.mjs`
- `.agents/scratches/page-scoped-webmcp/handoff.md`
- `.agents/scratches/page-scoped-webmcp/implementation-plan.md` (pre-existing,
  added unchanged)
- `docs/page-scoped-webmcp-tools-research.md` (pre-existing, added unchanged)

Verification performed:

- `npm test`: 11 passed, 0 failed.
- Driver against disposable WordPress 7.0: listed the exact seven current tools on
  General Settings, executed structured `webmcp-editor-context` on Dashboard through
  an absolute URL, reached authenticated and anonymous frontend URLs and reported
  their current zero-tool state, rejected a cross-origin URL, and rejected a missing
  `--url` value.
- `node tools/verify-page-scoping.mjs --expect=current`: passed. Dashboard, General
  Settings, post editor, and Site Editor shared the exact seven-tool current catalog;
  authenticated and anonymous frontend pages exposed zero tools.
- `node tools/verify-page-scoping.mjs --expect=agreed`: failed as intended. The exact
  2/3/17/17/3/2 page inventories were red on all six rows, with missing and
  unexpected names reported.
- `.agents/skills/webmcp-playwright/verify-frontend.mjs`: 83 passed, 0 failed,
  including 7/15/16 exposure gates, provenance and registration behavior, editor
  reads and writes, undo/redo, confirmation and cancellation, save/publish cleanup,
  and navigation rediscovery.
- JavaScript syntax checks, WordPress Prettier checks for the new source/tests, the
  instruction validator for the updated skill, and `git diff --check` passed.

Open risks or failures:

- The agreed page-scoped matrix is intentionally failing until later batches change
  provider ownership, names, and page loading.
- Canonical wp-env could not bind its configured port because the separate
  `localhost:8888` WordPress 7.1 site was already using it. Live evidence used the
  repository's disposable WordPress 7.0 Playground at `127.0.0.1:9400`; the existing
  site was not stopped or changed.

Exact next action: review and merge Batch 0, then begin Batch 1 in a separately
authorized session by wiring the protected pure contracts into the bridge.

Commit/push status: seven atomic page-scoped planning and Batch 0 commits are on
`test/page-scoped-webmcp-batch-0`. Push and pull-request creation are authorized as
the immediate delivery step; no merge was performed.

## Session update: Batch 1

Date: 3 September 2026.

Batch and scope: provider-independent bridge lifecycle only, while retaining the
legacy all-admin editor provider until its later scoping batch.

Completed:

- Removed the built-in Ability barrel import from `src/adapter.js` and loaded the
  legacy editor provider as a separately enqueued WordPress script module.
- Wired the Batch 0 slash-to-dot projection and risk classifier into a new pure
  Ability synchronizer.
- Added deterministic Ability-name and projected-tool-name collision diagnostics.
- Replaced additive `registered`/`pending` sets with registration records containing
  the definition fingerprint, projected name, promise state, and registration
  `AbortController`.
- Abort removed Abilities, remove before same-name replacement, keep rejected
  registrations retryable, and continue excluding server and mixed-provenance
  records.
- Added explicit `reversible` risk metadata to the eight unsaved editor writes and
  `consequential` to `save-post` so the existing 7/15/16 exposure behavior remains
  available during the bridge migration.
- Updated active test drivers and agent skills to use dot-projected tool names.

Compatibility:

- The projected WebMCP names intentionally change from dash aliases to dot segment
  boundaries. This is the approved breaking surface; no dash aliases remain.
- WordPress Ability names, input/output schemas, callbacks, WordPress annotations,
  and error/result semantics are unchanged. `meta.webmcp.risk` is additive provider
  metadata.

Files changed:

- `includes/Plugin.php`
- `src/adapter.js`
- `src/ability-synchronizer.js`
- `src/abilities/index.js`
- The eight unsaved-write Ability modules and `src/abilities/save-post.js`
- `tools/ability-synchronizer.test.mjs`
- Active WebMCP CLI, Playground, Playwright, page-matrix, and agent-skill files
- `.agents/scratches/page-scoped-webmcp/handoff.md`

Verification performed:

- `npm test`: 18 passed, 0 failed.
- `.agents/skills/webmcp-playwright/verify-frontend.mjs`: 87 passed, 0 failed on
  disposable WordPress 7.0. This covered 7/15/16 inventories, dot-name execution,
  provenance exclusion, late registration, injective projection, live Ability
  removal, contained registration rejection, every existing editor operation,
  confirmation/cancellation, save/publish cleanup, and navigation rediscovery.
- `node tools/verify-page-scoping.mjs --expect=current`: all six current-baseline
  rows passed with dot names.
- `node tools/verify-page-scoping.mjs --expect=agreed`: all six rows remained red as
  expected because page loading, base providers, navigation removal, and editor
  scoping belong to later batches.
- JavaScript and PHP syntax checks, shell syntax, three skill-instruction validators,
  and `git diff --check` passed.
- Current primary WordPress Abilities and WebMCP documentation confirmed client
  unregister support, asynchronous WebMCP registration, registration-scoped abort
  removal, and invocation-scoped cancellation.

Open risks or failures:

- General project docs still describe dash-projected names and the global catalog;
  Batch 9 owns the coordinated public documentation change.
- The PHP Ability/MCP probe harness is not applicable to these browser-only
  JavaScript client Abilities. Runtime evidence comes from the real WordPress client
  store projected through system Chrome's WebMCP implementation.

Exact next action: push and merge Batch 1, then begin Batch 2 by loading the bridge
and base page-context providers on eligible public and admin documents.

Commit/push status: three atomic Batch 1 commits are on
`feat/page-scoped-bridge`, including this handoff update. Push and pull-request
delivery follow immediately; no release was created.

## Session update: Batch 2

Date: 3 September 2026.

Batch and scope: eligible frontend/wp-admin loading plus base page providers. No
destination extraction, editor gate removal, form staging, or activity redesign.

Completed:

- Enqueue the bridge on normal frontend pages and wp-admin, while leaving login and
  other authentication screens asset-free.
- Explicitly enqueue the classic `wp-data` and `wp-i18n` dependencies required by
  WordPress 7.0's public `@wordpress/abilities` module.
- Added `PageContext` and `webmcp/get-page-context` with the minimal surface, URL,
  page/screen, object, taxonomy, post type, and authentication fields. Sensitive
  authentication query parameters are removed from reported URLs.
- Added page-selected `list-site-destinations` and `list-admin-destinations`
  provider shells. Their callbacks intentionally return empty lists until Batch 3.
- Load the legacy editor provider only when `WP_Screen::is_block_editor()` is true,
  eliminating editor tools from Dashboard and unrelated admin pages without
  changing editor callbacks or exposure settings.
- Changed the disposable Playground blueprint to require a real login so anonymous
  and authenticated frontend inventories can be tested independently.

Files changed:

- `includes/Plugin.php`, `includes/PageContext.php`, and `webmcp-adapter.php`
- `src/abilities/category.js`, `src/abilities/index.js`, and the three base provider
  modules
- Playground blueprint/script/skill, Playwright driver skill and editor verifier,
  WebMCP agent skill, and `tools/verify-page-scoping.mjs`
- `.agents/scratches/page-scoped-webmcp/handoff.md`

Verification performed:

- `npm test`: 18 passed, 0 failed.
- `node tools/verify-page-scoping.mjs --expect=batch2`: all seven rows passed on
  disposable WordPress 7.0: Dashboard 2, General Settings 2, post editor 9, Site
  Editor 9, authenticated frontend 3, anonymous frontend 2, authentication screen
  0.
- `.agents/skills/webmcp-playwright/verify-frontend.mjs`: 87 passed, 0 failed,
  preserving every editor operation and the legacy write/destructive gates while
  proving generic-admin scoping and destination-page rediscovery.
- Authenticated and anonymous driver calls to `webmcp.get-page-context` returned the
  same minimal frontend shape with `authenticated: true` and `false` respectively.
- The agreed final matrix now passes Dashboard, authenticated frontend, anonymous
  frontend, and authentication screens. General Settings and both editor rows remain
  red for their later provider work.
- PHP/JavaScript/shell/JSON syntax, skill instruction validators, and
  `git diff --check` passed.

Open risks or failures:

- Destination provider shells return empty lists by design until Batch 3.
- Editor inventories still include `webmcp.navigate` and still depend on the two
  exposure settings; Batches 3 and 4 own those changes.

Exact next action: push and merge Batch 2, then implement rendered public/admin
destination discovery and remove `webmcp/navigate` in Batch 3.

Commit/push status: three atomic Batch 2 commits are on
`feat/page-scoped-base-providers`, including this handoff update. Push and
pull-request delivery follow immediately; no release was created.

## Session update: Batch 3

Date: 3 September 2026.

Batch and scope: rendered destination discovery plus navigation-Ability removal.
No editor exposure-policy, form, activity, or backend observability changes.

Completed:

- Implemented shared destination normalization with stable IDs, same-origin URL
  resolution, first-rendered-order deduplication, and rejection of placeholders,
  credentials, external protocols/origins, authentication screens, nonce-bearing
  links, and consequential action URLs.
- `list-site-destinations` now reads visible semantic navigation landmarks while
  excluding the admin toolbar and arbitrary navigation/content links inside main
  article content.
- `list-admin-destinations` now reads the full rendered wp-admin menu or the
  authenticated frontend admin toolbar, including provider-added entries without a
  synthetic URL registry.
- Added closed output schemas for destination results and page context. Removed the
  unsupported `uri` output format after WordPress 7.0's client validator rejected
  that schema dialect; URL safety remains enforced in code and live tests.
- Deleted `webmcp/navigate`, removed it from every active inventory, and changed
  navigation verification to open a returned URL through the ordinary browser.

Files changed:

- `includes/Plugin.php`
- `src/abilities/destinations.js`, both destination providers,
  `src/abilities/page-context.js`, and `src/abilities/index.js`
- Deleted `src/abilities/navigate.js`
- `tools/destinations.test.mjs` and `tools/verify-destinations.mjs`
- Active Playground, Playwright, CLI, page-matrix, and agent-skill files
- `.agents/scratches/page-scoped-webmcp/handoff.md`

Verification performed:

- `npm test`: 23 passed, 0 failed.
- `node tools/verify-destinations.mjs`: 13 passed, 0 failed on disposable WordPress
  7.0. It proved real wp-admin and toolbar extraction, provider-added navigation,
  exclusion of unsafe/action/auth/hidden/content links, stable result shape,
  ordinary navigation to a returned URL, anonymous admin-destination exclusion,
  and no server Ability-catalog request.
- `.agents/skills/webmcp-playwright/verify-frontend.mjs`: 86 passed, 0 failed,
  preserving every editor operation and verifying ordinary navigation plus
  document rediscovery.
- `node tools/verify-page-scoping.mjs --expect=batch3`: all seven rows passed:
  Dashboard 2, General Settings 2, both editors 8, authenticated frontend 3,
  anonymous frontend 2, authentication screen 0.
- The agreed final matrix now has only General Settings and the two gated editor
  rows red.
- PHP/JavaScript/shell syntax, instruction validators, formatting checks, and
  `git diff --check` passed.

Open risks or failures:

- Editor writes and `save-post` remain behind legacy settings until Batch 4, so the
  two final editor inventory rows are still short of 17 tools.
- General Settings remains at two tools until its staging provider arrives in
  Batch 5.

Exact next action: push and merge Batch 3, then make the block-editor provider
always expose its 15 editor tools and remove the legacy settings/bypass in Batch 4.

Commit/push status: three atomic Batch 3 commits are on
`feat/rendered-destinations`, including this handoff update. Push and pull-request
delivery follow immediately; no release was created.

## Session update template

Update this file after each work session:

```text
Date:
Batch and scope:
Completed:
Files changed:
Verification performed:
Open risks or failures:
Exact next action:
Commit/push status:
```
