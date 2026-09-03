# WordPress Site Tools for ChatGPT Work and Codex

> **This is an experiment.** It is a proof of concept, not a production plugin.
> It targets a draft browser API. Run it only on a local or throwaway site.

This WordPress plugin exposes page-scoped frontend Abilities as Site tools for
ChatGPT Work and Codex in the ChatGPT desktop app's built-in browser. The agent
works against the same live page, signed-in session, and Gutenberg state the user
sees.

It is not a generic MCP bridge or a backend automation catalog. The adapter never
imports `@wordpress/core-abilities`, requests the REST Ability catalog, or projects
an Ability marked `serverRegistered`.

## Try it

You need WordPress 7.0+, PHP 8.1+, Node.js 22+, and the latest ChatGPT desktop app
with Site tools available. Docker is required only for wp-env.

```bash
git clone https://github.com/galatanovidiu/webmcp-adapter
cd webmcp-adapter
npm ci
npx wp-env start
```

Open `http://localhost:8888/wp-admin/post-new.php?post_type=page` in the built-in
browser and sign in with wp-env's `admin` / `password` credentials. Ask ChatGPT
Work or Codex to inspect the editor. A compatible block-editor page exposes the
complete 17-tool inventory after registration settles.

For a disposable, no-Docker WordPress 7.0.4 environment:

```bash
.agents/skills/webmcp-playground/webmcp-playground.sh test
```

This boots WordPress with the adapter and its acceptance-only provider fixture,
checks the editor inventory, and executes `webmcp.editor-context`. See
[development.md](docs/development.md) for the complete acceptance workflow.

## Page-scoped inventories

Each top-level document receives only the providers that apply to it.

| Page | Site tools |
|---|---:|
| Anonymous frontend | 2 |
| Authenticated frontend | 3 |
| Generic wp-admin | 2 |
| General Settings | 3 |
| Compatible post, page, or custom-post-type block editor | 17 |
| Site Editor | 17 |
| Login, password reset, and registration | 0 |

The two base frontend tools report page context and rendered site destinations.
Authenticated frontend pages also expose rendered admin-toolbar destinations.
Generic wp-admin pages report page context and rendered admin-menu destinations.

Destination results provide same-origin URLs. Use normal browser navigation to
open one, then rediscover the new document's tools.

## Ability projection

Provider plugins register normal client Abilities through `@wordpress/abilities`
only on the pages they own. The adapter observes the shared client store and
projects records with `clientRegistered: true` and without
`serverRegistered: true`.

| WordPress Ability field | WebMCP field |
|---|---|
| `name` (`namespace/name`) | `name` (`namespace.name`) |
| `label` | `title` |
| `description` | `description` |
| `input_schema` | `inputSchema` |
| `meta.annotations.readonly` | `annotations.readOnlyHint` |
| frontend callback | `execute(params, { signal })` |

The slash-to-dot mapping preserves Ability segment boundaries. Every definition
sets `untrustedContentHint: true`. Registration failures remain retryable, removed
Abilities abort their WebMCP registrations, and same-name replacements remove the
old definition before registering the new one.

## Editor tools

Compatible block-editor screens add 15 tools to the two wp-admin base reads.

Six reads:

- `webmcp.editor-context`
- `webmcp.read-blocks`
- `webmcp.list-block-types`
- `webmcp.get-theme-design-tokens`
- `webmcp.list-patterns`
- `webmcp.list-templates`

Eight reversible, unsaved writes:

- `webmcp.insert-blocks`
- `webmcp.update-block-attributes`
- `webmcp.insert-pattern`
- `webmcp.remove-blocks`
- `webmcp.move-blocks`
- `webmcp.replace-blocks`
- `webmcp.edit-post-attributes`
- `webmcp.undo`

`webmcp.save-post` is the consequential persistence tool. It saves staged editor
state and can publish only when its `status` argument explicitly requests that
transition. `webmcp.edit-post-attributes` rejects `status`.

The editor API is block-agnostic. It uses recursive
`{ name, attributes, innerBlocks }` block specs instead of one tool per block type.

## General Settings

`wordpress.settings.stage-general-form` is available only on
`options-general.php`. It updates supported visible controls, dispatches their
normal events, highlights changes, and asks the user to review the form and choose
**Save Changes**. The callback never submits the form or sends a persistence
request. Reloading discards staged values.

The Administration Email value is sensitive. It is never echoed in the result,
review feedback, activity request, stored event, or exporter hook.

## Safety and activity

Every applicable Ability with valid risk metadata is available on its page.
Readonly Abilities derive the `read` risk. Mutations declare `reversible`,
`persistent`, `consequential`, or `privileged`; an invalid mutation declaration
fails closed.

Consequential and privileged calls always open the plugin's in-page confirmation.
Approval requires an `event.isTrusted` click. Decline, Escape, 60-second expiry,
forwarded cancellation, and a final pre-execution context check all prevent the
action from running.

Eligible pages show one minimized 48-pixel activity control by default. Expanding
it reveals in-tab running and final states. Authentication screens load neither
the adapter nor the activity UI.

Each completed invocation attempt also sends one non-blocking, redacted event to
the backend. The default store keeps seven days or 10,000 rows, whichever bound is
reached first. Administrators can review it under **Tools → Site tools activity**.
Anonymous ingestion uses signed short-lived context tokens, hashed identifiers,
payload limits, and rate limits. Observability failure never changes a tool result.

See [architecture.md](docs/architecture.md) for the runtime and data boundaries and
[provider-extension.md](docs/provider-extension.md) for third-party registration.
The [Site tools learning guide](docs/webmcp-learning-guide.md) also has a
[speech-friendly PDF](output/pdf/webmcp-chatgpt-work-codex-site-tools-speechify.pdf).

## Client limitations

ChatGPT Work and Codex currently discover imperative registrations from the
top-level document. They do not discover declarative form tools or iframe
registrations. Tools are document-bound: navigation or reload requires discovery
on the new page, while same-document refresh timing remains unspecified.

The built-in browser performs its own invocation safety review. That product layer
is separate from WordPress authorization and the plugin's confirmation.

## Install and uninstall

For a local trial, use wp-env or Playground above. For a manual installation,
download `webmcp-adapter.zip` from the
[latest release](https://github.com/galatanovidiu/webmcp-adapter/releases/latest),
upload it under **Plugins → Add New → Upload Plugin**, and activate it. No companion
Ability catalog is required.

Normal activation and upgrade preserve existing activity rows and retired option
values for rollback compatibility. Deactivation stops scheduled retention without
deleting stored review data. WordPress uninstall removes the activity table,
plugin options, scheduled retention, and temporary anonymous rate-limit counters.

## Status

Proof of concept. WebMCP remains a draft, and browser/product behavior can change.
Check the [official Site tools documentation](https://learn.chatgpt.com/docs/webmcp)
for current availability and limitations.

## License

GPL-2.0-or-later.
