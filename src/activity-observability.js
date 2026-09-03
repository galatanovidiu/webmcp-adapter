/**
 * Bounded, audit-only activity event construction and transport.
 *
 * Raw Ability inputs/outputs and arbitrary errors never enter this module's
 * transport. The server independently owns the final allowlist and normalization.
 */

const FAILURE_FLAGS = [
	'ok',
	'success',
	'saved',
	'staged',
	'inserted',
	'updated',
	'removed',
	'moved',
	'replaced',
	'done',
];
const STALE_EDITOR_REASON =
	'This tab is not editing a post in the block editor.';
const GENERAL_SETTINGS_FIELDS = new Set( [
	'siteTitle',
	'tagline',
	'administrationEmail',
	'membership',
	'defaultRole',
	'siteLanguage',
	'timezone',
	'dateFormat',
	'timeFormat',
	'weekStartsOn',
] );

/**
 * Classifies a resolved Ability result without transporting the result itself.
 *
 * @param {*} result Structured Ability result.
 * @return {{outcome:string,errorCode:?string}} Final bounded outcome.
 */
export function classifyResolvedActivity( result ) {
	if ( isStaleResult( result ) ) {
		return { outcome: 'stale', errorCode: 'stale_context' };
	}
	if (
		result &&
		typeof result === 'object' &&
		FAILURE_FLAGS.some(
			( field ) =>
				Object.prototype.hasOwnProperty.call( result, field ) &&
				result[ field ] === false
		)
	) {
		return { outcome: 'failed', errorCode: 'ability_refused' };
	}

	return { outcome: 'ran', errorCode: null };
}

/**
 * Returns the one first-party safe summary currently declared by both client and
 * server: General Settings field identifiers and the manual-save flag.
 *
 * @param {string} abilityName WordPress Ability name.
 * @param {*}      result      Structured Ability result.
 * @return {?Object} Bounded candidate for server validation.
 */
export function buildSafeActivitySummary( abilityName, result ) {
	if (
		abilityName !== 'wordpress/settings/stage-general-form' ||
		! result ||
		typeof result !== 'object' ||
		Array.isArray( result )
	) {
		return null;
	}

	const summary = {};
	for ( const field of [ 'changedFields', 'unchangedFields' ] ) {
		if ( Array.isArray( result[ field ] ) ) {
			summary[ field ] = [
				...new Set(
					result[ field ]
						.filter(
							( value ) =>
								typeof value === 'string' &&
								GENERAL_SETTINGS_FIELDS.has( value )
						)
						.slice( 0, GENERAL_SETTINGS_FIELDS.size )
				),
			];
		}
	}
	if ( typeof result.requiresUserSave === 'boolean' ) {
		summary.requiresUserSave = result.requiresUserSave;
	}

	return Object.keys( summary ).length > 0 ? summary : null;
}

/**
 * Creates an audit-only fetch transport.
 *
 * @param {Object} config Server-provided endpoint, nonce, and signed token.
 * @return {{record:Function,readRun:Function}} Non-throwing transport methods.
 */
export function createActivityRecorder( config = {} ) {
	const endpoint = sameOriginEndpoint( config.endpoint );
	const token = typeof config.token === 'string' ? config.token : '';
	const nonce = typeof config.nonce === 'string' ? config.nonce : '';

	const request = async ( method, url, body = null ) => {
		if ( ! endpoint || ! token ) {
			return null;
		}
		const headers = {
			Accept: 'application/json',
			'X-WebMCP-Activity-Token': token,
		};
		if ( nonce ) {
			headers[ 'X-WP-Nonce' ] = nonce;
		}
		if ( body !== null ) {
			headers[ 'Content-Type' ] = 'application/json';
		}

		const response = await window.fetch( url, {
			method,
			headers,
			credentials: 'same-origin',
			keepalive: method === 'POST',
			...( body === null ? {} : { body } ),
		} );
		if ( ! response.ok ) {
			return null;
		}

		return response.json();
	};

	return {
		record( event ) {
			if ( ! endpoint ) {
				return;
			}
			try {
				const body = JSON.stringify( event );
				if ( body.length > 4096 ) {
					return;
				}
				void request( 'POST', endpoint, body ).catch( () => {} );
			} catch {
				// Audit failure must never affect the Ability result.
			}
		},
		readRun( runId, limit = 100 ) {
			if ( config.canReview !== true || ! isUuid( runId ) ) {
				return Promise.resolve( [] );
			}
			const url = new URL( endpoint );
			url.searchParams.set( 'run_id', runId );
			url.searchParams.set( 'limit', String( Math.min( 500, limit ) ) );

			return request( 'GET', url.href ).then( ( rows ) =>
				Array.isArray( rows ) ? rows : []
			);
		},
	};
}

/** @return {string} RFC 4122 UUID, including browsers without randomUUID(). */
export function mintActivityId() {
	if ( typeof crypto.randomUUID === 'function' ) {
		return crypto.randomUUID();
	}
	const bytes = new Uint8Array( 16 );
	crypto.getRandomValues( bytes );
	bytes[ 6 ] = ( bytes[ 6 ] & 0x0f ) | 0x40;
	bytes[ 8 ] = ( bytes[ 8 ] & 0x3f ) | 0x80;
	const hex = [ ...bytes ].map( ( value ) =>
		value.toString( 16 ).padStart( 2, '0' )
	);

	return [
		hex.slice( 0, 4 ).join( '' ),
		hex.slice( 4, 6 ).join( '' ),
		hex.slice( 6, 8 ).join( '' ),
		hex.slice( 8, 10 ).join( '' ),
		hex.slice( 10 ).join( '' ),
	].join( '-' );
}

function isStaleResult( result ) {
	if ( ! result || typeof result !== 'object' || Array.isArray( result ) ) {
		return false;
	}
	if ( result.inEditor === false && result.reason === STALE_EDITOR_REASON ) {
		return true;
	}
	if ( result.reason === STALE_EDITOR_REASON ) {
		return true;
	}

	return (
		Array.isArray( result.validationErrors ) &&
		result.validationErrors.some( ( error ) => error?.field === 'form' )
	);
}

function sameOriginEndpoint( value ) {
	if ( typeof value !== 'string' || value === '' ) {
		return null;
	}
	try {
		const url = new URL( value, window.location.href );
		return url.origin === window.location.origin &&
			[ 'http:', 'https:' ].includes( url.protocol )
			? url.href
			: null;
	} catch {
		return null;
	}
}

function isUuid( value ) {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	);
}
