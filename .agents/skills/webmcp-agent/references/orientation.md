# Orientation — explain the demo before driving it

Deliver this only when the invocation carries no task. Explain these points briefly
in your own words before opening the site:

1. **What WebMCP is.** A page publishes structured tools to an AI agent in the same
   tab through `document.modelContext`. The agent and user work against the same
   visible, signed-in application state.
2. **What Codex adds.** Codex in the ChatGPT desktop app's built-in browser can
   discover these actions as Site tools and call them directly. The repository's
   system-Chrome drivers are deterministic development fallbacks, not substitutes
   for the native acceptance path.
3. **What this plugin exposes.** It exposes only frontend WordPress editor abilities:
   seven reads by default, eight gated unsaved-write tools, and one separately gated
   save/publish tool. It does not expose REST-backed or server MCP abilities.

Then proceed with the workflow in the parent skill.
