# Front-end abilities make WordPress feel native to ChatGPT Work and Codex

*I know that is a bold prediction. But the experience of working with the live
editor changed how I think about agent tools.*

I built this plugin specifically for **ChatGPT Work and Codex Site tools** in the
ChatGPT desktop app's built-in browser. It uses WebMCP to make a small set of
WordPress editor actions available to ChatGPT Work and Codex on the page where I am
already working.

This matters because the user and the agent share the same live, signed-in
Gutenberg editor. When Codex inserts a block, I see it appear immediately. The edit
is still unsaved, so I can inspect it, refine it, or undo it before anything is
persisted.

[OpenAI describes Site tools](https://learn.chatgpt.com/docs/webmcp) as its
implementation of the proposed WebMCP standard. ChatGPT Work and Codex discover
those tools in the desktop app's built-in browser.

## What I built

[webmcp-adapter](https://github.com/galatanovidiu/webmcp-adapter/) registers a
focused set of frontend WordPress abilities and exposes them as Site tools through
`document.modelContext`.

It is deliberately built for ChatGPT Work and Codex. It is not a generic backend MCP
bridge, and it does not load the WordPress server ability catalog.

The available tools are intentionally small:

- Seven read tools for navigation, editor context, blocks, block types, theme
  design tokens, patterns, and templates.
- Eight optional write tools that stage unsaved block and document changes.
- One separately gated `save-post` tool that persists or publishes the staged
  editor state.

This gives ChatGPT Work and Codex enough structure to edit Gutenberg without creating one
tool for every block type.

## Why frontend abilities feel different

A server-side MCP tool can update WordPress without the relevant page being open.
That is useful for backend automation, but it is not the experience I wanted here.

Site tools are bound to the current page. ChatGPT Work or Codex works with the same
editor, selection, block tree, and unsaved state that I can see. That changes the
collaboration:

- **The agent sees the live context.** It can read the open document and the blocks
  I have selected.
- **Changes are visible before persistence.** Most writes update only Gutenberg's
  in-memory editor state.
- **Verification happens in the same place.** The agent can re-read the editor, and
  I can inspect the result without switching to another application.
- **The integration uses my existing ChatGPT session.** The WordPress plugin does
  not need its own model API key or embedded AI service.

If a page does not provide a suitable Site tool, ChatGPT Work and Codex can still use
their normal browser capabilities. The tools provide a more reliable path for the
operations WordPress already knows how to perform.

## How the pieces connect

| Layer | Responsibility |
|---|---|
| WordPress Abilities client store | Holds browser-owned frontend abilities |
| `webmcp-adapter` | Filters the frontend abilities and maps them to WebMCP |
| `document.modelContext` | Registers imperative tools in the top-level page |
| ChatGPT desktop built-in browser | Discovers and reviews Site tool invocations |
| ChatGPT Work or Codex | Selects and calls the relevant WordPress tool |

The frontend-only boundary is important. WordPress server abilities can also appear
in the shared client store, but the adapter accepts only records marked
`clientRegistered: true` and rejects anything marked `serverRegistered: true`.

That avoids turning a page integration into a duplicate backend API and keeps the
Site tool inventory focused on the editor.

## One interface for every block type

WordPress has many block types, but Gutenberg blocks share a recursive shape:

```json
{
  "name": "core/group",
  "attributes": {},
  "innerBlocks": []
}
```

The adapter therefore exposes general block operations instead of one tool per
block. ChatGPT Work or Codex can use `list-block-types` to inspect the available
contracts, then compose `insert-blocks`, `update-block-attributes`,
`move-blocks`, `replace-blocks`, or `remove-blocks`.

The same operations work in the Post Editor and Site Editor because the callbacks
act on the live Gutenberg data stores.

## The asynchronous registration detail

The WordPress ability store is populated imperatively. There is no resolver that
means “wait until every ability exists.”

The adapter reads the current records and subscribes for later frontend
registrations. It also waits for each WebMCP registration to finish before marking a
tool as registered. That prevents a cold page load from producing an incomplete or
empty Site tool inventory.

ChatGPT Work and Codex receive seven read tools by default, 15 when unsaved editor writes
are enabled, and 16 when the save/publish gate is also enabled.

## Safety belongs in layers

This is still an experiment, and wp-admin is a consequential environment.

- Read tools are available by default.
- Editor writes are disabled until an administrator enables them.
- Those writes remain unsaved and can be undone.
- `save-post` has its own default-off exposure gate.
- Every save or publish call opens an in-page confirmation showing the exact
  arguments.
- Unanswered confirmations expire safely.
- Completed, failed, declined, and expired calls are recorded in the activity view.
- The ChatGPT built-in browser performs its own safety review before the site runs a
  tool.

The trusted-click check blocks synthetic clicks dispatched by page script. It is a
page-level protection, not proof of human intent against privileged browser
automation.

## Try it with ChatGPT Work or Codex

Use a local or throwaway WordPress site:

```bash
git clone https://github.com/galatanovidiu/webmcp-adapter
cd webmcp-adapter
npm ci
npx wp-env start
```

Open the wp-admin editor in the **ChatGPT desktop app's built-in browser**, inspect
**Site tools**, and ask ChatGPT Work or Codex to read the current editor context.
Enable write tools under **Settings → WebMCP** only when you want the agent to stage
edits.

Check the [official Site tools documentation](https://learn.chatgpt.com/docs/webmcp)
for current model, app, workspace, and rollout requirements.

This project is not trying to replace backend MCP. It is built to make WordPress
editing feel native when a person and ChatGPT Work or Codex are working together on
the same page.
