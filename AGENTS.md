# AGENTS.md — webmcp-adapter

## Project goal

Bridge the WordPress Abilities API to the browser's WebMCP API (`document.modelContext`), exposing
registered abilities as tools to an in-tab AI agent in wp-admin. WebMCP is a proposed Chrome standard
(browser, JS/HTML, tab-bound). This adapter is generic: it exposes whatever abilities are registered.
It **depends on an abilities source** for tools worth exposing — the
[abilities-catalog](https://github.com/galatanovidiu/abilities-catalog) plugin provides the core
wp-admin set. The dependency is one-way (adapter → catalog); the catalog does not require this adapter.

## Docs

- [docs/architecture.md](docs/architecture.md) — the design: Abilities API → WebMCP, the adapter,
  the write-gating mechanism, the confirmation-modal threat model, and the async-store gotcha. Read
  first.
- [docs/development.md](docs/development.md) — local install/run and how to test the adapter in real
  Chrome.
- [docs/webmcp-reference.md](docs/webmcp-reference.md) — WebMCP API reference and version gotchas.
- `.hyper/memory/` and `.hyper/loops/` (local, gitignored) — terse build learnings and L3/L4/L6/L7/L8
  history.

## Current state

- v0.12.0, active. Reads each ability from the client store and registers it as a WebMCP tool;
  subscribes to the store for late arrivals. Reads, writes, and the dangerous tier verified
  end-to-end in Chrome 149.
- **Frontend editor abilities** (`src/abilities/`) drive the live Gutenberg editor via
  `window.wp.data` — post editor AND Site Editor: `navigate`, `editor-context` (incl. the
  human's live selection + document state), and a generic block-CRUD + patterns + document
  set (`read-blocks`, `list-block-types`, `get-theme-design-tokens`, `list-patterns`,
  `list-templates`, `insert-blocks`, `update-block-attributes`, `insert-pattern`,
  `remove-blocks`, `move-blocks`, `replace-blocks`, `edit-post-attributes`, `undo`,
  `save-post`). Generic over all ~109 block types (block = `{name, attributes, innerBlocks}`);
  do NOT add one ability per block. Writes are unsaved editor edits (no DB write) so none are
  destructive-tier — EXCEPT `save-post`, the one persistence gate (`destructive: true`; its
  `status` arg is the publish flow; `edit-post-attributes` deliberately rejects `status` so a
  write-tier call can never arm a publish). Media tools come from the catalog (`og-media/*`),
  not this adapter. Shared guard + spec helpers in `src/abilities/store.js`. See
  docs/architecture.md.
- **Write-gating mechanism** (the adapter enforces the catalog's classification): THREE default-OFF
  settings (`webmcp_enable_write_tools`, `webmcp_enable_destructive_tools`,
  `webmcp_enable_dangerous_tools`) + a per-ability dangerous opt-in (`webmcp_dangerous_tools_optin`).
  Reads always expose; writes need the write setting; destructive need write + destructive + a
  confirmation; dangerous need all three + opt-in + a confirmation. Capability is the hard guard
  underneath. The client store strips custom annotations, so dangerous tools are gated by NAME via a
  server-provided `dangerousToolNames` list (the `webmcp_dangerous_tools` filter). See
  docs/architecture.md.
- **Confirmation modal** — destructive/dangerous calls pop an in-page modal; its accept path is gated
  on `event.isTrusted` (the in-page agent cannot self-approve), with a default-OFF demo bypass.
- **Activity log panel (L7)** + **server-side persistence and review screen (L8)** — every tool call
  is logged in-page and persisted to `{prefix}webmcp_activity`; **Tools → Agent activity** reviews it.

## Key facts to not get wrong

- Feature-detect `document.modelContext || navigator.modelContext`. Chrome 149 exposes
  `navigator.modelContext`; `document.modelContext` lands in Chrome 150.
- The client ability store loads asynchronously and imperatively (no resolver). **Subscribe** to the
  store; do not `await getAbilities()`. See docs/architecture.md.
- WebMCP is browser-side and ephemeral. It is NOT the server-side MCP protocol.
- Treat the Abilities API as the one registry. Do not wire WebMCP to a server-side Tool layer directly.
- Two WebMCP APIs: imperative (`registerTool`) and declarative (HTML `<form>` attributes).
- **No build step** — `src/adapter.js` is served raw.
