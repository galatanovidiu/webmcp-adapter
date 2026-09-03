# Orientation — explain the demo before driving it

Deliver this only when the invocation carries no task. Explain these points briefly
in your own words before opening the site:

1. **What this project is for.** It is a WordPress Site tools adapter built for
   ChatGPT Work and Codex in the ChatGPT desktop app's built-in browser. The page
   publishes structured tools through `document.modelContext`, and the user and
   agent work against the same visible, signed-in application state.
2. **What ChatGPT Work and Codex add.** In the ChatGPT desktop app's built-in
   browser, both can discover these actions as Site tools and call them directly.
   The repository's system-Chrome drivers are deterministic development fallbacks,
   not substitutes for the native acceptance path.
3. **What this plugin exposes.** It exposes only frontend WordPress editor abilities:
   seven reads by default, eight gated unsaved-write tools, and one separately gated
   save/publish tool. It does not expose REST-backed or server MCP abilities.

Then proceed with the workflow in the parent skill.
