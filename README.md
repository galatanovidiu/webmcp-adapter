# WebMCP Adapter

> **This is an experiment.** It is a proof of concept, not a production plugin. It
> targets a draft browser API (WebMCP) that is still changing, and it exposes WordPress
> administration to an in-browser AI agent. Run it only on a local or throwaway site.
> Do not use it on a production WordPress install.

A WordPress plugin that bridges the WordPress core **Abilities API** to the browser's
**WebMCP API** (`document.modelContext` / `navigator.modelContext`). It turns registered
WordPress abilities into structured tools that an in-tab AI agent (for example, Chrome's
built-in agent) can discover and call.

## What it does

WordPress 7.0 ships the Abilities API in core: a single, machine-readable registry of
site capabilities (`wp_register_ability()`). WebMCP is a proposed Chrome standard that
lets a web page offer tools to a browser-side AI agent, scoped to the current tab.

This plugin connects the two. On every wp-admin page it:

1. Reads the abilities the site has registered.
2. Registers each one as a WebMCP tool.
3. Lets the in-tab agent call those tools to read site data and (when explicitly enabled)
   make changes.

The result: an AI agent running inside the browser tab can answer questions about the
site and perform admin actions through the same capabilities WordPress already exposes —
without a separate server-side protocol.

## How it works

The layers, server to browser:

| Layer | What it is |
|---|---|
| Abilities API (PHP, core) | The registry. Source of truth for site capabilities. |
| REST `/wp-abilities/v1/` | Abilities over HTTP. |
| `@wordpress/abilities` (JS, core) | Client store: `getAbilities`, `executeAbility`, `store`. |
| `@wordpress/core-abilities` (JS, core) | Fetches server abilities over REST into the client store. |
| **WebMCP Adapter (this plugin)** | Bridges the client store → WebMCP `modelContext`. |

The adapter enqueues one script module on wp-admin pages
([src/adapter.js](src/adapter.js)). It:

1. Feature-detects `document.modelContext || navigator.modelContext`. Chrome 149 exposes
   `navigator.modelContext`; `document.modelContext` lands in Chrome 150.
2. Reads abilities from the client store and registers each as a WebMCP tool.
3. **Subscribes** to the store and registers any ability it has not seen yet. (The store
   loads asynchronously with no resolver, so `await getAbilities()` returns an empty cache
   on first paint. Subscribing is the only correct pattern — this was the bug that made
   the first version register zero tools.)

Ability → WebMCP tool field mapping:

| Ability field | WebMCP tool field |
|---|---|
| `name` (`namespace/name`) | `name` (`namespace-name`, `/` is not allowed) |
| `description` (fallback `label`) | `description` |
| `input_schema` | `inputSchema` (JSON Schema, passes through as-is) |
| `meta.annotations.readonly` | `annotations.readOnlyHint` |
| `executeAbility(name, params)` | `execute(params)` |

## Safety model

Exposing admin actions to an AI agent is dangerous by default, so writes are gated
behind several layers. Read-only abilities always expose. Everything else is OFF until an
administrator turns it on.

- **Three exposure settings** (all default OFF, `manage_options` only):
  - `webmcp_enable_write_tools` — non-destructive writes.
  - `webmcp_enable_destructive_tools` — destructive writes (require the write setting too).
  - `webmcp_enable_dangerous_tools` — the dangerous tier (require all three settings).
- **Per-ability dangerous opt-in.** Dangerous tools (plugin/theme install, update, delete,
  option updates, privacy export) must each be individually opted in, on top of the three
  settings.
- **In-page confirmation.** Destructive and dangerous tool calls pop a confirmation modal
  the human must approve. The accept click is gated on `event.isTrusted`, so the in-page
  agent cannot synthetically self-approve. (A click injected over the Chrome DevTools
  Protocol is trusted and out of scope — a CDP-controlled browser already owns the
  session.)
- **Capability is the hard guard.** Every ability still runs its WordPress
  `permission_callback`. The settings and the modal are extra gates, not the authorization
  boundary.

## Activity log and review

Every agent tool call — reads, writes, and the outcome (`ran` / `failed` / `declined`) —
is logged two ways:

- A persistent, collapsible **in-page panel** (bottom-right) shows recent actions live,
  attributes each to the agent, and links writes to the relevant wp-admin screen.
- Activity is **persisted server-side** in a custom table so it survives navigation. A
  **Tools → Agent activity** admin screen lists past sessions and the actions in each run.
  Parameters are redacted before storage and retention is capped.

## Requirements

- WordPress 7.0 or later (for the Abilities API in core).
- PHP 8.1 or later.
- A browser that exposes the WebMCP API (Chrome 149+ for `navigator.modelContext`).

## Install

1. Copy this folder to `wp-content/plugins/webmcp-adapter`.
2. Activate **WebMCP Adapter** in wp-admin.
3. The abilities a site exposes depend on what is registered with the Abilities API. A
   companion plugin can register a catalog of wp-admin abilities; without it, only core
   abilities (such as `core/get-site-info`) are available.
4. To allow writes, enable the exposure settings (see Safety model). Leave them off for a
   read-only setup.

## Status

Proof of concept. Reads, writes, the destructive tier, and the dangerous tier have been
verified end-to-end in Chrome 149. The WebMCP API is a draft and may change; field names
and feature detection are expected to need updates as it evolves.

## License

GPL-2.0-or-later.
