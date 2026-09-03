# Page-scoped Abilities make WordPress feel native to ChatGPT Work and Codex

*The experience of working with the live editor changed how I think about agent
tools.*

I built this plugin specifically for **ChatGPT Work and Codex Site tools** in the
ChatGPT desktop app's built-in browser. It uses WebMCP to make a small set of
WordPress actions available on the page where they make sense.

This matters because the user and agent share the same live, signed-in WordPress
page. When Codex inserts a Gutenberg block, I see it immediately. The edit remains
unsaved until a separately confirmed save, so I can inspect, refine, or undo it
before persistence.

[OpenAI describes Site tools](https://learn.chatgpt.com/docs/webmcp) as its
implementation of the proposed WebMCP standard. ChatGPT Work and Codex discover
those tools in the desktop app's built-in browser.

## What I built

[webmcp-adapter](https://github.com/galatanovidiu/webmcp-adapter/) projects
frontend WordPress client Abilities through `document.modelContext`. It does not
load the REST-backed Ability catalog and is not a generic backend MCP bridge.

The inventory follows the current document:

- A public page reports its context and rendered site destinations.
- An authenticated public page also reports rendered admin-toolbar destinations.
- A generic wp-admin page reports its context and rendered admin-menu
  destinations.
- General Settings adds one Ability that stages supported fields for manual
  review and save.
- A compatible post, page, custom-post-type, or Site Editor adds 15 Gutenberg
  tools to the two wp-admin base reads.
- Authentication screens load no Site tools or plugin activity UI.

The WordPress Ability name `webmcp/editor-context` becomes the collision-safe
WebMCP name `webmcp.editor-context`. A full navigation creates a new document and
new inventory, so the agent rediscovers tools after it opens a returned URL with
normal browser navigation.

## Why frontend Abilities feel different

A server-side MCP tool can update WordPress without the relevant page being open.
That is useful for backend automation, but it is not the experience I wanted here.

Site tools are bound to the current page. ChatGPT Work or Codex works with the
same editor, selection, block tree, visible form, and unsaved state that I can see.
That changes the collaboration:

- **The agent sees the live context.** It can read the open document and selected
  blocks.
- **Most changes remain reversible.** Editor mutations stay in Gutenberg memory,
  and General Settings changes stay in the visible form.
- **Verification happens in place.** The agent can re-read structured state while
  I inspect the same UI.
- **The integration uses the existing ChatGPT session.** The plugin needs no model
  API key or embedded AI service.

If a page does not provide a suitable Site tool, ChatGPT Work and Codex can still
use ordinary browser capabilities. A structured tool improves precision for the
operations WordPress and the page owner already understand.

## How the pieces connect

| Layer | Responsibility |
|---|---|
| WordPress Abilities client store | Holds browser-owned frontend Abilities |
| Page provider | Selects the document and owns schemas, permissions, and callbacks |
| `webmcp-adapter` | Projects eligible Abilities, applies risk policy, and mirrors lifecycle |
| `document.modelContext` | Registers imperative tools in the top-level document |
| ChatGPT desktop built-in browser | Discovers and reviews Site tool invocations |
| ChatGPT Work or Codex | Selects and calls the relevant page tool |

The adapter accepts only records marked `clientRegistered: true` and rejects any
record also marked `serverRegistered: true`. Third-party plugins use normal
WordPress enqueue hooks and `@wordpress/abilities`; they do not register with a
second provider system.

## One interface for every block type

Gutenberg blocks share a recursive shape:

```json
{
  "name": "core/group",
  "attributes": {},
  "innerBlocks": []
}
```

The editor provider therefore exposes general block operations instead of one tool
per block. ChatGPT Work or Codex can inspect block contracts, then insert, update,
move, replace, or remove blocks. The adapter selects the provider through
`WP_Screen::is_block_editor()`, so compatible custom post types work without an
adapter-maintained list.

## Safety belongs in layers

Every applicable Ability is available only when its risk declaration is valid.
Readonly Abilities derive `read`; mutations declare `reversible`, `persistent`,
`consequential`, or `privileged`. Invalid mutation metadata fails closed.

The eight editor mutations remain unsaved and can be undone.
`webmcp.save-post` is consequential and always opens an in-page confirmation. The
dialog shows bounded, redacted context, requires a trusted click, expires after 60
seconds, and observes cancellation when the browser forwards it. The ChatGPT
built-in browser performs its own safety review as a separate layer.

General Settings demonstrates a different supervision model: the agent stages
supported visible controls, but the Ability never submits the form. The user
reviews and chooses **Save Changes**. Administration Email is redacted from every
result, notice, event, stored row, and exporter call.

Every eligible page starts with a small activity icon. Details open only when
requested. The backend receives one non-blocking, redacted event per completed
attempt, with bounded retention and privacy-preserving anonymous identifiers.

## Try it

Use a local or throwaway site:

```bash
git clone https://github.com/galatanovidiu/webmcp-adapter
cd webmcp-adapter
npm ci
.agents/skills/webmcp-playground/webmcp-playground.sh test
```

Open a reported WordPress URL in the ChatGPT desktop app's built-in browser,
inspect **Site tools**, and ask ChatGPT Work or Codex to read the current page.
Rediscover after navigation. Review every visible edit before confirming a
consequential action.

This project is not trying to replace backend MCP. It makes WordPress collaboration
feel native when a person and agent are working on the same page.
