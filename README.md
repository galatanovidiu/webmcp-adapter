# WordPress Site Tools for ChatGPT Work and Codex

> **This is an experiment.** It is a proof of concept, not a production plugin. It
> targets a draft browser API and exposes the open WordPress editor to ChatGPT Work
> and Codex through Site tools.
> Run it only on a local or throwaway site.

This WordPress plugin is built specifically for **ChatGPT Work and Codex Site
tools** in the ChatGPT desktop app's built-in browser. It exposes frontend editor
abilities through the imperative WebMCP API (`document.modelContext`) so ChatGPT
Work or Codex can work against the same live, signed-in editor the user sees.

It is not a generic MCP bridge or a backend automation catalog.

The adapter is intentionally frontend-only. It does not load or expose WordPress
server abilities. This keeps the page catalog focused on live editor collaboration
and avoids the locally reproduced failure where a 121-tool backend-heavy catalog
made Codex reject the page configuration. OpenAI does not publish a numeric Site
tools limit.

## Try it with ChatGPT Work or Codex

You need WordPress 7.0+, Node 22+, the latest ChatGPT desktop app, and a model with
Site tools support (currently GPT-5.6 Sol or GPT-5.6 Terra). Docker is required
only for the wp-env path below. In
**Settings → Browser → Permissions**, keep **Enable site tools** on. Site tools are
currently unavailable in Enterprise and Edu workspaces and may depend on rollout.

```bash
git clone https://github.com/galatanovidiu/webmcp-adapter
cd webmcp-adapter
npm ci
npx wp-env start
```

Then open
`http://localhost:8888/wp-admin/post-new.php?post_type=page` in the ChatGPT desktop
app's built-in
browser and sign in with wp-env's default `admin` / `password` credentials. Ask
ChatGPT Work or Codex to inspect the open editor or its selected blocks. The seven
read tools appear after page registration settles; editor writes stay off until
enabled under **Settings → WebMCP**.

For a no-Docker disposable environment, run:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh up
```

Open the reported Settings URL or
`http://127.0.0.1:9400/wp-admin/post-new.php?post_type=page` in the built-in browser;
the public site root does not enqueue admin tools. The repository also ships
Playwright and raw-CDP drivers for deterministic regression testing in system Chrome;
see [development.md](docs/development.md).

For the complete product boundary, read the
[ChatGPT Work and Codex Site tools guide](docs/webmcp-learning-guide.md). A
[speech-friendly PDF edition](output/pdf/webmcp-chatgpt-work-codex-site-tools-speechify.pdf)
is also available.

## What it does

WordPress 7.0 provides the Abilities API client store. This plugin registers a
focused `webmcp/*` frontend ability set in that store and projects only abilities
marked `meta.annotations.clientRegistered`, while rejecting any record also marked
`serverRegistered`.

On every top-level wp-admin page, the adapter:

1. Registers its frontend abilities in the WordPress client store.
2. Exposes the permitted frontend abilities through `document.modelContext.registerTool()`.
3. Subscribes to the store for frontend abilities registered later.
4. Executes calls against the live tab and open Gutenberg state.

Server abilities marked `serverRegistered` are ignored even when another plugin
loads them into the shared store. Use REST or a server-side MCP adapter for those
operations.

Ability → WebMCP mapping:

| Ability field | WebMCP tool field |
|---|---|
| `name` (`namespace/name`) | `name` (`namespace-name`) |
| `label` | `title` |
| `description` | `description` |
| `input_schema` | `inputSchema` |
| `meta.annotations.readonly` | `annotations.readOnlyHint` |
| frontend callback | `execute(params, { signal })` |

Every tool definition carries `untrustedContentHint: true` because editor and site data can
contain user-authored text. Tool registration failures are reported without creating
unhandled promise rejections. When a browser supplies the callback cancellation
signal, cancellation also tears down a pending confirmation before an ability can
run.

## Frontend editor tools

The tools operate on the open post editor or Site Editor through `window.wp.data`.
Changes appear live in the editor. Non-destructive writes remain unsaved until the
separately gated `save-post` tool runs.

Read tools (7, always available):

- `navigate`
- `editor-context`
- `read-blocks`
- `list-block-types`
- `get-theme-design-tokens`
- `list-patterns`
- `list-templates`

Editor write tools (8, behind **Enable write tools**):

- `insert-blocks`
- `update-block-attributes`
- `insert-pattern`
- `remove-blocks`
- `move-blocks`
- `replace-blocks`
- `edit-post-attributes`
- `undo`

Persistence tool (1, behind both **Enable write tools** and **Enable destructive
tools**):

- `save-post` — saves the staged editor state and can publish when explicitly asked.

The editor set is block-agnostic. It works with the registered block types through
the recursive `{ name, attributes, innerBlocks }` shape instead of adding one tool
per block. See [architecture.md](docs/architecture.md) for the full contract.

## Safety model

- Read tools are always exposed.
- Non-destructive editor writes are default-off.
- `save-post` is behind a second default-off gate and an in-page confirmation.
- The confirmation requires a trusted click by default. A separate clearly marked
  demo option can relax this for automated testing.
- An unanswered confirmation safely expires after 60 seconds.
- When the browser forwards an invocation signal to the callback, cancellation
  removes a pending confirmation and prevents a later click from running the action.
- Frontend callbacks re-check the current editor state and validate their inputs
  through the Abilities API before changing it.

The ChatGPT built-in browser performs its own safety review for Site tool calls. That
product layer is separate from the plugin's exposure gates and confirmation modal.

## Activity log and review

Every completed, failed, declined, or expired tool call is shown in a collapsible
in-page panel. Activity is also persisted
to the plugin's custom table, with parameter redaction and bounded retention, and can
be reviewed under **Tools → Site tools activity**.

## ChatGPT Work and Codex limitations

ChatGPT Work and Codex currently discover only imperative tools registered from
JavaScript in the top-level document. Declarative form tools and tools registered
inside iframes are not available as Site tools. This plugin registers in the
top-level wp-admin shell; the Site Editor's canvas may remain in an iframe.

Tools are tab-bound and ephemeral. Navigating or reloading invalidates old handles,
and the agent must discover the tools again on the new document.

## Requirements

- WordPress 7.0 or later.
- PHP 8.1 or later.
- Node.js 22 or later for local tooling.
- The latest ChatGPT desktop app with Site tools enabled for ChatGPT Work or Codex.

Use the built-in browser in the latest ChatGPT desktop app. Public sites
should use HTTPS; localhost is suitable for development.

## Install

For a local trial, use the ChatGPT Work/Codex quick start above. To install
manually, download `webmcp-adapter.zip` from the
[latest release](https://github.com/galatanovidiu/webmcp-adapter/releases/latest),
upload it under **Plugins → Add New → Upload Plugin**, and activate **WebMCP
Adapter**. No companion abilities plugin is required.

## Status

Proof of concept. The frontend read, write, and save/publish tiers are covered by the
local browser test workflows. WebMCP is still a draft and browser support can change.

## License

GPL-2.0-or-later.
