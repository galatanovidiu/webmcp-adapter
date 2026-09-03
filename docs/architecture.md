# Architecture: page-scoped WordPress Site tools

This plugin projects WordPress client Abilities into the imperative WebMCP API for
ChatGPT Work and Codex in the ChatGPT desktop app's built-in browser. It keeps page
logic in Ability providers and protocol logic in one document-bound adapter.

## Boundary

WordPress 7.0's `@wordpress/abilities` module owns the browser-side registry. The
adapter projects only records whose annotations satisfy both conditions:

- `clientRegistered === true`;
- `serverRegistered !== true`.

It never imports `@wordpress/core-abilities`, fetches
`/wp-abilities/v1/abilities`, or projects REST-backed Abilities. Server operations
belong on REST or a server-side MCP adapter.

Each provider owns its Ability names, category, labels, schemas, annotations,
permission checks, callbacks, page-selection predicates, and live-state guards.
The adapter owns WebMCP projection, lifecycle synchronization, risk policy,
confirmation, activity presentation, observability transport, and diagnostics.

## Page composition

The bridge and base providers load on normal top-level frontend and wp-admin
documents. Additional providers load only where their callbacks are meaningful.

| Document | Providers | Tool count |
|---|---|---:|
| Anonymous frontend | page context, site destinations | 2 |
| Authenticated frontend | frontend providers plus admin destinations | 3 |
| Generic wp-admin | page context, admin destinations | 2 |
| General Settings | wp-admin base plus form staging | 3 |
| Compatible block editor | wp-admin base plus editor provider | 17 |
| Site Editor shell | wp-admin base plus editor provider | 17 |
| Authentication screen | none | 0 |

Frontend loading explicitly enqueues the classic `wp-data` and `wp-i18n`
dependencies used by WordPress 7.0's built `@wordpress/abilities` module. Themes
must print the normal `wp_head` and `wp_footer` hooks.

Post-type selection is delegated to `WP_Screen::is_block_editor()`. The adapter
does not maintain a post-type list. Callbacks still require the expected
`core/editor` and `core/block-editor` stores at execution time.

The Site Editor keeps its provider set for the lifetime of the top-level shell.
Route changes can make an individual callback inapplicable, so callbacks check the
live route and stores rather than trusting discovery-time state.

Login, password-reset, registration, and two-factor documents receive no adapter
assets and no activity UI.

## Provider loading

[`includes/Plugin.php`](../includes/Plugin.php) registers versioned Script Modules
and enqueues providers through normal WordPress hooks:

- `wp_enqueue_scripts` for frontend documents;
- `admin_enqueue_scripts` for wp-admin documents;
- screen predicates for General Settings and compatible block editors.

[`src/adapter.js`](../src/adapter.js) imports no Ability provider. Provider module
presence is the page-selection contract. Third-party plugins use the same model;
see [provider-extension.md](provider-extension.md).

## Projection and lifecycle

The adapter reads the current Ability store, subscribes to changes, and delegates
the diff to [`src/ability-synchronizer.js`](../src/ability-synchronizer.js).

For each qualifying Ability, the synchronizer keeps:

- the WordPress Ability name;
- the projected WebMCP name;
- a definition fingerprint;
- registration promise state; and
- a registration-scoped `AbortController`.

It waits for `registerTool()` to resolve before treating a tool as active. A
rejected registration is reported and remains retryable. Removing an Ability
aborts its WebMCP registration. A changed same-name definition removes the earlier
registration before adding the replacement and emits a diagnostic because client
rediscovery timing is unspecified.

WordPress Ability names use `namespace/name`; WebMCP names use
`namespace.name`. WordPress Ability segments cannot contain dots, so replacing
slashes with dots is injective and reversible. The synchronizer detects both
Ability-name and projected-name collisions before registration.

## Descriptor mapping

| Ability field | WebMCP field | Rule |
|---|---|---|
| `name` | `name` | `/` becomes `.` |
| `label` | `title` | Preserved |
| `description` | `description` | Risk notice added only where required |
| `input_schema` | `inputSchema` | Empty/list shapes normalized |
| `annotations.readonly` | `annotations.readOnlyHint` | Preserved |
| frontend callback | `execute(params, { signal })` | Structured result returned directly |

Every definition sets `untrustedContentHint: true` because site, editor, and
third-party content can be user-authored.

## Destination and page-context providers

`webmcp.get-page-context` returns a minimal normalized object: surface, URL, page
type, object type and ID, screen ID, post type, taxonomy, and authentication state.
It excludes usernames, roles, broad capability maps, private metadata, page
content, and sensitive authentication query parameters.

`webmcp.list-site-destinations` reads visible semantic navigation landmarks.
`webmcp.list-admin-destinations` reads the authenticated frontend admin toolbar or
the full rendered wp-admin menu. Both providers:

- return labels, sections, stable-in-contract IDs, normalized URLs, and
  `sameOrigin`;
- preserve first-rendered order;
- deduplicate identical normalized URLs; and
- reject placeholders, credentials, external origins/protocols, authentication
  links, nonce-bearing URLs, and consequential action links.

The result URL is the navigation authority. After normal browser navigation, the
agent discovers the destination document's inventory.

## Editor provider

The editor provider owns six reads, eight reversible unsaved writes, and
`webmcp.save-post`.

Reads describe the editor, return the live block tree, discover block contracts,
theme tokens, patterns, and templates. Writes insert, update, move, replace, and
remove blocks; insert patterns; edit supported post attributes; and undo or redo.
`webmcp.edit-post-attributes` rejects `status`.

`webmcp.save-post` persists staged state and owns an explicit publish transition.
The block API remains generic over recursive
`{ name, attributes, innerBlocks }` specs.

Every callback re-reads mutable Gutenberg state before acting. In particular:

- block `clientId` values are transient;
- nested style updates are deep-merged before one batch dispatch;
- writes verify observed state because locks and `allowedBlocks` can refuse
  mutations without throwing;
- asynchronous selectors are awaited; and
- unsupported transforms return available alternatives.

## General Settings provider

`wordpress.settings.stage-general-form` is loaded only on
`options-general.php`. Its closed schema accepts supported fields only and requires
at least one property. Live select/radio options are the authority for enumerated
values.

The callback validates the complete request before mutation, updates only provided
visible controls through native setters and normal `input`/`change` events,
verifies the visible result, highlights changed controls, and adds a review notice.
It never submits the form or emits a persistence request. Feedback is cleared on
submit, reset, reload, or form replacement.

Administration Email is sensitive. Only its field identifier and the manual-save
warning may leave the callback; the address never enters result text, visible
feedback, observability, or exporter data.

## Risk and confirmation

Readonly Abilities derive `read` risk. Every mutation declares exactly one value at
`meta.webmcp.risk`: `reversible`, `persistent`, `consequential`, or `privileged`.
Missing or invalid mutation risk fails closed.

Consequential and privileged invocations use
[`src/confirmation.js`](../src/confirmation.js). The open-shadow-root dialog shows
provider, action, page context, risk, and a bounded recursively redacted summary.
Approval requires an `event.isTrusted` click. Decline, Escape, 60-second expiry,
forwarded callback cancellation, and the final pre-execution signal/context check
all stop the Ability before it acts.

The built-in browser's invocation review is a separate product layer. Neither
layer replaces the provider's authorization and validation.

## Activity UI

[`src/activity.js`](../src/activity.js) mounts one isolated control on every
eligible page. The default view is a fixed 48-pixel button with a count badge. The
detail region opens only on request and records `running`, `ran`, `failed`,
`declined`, `expired`, `cancelled`, and `stale` states.

The control supports Enter, Space, Escape, focus restoration, a named region,
polite announcements, responsive layout, and per-tab open/minimized state in
`sessionStorage`. Dynamic text uses `textContent`; activity links accept only
same-origin HTTP(S) URLs. Presentation failure cannot change an Ability result.

## Backend observability

After an invocation settles, [`src/activity-observability.js`](../src/activity-observability.js)
sends one fire-and-forget event to `/webmcp/v1/activity`. The server owns timestamp,
provider, risk, page context, path normalization, actor identity, and validation.

Stored fields are limited to event/run identifiers, normalized time, Ability/tool,
provider, risk, surface/context/path, hashed anonymous actor or WordPress user ID,
outcome, duration, confirmation outcome, bounded error code, and an optional
allowlisted safe summary. Raw inputs, outputs, page content, arbitrary errors, IP
addresses, and login-session tokens are excluded.

Authenticated ingestion requires a REST nonce and signed page-context token.
Anonymous ingestion uses a short-lived signed token, hashed run/actor identifiers,
a 4 KB request bound, and fixed-window token/run/network rate limits whose keys do
not contain raw identifiers or IP addresses.

Retention is seven days and 10,000 rows by default, enforced after insert and by a
daily scheduled job. These filters customize bounded behavior:

- `webmcp_activity_token_ttl_seconds`;
- `webmcp_activity_anonymous_rate_limit`;
- `webmcp_activity_rate_window_seconds`;
- `webmcp_activity_retention_days`;
- `webmcp_activity_retention_rows`;
- `webmcp_activity_ability_definitions`; and
- `webmcp_activity_should_export`.

After storage, `webmcp_activity_stored` receives only the normalized event and row
ID. Administrators review normalized and explicitly labeled legacy rows under
**Tools → Site tools activity**. The review never renders legacy session tokens.

## Data lifecycle

Schema migration is additive. It preserves existing rows and retired option values
for rollback compatibility, adds nullable normalized columns, and leaves legacy raw
columns empty for new writes. Deactivation clears only the daily retention event.
WordPress uninstall drops the activity table and removes plugin options, retention
scheduling, and temporary anonymous rate-limit counters.

## Client constraints and verification

ChatGPT Work and Codex discover imperative registrations from the top-level
document. They currently do not discover declarative form tools or iframe tools.
Registrations and handles are document-bound; navigation or reload requires fresh
discovery. Same-document refresh timing and callback cancellation forwarding are
not guaranteed, so providers retain live guards and confirmation retains expiry.

Primary acceptance uses Codex in the built-in browser. Current system Chrome runs
the deterministic page-side suites through
`document.modelContext.getTools()` and `document.modelContext.executeTool()`. The
harness detects JSON-string versus object input once with a harmless read and keeps
the Chrome 149 testing surface only as a fallback. See
[development.md](development.md).
