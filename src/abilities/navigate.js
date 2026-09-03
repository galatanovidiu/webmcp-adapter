/**
 * Frontend ability: navigate the current tab.
 *
 * A client-side WordPress ability — its `callback` runs in the browser, not on
 * the server — that moves the tab to another URL on this site. It registers into
 * the Abilities client store, so the adapter turns it
 * into a WebMCP tool through its normal path (write gate, activity log, and the
 * confirmation modal all apply). This replaces the old direct `registerTool` hack,
 * which bypassed all of that.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';

registerAbility( {
	name: 'webmcp/navigate',
	// Required by registerAbility (format /^[a-z0-9]+(?:-[a-z0-9]+)*$/); the adapter
	// ignores category, so a bare slug is enough — no need to pre-register it.
	category: 'webmcp',
	label: 'Navigate',
	description:
		'Navigate the current tab to a URL on this site (e.g. /wp-admin/plugins.php). The tab reloads, so tools re-register on the new page; list tools again afterwards. Caution: if a block editor with unsaved changes is open (editor-context isDirty:true), the browser shows a native leave-page dialog you cannot confirm — save or discard first.',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'The destination URL. Absolute or relative to this site.',
			},
		},
		required: [ 'url' ],
		additionalProperties: false,
	},
	// readonly:true → always exposed, never gated. Navigation actuates the browser
	// (moves the tab); it mutates no server data, so it is safe to always expose.
	// clientRegistered survives client-side (no REST trip strips custom keys).
	meta: { annotations: { readonly: true, clientRegistered: true } },
	callback: async ( { url } ) => {
		const destination = new URL( url, window.location.origin );

		// Same-origin only: never let the agent send the tab off this site.
		if ( destination.origin !== window.location.origin ) {
			return {
				navigated: false,
				reason: 'Off-site navigation is refused; stay on this site.',
			};
		}

		window.location.assign( destination.href );

		return { navigated: true, url: destination.href };
	},
} );
