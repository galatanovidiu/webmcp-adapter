const blockedActionNames = new Set( [
	'activate',
	'deactivate',
	'delete',
	'install',
	'logout',
	'trash',
	'update',
] );

const blockedQueryParameters = [
	'_wpnonce',
	'_wp_http_referer',
	'password',
	'pass',
	'pwd',
];

export const DESTINATIONS_OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		destinations: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string' },
					label: { type: 'string' },
					section: { type: 'string' },
					url: { type: 'string' },
					sameOrigin: { type: 'boolean' },
				},
				required: [ 'id', 'label', 'section', 'url', 'sameOrigin' ],
				additionalProperties: false,
			},
		},
	},
	required: [ 'destinations' ],
	additionalProperties: false,
};

/**
 * Normalizes one rendered navigation candidate into the public result shape.
 *
 * @param {Object} candidate Candidate fields read from a rendered anchor.
 * @param {string} baseUrl   Current document URL.
 * @return {?Object} A destination, or null when the candidate is unsafe/unusable.
 */
export function createDestination( candidate, baseUrl ) {
	const href =
		typeof candidate?.href === 'string' ? candidate.href.trim() : '';
	const label = normalizeText( candidate?.label );
	const section = normalizeText( candidate?.section ) || 'Navigation';

	if ( ! href || href === '#' || ! label ) {
		return null;
	}

	let currentUrl;
	let url;
	try {
		currentUrl = new URL( baseUrl );
		url = new URL( href, currentUrl );
	} catch {
		return null;
	}

	if (
		! [ 'http:', 'https:' ].includes( url.protocol ) ||
		url.origin !== currentUrl.origin ||
		url.username ||
		url.password
	) {
		return null;
	}

	const action = url.searchParams.get( 'action' )?.toLowerCase();
	if (
		blockedQueryParameters.some( ( parameter ) =>
			url.searchParams.has( parameter )
		) ||
		( action && blockedActionNames.has( action ) ) ||
		/(?:^|\/)wp-(?:login|signup|register)\.php$/i.test( url.pathname ) ||
		/(?:^|\/)wp-admin\/(?:admin-ajax|admin-post)\.php$/i.test(
			url.pathname
		)
	) {
		return null;
	}

	const idSource =
		normalizeText( candidate?.idHint ) || `${ section }-${ label }`;
	return {
		id: `${ slugify( idSource ) || 'destination' }-${ hashUrl(
			url.href
		) }`,
		label,
		section,
		url: url.href,
		sameOrigin: true,
	};
}

/**
 * De-duplicates normalized destinations by URL in first-rendered order.
 *
 * @param {Array<Object>} destinations Destination candidates.
 * @return {Array<Object>} Unique destinations.
 */
export function uniqueDestinations( destinations ) {
	const unique = new Map();
	for ( const destination of destinations ) {
		if ( destination && ! unique.has( destination.url ) ) {
			unique.set( destination.url, destination );
		}
	}
	return [ ...unique.values() ];
}

/**
 * Returns a compact visible label from rendered text.
 *
 * @param {*} value Candidate text.
 * @return {string} Normalized text.
 */
export function normalizeText( value ) {
	return typeof value === 'string' ? value.replace( /\s+/g, ' ' ).trim() : '';
}

function slugify( value ) {
	return value
		.toLowerCase()
		.normalize( 'NFKD' )
		.replace( /[\u0300-\u036f]/g, '' )
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-|-$/g, '' )
		.slice( 0, 64 );
}

function hashUrl( value ) {
	let hash = 2166136261;
	for ( let index = 0; index < value.length; index++ ) {
		hash ^= value.charCodeAt( index );
		hash = Math.imul( hash, 16777619 );
	}
	return ( hash >>> 0 ).toString( 36 );
}
