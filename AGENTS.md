# AGENTS.md — webmcp-adapter

## Project goal

Build WordPress Site tools specifically for ChatGPT Work and Codex in the ChatGPT
desktop app's built-in browser. Expose frontend editor abilities through the
imperative WebMCP API (`document.modelContext`). The adapter is tab-bound and
frontend-only: project `clientRegistered` abilities and exclude every
`serverRegistered` ability, including records loaded by another plugin. It is not a
generic MCP bridge or backend ability catalog.

## Read first

- [docs/architecture.md](docs/architecture.md) — runtime boundary, editor tools,
  gating, confirmation, and cancellation.
- [docs/development.md](docs/development.md) — ChatGPT Work/Codex, Playground,
  wp-env, and system Chrome verification.
- [docs/webmcp-reference.md](docs/webmcp-reference.md) — current API and client
  differences.
- [docs/webmcp-learning-guide.md](docs/webmcp-learning-guide.md) — current ChatGPT
  Work and Codex Site tools product boundary.
- `.hyper/memory/` and `.hyper/loops/` — local gitignored build history.

## Runtime contract

- `src/abilities/` owns 16 frontend abilities: 7 reads, 8 unsaved editor writes,
  and the destructive `save-post` persistence tool.
- Use one block-agnostic API over `{ name, attributes, innerBlocks }`. Do not add
  one ability per block type.
- `edit-post-attributes` must reject `status`; `save-post` owns the explicit
  save/publish flow.
- Import `@wordpress/abilities`, not `@wordpress/core-abilities`. Never fetch or
  project the server ability catalog.
- Filter every store record by `meta.annotations.clientRegistered === true` and
  `meta.annotations.serverRegistered !== true`, even when the store was populated
  elsewhere.
- Subscribe to the store for late frontend registrations. Treat
  `registerTool()` as asynchronous and mark a tool registered only after it
  resolves.
- Map ability labels to WebMCP `title`, preserve input schemas, return structured
  results directly, and mark outputs as potentially untrusted content.
- When the browser supplies a callback cancellation signal, observe it before
  confirmation, while the modal is pending, and immediately before execution.

## Safety

- Read tools are always exposed.
- Non-destructive editor writes require `webmcp_enable_write_tools`.
- `save-post` also requires `webmcp_enable_destructive_tools` and the in-page
  confirmation.
- The confirmation requires an `event.isTrusted` click unless the explicit
  default-off demo bypass is enabled.
- Frontend callbacks must re-check the current editor context before mutating it.
- Activity recording is audit-only and must never change the tool result.

## Client constraints

- Prefer `document.modelContext`; keep `navigator.modelContext` only as the
  Chrome 149 fallback.
- ChatGPT Work and Codex Site tools discover imperative registrations from the
  top-level document.
  They do not currently discover declarative form tools or iframe registrations.
- Register in the top-level wp-admin shell, including for the Site Editor.
- Tools are document-bound. Rediscover after navigation or reload.
- The acceptance target is ChatGPT Work or Codex in the ChatGPT desktop app's
  built-in browser. System Chrome drivers use the standard
  `getTools()/executeTool(tool, inputObject)` API; the JSON-string
  `modelContextTesting` form is a legacy fallback.

## Verification

- Default inventory: exactly 7 frontend tools.
- Writes enabled: exactly 15 frontend tools.
- Writes plus destructive enabled: exactly 16 frontend tools.
- Assert every exposed name starts with `webmcp-` and no request is made to
  `/wp-abilities/v1/abilities`.
- Exercise Dashboard, post editor, Site Editor, navigation/rediscovery, unsaved
  insert/read/undo, destructive decline/approve, registration rejection, and the
  browser's callback-signal behavior.
- `src/adapter.js` is served raw; there is no build step.
