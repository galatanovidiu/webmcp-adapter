# Architecture — frontend abilities to WebMCP

This plugin exposes the live WordPress editor to browser AI agents without turning
the page into a second backend API.

## Boundary

WordPress 7.0's `@wordpress/abilities` module provides one client-side registry.
Abilities in that registry carry provenance annotations:

- `clientRegistered: true` — browser-owned callbacks.
- `serverRegistered: true` — REST-backed callbacks loaded from PHP abilities.

The adapter projects only abilities marked `clientRegistered: true` and rejects
any record also marked `serverRegistered: true`. It does not import
`@wordpress/core-abilities`, fetch `/wp-abilities/v1/abilities`, or expose backend
catalog abilities.

That boundary is deliberate:

- frontend tools operate on the open tab and live editor state;
- server operations belong on REST or a server-side MCP adapter;
- in local Codex acceptance testing, projecting the backend catalog produced 121
  tools and the page configuration was rejected; OpenAI publishes no numeric limit;
- editor writes remain visible and reversible before persistence.

If another plugin loads server abilities into the shared client store, the provenance
check still excludes them.

## Runtime path

The plugin enqueues [`src/adapter.js`](../src/adapter.js) as a script module on the
top-level wp-admin document. The module:

1. Imports `@wordpress/abilities`.
2. Imports [`src/abilities/index.js`](../src/abilities/index.js), which registers
   this plugin's frontend category and abilities.
3. Feature-detects `document.modelContext`, with `navigator.modelContext` as the
   Chrome 149 fallback.
4. Reads the ability store, filters by provenance and the exposure gates, and calls
   `registerTool()`.
5. Subscribes to the store for frontend abilities registered later.

The subscription remains important even though this plugin's own imports are ready
before the adapter body runs. Other frontend modules may register abilities after
initial paint. Registration is tracked as pending until its promise resolves; failures
are reported and remain retryable on a later store update.

Ability → WebMCP mapping:

| Ability field | WebMCP field | Note |
|---|---|---|
| `name` | `name` | `/` becomes `-` |
| `label` | `title` | Human-readable browser UI label |
| `description` | `description` | Destructive tools receive a confirmation notice |
| `input_schema` | `inputSchema` | Empty/list-shaped schemas are normalized |
| `annotations.readonly` | `annotations.readOnlyHint` | |
| frontend callback | `execute(params, { signal })` | Structured results are returned directly |

Every registered definition sets `untrustedContentHint` to true because editor titles, content, patterns, and
other site data can contain user-authored text.

## Codex Site tools contract

Codex discovers imperative WebMCP tools from the top-level document in the ChatGPT
desktop app's built-in browser. It currently does not discover declarative form tools
or tools registered inside iframes.

The adapter therefore registers on the wp-admin shell. The Site Editor canvas can
remain in an iframe because the tools and `window.wp.data` stores used by the adapter
live in the top-level application.

Registrations are document-bound. A navigation or reload invalidates old tool handles;
the agent must discover the new document's tools.

The frontend-only inventory is intentionally small:

- 7 tools with default read-only settings;
- 15 when non-destructive editor writes are enabled;
- 16 when the separately gated `save-post` tool is also enabled.

## Frontend editor abilities

The callbacks read and write Gutenberg data stores through `window.wp.data` and
`window.wp.blocks` at call time. Changes land in the editor the user is watching.
They do not silently update the database.

Read tools:

- `editor-context` describes the open document, save state, permalink, undo state,
  and the user's current block/text selection.
- `read-blocks` returns the live block tree and targeting `clientId` values.
- `list-block-types` returns the installed block schemas and design supports.
- `get-theme-design-tokens` returns theme presets.
- `list-patterns` returns available block patterns.
- `list-templates` returns templates and template parts with edit URLs.
- `navigate` moves the current tab to a same-origin location.

Write tools:

- `insert-blocks`
- `update-block-attributes`
- `insert-pattern`
- `remove-blocks`
- `move-blocks`
- `replace-blocks`
- `edit-post-attributes`
- `undo`

These stage unsaved changes and form the editor's reversible working set.
`edit-post-attributes` rejects `status` so a non-destructive call cannot arm a later
save into publishing.

`save-post` is the one destructive-tier tool. It persists the staged editor state,
and its optional `status` argument owns the explicit publish flow.

The set is generic over block types. WordPress blocks share the recursive
`{ name, attributes, innerBlocks }` shape, so the adapter discovers block contracts
at runtime instead of registering one WebMCP tool per block.

## Editor implementation constraints

Shared guards and block-spec helpers live in
[`src/abilities/store.js`](../src/abilities/store.js).

Important runtime details:

- Block `clientId` values change when the editor reparses content. Read immediately
  before a targeted update, move, replace, or removal.
- `updateBlockAttributes` shallow-merges. The ability deep-merges nested style
  patches and dispatches a batch once so one call is one undo step.
- Block-editor mutation actions can fail silently under template locks, block locks,
  or `allowedBlocks`. Every write re-reads state and reports the observed outcome.
- Patterns and templates use asynchronous selectors.
- Theme preset containers vary across WordPress versions; the token tool normalizes
  the supported shapes.
- `switchToBlockType` can return no transform; the replace tool reports available
  alternatives instead of pretending it succeeded.
- Media upload and library management are not part of this frontend-only adapter.

## Exposure and confirmation

Two default-off settings control mutation:

| Setting | Effect |
|---|---|
| `webmcp_enable_write_tools` | Exposes the eight unsaved editor write tools |
| `webmcp_enable_destructive_tools` | With writes enabled, exposes `save-post` |

The adapter reads these flags once from script-module data. Missing or invalid values
fail closed.

Every `save-post` call opens an in-page confirmation that shows the tool and exact
arguments. The default accept path requires `event.isTrusted`, which blocks synthetic
clicks dispatched by page script. A privileged browser automation channel can produce
trusted clicks and is outside that page-level defense.

A default-off demo setting can intentionally relax the trusted-click requirement. A
persistent admin warning and modal marker remain visible while it is enabled.

When a browser supplies the WebMCP callback signal, it is observed before
confirmation, during a pending modal, and immediately before the ability callback.
Cancellation then removes the modal and prevents a late confirmation from executing
an abandoned call. Current clients may cancel the outer invocation without forwarding
that signal; the page cannot infer an undisclosed cancellation.
Pending confirmation dialogs also expire to a safe decline after 60 seconds, so an
outer cancellation that is not forwarded cannot leave an indefinitely actionable modal.

The ChatGPT built-in browser also performs its own safety review. That product review,
the plugin's exposure gates, and the in-page confirmation are separate layers.

## Frontend security boundary

A frontend callback has no independent server-side capability check. It may only do
what the current page can already do and must validate its current editor context
before mutating it.

This is why the adapter no longer projects REST-backed abilities. Backend authorization
belongs at the backend operation, not in a generic page bridge.

## Activity

Every completed, failed, declined, or expired tool call appears in an in-page activity panel.
The adapter also sends an audit-only record to `/webmcp/v1/activity`. Server recording
is fire-and-forget and cannot alter the tool result. Parameters are redacted before
storage, retention is bounded, and administrators can review runs under
**Tools → Agent activity**.

## Verification

The primary acceptance test uses Codex's built-in browser against a direct localhost
wp-admin page. System Chrome drivers exercise the standard
`document.modelContext.getTools()/executeTool(tool, inputObject)` path. They detect
the input shape once with a harmless read for transitional builds, while the older
JSON-string `modelContextTesting` hook remains a compatibility fallback.

See [development.md](development.md) for the exact checks.
