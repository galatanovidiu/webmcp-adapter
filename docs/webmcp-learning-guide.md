# WebMCP in ChatGPT Desktop: a ChatGPT Work and Codex Site tools guide

Research snapshot: 3 September 2026.

This guide is deliberately narrow. It explains what ChatGPT Work and Codex can do
with WebMCP **today in the ChatGPT desktop app's built-in browser**. The official
[OpenAI Site tools guide](https://learn.chatgpt.com/docs/webmcp) is authoritative
for product behavior. The
[WebMCP draft](https://webmachinelearning.github.io/webmcp/) is used only to explain
the imperative browser API that a page exposes. A feature in the broader draft is
not automatically a feature supported by ChatGPT.

This repository is built specifically for that ChatGPT Work and Codex Site tools
path. It is not a generic browser-agent adapter or a backend MCP integration.

## The short mental model

A normal web page can register named JavaScript functions as structured tools on
`document.modelContext`. When that page is open in the ChatGPT desktop app's
the built-in browser, ChatGPT Work or Codex can discover its top-level imperative tools, select one,
send schema-shaped arguments, and receive the value returned by the page's
callback. The callback runs in the live page, so it can use the application's
existing JavaScript state, DOM, signed-in session, and normal backend APIs. The
person and the selected agent therefore work on the same page instead of through a separate
integration. [OpenAI describes Site tools as its implementation of the proposed
WebMCP standard and explicitly says the person and agent share the live page and
signed-in session.](https://learn.chatgpt.com/docs/webmcp)

The most important boundary is that these are **page tools**, not permanently
installed account tools. Closing the page or navigating away can make them
unavailable. A server-side MCP integration is different: it can remain available
without the website being open. A website may support both, but this guide covers
only Site tools. [OpenAI's comparison makes this page-bound versus independent
integration distinction explicit.](https://learn.chatgpt.com/docs/webmcp#webmcp-vs-mcp)

## What is available now

Current OpenAI product requirements and limits are:

- Use the built-in browser in the latest ChatGPT desktop app. Site tools are
  available there to ChatGPT Work and Codex when the current page provides them.
- Use GPT-5.6 Sol or GPT-5.6 Terra. GPT-5.6 Luna currently has WebMCP disabled.
- Availability still depends on rollout, app version, workspace, and the current
  page. Site tools are not available in Enterprise or Edu workspaces.
- The user can disable them under **Settings -> Browser -> Permissions -> Enable
  site tools**.
- Only top-level imperative JavaScript tools are supported. Declarative HTML form
  tools are not currently exposed as Site tools.
- Tools registered inside an iframe are not discovered, whether that iframe is
  same-origin or cross-origin.

These are current product facts, not conclusions inferred from the general WebMCP
draft. See [OpenAI's availability, controls, and limitations](https://learn.chatgpt.com/docs/webmcp).

## Define a tool

Feature-detect the API and register the tool in JavaScript executing in the
top-level page:

```js
if (typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool({
    name: "find_section",
    title: "Find section",
    description:
      "Find a section in the document currently open in this editor.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text or heading to find.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: async ({ query }, { signal } = {}) => {
      if (signal?.aborted) {
        throw (
          signal.reason ??
          new DOMException("Tool execution cancelled", "AbortError")
        );
      }

      const match = findSectionInCurrentEditor(query);
      return match
        ? { found: true, sectionId: match.id, heading: match.heading }
        : { found: false };
    },
  });
}
```

OpenAI's own example uses the same `document.modelContext.registerTool(...)`
shape and returns a JavaScript object from `execute`.
[See the current OpenAI registration example.](https://learn.chatgpt.com/docs/webmcp#add-webmcp-to-your-website)

The current imperative descriptor is:

| Field                              | Meaning                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                             | Required machine identifier. It is unique within the document. The draft limits it to 1-128 ASCII letters, digits, `_`, `-`, or `.`.                   |
| `title`                            | Optional human-readable label for browser UI.                                                                                                          |
| `description`                      | Required natural-language explanation of what happens and when the agent should use the tool.                                                          |
| `inputSchema`                      | JSON Schema describing the argument object. Keep it narrow and give properties useful descriptions.                                                    |
| `annotations.readOnlyHint`         | A hint that the tool only reads state. It is not an authorization rule or proof of behavior.                                                           |
| `annotations.untrustedContentHint` | A hint that returned content may contain untrusted data, such as user-authored or third-party text.                                                    |
| `execute(params, context)`         | Required async callback. `params` is the argument object. The current draft gives `context` a cancellation `signal`. Return a JSON-serializable value. |

The exact descriptor and callback types come from the
[current `ModelContextTool` definition](https://webmachinelearning.github.io/webmcp/#modelcontexttool-dictionary).
OpenAI demonstrates `name`, `description`, `inputSchema`, `readOnlyHint`, and
`execute`; its product page does not separately document how Site tools present every
optional draft field. Use `title` and `untrustedContentHint` accurately, but do not
make tool correctness depend on a particular UI treatment of either field.
The current descriptor does **not** define an `outputSchema` or a destructive-action
annotation. Describe side effects honestly and enforce consequential-action rules
in the application itself.

Treat the schema as agent guidance, not your security boundary. OpenAI tells sites
to keep inputs narrow and to continue using the application's existing
authentication, authorization, and input validation.
[See OpenAI's implementation guidance.](https://learn.chatgpt.com/docs/webmcp#add-webmcp-to-your-website)
The callback should therefore validate arguments again before it changes anything.

Also await `registerTool()`. A rejected registration is not an available tool. The
draft rejects duplicate names in one document, empty names or descriptions, invalid
names, and registrations from a document that is not in a valid state.
[See the registration algorithm.](https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool)

## How ChatGPT Work and Codex discover and run a tool

The product-level flow is:

1. The user opens the site directly in the desktop app's built-in browser.
2. The top-level document's JavaScript registers imperative tools.
3. ChatGPT Work or Codex receives the tools made available by the current page and chooses a
   relevant action from each tool's name, description, and input schema.
4. The built-in browser reviews each invocation before the website carries it out.
5. The browser invokes the registered callback in the page. The callback reads or
   changes the live application and returns a JSON-serializable result.
6. The agent can inspect both the returned result and the current page to verify what
   changed or decide what to do next.

The user can inspect the inventory through **Site tools** in the browser address
bar, then **Available site tools**. When activity is available, **Recently used**
opens Sources so the calls can be reviewed.
[OpenAI documents this discovery and review UI.](https://learn.chatgpt.com/docs/webmcp#how-it-works-in-the-browser)

If no suitable Site tool exists, ChatGPT Work or Codex may still use ordinary browser
capabilities. A Site tool improves precision; it does not disable normal page
inspection and interaction.

### `getTools()` and `toolchange` are not the Site tools refresh contract

The broader imperative API also gives page JavaScript `getTools()` and a
`toolchange` event. They are useful for in-page consumers, developer tooling, and
tests. The draft separately explains that a browser-integrated agent receives an
implementation-defined **observation** of page tools; it may take observations at
implementation-chosen times.
[See the draft's agent observation model.](https://webmachinelearning.github.io/webmcp/#page-observations)

This distinction matters:

- A `toolchange` event tells listening **documents** that registrations changed.
  It does not document when the desktop app rebuilds the tool context already supplied to
  the model.
- Calling `getTools()` in the page can prove what the page-side API currently
  exposes. It does not force the desktop browser to rediscover tools for ChatGPT Work or Codex.
- OpenAI's current Site tools guide does not publish a refresh delay, cache rule,
  notification hook, or site-author API that forces rediscovery after a
  same-document change.

Consequently, full navigation has a clear product contract, while same-document
dynamic refresh timing must be treated as unspecified.

## Page changes and tool-set changes

Yes, different web pages can provide different tools. Each `Document` has its own
model context in the draft, and OpenAI says tools belong to the page that provides
them. The practical behavior differs depending on whether the browser created a
new document.

| Situation                      | Page-side state                                                                                                                   | What OpenAI documents                                                                        | Safe design assumption                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| First load                     | The top-level script registers this document's tools.                                                                             | ChatGPT Work and Codex can discover them when they are available.                           | Register a small useful inventory early, await each registration, and handle rejection.                                       |
| Full navigation to another URL | The old document is replaced. The new page creates its own model context and registers its own set.                               | OpenAI says navigating away can make the old page's tools unavailable.                      | Page A and page B may expose different tools. Treat every navigation as requiring discovery from the new page.                |
| Reload                         | The old document is replaced even if the URL is unchanged.                                                                        | The prior tools are page-bound and cannot be assumed to survive.                            | Run registration code again and treat old tool handles/context as stale.                                                      |
| Same-document SPA route        | The document survives, so its existing registrations also survive until the page changes them.                                    | OpenAI does not document when Site tools notice route-driven registration changes.          | Prefer stable tools whose callback checks the current route and live state. Do not depend on immediate model-context refresh. |
| Late `registerTool()`          | The draft changes the document's tool map and emits `toolchange`.                                                                 | No Site tools refresh timing or wake-up guarantee is documented.                            | Late tools may be useful, but do not make the critical path depend on instant discovery.                                      |
| Remove or replace a tool       | The draft's removal mechanism is aborting the `signal` supplied when registering it. Replacing means remove, then register again. | No Site tools refresh timing is documented, and an observed call can race a replacement.    | Validate current state inside every call. Avoid rapidly replacing one name with a different schema or meaning.                |
| Tool in an iframe              | It belongs to the iframe document.                                                                                                | The current built-in browser does not discover iframe tools at all.                         | Register Site tools in the top-level document.                                                                                |
| Close the page or tab          | The providing page is gone.                                                                                                       | Its tools become unavailable.                                                               | Use server-side MCP if an operation must remain available without the page.                                                   |

The draft defines registration-scoped removal through an `AbortSignal` and emits
`toolchange` when a tool is added or removed.
[See the registration options and tool-change event.](https://webmachinelearning.github.io/webmcp/#modelcontextregistertooloptions-dictionary)
It also records an unresolved race when a tool is removed and quickly re-registered
under the same name with a different schema.
[See the draft's execution race note.](https://webmachinelearning.github.io/webmcp/#tool-execute-steps)
Those are page API facts; OpenAI does not promise that the Site tools client observes the change
at the same moment.

## Execution, results, errors, and cancellation

The `execute` callback runs in the tool-owning page. This is why WebMCP fits editors,
dashboards, maps, and other applications where the visible client state matters.
It also means the callback has only the authority of the current application and
session; registering a tool does not create a new backend permission.

Return compact structured data that helps ChatGPT Work or Codex verify the outcome:

```js
return {
  ok: true,
  changed: true,
  itemId: item.id,
  message: "Draft item inserted. The document is not saved yet.",
};
```

Do not return a success-shaped result before the underlying operation is complete.
For an expected business refusal, such as "not in an editor" or "user declined",
a structured result is easier for the agent to reason about than an opaque error.
For unexpected failures, rejecting the callback communicates failure, but the
current OpenAI documentation does not specify the exact error object or wording
the Site tools client will receive. Avoid building behavior around a client-specific error string.

Cancellation has three separate facts:

1. The current WebMCP draft gives the callback an invocation-scoped
   `AbortSignal` as `execute(params, { signal })`. A callback should check it and
   pass it to cancellable work such as `fetch`.
2. The draft separately allows a registration-scoped signal. Aborting that signal
   unregisters the tool; it is not the same signal as one invocation's
   cancellation.
3. OpenAI's Site tools page does not document when the current built-in browser
   cancels an invocation, whether every cancellation is forwarded to the callback,
   or what happens after irreversible work has already begun.

The first two are defined by the
[imperative WebMCP callback and registration interfaces](https://webmachinelearning.github.io/webmcp/#modelcontexttool-dictionary).
The third is an implementation uncertainty. Build cancellation as cooperative
best effort: check before side effects, listen while waiting for user input, check
again immediately before the mutation, and make long-running I/O abortable. Do not
promise that cancellation rolls back a completed write.

## Safety, permissions, and authentication

Site tools run inside a powerful context: the same live, authenticated page the
user is viewing. The correct trust model is therefore layered:

- Tool names, descriptions, schemas, annotations, and results are website-provided
  content. OpenAI treats them as untrusted. A site's `readOnlyHint` or description
  is not proof of what the callback really does.
- The built-in browser performs a safety review for each invocation and keeps
  normal access and confirmation policies for consequential actions such as
  purchases, messages, deletion, and permission changes.
- That review does not replace the site's own authorization, validation, and
  confirmation. The application must enforce the same server permissions and
  invariants it would enforce for a human-driven action.
- Send only the arguments the tool actually needs. Do not use a broad schema as a
  route for unrelated personal or cross-site context.
- Mark user-authored and third-party output with `untrustedContentHint`, keep
  results compact, and never treat instructions inside a tool result as higher
  authority than the user's request.
- Make consequential actions visible in the page and return enough result data for
  the person and the selected agent to verify the outcome.

OpenAI documents both the per-call browser review and the fact that these checks do
not make a website trustworthy.
[See Site tools security and user controls.](https://learn.chatgpt.com/docs/webmcp#security-and-user-controls)

## Applied to this WordPress adapter

This repository already follows a design that fits the current ChatGPT Work and Codex product
boundary:

- [`src/adapter.js`](../src/adapter.js) runs in the top-level wp-admin document and
  projects only frontend abilities marked `clientRegistered` and rejects records
  also marked `serverRegistered`. It does not project REST-backed server abilities.
- It provides a stable, gated inventory for each page load: seven read tools by
  default, eight additional unsaved editor-write tools when writes are enabled,
  and the separately gated `save-post` persistence tool when destructive tools are
  enabled. The gates are read once from module data, so changing a setting requires
  a reload before the document's inventory changes.
- It reads the current ability store immediately, subscribes to that store, and
  attempts registrations for frontend abilities that arrive later. An ability is
  marked registered only after `registerTool()` resolves; a failed registration
  remains eligible for a later retry.
- The current synchronizer is additive. Its `registered` and `pending` sets prevent
  duplicate work, but it does not supply registration abort controllers and does
  not mirror ability removal or same-name definition updates into WebMCP. We should
  not claim that it does.
- Editor abilities call [`getEditor()`](../src/abilities/store.js) at execution
  time. They therefore verify that the live tab is still editing a post instead of
  trusting the context that existed when the agent discovered the tool. This is the
  right defense against stale page or SPA state.
- The adapter reads the invocation signal when the client supplies it. It checks
  before execution, listens while a destructive confirmation is open, and checks
  again immediately before dispatch. It does not pass that signal into
  `executeAbility()`, so cancellation after the ability starts is not a guaranteed
  stop or rollback.
- Destructive persistence has an application-owned, in-page confirmation. This is
  separate from the built-in browser's safety review and from WordPress backend
  authorization.

This leads to a practical rule for the adapter: keep the top-level inventory stable
within one page load, make every callback inspect current editor state, and use a
reload after exposure-setting changes. The subscription supports late additions,
but until current Site tools refresh behavior is verified, those additions should not
be the only way a critical tool becomes discoverable.

## Implementation checklist for ChatGPT Work and Codex Site tools

- Register imperative tools on `document.modelContext` in the top-level page.
- Feature-detect `registerTool`; keep the human UI functional when it is absent.
- Await registration and log failures without pretending the tool is available.
- Keep the inventory small, names stable, descriptions precise, and schemas narrow.
- Use `readOnlyHint` accurately and `untrustedContentHint` for site or third-party
  content.
- Validate arguments and current page state inside every execution.
- Reuse existing application logic, authentication, authorization, and server-side
  validation.
- Return compact structured outcomes only after the visible/application state has
  reached the claimed result.
- Treat invocation cancellation as cooperative and never as automatic rollback.
- After a full navigation or reload, assume a new tool set and rediscover it.
- For SPA or late-registration changes, do not assume Site tools refresh immediately;
  design stale calls to fail safely and informatively.
- Keep all ChatGPT Work/Codex Site tool registrations out of iframes.
- Add site-owned confirmation for irreversible actions even though the built-in
  browser also reviews the call.

## Known current unknowns

The official OpenAI documentation does not currently specify:

- how quickly Site tools notice a late registration or removal in the same document;
- whether `toolchange` immediately updates the tools already in the model's context;
- a page API that forces the desktop app to refresh its Site tool inventory;
- exact invocation-cancellation forwarding behavior;
- the exact ChatGPT Work/Codex error/result wrapper when a callback rejects;
- a maximum number of Site tools.

These are test targets, not facts to fill in from the broader specification. Recheck
the [OpenAI Site tools guide](https://learn.chatgpt.com/docs/webmcp) before relying
on any of them, because the product and the proposed API are still evolving.

## Primary sources

- [OpenAI: Site tools](https://learn.chatgpt.com/docs/webmcp) — current ChatGPT
  desktop, ChatGPT Work, and Codex product behavior, availability, UI, safety, and
  limitations.
- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/) —
  the imperative `document.modelContext` surface, document ownership, tool
  registration, execution, events, and implementation-defined browser-agent
  observations. It is a Community Group draft, not an OpenAI support matrix.
