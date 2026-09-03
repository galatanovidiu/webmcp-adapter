/**
 * Frontend Ability: report the current eligible WordPress document context.
 */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-adapter/category';

const serverContext = readServerContext();
const sensitiveQueryParameters = [
	'_wpnonce',
	'_wp_http_referer',
	'password',
	'pass',
	'pwd',
];

registerAbility( {
	name: 'webmcp/get-page-context',
	category: 'webmcp',
	label: 'Get Page Context',
	description:
		'Return the current WordPress page surface, URL, public query or admin screen identity, related content object when available, and authentication state. Use this first to orient to the document providing the current Site tools.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
	},
	callback: async () => ( {
		...serverContext,
		url: currentUrl(),
	} ),
} );

function currentUrl() {
	const url = new URL( window.location.href );
	for ( const parameter of sensitiveQueryParameters ) {
		url.searchParams.delete( parameter );
	}
	return url.href;
}

function readServerContext() {
	const container = document.getElementById(
		'wp-script-module-data-webmcp-adapter/page-context'
	);
	if ( ! container ) {
		return {
			surface: document.body?.classList.contains( 'wp-admin' )
				? 'wp-admin'
				: 'frontend',
			url: currentUrl(),
			pageType: null,
			objectType: null,
			objectId: null,
			screenId: null,
			postType: null,
			taxonomy: null,
			authenticated:
				document.body?.classList.contains( 'logged-in' ) ?? false,
		};
	}

	try {
		return JSON.parse( container.textContent );
	} catch {
		return {
			surface: 'unknown',
			url: currentUrl(),
			pageType: null,
			objectType: null,
			objectId: null,
			screenId: null,
			postType: null,
			taxonomy: null,
			authenticated: false,
		};
	}
}
