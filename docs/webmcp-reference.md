# WebMCP reference for ChatGPT Work and Codex Site tools

Consolidated reference for WebMCP, built from the Chrome for Developers docs and the
`GoogleChromeLabs/webmcp-tools` demos. It is scoped to this plugin's product goal:
exposing WordPress administration (wp-admin) to ChatGPT Work and Codex as Site
tools in the ChatGPT desktop app's built-in browser.

Sources (canonical, check for updates):
- OpenAI Site tools: https://learn.chatgpt.com/docs/webmcp
- Overview: https://developer.chrome.com/docs/ai/webmcp
- Imperative API: https://developer.chrome.com/docs/ai/webmcp/imperative-api
- Declarative API: https://developer.chrome.com/docs/ai/webmcp/declarative-api
- Best practices: https://developer.chrome.com/docs/ai/webmcp/best-practices
- WebMCP vs MCP: https://developer.chrome.com/docs/ai/webmcp/compare-mcp
- Use cases: https://developer.chrome.com/docs/ai/webmcp/use-cases
- Evals: https://developer.chrome.com/docs/ai/webmcp/evals
- Spec: https://github.com/webmachinelearning/webmcp
- Demos + dev tools: https://github.com/GoogleChromeLabs/webmcp-tools
- Tool Inspector (Chrome extension): https://chromewebstore.google.com/detail/model-context-tool-inspec/gbpdfapgefenggkahomfgkhfehlcenpd

## Status and client notes

- WebMCP is a proposed web standard.
- ChatGPT Work and Codex can use imperative WebMCP tools as **Site tools** in the
  ChatGPT desktop app's built-in browser. Current availability requires a supported
  model, app version, workspace, and rollout; check the OpenAI page above.
- ChatGPT Work and Codex currently ignore declarative form tools and iframe registrations.
- Current Chrome development builds use the `WebMCP` feature; older Chrome 149
  testing used `WebMCPTesting` and `DevToolsWebMCPSupport`.
- Prefer `document.modelContext`. Feature-detect
  `document.modelContext || navigator.modelContext` for older Chrome builds.
- Tools are document-bound and ephemeral.

## What WebMCP is

A page exposes structured "tools" to a browser's built-in AI agent. In this project,
that product client is ChatGPT Work or Codex in the ChatGPT desktop app's built-in
browser. The page declares
each feature's purpose, inputs (JSON Schema), and outputs, so the agent calls explicit
functions instead of guessing from the DOM. Three pillars: discovery, JSON Schemas,
state management.

Two ways to define tools:
- Imperative API — JavaScript (`document.modelContext.registerTool`).
- Declarative API — HTML attributes on a `<form>`.

## Imperative API

### registerTool(toolDef, options)

```js
document.modelContext.registerTool({
  name: 'string',            // unique tool ID; name with an exact verb (create-event)
  description: 'string',     // what it does and when to use it
  inputSchema: {             // JSON Schema for arguments
    type: 'object',
    properties: { /* ... */ },
    required: ['field'],
  },
  execute: async (params) => {
    // Run the real page logic; return a JSON-serializable value.
    return { ok: true };
  },
  annotations: {
    readOnlyHint: boolean,        // tool does not mutate state
    untrustedContentHint: boolean // output may contain untrusted content
  }
}, {
  signal: AbortSignal,                 // optional; abort to unregister
  exposedTo: ['https://origin.com']    // optional; cross-origin allowlist
});
```

Tool definition fields: `name`, optional `title`, `description`, `inputSchema` (JSON
Schema: `type`, `properties`, `enum`, `required`, `minimum`, `integer`, etc.),
`execute(args, context)` returning any JSON-serializable value, and optional
`annotations`.

### Other operations

```js
// Discover tools (optionally limited to origins)
const tools = await document.modelContext.getTools({ fromOrigins: ['https://partner.org'] });

// Execute a tool; args passed as an object
const result = await document.modelContext.executeTool(tool, { param: 'value' }, { signal });

// React to changes in the registered tool set
document.modelContext.addEventListener('toolchange', (event) => { /* ... */ });
```

### Cross-origin (broader WebMCP API, not ChatGPT Work or Codex Site tools)

Two conditions, both required:
1. Host page delegates via Permissions Policy: `<iframe allow="tools"></iframe>`.
2. Tool exposes itself to the requesting origin via `exposedTo`.

The `tools` Permissions Policy defaults to `self`.

## Declarative API (not currently discovered by ChatGPT Work or Codex)

Annotate a standard `<form>` so the browser turns it into a tool. No JS registration.

Form attributes:
- `toolname` — tool ID (name by purpose).
- `tooldescription` — what action it takes and why.
- `toolautosubmit="true"` — agent submits automatically; without it the user clicks submit.

Field attributes:
- `toolparamdescription` — describes one parameter; maps to the JSON Schema property
  description. The field's `name`, `required`, `minlength`, input `type`, and `<option>`
  values are reused as the parameter schema and validation.

```html
<form id="reservationForm"
      toolname="book_table"
      tooldescription="Initiates a dining reservation. Accepts customer details and timing."
      novalidate>
  <input type="text" id="name" name="name" required minlength="2"
         toolparamdescription="Customer's full name (min 2 chars)" />
  <input type="date" id="date" name="date" required
         toolparamdescription="Reservation date (YYYY-MM-DD). Must be today or future." />
  <select id="guests" name="guests" required
          toolparamdescription="Number of people. String '1'..'5', or '6' for 6+.">
    <option value="2" selected>2 People</option>
  </select>
  <button type="submit">Request Reservation</button>
</form>
```

### Events

On `SubmitEvent`:
- `e.agentInvoked` (boolean) — agent triggered the submit.
- `e.respondWith(value)` — return a result (or a Promise) to the agent.

Window events:
- `toolactivated` — fires when the agent selects the tool / fields are pre-filled;
  carries `toolName`. Use it to validate before submit.
- `toolcancel` — fires on user cancel or `form.reset()`.

```js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  validateForm();
  if (formValidationErrors.length) {
    if (e.agentInvoked) e.respondWith(formValidationErrors); // send errors back
    return;
  }
  showResult();
  if (e.agentInvoked) e.respondWith(resultText);             // send success back
});

window.addEventListener('toolactivated', ({ toolName }) => {
  if (toolName !== 'book_table') return;
  validateForm();
});
```

### CSS feedback

- `:tool-form-active` — on the active form during agent interaction.
- `:tool-submit-active` — on the submit button.

Both deactivate after submit, cancel, or reset.

## WebMCP vs MCP

Not a replacement. Different layers; use both together.

| Aspect      | MCP                              | WebMCP                          |
|-------------|----------------------------------|---------------------------------|
| Layer       | Backend, external systems        | Frontend, in-browser            |
| Lifecycle   | Persistent (server/daemon)       | Ephemeral (tab-bound)           |
| Reach       | Anywhere (desktop/mobile/cloud)  | Browser agents only             |
| Interaction | Headless, external               | DOM-aware, browser-integrated   |
| Use         | Background API actions, data     | Navigate and actuate live UI    |

Analogy: MCP = call center (anywhere). WebMCP = in-store expert (on-site only).
Recommended split: MCP for core business logic and data; WebMCP for contextual
in-browser UI.
This plugin implements only the WebMCP side for ChatGPT Work and Codex Site tools.

## Best practices

1. Tool strategy: one function per tool; no overlapping tools. Static registration is the
   default; register/unregister dynamically only when it helps. Trust the agent; do not
   impose rigid step-by-step flows.
2. Clear language and semantic code: name tools with exact verbs (`create-event`, not
   `start-event-creation-process`). Describe what and when. Use positive capability
   language, not limitations.
3. Minimize cognitive computing: accept raw user input; do not make the model do math or
   string transforms. Declare precise parameter types (string/number/enum). Use
   natural-language values (`shipping="Express"`, not `shipping_id=1`).
4. Prioritize reliability: graceful failures with meaningful errors (incl. rate limits).
   Update interface state after a tool runs so the agent can verify completion. Validate
   strictly in code, loosely in schema; return descriptive errors so the model self-corrects.
5. Evaluation-driven testing: define each problem as an API contract (input type, output
   format, constraints). Set baseline and ideal results. Evaluate with code checks or
   LLM-as-judge. Fix the tool, not single-model quirks.

## Evals

Tests probabilistic outcomes. Three checks: tool understanding, parameter accuracy,
information processing. Run isolated tools via `document.modelContext.executeTool(...)`,
assert with `expectedCall`.

```json
{
  "messages": [{ "role": "user", "content": "I'd like a small pizza." }],
  "expectedCall": [
    { "functionName": "set_pizza_size", "arguments": { "size": "Small" } }
  ]
}
```

End-to-end journeys support ordered and `unordered` call sets. CLI:
`GoogleChromeLabs/webmcp-tools/tree/main/evals-cli`.

## Demos (reference implementations)

`GoogleChromeLabs/webmcp-tools/tree/main/demos`:
- Imperative: `pizza-maker`, `react-flightsearch`, plus analytics-dashboard, hotel-chain,
  smart-home, real-estate-map, ticket-booking, sport-shop-angular, others.
- Declarative: `french-bistro` (Le Petit Bistro).
- `shared/types` holds shared TypeScript type definitions.

## Notes for WordPress administration

See [architecture.md](architecture.md) for the project boundary and
[development.md](development.md) for verification. Summary:

- The plugin registers frontend editor abilities in the WordPress Abilities client
  store and projects only records marked `clientRegistered` without
  `serverRegistered` provenance.
- It does not import `@wordpress/core-abilities` or project REST-backed abilities.
- Registration occurs in the top-level wp-admin shell, including on the Site Editor.
- The adapter subscribes for late frontend registrations and waits for each
  `registerTool()` promise before treating the ability as registered.
- `execute` returns structured ability results and observes the invocation's
  cancellation signal when the client supplies it to the callback.
