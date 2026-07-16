# Orientation — explain the demo before driving it

Deliver this when the invocation carried **no task** (see "Invocation modes" in SKILL.md). It is
the point of the demo: the setup only makes sense once the user understands it. Explain it in plain
language, in your **own words**, before any Chrome launch or tool call. Cover these three points,
a few sentences each — not a lecture:

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

3. **What they can do through this connection.** Relay the gist of "What you can do through this
   connection" in SKILL.md.

Keep it short. Then proceed to the workflow.
