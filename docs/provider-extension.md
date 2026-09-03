# Add a page-scoped Site tools provider

A third-party WordPress plugin can expose its own page tools by conditionally
enqueuing client Ability modules. Registration and page lifecycle use the shared
`@wordpress/abilities` store and normal WordPress hooks; providers do not call
`document.modelContext`, do not register with an adapter-specific provider registry,
and do not load their modules on unrelated pages. Adapter policy uses the documented
`meta.webmcp` fields, and persisted activity uses a separate WordPress filter.

The disposable implementation in
[`tests/fixtures/webmcp-provider`](../tests/fixtures/webmcp-provider/) is the
executable reference. It registers one read on one plugin page and one reversible
Ability shared by exactly two plugin pages. The fixture also registers the private,
REST-enabled `webmcp_note` post type so acceptance can prove that block-editor
provider selection has no post-type list; that post type is test infrastructure,
not part of the extension API.

## 1. Select pages with normal enqueue hooks

Register versioned script modules, then enqueue only the provider modules that are
valid for the current document. A shared Ability is the same module enqueued for
more than one page.

```php
add_action(
	'admin_enqueue_scripts',
	static function (string $hook_suffix): void {
		$pages = [
			'toplevel_page_example-primary',
			'example_page_example-secondary',
		];
		if (!in_array($hook_suffix, $pages, true)) {
			return;
		}

		wp_register_script_module(
			'example-provider/category',
			plugins_url('src/category.js', __FILE__),
			['@wordpress/abilities'],
			'1.0.0'
		);
		wp_register_script_module(
			'example-provider/shared-ability',
			plugins_url('src/shared-ability.js', __FILE__),
			['@wordpress/abilities', 'example-provider/category'],
			'1.0.0'
		);
		wp_enqueue_script_module('example-provider/shared-ability');
	}
);
```

Use `wp_enqueue_scripts` instead for a frontend provider. On WordPress 7.0 public
pages, also enqueue `wp-data` and `wp-i18n`; the built `@wordpress/abilities`
module reads those classic globals. Normal themes must print `wp_head` and
`wp_footer` for enqueued script modules to appear.

## 2. Register the category before the Ability

Register the category module as a dependency, then import its module ID for the
side effect in every provider Ability module. A Script Modules dependency makes
the ID resolvable and preloadable; it does not execute the category module by
itself.

```js
import { registerAbilityCategory } from '@wordpress/abilities';

registerAbilityCategory( 'example-provider', {
	label: 'Example Provider',
	description: 'Page tools owned by the Example Provider plugin.',
} );
```

## 3. Register a precise client Ability

Use a globally namespaced Ability name, closed input and output schemas, a live
permission check, a callback that revalidates the current page, and the complete
WordPress risk annotations. WordPress adds `clientRegistered: true` when a normal
client Ability is registered.

```js
import { registerAbility } from '@wordpress/abilities';
import 'example-provider/category';

registerAbility( {
	name: 'example-provider/set-panel-mode',
	category: 'example-provider',
	label: 'Set Panel Mode',
	description:
		'Set the visible provider panel to exactly `compact` or `expanded`. This changes only the current page and is reversible by calling the Ability again with the returned `previousMode`; it does not save. A result with `applied: true` and the requested `mode` is the success signal.',
	input_schema: {
		type: 'object',
		properties: {
			mode: {
				type: 'string',
				enum: [ 'compact', 'expanded' ],
				description:
					'Visible panel mode; use exactly `compact` or `expanded`.',
			},
		},
		required: [ 'mode' ],
		additionalProperties: false,
	},
	output_schema: {
		type: 'object',
		properties: {
			applied: { type: 'boolean' },
			previousMode: { type: 'string' },
			mode: { type: 'string' },
		},
		required: [ 'applied', 'previousMode', 'mode' ],
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: true,
		},
		webmcp: {
			provider: 'Example Provider',
			risk: 'reversible',
		},
	},
	permissionCallback: async () =>
		document.querySelector( '[data-example-panel]' ) !== null,
	callback: async ( { mode } ) => {
		const panel = document.querySelector( '[data-example-panel]' );
		if ( ! panel ) {
			throw new Error(
				'The provider panel is no longer available in this document.'
			);
		}
		const previousMode = panel.dataset.mode;
		panel.dataset.mode = mode;
		return { applied: true, previousMode, mode };
	},
} );
```

Readonly Abilities use `readonly: true`, `destructive: false`, and
`idempotent: true` and do not need `meta.webmcp.risk`. Mutations use one of
`reversible`, `persistent`, `consequential`, or `privileged`. Missing or invalid
mutation risk fails closed in the adapter.

The callback must enforce the provider's real live route, DOM/application state,
and authorization immediately before it acts. Client `permissionCallback` is part
of normal Ability execution, but it is not a server authorization boundary.

## 4. Pair activity with a server-side allowlist entry

The adapter accepts activity only for server-side allowlist entries. Add the same
Ability name, provider label, and risk through the normal WordPress filter. Do not
derive these values from the client request; this entry is an activity contract,
not a registered server Ability.

```php
add_filter(
	'webmcp_activity_ability_definitions',
	static function (array $definitions): array {
		$definitions['example-provider/set-panel-mode'] = [
			'provider' => 'Example Provider',
			'risk'     => 'reversible',
		];

		return $definitions;
	}
);
```

Without that definition, the hardened endpoint rejects the event and the Ability
result still succeeds because observability is audit-only. Add `summary_fields`
only for bounded identifiers that are safe to store; raw inputs and outputs do not
belong in activity.

## 5. Handle same-document lifecycle conservatively

Use `unregisterAbility(name)` when the live page no longer supports an Ability.
The adapter removes its WebMCP registration, and a later `registerAbility(...)`
call can add it again. Discovery timing in ChatGPT Work and Codex is not guaranteed
for same-document changes, so callbacks must still reject stale state. After a full
navigation or reload, rediscover the new document's tools.

## Verification

On each owned page, verify the exact projected tool inventory and execute the read
and mutation through the standard `document.modelContext` API. Also verify:

-   unrelated pages contain no provider tool;
-   the mutation can be reversed to its original visible state;
-   unregister removes the tool and a later registration restores it once;
-   a captured handle from the removed registration rejects without execution;
-   stored activity uses the server-owned provider and risk; and
-   no request is made to `/wp-abilities/v1/abilities`.
