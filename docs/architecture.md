# Architecture — Abilities to WebMCP

How `wpwebmcp` exposes WordPress administration to in-browser AI agents, and why it
is built this way. For the WebMCP API itself, see [webmcp-reference.md](webmcp-reference.md).
For setup and testing, see [development.md](development.md).

## The decision: bridge an existing registry, do not build a new one

WordPress 7.0 (released 20 May 2026) ships the **Abilities API** in core. It is the
canonical, machine-readable registry of site capabilities. We do not invent a tool
system. We map that registry to the browser.

The layers, server to browser:

| Layer | What it is | Consumer |
|---|---|---|
| Abilities API (PHP) | Central registry. `wp_register_ability()` on `wp_abilities_api_init` | source of truth |
| REST `/wp-abilities/v1/` | Abilities over HTTP (`/abilities`, `/abilities/{name}/run`) | JS, external clients |
| `@wordpress/abilities` (JS module) | Client store: `getAbilities`, `executeAbility`, `registerAbility`, `store` | browser code |
| `@wordpress/core-abilities` (JS module) | Fetches server abilities over REST, registers them into the client store | browser code |
| MCP Adapter (PHP plugin, separate) | Bridges abilities → MCP protocol | external agents (Claude Desktop, Cursor) |
| **webmcp-adapter (this plugin)** | Bridges the client ability store → WebMCP `modelContext` | in-tab Chrome agent |

The first four are official core. The MCP Adapter covers external agents. Our plugin
fills the remaining gap: the in-browser agent.

The dependency runs one way. This adapter is generic — it exposes whatever abilities are
registered in the client store and does nothing on its own. It therefore **depends on an
abilities source** to have tools worth exposing; the
[abilities-catalog](https://github.com/galatanovidiu/abilities-catalog) plugin provides the
core wp-admin ability set this project is built around. The reverse is not true:
abilities-catalog is a standalone, consumer-agnostic registrar and does not require this
adapter (a server-side MCP consumer, or none, works just as well).

Existing community bridges (`code-atlantic/webmcp-abilities`, the `webmcp-bridge`
plugin) target the deprecated `navigator.modelContext`. We feature-detect
`document.modelContext` first, so we stay correct on Chrome 150+.

## How the adapter works

The plugin enqueues one script module on wp-admin pages
([src/adapter.js](../src/adapter.js)). It depends on
`@wordpress/abilities` and `@wordpress/core-abilities`. The adapter:

1. Feature-detects `document.modelContext || navigator.modelContext`.
2. Reads abilities from the client store and registers each as a WebMCP tool.
3. Subscribes to the store and registers any ability it has not seen yet.

Field mapping, ability → WebMCP tool:

| Ability field | WebMCP tool field | Note |
|---|---|---|
| `name` (`namespace/name`) | `name` (`namespace-name`) | `/` is not allowed in tool names |
| `description` (fallback `label`) | `description` | |
| `input_schema` | `inputSchema` | JSON Schema passes through as-is |
| `meta.annotations.readonly` | `annotations.readOnlyHint` | |
| `executeAbility(name, params)` | `execute(params)` | result stringified for the agent |

### Frontend abilities (client-side, no server)

Abilities come from two sources, both in the **same** client store, so the adapter treats
them identically:

- **Server abilities** — `@wordpress/core-abilities` fetches them over REST; each gets a
  `callback` that POSTs to `/wp-abilities/v1/abilities/{name}/run`. The server enforces the
  `permission_callback` capability there.
- **Frontend abilities** — registered in the browser under [src/abilities/](../src/abilities/)
  via `registerAbility({ ..., callback })`. The `callback` is plain JS that runs in the page;
  `executeAbility` invokes it directly, **no REST**. The adapter picks them up through the
  same subscribe path and applies the same write gate, confirmation modal, and activity log.

`src/abilities/index.js` is the barrel: it imports `category.js` first (registerAbility
rejects an ability whose category is not already registered), then one file per ability.
`adapter.js` imports the barrel once; adding an ability touches only `src/abilities/`.

**Security limit:** a frontend callback runs with the user's session and has **no server-side
capability check** (the client `permissionCallback` is not a trust boundary — page script can
bypass it). So frontend abilities may only do what page JS can already do — navigate, touch
the DOM, call REST the user is already authorized for. `webmcp/navigate` is the first one: it
moves the tab to a same-origin URL and refuses off-site targets.

## The critical gotcha: the store populates asynchronously and imperatively

`@wordpress/core-abilities` fetches `/wp-abilities/v1/abilities` once over REST, then
calls `registerAbility()` for each result. The abilities data store has **no resolver**
for `getAbilities`.

So on first paint the store is empty, and:

- `await getAbilities()` returns the empty cache. It does not wait.
- `wp.data.resolveSelect(store).getAbilities()` also returns empty — there is no
  resolver to await.

The only correct pattern is **subscribe**: read what is present, then
`wp.data.subscribe(sync, store)` and register each new ability as it arrives. This was
the bug that made the first version register zero tools. It is only visible on a cold
page load; a warm store hides it.

## Verified facts (WordPress 7.0 + Chrome 149)

- Three core abilities exist server-side: `core/get-site-info`,
  `core/get-environment-info`, `core/get-user-info`. Only the first two are exposed to
  the client store; `core/get-user-info` is not.
- The adapter registers both exposed abilities as tools and they execute successfully
  (e.g. `core-get-site-info` returns the live site info object).
- Chrome 149 exposes `navigator.modelContext` (live) and `navigator.modelContextTesting`
  (`listTools`, `executeTool`). `document.modelContext` arrives in Chrome 150.

## Write-gating mechanism (how the adapter enforces the catalog's classification)

The abilities-catalog classifies every ability (`readonly`, `destructive`, `idempotent`, and a
`dangerous` marker) and states the *principle* that a consumer must gate writes. This adapter is
that gate for the in-browser agent. WebMCP has no built-in confirmation, and the only standard
tool annotations a browser agent consumes are `readOnlyHint` and `untrustedContentHint` — there
is no agent-consumed "destructive" hint. So write safety is enforced here, in the adapter, as a
layered exposure gate. Capability (`permission_callback`) stays the hard server-side guard
underneath all of it.

**Three default-OFF settings + a per-ability opt-in** ([includes/Settings.php](../includes/Settings.php)):

| Setting / option | Default | Gate it opens |
|---|---|---|
| `webmcp_enable_write_tools` | off | exposes non-destructive write tools |
| `webmcp_enable_destructive_tools` | off | with the write setting, exposes destructive write tools |
| `webmcp_enable_dangerous_tools` | off | with the two above, exposes dangerous (T3) tools |
| `webmcp_dangerous_tools_optin` | empty | per-ability allow-list for dangerous tools (a dangerous tool exposes only if individually opted in) |

Exposure rules the adapter applies when reading the client store (the "Option B" filter — opt-in
write exposure, one policy with no per-domain logic):

- **Read** tools are always exposed (mapped `readonly → readOnlyHint`).
- **Write** tools expose only when `webmcp_enable_write_tools` is on.
- **Destructive** writes expose only when BOTH the write and destructive settings are on, and each
  call shows the in-page confirmation modal (below).
- **Dangerous** (T3) tools expose only when all three settings are on AND the tool is in the
  per-ability opt-in, and each call shows the same modal.

**Gate dangerous tools by NAME, not by annotation.** The `@wordpress/abilities` client store
strips custom annotation keys — it keeps only `readonly`/`destructive`/`idempotent`, so the
adapter cannot read `annotations.dangerous` client-side. Instead the adapter applies a
`webmcp_dangerous_tools` filter server-side
([Settings.php](../includes/Settings.php) → `apply_filters('webmcp_dangerous_tools', [])`); the
abilities-catalog Registry contributes its dangerous ability names into that filter. The adapter
ships the resulting list to the page as `dangerousToolNames`
([Plugin.php](../includes/Plugin.php)), and [src/adapter.js](../src/adapter.js) reads it into
`DANGEROUS_NAMES` and gates each tool by name. The dependency direction holds: the hook is the
adapter's; the catalog optionally populates it. Without the catalog the list is simply empty.

## Confirmation threat model and limits (the destructive/dangerous modal)

Destructive and dangerous tools pop an in-page confirmation modal
(`webmcp-adapter/src/adapter.js` → `confirmDestructive`) before they run. The modal's
accept path is **human-only against the in-page agent by default**, with a deliberate,
default-OFF demo bypass. Be precise about what this guards:

- **Defended by default.** The confirm-accept click is gated on `event.isTrusted`. A
  synthetic, script-dispatched click (`element.click()`, `dispatchEvent`) has
  `isTrusted === false` and is rejected, so the in-page WebMCP agent
  (`navigator.modelContext`) cannot self-approve its own destructive action. The
  Promise that resolves the modal is closure-scoped and unreachable from page script.
- **Relaxed by an explicit human toggle.** The `webmcp_allow_automated_confirmation`
  admin setting (default OFF, `manage_options` only — the agent cannot flip it) drops the
  `isTrusted` check so a script can confirm automatically. This exists for demos /
  proof-of-concept recordings, NOT production. While it is on, a persistent admin notice
  warns the operator and the modal shows an "Automated confirmation enabled" marker; the
  destructive tool descriptions also tell the agent the live mode.
- **NOT defended (out of scope).** A click injected over the Chrome DevTools Protocol
  (`Input.dispatchMouseEvent`) has `isTrusted === true` and passes the gate. A fully
  CDP-controlled or otherwise compromised browser already owns the user's whole session,
  so no in-page channel can stop it; this is accepted, not a regression. The WebMCP
  testing API (`navigator.modelContextTesting`) is a developer affordance and is treated
  the same way — if it confirms via trusted events it is not covered by `isTrusted`.

The hard guards underneath remain capability (`permission_callback`) + the three
default-OFF exposure settings + the per-ability dangerous opt-in. The modal is a
self-approval guard, not the authorization boundary.

**Known follow-up (security risk):** telling the agent the confirmation mode via the tool
description, and relying on the agent to honor it, is advisory only — a non-compliant
agent can ignore it. Accepted for this proof of concept; tracked in the backlog.

## Status and next steps

Current version: **v0.8.0**.

Done (all verified end-to-end in Chrome 149):
- Local WP 7.0 install, Abilities API confirmed, plugin active.
- Read tools registered from the client store, including late arrivals via the subscribe
  path.
- Full write gate: three default-OFF settings (write / destructive / dangerous) plus the
  per-ability dangerous opt-in, gating dangerous tools by name. Write, destructive, and
  dangerous tiers all exercised.
- Confirmation modal for destructive/dangerous calls, gated on `event.isTrusted`, with the
  default-OFF `webmcp_allow_automated_confirmation` demo bypass.
- Activity log: in-page panel plus server-side persistence to `{prefix}webmcp_activity` and
  a **Tools → Agent activity** review screen. `ActivityRedactor` scrubs secrets before
  storage.
- `tools/webmcp.mjs` CLI for driving the registered tools from a script.

Open:
- **Advisory confirmation mode (security risk).** Telling the agent the confirmation mode
  via the tool description and relying on it to comply is advisory only; a non-compliant
  agent, or a click injected over the Chrome DevTools Protocol, bypasses the human-only
  gate. Accepted for this proof of concept; tracked in the backlog.
- Decide front-end (non-admin) exposure. Currently admin-only by design.
- Relationship to the server-side `wp-ai-agent` Tool layer: treat abilities as the one
  registry; do not wire WebMCP to that layer directly.
