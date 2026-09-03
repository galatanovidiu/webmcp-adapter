# Page-scoped WebMCP tools for WordPress

Research and decision record, verified 3 September 2026.

This document records the evidence and product decisions behind the implemented
page-scoped architecture. For the released runtime contract, use
[architecture.md](architecture.md); for current ChatGPT Work and Codex behavior,
use [webmcp-learning-guide.md](webmcp-learning-guide.md).

## Conclusion

Use the current `Document`'s WordPress client Ability store as its WebMCP inventory.
Load a small adapter on every eligible top-level frontend and wp-admin document,
then let WordPress core, this plugin, and third-party plugins register client
Abilities only where their callbacks are meaningful.

This design follows the two owning registries:

- WebMCP registrations belong to one `Document`.
- `@wordpress/abilities` owns client registration, querying, execution,
  permission callbacks, schema validation, and unregistration.

The adapter remains provider-independent. It projects the current page's eligible
client Abilities, mirrors their lifecycle, applies WebMCP policy, and records
bounded activity. Providers own page selection and behavior.

## Verified platform facts

### WebMCP is document-bound

The WebMCP draft associates one `ModelContext` with each `Document`.
`registerTool()` adds a tool to that document. A registration-scoped
`AbortSignal` removes it, and an invocation receives a separate cancellation
signal. See the [WebMCP interfaces](https://webmachinelearning.github.io/webmcp/#model-context-api).

OpenAI states that Site tools belong to the page providing them. Closing the page
or navigating away can make them unavailable. ChatGPT Work and Codex currently
discover top-level imperative registrations, not declarative form tools or iframe
registrations. See [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp).

Page JavaScript can listen for `toolchange` and call `getTools()`. OpenAI does not
publish a same-document refresh deadline or a site API that forces rediscovery.
Full navigation is therefore the clearest context boundary. Same-document routes
still need stable definitions and execution-time guards.

### WordPress owns the client Ability contract

WordPress 7.0's `@wordpress/abilities` package provides the `core/abilities` store
and the client functions `registerAbility`, `registerAbilityCategory`,
`getAbilities`, `executeAbility`, `unregisterAbility`, and
`unregisterAbilityCategory`. Client Abilities run browser callbacks;
`@wordpress/core-abilities` is the separate REST-backed layer.

`registerAbility()` requires an existing category and globally unique name. It
validates input, runs `permissionCallback`, executes the callback, and validates
output when schemas are present. Normal client registration adds
`meta.annotations.clientRegistered: true`.

WordPress preserves custom top-level `meta` keys but filters annotation keys.
Adapter policy therefore belongs under `meta.webmcp`, while standard WordPress
annotations remain `readonly`, `destructive`, and `idempotent`.

Primary references:

- [WordPress Client-Side Abilities API dev note](https://make.wordpress.org/core/2026/03/24/client-side-abilities-api-in-wordpress-7-0/)
- [`@wordpress/abilities` reference](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-abilities/)
- [Gutenberg registration action](https://github.com/WordPress/gutenberg/blob/6fee93b8e4381051cc66e492f7e94b03596ec481/packages/abilities/src/store/actions.ts#L130-L154)
- [WordPress 7.0 built package](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/js/dist/script-modules/abilities/index.js#L7140-L7184)

### Public Script Modules need explicit classic dependencies

`@wordpress/abilities` is a default WordPress 7.0 Script Module. Providers register
versioned modules through `wp_register_script_module()` and enqueue them through
`wp_enqueue_script_module()`.

The WordPress 7.0 built module reads `window.wp.data` and `window.wp.i18n`. Public
pages must enqueue `wp-data` and `wp-i18n` explicitly rather than assuming the
theme already loaded them. Themes must provide the normal `wp_head` and
`wp_footer` hooks for Script Modules to print.

See [`wp_register_script_module()`](https://developer.wordpress.org/reference/functions/wp_register_script_module/),
[`wp_enqueue_script_module()`](https://developer.wordpress.org/reference/functions/wp_enqueue_script_module/),
and [`wp_enqueue_scripts`](https://developer.wordpress.org/reference/hooks/wp_enqueue_scripts/).

### Authentication screens are a separate surface

`wp-login.php` fires login-specific hooks. WordPress 7.0 installs Script Module
printers on normal frontend and admin output hooks, not the login-page hooks.
Authentication screens also handle passwords, passkeys, recovery codes, and
two-factor secrets that do not belong in Site tool schemas.

The implemented first version loads no adapter assets, Site tools, or activity UI
on login, password-reset, registration, or two-factor documents.

### Authentication is not authorization

Site tools run in the current signed-in page session. That does not create new
authority. Every provider must keep exact server-side authorization where the
underlying action crosses the browser boundary and must revalidate live client
state before any browser-side mutation. A client `permissionCallback` controls
normal Ability execution but is not a server security boundary.

See [WordPress roles and capabilities](https://developer.wordpress.org/apis/security/user-roles-and-capabilities/)
and [nonce guidance](https://developer.wordpress.org/apis/security/nonces/).

## Implemented page model

The inventory is the union of provider modules selected for four facts:

1. **Surface:** frontend, wp-admin, or authentication screen.
2. **Authority:** anonymous, authenticated, and the exact permissions used by an
   action.
3. **Application:** WordPress core, block editor, Site Editor, or a plugin-owned
   application.
4. **Live context:** current screen, document, route, DOM, and application state.

| Context | Provider ownership |
|---|---|
| Frontend base | page context and rendered site navigation |
| Authenticated frontend | frontend base plus rendered admin toolbar |
| wp-admin base | page context and rendered admin menu |
| General Settings | one provider-owned staging Ability |
| Block editor | common Gutenberg provider selected by `WP_Screen::is_block_editor()` |
| Site Editor | common Gutenberg provider in the top-level shell with live route guards |
| Plugin page | provider plugin's own PHP predicate and Script Modules |
| Authentication screen | no provider |

Post-type compatibility comes from WordPress. A post type must support the editor,
be available through REST, and not be filtered away from the block editor. The
adapter keeps no post-type list. See
[`WP_Screen::is_block_editor()`](https://developer.wordpress.org/reference/classes/wp_screen/is_block_editor/)
and [`use_block_editor_for_post_type()`](https://developer.wordpress.org/reference/functions/use_block_editor_for_post_type/).

## Navigation decision

Site and admin destination Abilities read navigation that WordPress rendered for
the current user. They return normalized labels and same-origin URLs, reject action
or authentication links, deduplicate URLs, and preserve rendered order.

The browser opens a returned URL through its ordinary navigation controls. The new
document then publishes its own inventory. This avoids a second hard-coded admin
URL registry and keeps navigation semantics visible to the user.

## Provider decision

The supported extension model is provider-owned conditional Ability modules.

A provider plugin:

1. selects owned pages through normal public/admin hooks and WordPress predicates;
2. enqueues versioned Script Modules that depend on `@wordpress/abilities`;
3. registers its category before its Abilities;
4. supplies precise schemas, WordPress annotations, `meta.webmcp.risk`, permission
   callbacks, and browser callbacks;
5. revalidates live state and exact authorization on every call; and
6. adds server-owned activity definitions for events it wants persisted.

The adapter does not require a PHP provider registry, page-context enumeration, or
direct `document.modelContext.registerTool()` calls from providers. Module presence
selects the page. The same module can be enqueued in several contexts for a shared
Ability.

See [provider-extension.md](provider-extension.md) and the disposable
[`tests/fixtures/webmcp-provider`](../tests/fixtures/webmcp-provider/) reference.

## Naming and lifecycle decisions

WordPress Ability names project from `namespace/name` to `namespace.name`.
WordPress Ability segments cannot contain dots, so the conversion is injective and
reversible.

The adapter keeps one registration record per Ability with the projected name,
definition fingerprint, promise state, and registration-scoped abort controller.
It:

- reports collisions before registration;
- waits for `registerTool()` before marking a tool active;
- leaves rejected registrations retryable;
- aborts the WebMCP registration when an Ability disappears; and
- removes an existing definition before a same-name replacement.

Callbacks still reject stale state because registration and model rediscovery can
race a same-document transition.

## Risk and supervision decisions

Readonly Abilities derive `read` risk. Mutations declare one adapter-specific risk
under `meta.webmcp.risk`:

- `reversible` for temporary page/editor/session state;
- `persistent` for saved site or account data;
- `consequential` for publishing, purchases, messages, refunds, or deletion; and
- `privileged` for permissions, extensions, themes, or executable code.

Missing or invalid mutation risk fails closed. Consequential and privileged calls
always use the in-page trusted-click confirmation, which expires after 60 seconds
and observes forwarded cancellation. This is a supervision layer, not proof of
human intent against a privileged automation client.

## Form decision

Do not infer tools from arbitrary DOM forms. Each supported physical form receives
one provider-authored staging Ability with a closed schema. It exposes only safe,
meaningful controls; updates real application or DOM state through native paths;
verifies the visible result; and never submits.

The first version implements General Settings only. The agent stages; the user
reviews and saves. Administration Email is redacted from every result, review
notice, event, stored row, and exporter hook.

## Activity and observability decisions

Every eligible page starts with a small minimized activity control. The detail
region opens only on request, records running/final states, supports keyboard and
screen-reader use, isolates styles, and stores only its open/minimized state in the
current tab's `sessionStorage`.

Each completed attempt sends one non-blocking backend event. The server stores only
bounded identifiers and classifications, normalized page context/path, hashed
anonymous identity or user ID, outcome, duration, confirmation outcome, safe error
code, and an optional allowlisted summary. It does not store raw inputs, outputs,
content, arbitrary errors, IP addresses, login-session tokens, credentials, or
personal/payment data.

Anonymous ingestion uses short-lived signed context tokens, a 4 KB payload bound,
and hashed token/run/network rate limits. Default retention is seven days and
10,000 rows. A documented action fires after successful storage for external
exporters; observability failure never changes the Ability result.

## Deliberate exclusions

- Classic Editor, Customizer, Widgets, and legacy-interface providers.
- Production WooCommerce tools in this repository.
- New Site Editor-specific tools.
- Page-specific Dashboard, list-table, Media, Comments, Users, Plugins, Themes,
  or other Settings tools.
- Server Ability projection.
- Login, password-reset, registration, or two-factor tools.

## Product unknowns to recheck

Current OpenAI documentation does not specify:

- same-document Site tools refresh timing;
- a page API that forces the desktop app to rediscover tools;
- exact callback-cancellation forwarding behavior;
- the exact result/error wrapper for every callback failure; or
- a maximum Site tool count.

These are acceptance targets, not facts to infer from the broader specification.
Recheck [OpenAI Site tools](https://learn.chatgpt.com/docs/webmcp) before relying on
mutable product behavior.
