# Page-scoped WebMCP implementation plan

Status: approved product contract; implementation has not started.

Audience: future primary sessions and delegated implementation/review agents working
in this repository.

This plan turns the decisions from the page-scoping research and grilling session
into ordered implementation work. It is not documentation of released behavior.
The research evidence remains in
[`docs/page-scoped-webmcp-tools-research.md`](../../../docs/page-scoped-webmcp-tools-research.md).

## Outcome

Load a small WebMCP adapter on every eligible top-level WordPress frontend and
wp-admin document. Project only the WordPress client Abilities that the current
page's providers register. Keep the bridge protocol-specific and let WordPress core,
this plugin, and third-party plugins own their page logic and Ability definitions.

The first version must:

- expose only the tools applicable to the current document;
- support one Ability on one page or the same Ability on several pages without
  changing the bridge;
- keep server-registered Abilities out of the page catalog;
- expose every applicable first-version Ability without enable/disable settings;
- let the normal browser navigate to URLs returned by discovery tools;
- stage the General Settings form without submitting it;
- keep the existing Gutenberg editor functionality on compatible editor screens;
- show minimized agent activity on frontend and wp-admin pages;
- record redacted observability for every invocation on the backend; and
- give third-party providers a documented WordPress-native extension contract.

## Accepted product contract

These decisions are settled. Reopen them with the user before implementing a
different behavior.

### Page inventories

| Page context                                                | Required Site tools                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Anonymous frontend                                          | `webmcp.get-page-context`, `webmcp.list-site-destinations`          |
| Logged-in frontend                                          | Frontend tools plus `webmcp.list-admin-destinations`                |
| Generic wp-admin                                            | `webmcp.get-page-context`, `webmcp.list-admin-destinations`         |
| General Settings                                            | Generic wp-admin tools plus `wordpress.settings.stage-general-form` |
| Post/page/compatible CPT block editor                       | Generic wp-admin tools plus the 15 editor tools                     |
| Site Editor                                                 | Generic wp-admin tools plus the same 15 editor tools                |
| Login, password reset, registration, and two-factor screens | No Site tools and no activity UI                                    |

The activity icon is UI, not a Site tool.

The 15 editor tools are the current editor set minus `webmcp/navigate`:

- Reads: `editor-context`, `read-blocks`, `list-block-types`,
  `get-theme-design-tokens`, `list-patterns`, and `list-templates`.
- Reversible, unsaved writes: `insert-blocks`, `update-block-attributes`,
  `insert-pattern`, `remove-blocks`, `move-blocks`, `replace-blocks`,
  `edit-post-attributes`, and `undo`.
- Consequential persistence: `save-post`.

After the collision-safe name conversion, their WebMCP names use dots at Ability
segment boundaries, for example `webmcp.editor-context`.

### Navigation and discovery

- Do not register a navigation-execution tool. The built-in browser can open a URL
  directly and can click ordinary links.
- `list-site-destinations` reads visible semantic navigation landmarks from the
  rendered page. It excludes empty `#` placeholders, action URLs, login/logout
  links, and arbitrary links in page content.
- `list-admin-destinations` reads only navigation WordPress rendered for the
  current user: the admin toolbar on an authenticated frontend page and the full
  admin menu inside wp-admin.
- Destination results contain stable labels and URLs. The agent uses normal browser
  navigation to open a result.
- Do not maintain a second hard-coded registry of admin URLs.

### Provider ownership and page selection

- `src/adapter.js` becomes a pure WordPress Ability-to-WebMCP bridge. It does not
  import a built-in Ability barrel.
- Provider plugins conditionally enqueue ordinary WordPress script modules on the
  pages they own. Those modules register WordPress client Abilities through
  `@wordpress/abilities`.
- A shared Ability is the same module enqueued in more than one page context.
- Page selection is module presence, not `meta.webmcp.contexts`.
- Every callback independently revalidates its live DOM, route, application state,
  and authorization before acting.
- Gutenberg providers use `WP_Screen::is_block_editor()` as the server-side gate,
  then require the expected `core/editor` and `core/block-editor` stores at call
  time. Do not hard-code post types.
- The Site Editor keeps a stable tool set for the lifetime of its top-level shell.
  Route-specific callbacks reject when the live route is not applicable.
- Direct third-party `document.modelContext.registerTool()` calls are outside this
  adapter's supported contract.

### Provenance, naming, and lifecycle

- Project only records with `meta.annotations.clientRegistered === true`.
- Exclude every record with `meta.annotations.serverRegistered === true`.
- Do not import `@wordpress/core-abilities` or request the server Ability catalog.
- Convert `/` in WordPress Ability names to `.` in WebMCP names. WordPress Ability
  segments cannot contain dots, so the mapping is injective and reversible.
- Detect both WordPress Ability-name collisions and WebMCP-name collisions before
  registration and report them as diagnostics.
- Keep an `AbortController` and definition fingerprint for every WebMCP
  registration. Diff the WordPress store and abort registrations when their
  Abilities disappear.
- Same-name hot replacement is not a critical path. If a definition changes in the
  same document, remove the old registration before registering the replacement and
  record a diagnostic because client rediscovery timing is unspecified.

### Risk and confirmation

Providers classify non-read Abilities under `meta.webmcp.risk`:

- `reversible`: temporary UI, form, editor, or visitor-session state;
- `persistent`: saved site or account data;
- `consequential`: publishing, purchases, messages, refunds, or deletion; and
- `privileged`: roles, permissions, plugins, themes, or executable code.

`meta.annotations.readonly === true` maps to `read` without a separate risk value.
A non-read Ability with missing or invalid risk metadata fails closed and produces a
diagnostic. WordPress's standard `readonly`, `destructive`, and `idempotent`
annotations remain accurate.

There are no exposure settings. Every correctly declared Ability applicable to the
current page is exposed. Consequential and privileged calls always use the in-page
confirmation flow. The confirmation:

- shows provider, action, page context, and a redacted action summary;
- provides Approve and Decline actions;
- requires a trusted click;
- expires after 60 seconds;
- closes when invocation cancellation is forwarded;
- revalidates context immediately before execution; and
- has no automated-confirmation bypass.

This is a supervision layer, not proof that a privileged browser automation client
is human.

### Forms

- Each eligible physical form with one Save/Submit control gets one explicitly
  authored, page-scoped staging Ability.
- Do not automatically convert arbitrary DOM forms and do not register a generic
  form-submission tool.
- A form Ability exposes only its supported fields, with descriptions, through its
  input schema. It does not expose hidden action/nonce fields, submit controls,
  disabled or read-only fields, password/payment/authentication secrets, file/media
  pickers, or controls that persist automatically when changed.
- Form staging makes no network request. It updates canonical client state when an
  application provides one; otherwise it updates real DOM controls and dispatches
  their normal `input` and `change` events.
- It verifies the visible values after staging, highlights changed controls, and
  adds a form notice telling the user to review and save manually.
- It never invokes or emulates form submission. The product contract is “the agent
  stages; the user reviews and saves.” The page cannot prove that a privileged
  browser automation client is human, so do not describe this as a hard human-only
  boundary.

The first version implements only the General Settings form on
`options-general.php`.

### Activity and observability

- Show the activity UI on every eligible frontend and wp-admin page.
- Default to a small fixed icon. A subtle badge/count indicates new activity. The
  UI never opens automatically.
- Clicking the icon opens the detailed list; closing it returns to the icon.
- Remember minimized/expanded state in `sessionStorage` for the current tab.
- Show `running` immediately, then update the entry to its final outcome.
- Do not render the UI on authentication screens.

Send one non-blocking backend event for every completed invocation attempt. Outcomes
include at least `ran`, `failed`, `declined`, `expired`, `cancelled`, and `stale`.
Observability failure never changes the Ability result.

Store only:

- server timestamp plus event and run identifiers;
- Ability, projected tool name, provider, risk, page surface/context, and normalized
  URL/path;
- logged-in user ID or a hash of an anonymous session ID;
- outcome, duration, confirmation outcome, and a bounded safe error code; and
- an optional provider-supplied safe summary accepted by a strict allowlist.

Do not store raw inputs, raw outputs, page content, credentials, payment data,
personal data, IP addresses, raw login-session tokens, or arbitrary error messages.

The adapter owns a hardened ingestion endpoint and a bounded default store. After a
validated/redacted event is stored, the server fires a documented WordPress action
for external exporters. The full cross-session review screen remains administrator
only. Anonymous ingestion uses a short-lived page-issued token, payload limits, and
rate limiting; the token is an anti-abuse mechanism, not authentication.

Default retention is seven days and 10,000 events, whichever limit is reached
first. Code-level filters may alter retention or export behavior; there is no
settings UI.

### Scope exclusions

- No login/reset/registration/two-factor Site tools or activity UI.
- No Classic Editor, Customizer, Widgets, or other legacy-interface provider in this
  version.
- No WooCommerce production tools in this repository. A small fixture provider
  proves the extension contract.
- No new Site Editor-specific tools yet.
- No page-specific Dashboard, list-table, Media, Comments, Users, Plugins, Themes,
  or other Settings tools beyond the shared inventory.
- No navigation-execution Ability.

## Public contracts

### Ability metadata

Read example:

```js
meta: {
	annotations: {
		readonly: true,
		idempotent: true,
	},
}
```

Mutation example:

```js
meta: {
	annotations: {
		readonly: false,
		destructive: false,
		idempotent: false,
	},
	webmcp: {
		risk: 'reversible',
	},
}
```

Do not place adapter-specific keys in `meta.annotations`; WordPress filters unknown
annotation keys. WordPress automatically adds `clientRegistered` to normal client
Ability registrations.

### Destination result

Both destination tools return the same compact shape:

```json
{
  "destinations": [
    {
      "id": "settings-discussion",
      "label": "Discussion",
      "section": "Settings",
      "url": "http://localhost:8888/wp-admin/options-discussion.php",
      "sameOrigin": true
    }
  ]
}
```

IDs are stable only within their provider contract. URLs are the navigation
authority for the current result. De-duplicate identical normalized URLs while
preserving the first rendered order.

### Page-context result

`webmcp/get-page-context` becomes `webmcp.get-page-context` and returns a minimal
cross-surface object:

```json
{
  "surface": "frontend",
  "url": "https://example.test/sample-page/",
  "pageType": "singular",
  "objectType": "page",
  "objectId": 42,
  "screenId": null,
  "postType": "page",
  "taxonomy": null,
  "authenticated": true
}
```

Do not include usernames, roles, the full capability map, private object metadata,
or page content.

### General Settings staging Ability

Ability name: `wordpress/settings/stage-general-form`.

Supported optional inputs:

- `siteTitle`: string;
- `tagline`: string;
- `administrationEmail`: valid email, treated as sensitive;
- `membership`: boolean;
- `defaultRole`: string validated against the form's live options;
- `siteLanguage`: string validated against the form's live options;
- `timezone`: string validated against the form's live options;
- `dateFormat`: string matching a preset or the custom-format control;
- `timeFormat`: string matching a preset or the custom-format control; and
- `weekStartsOn`: integer from 0 through 6.

Use `minProperties: 1` and `additionalProperties: false`. Exclude the Site Icon
picker and disabled WordPress/Site Address fields.

Result shape:

```json
{
  "staged": true,
  "changedFields": ["siteTitle", "timezone"],
  "unchangedFields": [],
  "validationErrors": [],
  "requiresUserSave": true,
  "saveControlLabel": "Save Changes"
}
```

For `administrationEmail`, return only the field name and a warning that WordPress
will require email confirmation after manual save. Never echo the address.

## Target code layout

The exact split may adjust to existing module constraints, but ownership must remain
as follows:

| Target                                                 | Responsibility                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `includes/Plugin.php`                                  | Register global hooks, context-specific provider modules, module data, and required classic dependencies.                 |
| `includes/PageContext.php`                             | Build the minimal server-side public/admin context supplied to the page-context provider and observability.               |
| `includes/ActivityMigrator.php`                        | Add the observability event columns/indexes and retention migration without dropping existing rows.                       |
| `includes/ActivityRepository.php`                      | Insert, query, and prune validated event records.                                                                         |
| `includes/ActivityRestController.php`                  | Authenticated and anonymous ingestion plus administrator reads.                                                           |
| `includes/ActivityToken.php`                           | Issue and validate short-lived anonymous ingestion tokens.                                                                |
| `includes/ActivityRateLimiter.php`                     | Bound anonymous ingestion without persisting raw IP addresses.                                                            |
| `includes/ActivityScreen.php`                          | Administrator cross-session review UI for the new event fields.                                                           |
| `src/adapter.js`                                       | Pure filtering, collision checks, registration diff, execution policy, confirmation integration, and observability hooks. |
| `src/activity.js`                                      | Minimized/expanded activity UI and in-tab redacted session history.                                                       |
| `src/confirmation.js`                                  | Mandatory consequential/privileged confirmation; no demo bypass.                                                          |
| `src/abilities/category.js`                            | First-party Ability category registration.                                                                                |
| `src/abilities/page-context.js`                        | `webmcp/get-page-context`.                                                                                                |
| `src/abilities/list-site-destinations.js`              | Rendered public navigation discovery.                                                                                     |
| `src/abilities/list-admin-destinations.js`             | Admin toolbar/admin menu discovery.                                                                                       |
| `src/abilities/editor/index.js`                        | Editor provider entry point for the existing editor Abilities.                                                            |
| `src/abilities/forms/general-settings.js`              | `wordpress/settings/stage-general-form` and its visible review feedback.                                                  |
| `tests/fixtures/webmcp-provider/`                      | Disposable third-party provider plugin used only by acceptance tests.                                                     |
| `tools/verify-page-scoping.mjs`                        | Exact inventory, navigation, provider, and lifecycle matrix.                                                              |
| `tools/verify-general-form.mjs`                        | Form staging/no-submit/no-network verification.                                                                           |
| `.agents/skills/webmcp-playwright/verify-frontend.mjs` | Updated editor and activity end-to-end coverage.                                                                          |

Because this repository serves raw modules without a build step, register first-party
modules under versioned WordPress script-module IDs. Avoid new relative imports whose
child URLs lack the plugin-version cache key. Where shared code must be imported,
register it as a script module and use its import-map ID.

On public pages, explicitly enqueue the classic `wp-data` and `wp-i18n` dependencies
required by WordPress 7.0's built `@wordpress/abilities` module. Do not assume a
theme already loaded them. Themes must still provide the normal `wp_head` and
`wp_footer` hooks for script modules to print.

## Database and upgrade behavior

Use an additive migration of the existing `{$wpdb->prefix}webmcp_activity` table.
Do not drop existing activity rows during activation or upgrade.

The new schema must not retain raw WordPress login-session tokens. Add nullable
columns for new event data so existing rows remain readable, then stop writing the
legacy raw token field. A later cleanup migration may remove obsolete columns after
rollback compatibility is no longer needed.

Remove the Settings -> WebMCP page and stop loading `includes/Settings.php`. Ignore
the three legacy option values during normal execution. Do not delete them on
upgrade. Update `uninstall.php` to delete those options when WordPress uninstalls the
plugin.

The `/` to `.` projected-name change is intentionally breaking. Update every driver,
test, screenshot workflow, README example, and internal document in the same release.
Do not retain duplicate dash aliases because they recreate catalog size and collision
problems.

## Implementation batches

Each batch should be independently reviewable and leave the supported runtime green.
Do not commit or push without explicit user approval. Before each session, inspect
the live worktree because it already contains unrelated user changes.

### Batch 0 - Characterize and protect the current behavior

Goal: establish failing tests for the agreed contract before restructuring modules.

Work:

1. Extend the browser driver so a test can open an arbitrary frontend/admin URL and
   report tool names without assuming `webmcp-editor-context` exists everywhere.
2. Add page-inventory assertions for the current Dashboard, General Settings, post
   editor, Site Editor, anonymous frontend, and authenticated frontend.
3. Add pure tests for injective Ability-name conversion and risk classification.
4. Capture the current editor behavior as regression coverage before moving files.

Exit criteria:

- Tests demonstrate the old global admin inventory and fail on the new agreed
  counts for the expected reasons.
- Existing editor action semantics remain characterized.

### Batch 1 - Make the bridge provider-independent

Goal: a pure bridge that projects arbitrary WordPress client Abilities correctly.

Work:

1. Remove the built-in Ability barrel import from `src/adapter.js`.
2. Replace slash-to-dash conversion with slash-to-dot conversion.
3. Add deterministic collision detection and diagnostics.
4. Validate `meta.webmcp.risk` for non-read Abilities.
5. Replace `registered`/`pending` sets with a registration map containing Ability
   fingerprint, projected name, promise state, and `AbortController`.
6. Diff removals and safe same-name replacements.
7. Preserve input normalization, structured results, cancellation checks, and
   exclusion of `serverRegistered` records.

Exit criteria:

- A fixture Ability registered before or after bridge initialization is projected.
- Removing it aborts the WebMCP registration.
- Colliding names do not produce an ambiguous tool.
- No server Ability request occurs.

### Batch 2 - Load the adapter and providers by page

Goal: global eligible-page coverage with exact provider ownership.

Work:

1. Enqueue the bridge from both `wp_enqueue_scripts` and
   `admin_enqueue_scripts`.
2. Add explicit public classic dependencies for `@wordpress/abilities`.
3. Add `PageContext` and module data for the minimal context contract.
4. Register/enqueue the page-context provider on every eligible document.
5. Register/enqueue site destinations only on frontend pages.
6. Register/enqueue admin destinations on authenticated frontend and wp-admin
   pages.
7. Exclude `wp-login.php` and related authentication documents.

Exit criteria:

- Anonymous frontend: exactly two tools.
- Logged-in frontend: exactly three tools.
- Generic wp-admin: exactly two tools.
- Public pages load without depending on admin-only globals.

### Batch 3 - Implement destination discovery

Goal: structured, rendered-truth navigation without a navigation executor.

Work:

1. Implement visible semantic public-navigation extraction and URL normalization.
2. Implement admin-toolbar extraction on the frontend.
3. Implement full admin-menu extraction in wp-admin.
4. Exclude action, nonce, login/logout, empty, and duplicate destinations.
5. Preserve rendered order and section labels.
6. Delete `src/abilities/navigate.js` and update all references.

Exit criteria:

- Results include plugin-added rendered navigation automatically.
- The browser can open a returned URL directly with no WebMCP navigation call.
- No destination callback changes page or server state.

### Batch 4 - Scope and migrate the editor provider

Goal: retain all editor behavior while removing it from unrelated admin pages.

Work:

1. Move/register the existing editor Abilities as a block-editor provider module.
2. Add `reversible` risk metadata to all eight unsaved writes.
3. Classify `save-post` as `consequential`.
4. Enqueue the provider only when `WP_Screen::is_block_editor()` is true.
5. Preserve live `core/editor` and `core/block-editor` guards.
6. Remove all exposure settings and the automated-confirmation bypass.
7. Update tool names and descriptions to the dot projection and always-available
   contract.

Exit criteria:

- Generic admin inventory remains two tools.
- Post, page, compatible CPT, and Site Editor inventories are exactly 17 tools.
- All existing editor flows pass with no setting changes.
- `save-post` always confirms; unsaved writes do not.

### Batch 5 - Add the General Settings staging provider

Goal: prove one-form/one-Ability supervised staging.

Work:

1. Define the exact input schema and live option validation.
2. Update only provided controls through native value setters and events.
3. Handle preset/custom date and time formats without submitting.
4. Treat Administration Email as sensitive in results, UI, and observability.
5. Add per-field highlights and the form-level review/save notice.
6. Clear feedback after save, reset, reload, or form replacement.
7. Observe network traffic during the callback and fail the test if staging emits a
   request.

Exit criteria:

- General Settings exposes exactly three tools.
- Partial calls stage and verify only named fields.
- WordPress option values remain unchanged until a human submits the form.
- Reload discards staged changes.

### Batch 6 - Generalize activity UI and confirmation

Goal: visible, unobtrusive agent activity on every eligible page.

Work:

1. Extract activity presentation from the bridge.
2. Replace the expanded-by-default wp-admin panel with the minimized icon.
3. Add running/final states, count badge, expansion, keyboard operation,
   `aria-live`, safe text rendering, and `sessionStorage` state.
4. Mount on frontend and wp-admin pages without inheriting or disturbing theme
   styles.
5. Generalize confirmation from the old destructive flag to consequential and
   privileged risk classes.
6. Remove the demo bypass and preserve expiry/cancellation behavior.

Exit criteria:

- All outcomes display without blocking or changing Ability results.
- The icon is the only default-visible UI.
- Confirmation cannot be bypassed by the removed plugin setting.
- Accessibility and untrusted-content rendering checks pass.

### Batch 7 - Build backend observability

Goal: bounded, redacted event ingestion for logged-in and anonymous calls.

Work:

1. Add the schema migration and stop persisting raw login-session tokens.
2. Define one normalized server-owned event DTO/array shape.
3. Implement logged-in nonce-authenticated ingestion.
4. Implement short-lived anonymous ingestion tokens, payload limits, and rate
   limiting without storing IP addresses.
5. Redact/allowlist every field server-side; never trust client risk, outcome,
   timestamp, or safe-summary claims without validation.
6. Record duration and final outcome asynchronously after execution settles.
7. Fire a documented WordPress exporter action after successful storage.
8. Enforce seven-day/10,000-row pruning.
9. Update the administrator review screen for new fields and legacy rows.

Exit criteria:

- Read, reversible, failed, cancelled, declined, expired, and stale calls all
  produce bounded events.
- Anonymous spam controls work and cannot grow the table beyond the cap.
- Sensitive General Settings inputs never reach storage or exporter hooks.
- Observability failure never changes tool execution.

### Batch 8 - Prove third-party extension

Goal: demonstrate the public provider contract without WooCommerce coupling.

Work:

1. Add a disposable fixture plugin with its own Ability category and script
   modules.
2. Register one Ability on one page and one shared across two pages.
3. Register a read and a reversible Ability with precise schemas.
4. Exercise late registration and unregistration.
5. Verify unrelated pages never receive fixture tools.
6. Document the minimal provider recipe using normal WordPress enqueue hooks.

Exit criteria:

- The adapter source contains no fixture/provider names.
- The fixture works through only `@wordpress/abilities` and normal WordPress hooks.
- Page navigation produces the exact expected inventories.

### Batch 9 - Acceptance, cleanup, and documentation

Goal: close every agreed behavior with live evidence.

Work:

1. Run Node unit tests and repository formatting.
2. Run the full system-Chrome page matrix against the disposable WordPress 7.0
   environment.
3. Run primary acceptance in ChatGPT Work or Codex's built-in browser.
4. Verify Dashboard, General Settings, post editor, page editor, compatible CPT,
   Site Editor, anonymous frontend, authenticated frontend, and fixture pages.
5. Verify direct navigation to a returned URL without a navigation Ability.
6. Verify exact tool counts, confirmation paths, activity UI, observability,
   retention, and redaction.
7. Remove the settings page/class wiring and update uninstall cleanup.
8. Update README, architecture, development, WebMCP reference, learning guide,
   agent skills, and CLI examples together.
9. Rebuild the plugin zip only if the user asks for a release artifact.

Exit criteria:

- The complete agreed acceptance matrix passes.
- No documentation describes the old dash names, global admin catalog, exposure
  toggles, expanded activity panel, or navigation Ability.
- No unrelated working-tree changes were overwritten.

## Verification matrix

| Scenario                     | Expected evidence                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Anonymous home/singular page | Two exact tools; minimized activity icon; no admin destination leakage.                     |
| Authenticated singular page  | Three exact tools; admin-toolbar destinations; no full synthetic admin registry.            |
| Dashboard/unrelated admin    | Two exact tools; admin-menu destinations; no editor or form tools.                          |
| General Settings             | Three exact tools; partial staging; highlights; no request; no submit; manual-save notice.  |
| Post/page editor             | Seventeen exact tools; read, unsaved write, undo, decline save, approve save.               |
| Compatible CPT editor        | Same editor provider selected without a post-type allowlist.                                |
| Site Editor                  | Stable 17-tool inventory across in-shell routes; stale calls reject clearly.                |
| Full navigation/reload       | Old document registrations disappear; new page inventory is rediscovered.                   |
| Ability removal              | Registration signal aborts; stale execution rejects safely.                                 |
| Fixture plugin               | Page-specific and shared tools appear only in declared contexts.                            |
| Observability                | Every final outcome recorded; redaction, rate limit, retention, and exporter hook verified. |
| Authentication screens       | No adapter, Ability, activity UI, or observability assets.                                  |

Treat the repository's WordPress 7.0 environment as the compatibility target. The
currently running `localhost:8888` site reported WordPress 7.1 during the grilling
session and displayed an unrelated plugin-assets warning, so it is useful for a
smoke test but is not the sole acceptance environment.

## Multi-session and subagent protocol

- Start every session by reading this plan and `handoff.md`, then inspect
  `git status --short` and the relevant live source.
- Work on one batch or one explicitly bounded part of a batch at a time.
- Update `handoff.md` after verified progress, before ending a session.
- Use subagents only for independent tasks with non-overlapping file ownership,
  such as test-fixture work, backend observability review, or browser-matrix
  verification.
- The primary agent owns integration, adversarial review, and the final decision
  that a batch meets its exit criteria.
- Do not let two agents edit `src/adapter.js`, `includes/Plugin.php`, or the same
  migration/test driver concurrently.
- Preserve all pre-existing modified and untracked files.
- Commits and pushes remain separate user approval gates.

## Completion rule

The project is complete only when every batch exit criterion and every row of the
verification matrix has current evidence. A passing unit test alone is not enough;
page inventory, browser behavior, visible staging, confirmation, and observability
must be verified in the live WordPress/browser path.
