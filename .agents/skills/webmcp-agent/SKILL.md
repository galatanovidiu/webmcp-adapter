---
name: webmcp-agent
description: Act as the stand-in WebMCP client for this WordPress demo. FIRST explain to the user how the demo works and why a terminal agent (Claude Code / Codex) plays the browser AI client that does not exist yet — then discover the page's WebMCP tools in Chrome and call them. Use when the user asks to drive, test, demo, or use the WebMCP tools/abilities in the browser, run a wp-admin action through WebMCP, or says "/webmcp".
---

# WebMCP agent

You (Claude Code, or Codex — any terminal coding agent) are the WebMCP **client** in this
demo. The plugin registers WordPress abilities as WebMCP tools on wp-admin pages; this skill
drives Chrome over the DevTools Protocol to discover and run those tools, then reasons over
the results.

Background: [architecture](../../../docs/architecture.md),
[development](../../../docs/development.md).

## First: orient the user (do this BEFORE launching anything)

The whole point of this skill is a demo, and it only makes sense once the user understands
the setup. So the **first thing you do** — before any Chrome launch or tool call — is explain
it, in plain language, in your own words. Cover these three points:

1. **What WebMCP is.** A proposed browser standard: a web page publishes "tools" (actions) to
   an AI agent running *inside the same tab*, via `document.modelContext` /
   `navigator.modelContext` (Chrome 149+, behind a flag). Think of MCP, but the *page* is the
   server and a *browser-native AI agent* is meant to be the client. This plugin turns every
   registered WordPress ability into one such tool on wp-admin — "list posts", "insert a
   block", "update a setting", and so on.

2. **Why a terminal agent (Claude Code / Codex) is the client here.** No shipping browser has
   a built-in AI agent that consumes WebMCP yet — so in a real product there is nothing to
   actually *call* these tools today. To bridge that, the same Chrome flag also exposes a
   testing hook (`navigator.modelContextTesting`, with `listTools()` / `executeTool()`). A
   terminal agent connects to Chrome over the DevTools Protocol and uses that hook to list and
   run the tools. **So Claude Code / Codex is standing in for the future in-browser WebMCP
   client** — reasoning about the request, picking tools, calling them in the live page,
   reading the JSON back. This lets us build and test the entire tool surface — schemas, the
   write-gating, the confirmation modal — end to end *now*. When a real in-browser WebMCP
   client ships, it consumes these exact same tools with no CDP and no terminal agent.

3. **What they can do through this connection.** See the next section; relay the gist.

Keep it short — a few sentences per point, not a lecture. Then proceed.

## What you can do through this connection

Every registered ability becomes one tool. Because this runs on a **disposable local demo
site**, enable *all* tiers — there is no real data to protect. (The plugin ships with writes
off; that is its secure default for real sites, not a limit that matters here.)

- **Reads — always on** (~64 today: site/settings/content/users/media/comments info, plus the
  editor reads). Safe to call freely.
- **Writes — turn them on.** Enable from the settings screen
  (`/wp-admin/options-general.php?page=webmcp-adapter`), or with `ENABLE_WRITES=1` in the
  Playground skill. This unlocks the live Gutenberg editor set: insert / update / move / replace
  blocks, insert patterns, edit post attributes, undo.
- **Destructive** (`save-post` / publish) and **dangerous** (plugin/theme install, option
  writes) — turn these on too: destructive has its own toggle; dangerous needs its toggle *plus*
  a per-ability opt-in. Both still pop an in-page confirmation before running — this skill's
  driver opens a **visible** Chrome, so approve by clicking **Confirm** in that window. A
  declined action returns `{cancelled:true}`, not an error.

Do not assume the list — run `list` and read each tool's `description` + `inputSchema`. New
abilities appear automatically; no adapter change needed.

### Authoring pages/posts: use THIS adapter's front-end editor tools

For creating or editing a page (or post), use this adapter's own **front-end abilities** — the
`webmcp/*` set in [`src/abilities/`](../../../src/abilities) that drive the *live Gutenberg
editor* through `window.wp.data`. A fast, low-round-trip flow:

1. **Open the editor via setup**, not navigate:
   `setup "/wp-admin/post-new.php?post_type=post"` (or `?post_type=page`). One command lands you
   in the editor with tools ready.
2. **Pull the design contract once** — `webmcp-get-theme-design-tokens` (color / spacing / font
   slugs), `webmcp-list-block-types` (the ONLY valid attribute keys per block), and
   `webmcp-list-patterns` (ready-made sections). Trust these; do **not** read the plugin source to
   learn schemas, and do **not** assume standard Gutenberg attributes (see Gotchas).
3. **Compose in as few writes as possible.** `webmcp-insert-blocks` takes a whole recursive
   `blocks` tree — build the entire body in ONE call when you know the layout (or a `batch` of
   inserts + `edit-post-attributes`). `webmcp-insert-pattern` drops a designed section;
   `update` / `move` / `replace` / `remove` tune it.
4. `webmcp-edit-post-attributes` — title, excerpt, and other sidebar fields (never `status`).
5. `webmcp-save-post` — persist (destructive tier: pops the in-page confirmation; save as a draft
   first, publish only when asked).
6. `screenshot "<permalink>&preview=true" out.png` — see the rendered result and confirm it looks
   right (the tab leaves the editor, so `setup` again if you keep editing).

**Do NOT use the catalog's server-side content tools for authoring** — `content-create-page`,
`content-create-post`, `content-update-post`, and the rest of `content/*`. They write straight
to the database over REST and never touch the browser editor, so they do *not* exercise the
WebMCP front-end tools this demo exists to prove. (They are fine for read-only lookups like
`content-list-pages`.)

Why: the whole point here is the real, in-browser WebMCP front-end abilities. Building a page by
driving the live editor is what shows the WebMCP tool surface working end to end.

## Prerequisites

A WordPress site must be running with both plugins active. Easiest: `npx wp-env start` from the
repo root (→ http://localhost:8888, `admin` / `password`). No-Docker alternative: the
[webmcp-playground](../webmcp-playground/SKILL.md) skill. See [development.md](../../../docs/development.md).

## Paths and config

Run from the **repo root**. The CLI lives at:

```bash
WEBMCP="tools/webmcp.mjs"
```

Config is via env, all with defaults — set them to match your site. For the wp-env default:

```bash
export WP_URL=http://localhost:8888 WP_USER=admin WP_PASS=password
```

Other knobs: `CDP_PORT` (9222), `CHROME_BIN` (auto-detected per OS), `CHROME_PROFILE` (a
throwaway dir under the system temp). The CLI's own defaults are `:8080` / `admin` / `admin`,
so with wp-env you MUST set the three above.

## Quick start

```bash
node "$WEBMCP" setup                       # launch Chrome if needed, log in, open wp-admin, wait for tools
node "$WEBMCP" setup "/wp-admin/post-new.php?post_type=post"  # ...or land straight in an editor, tools ready
node "$WEBMCP" list                        # discover tools + schemas
node "$WEBMCP" call <name> '<json>'        # execute a tool with inline JSON args
node "$WEBMCP" call <name> @args.json      # ...or read args from a file (no shell-escaping pain)
node "$WEBMCP" batch @build.json           # run [{name,args},…] in ONE session (a whole page build)
node "$WEBMCP" screenshot "<url>" out.png  # full-page PNG — verify the rendered result
```

`batch` takes a JSON array like `[{"name":"webmcp-insert-blocks","args":{"blocks":[…]}},{"name":"webmcp-edit-post-attributes","args":{"title":"…"}}]`
(`args` may be an object or a JSON string). One CDP connection for all of them — far
faster than N separate `call`s. Keep `webmcp-navigate` and `webmcp-save-post` OUT of a
batch: navigate reloads the page mid-batch, and save pops the confirmation modal you
want to time yourself.

## Workflow

1. **Orient the user** (the section above) — the first thing, always.
2. **Preflight the WP server.** `curl -s -o /dev/null -w "%{http_code}" "$WP_URL/"` should be
   `200`/`302`. If not, start wp-env (or the Playground skill) first.
3. **`setup [adminPath]`** — launches the debug Chrome with the WebMCP flag (if the CDP port is
   down), logs in, loads the given wp-admin URL (default `/wp-admin/`), and waits for the async
   ability store to populate. Confirm the returned `tools` array is non-empty. **To author, pass
   the editor URL** — `setup "/wp-admin/post-new.php?post_type=post"` — and you land in the editor
   with all tools (including the `webmcp/*` editor set) ready; no separate navigate + wait.
4. **`list`** — read each tool's `name`, `description`, and `inputSchema`.
5. **Reason and act** — pick the tool(s) that satisfy the request, build args that fit the
   schema, run `call`, read the JSON result. Destructive/dangerous calls need the human to
   confirm in the page.
6. **Synthesize** — answer the user from the structured results, not the DOM.

## Gotchas

- `call` args must be a JSON **string** matching the tool's `inputSchema`. `{}` is fine when
  nothing is required. A call that returns the generic *"invocation failed"* is usually a schema
  rejection — most often a wrong/extra arg name (`inputSchema` has `additionalProperties:false`).
  Re-check the arg names against `list` (e.g. `read-blocks` takes `rootClientId`, not `clientId`).
- `list` / `call` / `batch` act on **whatever page the debug tab currently shows** — they do NOT
  navigate. Only `setup` moves the tab (it forces the wp-admin URL). So do **not** run `setup`
  after `webmcp-navigate` — it throws you back to the dashboard. To enter an editor with tools
  ready, pass the URL to `setup`. After a mid-session `webmcp-navigate`, just keep using
  `list` / `call` on the new page (give the async store a moment to populate).
- **Build block specs only from `webmcp-list-block-types`** — attribute keys it does not list are
  silently dropped on serialize, and this theme does not always match "standard" Gutenberg. Notably
  both `core/heading` and `core/paragraph` center via `align:"center"` (there is **no** `textAlign`
  on heading here). `webmcp-get-theme-design-tokens` gives the on-brand color / spacing / font slugs.
- `webmcp-insert-blocks` builds via `createBlock`, so its output is **valid by construction** — no
  post-insert validity re-read needed. Only `webmcp-insert-pattern` parses markup and can yield
  broken blocks; it reports any as `invalidBlocks` in its result.
- The WP login is a session cookie; it clears when Chrome restarts. `setup` re-logs in.
- Only the debug Chrome (the `CDP_PORT`) is reachable, not the user's normal Chrome.
- After editing `adapter.js`, reload with cache disabled or bump `WEBMCP_ADAPTER_VERSION`.
- If `setup` reports Chrome did not open the port, set `CHROME_BIN` to the browser path.
