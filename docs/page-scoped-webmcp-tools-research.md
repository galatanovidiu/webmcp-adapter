# Page-scoped WebMCP tools for WordPress

Research snapshot: 3 September 2026.

Status: research and decision input. This document does not authorize or describe
an implemented runtime change. It separates verified facts, recommendations, and
questions that still need a product decision.

## Executive conclusion

**Recommendation:** make the current `Document`'s WordPress client Ability store the
source of its WebMCP inventory. Load a small adapter shell on every eligible
top-level WordPress page, then let WordPress core, this plugin, and third-party
plugins register client-side Abilities only in the page contexts where their
callbacks are meaningful. The adapter should project the matching client Abilities;
it should not own one exhaustive global tool catalog.

Under that model:

- A page-specific tool is registered by an Ability module enqueued only for that
  page or screen family.
- A shared tool is the same Ability module enqueued in several contexts. Each new
  document registers its own copy; the tool is not global or persistent.
- A block-editor module is selected by the actual WordPress block-editor screen
  state, not by hard-coding `post` and `page`, so compatible custom post types work.
- WooCommerce or another plugin owns its page logic, Ability definitions, schemas,
  permissions, and conditional enqueue. The WebMCP Adapter owns projection,
  exposure policy, confirmation, cancellation, collision handling, and diagnostics.
- Every callback still rechecks the live route, application state, and permission
  immediately before acting. Page-level selection reduces stale calls; it does not
  make stale calls impossible.

This follows the two relevant registries instead of inventing a second capability
API: WebMCP tools belong to a `Document`, while `@wordpress/abilities` already
supports client-side registration, querying, execution, permission callbacks, and
unregistration.

## 1. Verified facts

### 1.1 WebMCP is document-scoped

**Fact:** the current WebMCP draft gives every `Document` its own associated
`ModelContext`. `registerTool()` registers into that document's tool map. A
registration-scoped `AbortSignal` removes the tool, and registration/removal emits
`toolchange`. The invocation callback receives a different signal for cancelling
one execution. See the [WebMCP `Document` and `ModelContext` interfaces](https://webmachinelearning.github.io/webmcp/#model-context-api),
[registration options](https://webmachinelearning.github.io/webmcp/#modelcontextregistertooloptions-dictionary),
and [callback options](https://webmachinelearning.github.io/webmcp/#toolexecutecallbackoptions-dictionary).

**Fact:** OpenAI says Site tools belong to the page providing them, and closing or
navigating away from that page can make them unavailable. ChatGPT Work and Codex
currently discover top-level imperative tools, not declarative form tools or tools
inside iframes. See [OpenAI Site tools: how it works and limitations](https://learn.chatgpt.com/docs/webmcp#how-it-works-in-the-browser).

**Fact:** page JavaScript can observe `toolchange` and call `getTools()`, but the
draft says the browser's agent uses a different internal retrieval mechanism and
describes its page observation as implementation-defined. OpenAI does not publish
a same-document refresh deadline or a site API that forces rediscovery. Therefore a
late register/unregister is valid page-side behavior, but immediate ChatGPT Work or
Codex rediscovery is not a safe product assumption. See the draft's
[`getTools()` distinction](https://webmachinelearning.github.io/webmcp/#dom-modelcontext-gettools)
and [page observations](https://webmachinelearning.github.io/webmcp/#page-observations).

**Consequence:** full navigation is the clean context boundary. Same-document SPA
route changes need conservative tools and execution-time guards even if the bridge
eventually mirrors registration changes.

### 1.2 WordPress already has the client extension seam

**Fact:** WordPress 7.0's `@wordpress/abilities` package provides a shared
`core/abilities` data store plus `registerAbility`, `registerAbilityCategory`,
`getAbilities`, `executeAbility`, `unregisterAbility`, and
`unregisterAbilityCategory`. Client-side Abilities run browser callbacks;
`@wordpress/core-abilities` is the separate layer that imports server-registered
Abilities over REST. See the [WordPress 7.0 Client-Side Abilities API dev note](https://make.wordpress.org/core/2026/03/24/client-side-abilities-api-in-wordpress-7-0/)
and [`@wordpress/abilities` package reference](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-abilities/).

**Fact:** `registerAbility()` requires a pre-existing category and a globally unique
Ability name. It validates input before the callback and output after the callback
when schemas are present; it also runs `permissionCallback` before execution. This
makes the Ability, rather than a WebMCP-specific object, the reusable contract.

**Fact:** current WordPress source automatically sets
`meta.annotations.clientRegistered = true` unless `serverRegistered` is true.
Registration filters annotation keys to `readonly`, `destructive`, `idempotent`,
`serverRegistered`, and `clientRegistered`. Arbitrary keys placed inside
`meta.annotations` do not survive. Other top-level `meta` keys do survive because
registration spreads the supplied `meta` before replacing only `annotations`, and
the reducer preserves the whole `meta` property. Evidence:

- [Gutenberg registration action](https://github.com/WordPress/gutenberg/blob/6fee93b8e4381051cc66e492f7e94b03596ec481/packages/abilities/src/store/actions.ts#L130-L154)
- [Gutenberg Ability reducer](https://github.com/WordPress/gutenberg/blob/6fee93b8e4381051cc66e492f7e94b03596ec481/packages/abilities/src/store/reducer.ts#L17-L56)
- [WordPress 7.0 built package](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/js/dist/script-modules/abilities/index.js#L7140-L7184)

**Consequence:** if adapter-specific context metadata is chosen, it can live under
`meta.webmcp`, not under `meta.annotations`. Plugin authors do not need to set
`clientRegistered` themselves when using the normal client registration API.

**Fact:** `unregisterAbility(name)` removes an Ability from the WordPress store.
The current WebMCP adapter subscribes to additions but is additive: it retains a
`registered` set and does not hold registration abort controllers, diff removals, or
mirror Ability changes. WordPress therefore has enough lifecycle API to express a
same-document context change, but [the current adapter](../src/adapter.js) does not
carry that lifecycle through to WebMCP.

### 1.3 Public front-end modules work, with a WordPress 7.0 dependency caveat

**Fact:** `@wordpress/abilities` is registered as a default WordPress 7.0 script
module. A plugin module may declare `@wordpress/abilities` in the dependency list
passed to `wp_register_script_module()`, and WordPress's front-end module printer
uses `wp_head`/`wp_footer`. The normal front-end enqueue hook is
`wp_enqueue_scripts`; `admin_enqueue_scripts` is for wp-admin. See
[`wp_register_script_module()`](https://developer.wordpress.org/reference/functions/wp_register_script_module/),
[`wp_enqueue_script_module()`](https://developer.wordpress.org/reference/functions/wp_enqueue_script_module/),
and [`wp_enqueue_scripts`](https://developer.wordpress.org/reference/hooks/wp_enqueue_scripts/).

**Fact and caveat:** the WordPress 7.0 built `@wordpress/abilities` module reads the
classic globals `window.wp.data` and `window.wp.i18n`. Its package metadata names
`wp-data` and `wp-i18n`, but the default script-module registration path passes only
`module_dependencies` into the script-module registry. Those classic globals are
normally present in wp-admin, but are not guaranteed on an arbitrary public theme
page. A public enqueuer must explicitly enqueue the classic dependencies (or prove
that its existing dependency tree does) as well as declaring the module dependency.
See the WordPress 7.0
[package map](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/assets/script-modules-packages.php#L8-L13),
[default module registration](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/script-modules.php#L167-L220),
and [built package externals](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/js/dist/script-modules/abilities/index.js#L31-L42).

**Fact:** theme output is part of this contract. WordPress prints front-end modules
through `wp_head`/`wp_footer`; a nonconforming theme that omits the relevant hook can
prevent them from appearing. This is the same platform caveat as other enqueued
front-end assets.

### 1.4 The login screen is not a normal script-module surface

**Fact:** `wp-login.php` fires `login_enqueue_scripts`, `login_head`, and
`login_footer`. WordPress 7.0's Script Modules API installs printers only on
`wp_head`, `wp_footer`, and `admin_print_footer_scripts`; it does not install a
login-page printer. Enqueueing a script module from `login_enqueue_scripts` alone
therefore does not print its import map, module, data, preloads, and translations.
See [WordPress 7.0's module print hooks](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-includes/class-wp-script-modules.php#L423-L466)
and [login page hooks](https://github.com/WordPress/wordpress-develop/blob/7.0/src/wp-login.php#L115-L127).

**Recommendation:** expose no WebMCP login tool in the first design. ChatGPT can use
the normal login UI, and a tool schema should never collect a password, passkey,
recovery code, or two-factor secret. If login-page tools become a requirement, they
need explicit script-module printing integration and a separate security design;
they are not covered by the normal public/admin enqueue path.

### 1.5 Authentication is not authorization

**Fact:** Site tools run in the same signed-in page session, but OpenAI instructs
sites to retain their own authentication, authorization, and input validation.
WordPress likewise requires capability checks for public or admin writes, and says
nonces must not be treated as authentication or authorization. See
[OpenAI's implementation guidance](https://learn.chatgpt.com/docs/webmcp#add-webmcp-to-your-website),
[WordPress roles and capabilities](https://developer.wordpress.org/apis/security/user-roles-and-capabilities/),
and [WordPress nonces](https://developer.wordpress.org/apis/security/nonces/).

**Consequence:** “logged in” is only an inventory precondition for management tools.
The server endpoint or existing application operation invoked by a client Ability
still needs an object-specific capability check, such as whether this user can edit
this post or manage this store order. A client-side `permissionCallback` controls
normal Ability execution, but page JavaScript can bypass it, so it is not a server
authorization boundary.

### 1.6 Current repository baseline and gaps

The following are facts about the current working tree, not recommendations:

| Current behavior                                                                                                                         | Page-scoped implication                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Plugin::register()`](../includes/Plugin.php) hooks only `admin_enqueue_scripts`.                                                       | The adapter is not currently on public front-end or login pages.                                                                                          |
| [`src/adapter.js`](../src/adapter.js) imports one barrel, [`src/abilities/index.js`](../src/abilities/index.js), on every wp-admin page. | All 16 built-in definitions enter every admin document; editor reads fail gracefully off-editor rather than being absent.                                 |
| The bridge filters for `clientRegistered === true` and excludes every `serverRegistered` record, then subscribes for late additions.     | A third-party plugin can already extend the page through the WordPress client store without importing `@wordpress/core-abilities`.                        |
| The bridge is additive and tracks names in `registered`/`pending` sets.                                                                  | It does not remove a WebMCP tool when an Ability is unregistered or its context changes.                                                                  |
| Ability names are converted by replacing every `/` with `-`.                                                                             | The mapping is non-injective: for example, `vendor/foo-bar` and `vendor/foo/bar` both become `vendor-foo-bar`. This is a real third-party collision risk. |
| Write and destructive exposure settings are global booleans read once per document.                                                      | An editor-centric write policy may not fit reversible visitor-session writes such as changing a cart.                                                     |
| The activity REST route requires `manage_options` for both recording and reading.                                                        | Anonymous visitors, customers, subscribers, authors, and many shop staff cannot use the current persisted audit path.                                     |
| Tools register in the top-level document and callbacks recheck live editor state.                                                        | These are foundations worth preserving for Site Editor and stale-context safety.                                                                          |

## 2. Recommended page/context taxonomy

**Recommendation:** do not model context as one growing enumeration of URLs. Model
it as the intersection of four axes:

1. **Surface:** public front end, wp-admin, or authentication screen.
2. **Authority:** anonymous, authenticated, and exact capabilities relevant to an
   action.
3. **Application:** WordPress core, block editor, Site Editor, WooCommerce, or
   another plugin-owned application.
4. **Screen/route:** singular content, collection, list table, editor, settings,
   product, cart, checkout, order detail, and so on.

The document inventory is the union of the small Ability providers whose predicates
match all four axes.

| Context ID (provisional)       | Detection/owner                                                               | What belongs here                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `public-base`                  | `wp_enqueue_scripts`; any normal top-level theme page                         | Public page orientation and site navigation.                                                                |
| `public-singular`              | WordPress singular query; post type/id known                                  | Structured context for the current post, page, or public CPT.                                               |
| `public-collection`            | Home, archive, taxonomy, author, date, or search result                       | Current query, filters, pagination, and navigation among results.                                           |
| `public-authenticated`         | Public page plus logged-in state and relevant capability                      | Management destinations for the current object. Do not expose an action from login state alone.             |
| `admin-base`                   | `admin_enqueue_scripts`; site, network, or user admin                         | Current admin screen and authorized navigation.                                                             |
| `admin-dashboard`              | Dashboard screen                                                              | Dashboard-specific structured reads and destinations.                                                       |
| `admin-list`                   | Core or plugin list-table/DataViews screen                                    | Inspect/filter/search/sort/paginate/open records; page owner defines record semantics.                      |
| `admin-detail`                 | Settings, taxonomy, user, media, plugin, theme, or plugin-owned detail screen | Only domain-specific form or record abilities; avoid a generic arbitrary-form executor.                     |
| `block-editor`                 | `$screen->is_block_editor()` plus live editor-store check                     | Shared post/page/CPT block tools. WordPress determines compatibility; do not hard-code post types.          |
| `site-editor`                  | Site Editor screen plus its current in-document route                         | Site, template, part, pattern, navigation, global-styles, and page routes. Register in the top-level shell. |
| `classic-editor`               | Edit screen where `is_block_editor()` is false                                | No Gutenberg tools. Add a separate provider only if classic-editor support is intentionally chosen.         |
| `auth-screen`                  | `wp-login.php` action such as login, logout, reset, register                  | No first-phase Site tools; separate printing and credential-safety boundary.                                |
| `plugin:<namespace>:<context>` | Plugin-owned PHP screen predicates plus live JS state                         | WooCommerce or any extender registers its own client Abilities where its UI and logic exist.                |

**Fact:** `WP_Screen::is_block_editor()` reports whether the current admin screen is
loading the block editor, and WordPress sets it for both post editing and the Site
Editor. A post type is block-editor compatible only when it supports `editor`, is
shown in REST, and has not been filtered out. See
[`WP_Screen::is_block_editor()`](https://developer.wordpress.org/reference/classes/wp_screen/is_block_editor/)
and [`use_block_editor_for_post_type()`](https://developer.wordpress.org/reference/functions/use_block_editor_for_post_type/).

**Recommendation:** treat Site Editor as both `admin-base + block-editor +
site-editor`. Its top-level shell stays alive while routes can change, so its tools
should be stable across the route family or must be able to reject an inapplicable
call after reading the current route and stores.

## 3. Candidate core tool inventory

Names below are logical WordPress Ability names, not a final naming decision. The
current adapter will also need a collision-safe WebMCP name mapping before this
becomes a public extension contract.

### 3.1 Shared tools

| Candidate Ability                | Contexts                             | Purpose                                                                                                                                                               | Tier       |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `webmcp/get-page-context`        | Every eligible public/admin document | Return the current surface, normalized screen/route, content object when applicable, auth state, and only the capability booleans needed to choose safe next actions. | Read       |
| `webmcp/list-site-destinations`  | Public and admin                     | Return semantic same-site destinations currently available through site navigation.                                                                                   | Read       |
| `webmcp/navigate-site`           | Public and admin                     | Open a validated same-origin public destination; rediscovery follows full navigation.                                                                                 | Navigation |
| `webmcp/list-admin-destinations` | Authorized front end and wp-admin    | Return only management destinations the current user can access.                                                                                                      | Read       |
| `webmcp/navigate-admin`          | Authorized front end and wp-admin    | Open a validated wp-admin destination supplied by the preceding inventory.                                                                                            | Navigation |

**Recommendation:** keep “list destinations” separate from “navigate” so a raw URL
is not the only semantic contract. Do not add generic `click`, `fill-selector`, or
`submit-form` tools; the browser already has ordinary UI interaction, and domain
tools can express validation and side effects more safely.

### 3.2 Public WordPress pages

| Page family                         | Useful page-specific candidates                                                                                 | Notes                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Front page / blog home              | `get-home-context`, `search-site`                                                                               | Expose structured sections or query inputs only when they add value beyond reading the DOM.                                  |
| Singular post/page/CPT              | `get-current-content-context`, `list-related-content-destinations`                                              | Return canonical ID/type/title/permalink and public taxonomy/author data; do not leak private edit metadata.                 |
| Archive/taxonomy/author/date/search | `get-content-collection-context`, `set-content-collection-filters`, `open-content-result`, `go-to-content-page` | Prefer URL/query-state transitions that remain visible and shareable.                                                        |
| 404/empty results                   | `search-site`, `list-site-destinations`                                                                         | No write tools. Return recovery destinations rather than inventing content.                                                  |
| Comment/form-bearing pages          | Domain-specific read/prepare/submit abilities only if selected later                                            | Submission sends data and needs anti-spam, authorization/nonce, confirmation, and privacy decisions; no generic form bridge. |
| Authenticated public page           | `list-admin-destinations`, `open-current-content-editor`, `open-site-editor` when capability checks pass        | The admin bar is a useful source of authorized destinations, but its presence is not the permission check.                   |

### 3.3 General wp-admin pages

| Screen family               | Useful page-specific candidates                                                                                                 | Notes                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                   | `get-dashboard-context`, `list-dashboard-widgets`, `open-dashboard-destination`                                                 | Read-only first; avoid duplicating every visible widget as a tool.                                                                    |
| Posts/pages/CPT list tables | `get-content-list-context`, `set-content-list-filters`, `search-content-list`, `open-content-editor`, `go-to-content-list-page` | A later gated tool could apply an explicitly named bulk action to selected IDs.                                                       |
| Media Library               | `get-media-library-context`, `search-media`, `filter-media`, `get-selected-media`, `open-media-item`                            | Upload, edit, and delete are separate write/destructive candidates, not one broad media tool.                                         |
| Comments                    | `get-comments-context`, `filter-comments`, `search-comments`, `open-comment`                                                    | Approve, unapprove, spam, and trash are consequential state changes and need individual semantics.                                    |
| Taxonomies                  | `get-terms-context`, `search-terms`, `open-term`                                                                                | Create/update/delete belong in a later write tier with taxonomy-specific capability checks.                                           |
| Users                       | `get-users-context`, `filter-users`, `search-users`, `open-user`                                                                | Creating users, changing roles, resetting passwords, or deleting users are high-risk and should not enter a generic first tranche.    |
| Plugins/themes              | `get-extensions-context`, `filter-extensions`, `open-extension-details`                                                         | Install/update/activate/deactivate/delete changes executable site code and needs a dedicated high-risk policy.                        |
| Settings and plugin pages   | One provider-owned context read plus narrowly named settings actions                                                            | Never project an arbitrary settings form as one generic write tool. The screen owner knows field meaning, validation, and capability. |
| Network/user admin          | Separate context from site admin                                                                                                | Multisite authority and destination sets differ; do not infer them from `is_admin()` alone.                                           |

### 3.4 Block editor for posts, pages, and compatible CPTs

**Recommendation:** move the existing editor inventory into a block-editor provider
instead of registering it on every admin page. Keep the block-agnostic design.

Existing candidates that already have implementations:

- Reads: `editor-context`, `read-blocks`, `list-block-types`,
  `get-theme-design-tokens`, `list-patterns`, and `list-templates`.
- Reversible unsaved writes: `insert-blocks`, `update-block-attributes`,
  `insert-pattern`, `remove-blocks`, `move-blocks`, `replace-blocks`,
  `edit-post-attributes`, and `undo`.
- Persistence: `save-post`, behind a separate consequential-action policy and
  confirmation.

Potential follow-ups:

- `redo` and a compact `get-document-outline` if they materially improve agent
  recovery/orientation.
- Media selection/upload abilities only after their permission, progress,
  cancellation, and audit behavior is designed.
- Taxonomy, featured image, scheduling, revisions, and collaboration/comment tools
  as separate contracts where existing `edit-post-attributes` is insufficient.

### 3.5 Site Editor

The Site Editor should compose the shared block-editor tools with Site Editor
abilities:

| Candidate Ability                  | Purpose                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `webmcp/get-site-editor-context`   | Report current Site Editor route, entity, mode, selection, dirty entities, and save state.                       |
| `webmcp/list-site-entities`        | List pages, templates, template parts, patterns, and navigation entities available from the current Site Editor. |
| `webmcp/open-site-entity`          | Move to a selected Site Editor route/entity without guessing its URL shape.                                      |
| `webmcp/get-global-styles-context` | Return editable style/settings scope and current design tokens.                                                  |
| `webmcp/update-global-styles`      | Stage a narrow, validated style patch with undo/checkpoint behavior.                                             |
| `webmcp/get-navigation-context`    | Return the selected navigation entity/tree and its current editability.                                          |
| `webmcp/save-site-editor-changes`  | Persist an explicit set of dirty entities after showing exactly what will be saved.                              |

**Open decision:** whether Site Editor route-specific tools remain registered but
return “not in this route”, or register/unregister as routes change. The former is
more robust against unspecified Site tools refresh timing; the latter gives a
cleaner inventory but requires bridge lifecycle work and client testing.

## 4. WooCommerce as the extension test

WooCommerce is useful because it exercises public, authenticated, visitor-session,
financial, and wp-admin contexts without requiring WooCommerce logic in the
adapter.

| WooCommerce page context      | Plugin-owned client Ability candidates                                                                                                    | Risk notes                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shop/category/search          | `search-products`, `get-product-collection-context`, `set-product-filters`, `open-product`                                                | Read/navigation first.                                                                                                                 |
| Product detail                | `get-product-context`, `list-product-options`, `select-product-options`, `add-product-to-cart`                                            | Cart addition mutates visitor/session state even though it is reversible.                                                              |
| Cart                          | `get-cart-context`, `set-cart-item-quantity`, `remove-cart-item`, `apply-coupon`, `remove-coupon`, `open-checkout`                        | Needs a policy distinct from editor writes and persistent destructive changes.                                                         |
| Checkout                      | `get-checkout-context`, `list-shipping-methods`, `select-shipping-method`, `list-payment-methods`, `select-payment-method`, `place-order` | Do not return or accept payment secrets. Placing an order is consequential and needs normal Woo validation plus explicit confirmation. |
| My Account                    | `get-account-context`, `list-orders`, `open-order`, `list-downloads`                                                                      | Authenticated/customer-scoped output; verify ownership on every request.                                                               |
| Woo admin dashboard/analytics | Context, filters, date range, and chart-data reads                                                                                        | Strong WebMCP fit because agent and user inspect the same dashboard.                                                                   |
| Woo products/orders list      | List context, filters, search, pagination, open record                                                                                    | Reuse list concepts but let Woo own schemas and route details.                                                                         |
| Woo product/order editor      | Record context and narrowly named edits                                                                                                   | Status, inventory, refunds, fulfillment, and customer messages need distinct permissions and consequence levels.                       |

**Recommendation:** use WooCommerce acceptance fixtures to prove that:

1. a third-party provider can register page-specific and shared Abilities without
   modifying the adapter;
2. anonymous, customer, shop-manager, and administrator inventories differ;
3. a full navigation replaces the inventory cleanly;
4. a same-document UI transition fails safely if discovery is stale; and
5. public/session activity does not depend on the current `manage_options` audit
   endpoint.

## 5. Third-party extension models

### Model A: provider-owned conditional Ability modules

**Recommendation: preferred starting model.**

The provider plugin:

1. uses WordPress's normal public/admin hooks and screen/query predicates;
2. enqueues a script module that depends on `@wordpress/abilities` only where its
   tools are applicable;
3. registers its category before its namespaced Abilities;
4. supplies precise input/output schemas, annotations, permission callbacks, and
   browser callbacks; and
5. revalidates live context and exact permission on execution.

The adapter observes the common store and projects qualifying client Abilities.
A shared Ability is simply registered by the same module in more than one provider
context.

Advantages:

- Native WordPress extension mechanism and ownership boundaries.
- No adapter-specific registration function in WooCommerce or other plugins.
- Small page inventories and no unused callbacks loaded everywhere.
- Full navigation naturally discards the old document and registry.

Costs:

- Each provider must implement correct PHP enqueue predicates and public classic
  dependencies.
- Duplicate Ability/category names and the adapter's slash-to-dash collision must
  be diagnosed clearly.
- Same-document route changes remain the difficult lifecycle case.

### Model B: global Ability registration plus `meta.webmcp.contexts`

All provider Abilities load everywhere, and the adapter filters them using stable
context IDs stored under a top-level metadata key.

Advantages:

- One centralized context matcher and diagnostics surface.
- A declarative way to say one Ability belongs to several contexts.
- Could support route changes if the adapter diffs and unregisters tools.

Costs:

- Loads irrelevant code and Ability records on every page.
- Introduces adapter-specific metadata into otherwise protocol-independent
  Abilities.
- Context vocabulary becomes a compatibility contract the adapter must version.
- Still cannot rely on immediate ChatGPT Work/Codex refresh after a dynamic change.

**Recommendation:** reserve `meta.webmcp` for optional diagnostics/policy metadata,
not primary page selection, unless the grilling session chooses a centrally managed
registry.

### Model C: adapter-owned PHP provider registry/manifests

Providers register module IDs and context predicates through adapter PHP hooks; the
adapter enqueues their modules and may expose a context registry for diagnostics.

Advantages:

- Central dependency, policy, and inventory observability.
- Easier to add common capability/exposure checks and test fixtures.

Costs:

- Couples every provider to this adapter before it can register a normal client
  Ability.
- PHP predicates cannot fully describe live JavaScript/SPA state.
- The registry risks becoming a second abilities system.

**Recommendation:** add a small optional helper/filter only if native enqueueing
proves too fragmented. Do not make it mandatory without a concrete need.

### Model D: plugins call WebMCP directly

**Recommendation: reject for this project.** Direct `registerTool()` calls bypass
the WordPress Ability registry, schema validation, `permissionCallback`, adapter
exposure settings, confirmation, cancellation, activity, collision diagnostics,
and the explicit client-only provenance boundary.

## 6. Proposed provider contract for grilling

This is a recommendation to discuss, not a finalized API:

- The provider owns the Ability name, category, label, description, input/output
  schemas, callback, permission callback, and page enqueue predicate.
- The adapter accepts only normally client-registered Abilities and continues to
  exclude `serverRegistered` records.
- Context applicability is primarily represented by module presence in the current
  document. A callback independently checks that the context is still valid.
- Shared provider modules may be enqueued in several page families; WordPress module
  IDs and Ability names remain globally namespaced.
- Providers use WordPress annotations only for `readonly`, `destructive`, and
  `idempotent`. Any adapter policy metadata uses `meta.webmcp` because custom
  annotation keys are stripped.
- The bridge keeps one registration record per Ability containing the WebMCP-safe
  name, Ability fingerprint, and registration `AbortController`; it diffs the store
  rather than keeping only an additive name set.
- The bridge reports collisions before registration and must adopt a reversible or
  injective name mapping before claiming an open third-party contract.
- Exposure settings and confirmation are evaluated by consequence class, provider,
  and context rather than assuming every non-read action is an editor write.
- Tools return compact structured results only after the UI/application state
  reaches the claimed outcome; all content-derived outputs remain untrusted.

## 7. Safety and product boundaries

**Recommendations:**

- Keep each page inventory intentionally small. If a tool has no meaningful chance
  of being used on the current page, do not register it there.
- Use exact capabilities, not WordPress roles and not merely `is_user_logged_in()`.
- Keep login credentials and payment secrets out of Ability schemas, logs, and
  results.
- Separate navigation, reversible UI/session writes, persistent content writes,
  financial/communications actions, permission changes, and executable-code changes
  in the exposure policy. The current read/write/destructive editor tiers are not a
  complete site-wide risk taxonomy.
- Preserve application-owned confirmation for consequential actions even though
  the built-in browser also reviews calls. The two layers solve different problems.
- Make anonymous/customer activity privacy-preserving. Do not loosen the
  `manage_options` endpoint as a shortcut; decide whether those calls are local-only,
  recorded under a separate scoped endpoint, or not persisted.
- Do not turn all server Abilities into page tools. A browser-owned Ability may call
  existing UI/application logic, but operations that do not depend on the open page
  are still better represented by REST/backend Abilities or a server MCP surface.

## 8. Questions for the grilling session

1. What is the smallest inventory that must exist on every normal public page:
   page context, site destinations, navigation, search, or fewer?
2. Should public navigation be one raw same-origin URL tool, or the pair “list
   semantic destinations” then “navigate to one”?
3. On an authenticated public page, which management destinations should appear,
   and must they come from the admin bar, a server-built capability map, or both?
4. Is the login/reset/register screen deliberately tool-free? If not, which exact
   non-secret action justifies custom module printing there?
5. Is Model A (provider-owned conditional modules) the public extension contract,
   or do we want a centralized adapter provider registry?
6. Do we need `meta.webmcp.contexts`, or is page-module presence plus execution-time
   validation sufficient?
7. Should Site Editor route-specific tools stay stable across the shell or be
   dynamically registered/unregistered despite unspecified Site tools refresh
   timing?
8. What collision-safe mapping replaces slash-to-dash before third-party plugins
   depend on tool names?
9. Are `readonly`, reversible session/UI write, persistent write, consequential
   transaction, privilege change, and code change the right exposure classes?
10. Are exposure switches global, per provider, per context, per Ability, or a
    combination? Who owns their defaults?
11. Which actions require an in-page confirmation in addition to ChatGPT's browser
    review: save/publish, comment/message, checkout/order, refund, role change,
    plugin/theme changes?
12. What activity is stored for anonymous and customer sessions, for how long, and
    who may review it? Which fields are prohibited from storage?
13. Do we support the classic editor/customizer/widgets now, later, or explicitly
    not at all?
14. Which generic wp-admin screen families belong to this adapter's built-in
    providers, and which should remain owned by WordPress core or their source
    plugin?
15. What maximum per-page inventory and description budget do we adopt before
    adding discovery/meta-tools?
16. Which first vertical proves the model: core public navigation + block editor,
    or a WooCommerce storefront flow that exercises third-party extension early?

## Primary sources

- [OpenAI: Site tools](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/)
- [WordPress 7.0: Client-Side Abilities API](https://make.wordpress.org/core/2026/03/24/client-side-abilities-api-in-wordpress-7-0/)
- [WordPress package reference: `@wordpress/abilities`](https://developer.wordpress.org/block-editor/reference-guides/packages/packages-abilities/)
- [Gutenberg `@wordpress/abilities` source](https://github.com/WordPress/gutenberg/tree/6fee93b8e4381051cc66e492f7e94b03596ec481/packages/abilities)
- [WordPress Script Modules API](https://developer.wordpress.org/apis/interactivity-api/core-concepts/using-script-modules/)
- [WordPress front-end and admin enqueue hooks](https://developer.wordpress.org/reference/hooks/wp_enqueue_scripts/)
- [WordPress admin screen API](https://developer.wordpress.org/reference/classes/wp_screen/)
- [WordPress roles/capabilities and nonce guidance](https://developer.wordpress.org/apis/security/user-roles-and-capabilities/)
- Repository-owned references: [WebMCP reference](webmcp-reference.md),
  [learning guide](webmcp-learning-guide.md), [architecture](architecture.md), and
  [development/verification](development.md).
