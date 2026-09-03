/**
 * WebMCP Adapter — browser adapter.
 *
 * Maps frontend WordPress abilities (Abilities API client store) onto the
 * browser WebMCP API so ChatGPT Work and Codex can discover and run them as
 * Site tools in the ChatGPT desktop app's built-in browser.
 *
 * Server-registered abilities deliberately stay on the server-side MCP/REST
 * surfaces. Keeping this page catalog frontend-only also keeps it within the
 * practical inventory accepted by ChatGPT Work and Codex Site tools.
 */

import {
	executeAbility,
	getAbilities,
	store as abilitiesStore,
} from '@wordpress/abilities';
import { createAbilitySynchronizer } from 'webmcp-adapter/ability-synchronizer';
import {
	classifyAbilityRisk,
	requiresConfirmationForRisk,
	toWebMcpToolName,
} from 'webmcp-adapter/adapter-contract';
import { createActivityPresenter } from 'webmcp-adapter/activity';
import {
	buildSafeActivitySummary,
	classifyResolvedActivity,
	createActivityRecorder,
	mintActivityId,
} from 'webmcp-adapter/activity-observability';
import {
	confirmRiskyAction,
	throwIfAborted,
} from 'webmcp-adapter/confirmation';

// `navigator.modelContext` is the live API in Chrome 149; `document.modelContext`
// replaces it in Chrome 150. Prefer document, fall back to navigator.
const modelContext = document.modelContext || navigator.modelContext;

// Writes-only map of ability NAME to an admin-relative URL template with {param}
// tokens (e.g. `post.php?post={id}&action=edit`). The server supplies it via the
// `webmcp_screen_links` filter; reads and some writes are absent (linkless). Read
// once here; a missing/unparseable/non-object value yields an empty map (fail-safe:
// every tool is linkless).
const SCREEN_LINKS = readModuleObject( 'screenLinks' );
const ACTIVITY_CONFIG = readModuleObject( 'activity' );
const activityRecorder = createActivityRecorder( ACTIVITY_CONFIG );

// The wp-admin base URL, used to turn an admin-relative template into a same-origin
// absolute link. Read once here; a missing/unparseable value yields an empty string,
// in which case a resolved link stays admin-relative (the caller resolves it against
// the current admin origin).
const ADMIN_URL = ( () => {
	const c = document.getElementById(
		'wp-script-module-data-webmcp-adapter/adapter'
	);

	try {
		return JSON.parse( c.textContent )?.adminUrl ?? '';
	} catch {
		return '';
	}
} )();

// The client-minted run id: the group key for this browser session's activity.
// Persisted in `sessionStorage` so it survives reloads (the navigation case) and
// stays stable within the tab; a new tab mints a fresh id. Read once here; if
// `sessionStorage` is unavailable or throws (privacy mode, disabled storage), fall
// back to a one-off in-memory id so the POST/GET payloads still carry a stable value
// for this page's lifetime.
const RUN_ID = ( () => {
	try {
		const existing = window.sessionStorage.getItem( 'webmcpRunId' );
		if ( existing ) {
			return existing;
		}
		const minted = mintActivityId();
		window.sessionStorage.setItem( 'webmcpRunId', minted );
		return minted;
	} catch {
		return mintActivityId();
	}
} )();

const CONFIRMATION_NOTICE =
	'⚠ This action requires in-page confirmation before it proceeds; the supervising user may decline. ';

// Mount on every eligible document, even when WebMCP is unavailable. Presentation
// is isolated and optional: a UI failure must never prevent tool registration.
const activity = createActivityPresenter();
try {
	activity.mount();
	hydrateActivityLog();
} catch {
	// Activity is presentation-only.
}

if ( modelContext && typeof modelContext.registerTool === 'function' ) {
	const synchronizer = createAbilitySynchronizer( {
		getAbilities,
		subscribe: ( callback ) =>
			window.wp?.data?.subscribe?.( callback, abilitiesStore ),
		registerAbility: registerAbilityAsTool,
		reportDiagnostic: reportBridgeDiagnostic,
		classifyAbilityRisk,
		toWebMcpToolName,
	} );
	void synchronizer.start();
}

/**
 * Reads a named plain object from server-provided script-module data.
 *
 * Returns the named value when it is a plain object. Anything else — a missing
 * tag, invalid JSON, null, or an array — reads as an empty object (fail-safe).
 *
 * @param {string} key The object name to read.
 * @return {Object} The named object, or an empty object.
 */
function readModuleObject( key ) {
	const container = document.getElementById(
		'wp-script-module-data-webmcp-adapter/adapter'
	);

	if ( ! container ) {
		return {};
	}

	try {
		const parsed = JSON.parse( container.textContent );
		const value = parsed?.[ key ];
		return value && typeof value === 'object' && ! Array.isArray( value )
			? value
			: {};
	} catch {
		return {};
	}
}

/**
 * Resolves a write tool to its wp-admin URL using the screen-link map.
 *
 * Looks up the ability's admin-relative URL template in {@link SCREEN_LINKS} and
 * substitutes every `{token}` with the matching value from `params`, each
 * URL-encoded. Returns null when the ability has no mapping, the template is not a
 * string, or any `{token}` has no resolvable value in `params` (an own property that
 * is not null/undefined) — the URL is never left with an unsubstituted token
 * (linkless fail-safe). The result is prefixed with {@link ADMIN_URL} to form a
 * same-origin absolute URL; when ADMIN_URL is empty the admin-relative template is
 * returned for the caller to resolve.
 *
 * This only RESOLVES the URL; it renders nothing.
 *
 * @param {string} abilityName The ability name (the map key).
 * @param {Object} params      The action's arguments supplying token values.
 * @return {?string} The resolved URL, or null when unresolvable.
 */
function resolveScreenLink( abilityName, params = {} ) {
	const template = SCREEN_LINKS[ abilityName ];

	if ( typeof template !== 'string' ) {
		return null;
	}

	let unresolved = false;

	const resolved = template.replace( /\{([^}]+)\}/g, ( match, token ) => {
		if (
			! Object.prototype.hasOwnProperty.call( params, token ) ||
			params[ token ] === null ||
			params[ token ] === undefined
		) {
			unresolved = true;
			return match;
		}

		return encodeURIComponent( String( params[ token ] ) );
	} );

	if ( unresolved ) {
		return null;
	}

	return ADMIN_URL + resolved;
}

/**
 * Registers one ability as a WebMCP tool.
 *
 * @param {Object} ability              The ability record from the client store.
 * @param {Object} registration         Validated registration data.
 * @param {string} registration.toolName Collision-safe projected tool name.
 * @param {string} registration.risk     Validated WebMCP risk classification.
 * @param {AbortSignal} registration.signal Signal that removes this registration.
 * @return {Promise<void>|void} Registration completion when the API is asynchronous.
 */
function registerAbilityAsTool( ability, { toolName, risk, signal } ) {
	const annotations = ability.meta?.annotations ?? {};
	const baseDescription =
		ability.description ?? ability.label ?? ability.name;
	const description = requiresConfirmationForRisk( risk )
		? CONFIRMATION_NOTICE + baseDescription
		: baseDescription;

	return modelContext.registerTool(
		{
			name: toolName,
			title: ability.label ?? ability.name,
			description,
			inputSchema: normalizeInputSchema( ability.input_schema ),
			annotations: {
				readOnlyHint: annotations.readonly === true,
				// WordPress content, labels, and metadata may contain user-authored text.
				untrustedContentHint: true,
			},
			execute: async ( params, context = {} ) => {
				const invocationSignal = context?.signal;
				const invocation = startActivity( ability, params ?? {}, risk );
				let confirmation = requiresConfirmationForRisk( risk )
					? 'not_requested'
					: 'not_required';
				try {
					throwIfRegistrationStale( signal );
					throwIfAborted( invocationSignal );

					if ( requiresConfirmationForRisk( risk ) ) {
						const decision = await confirmRiskyAction(
							ability,
							params ?? {},
							{
								risk,
								signal: invocationSignal,
								pageContext: currentPageContext(),
							}
						);

						if ( ! decision.approved ) {
							const expired = decision.reason === 'expired';
							confirmation = expired ? 'expired' : 'declined';
							finishActivity( invocation, {
								ability,
								outcome: expired ? 'expired' : 'declined',
								confirmation,
								errorCode: expired
									? 'confirmation_expired'
									: 'confirmation_declined',
							} );
							return {
								cancelled: true,
								reason: expired
									? 'The confirmation expired before approval.'
									: `The user declined this ${ risk } action in the page.`,
							};
						}
						confirmation = 'confirmed';
					}

					throwIfRegistrationStale( signal );
					throwIfAborted( invocationSignal );
					const result = await executeAbility(
						ability.name,
						params ?? {}
					);
					const final = classifyResolvedActivity( result );
					finishActivity( invocation, {
						ability,
						outcome: final.outcome,
						confirmation,
						errorCode: final.errorCode,
						safeSummary: buildSafeActivitySummary(
							ability.name,
							result
						),
					} );
					return result;
				} catch ( error ) {
					const stale = error?.code === 'webmcp_stale_registration';
					const cancelled = error?.name === 'AbortError';
					if ( cancelled && requiresConfirmationForRisk( risk ) ) {
						confirmation = 'cancelled';
					}
					finishActivity( invocation, {
						ability,
						outcome: stale
							? 'stale'
							: cancelled
							? 'cancelled'
							: 'failed',
						confirmation,
						errorCode: stale
							? 'stale_registration'
							: cancelled
							? 'invocation_cancelled'
							: 'ability_execution_failed',
					} );
					throw error;
				}
			},
		},
		{ signal }
	);
}

/**
 * Reports bridge diagnostics without exposing raw site data.
 *
 * @param {Object} diagnostic         Bounded bridge diagnostic.
 * @param {string} diagnostic.code    Stable diagnostic code.
 * @param {string} diagnostic.message Human-readable diagnostic message.
 * @param {*}      diagnostic.error   Optional registration error.
 * @return {void}
 */
function reportBridgeDiagnostic( { code, message, error } ) {
	console.warn( `[WebMCP ${ code }] ${ message }`, error ?? '' );
}

/**
 * Adds the immediate running state. Presentation errors are always contained.
 *
 * @param {Object} ability Ability record.
 * @param {Object} params Invocation arguments.
 * @return {Object} Activity handle and resolved presentation data.
 */
function startActivity( ability, params, risk ) {
	const isWrite = ability.meta?.annotations?.readonly !== true;
	const screenUrl = isWrite
		? resolveScreenLink( ability.name, params )
		: null;
	let id = null;
	try {
		id = activity.start( {
			label: ability.label ?? ability.name,
			screenUrl,
			isWrite,
		} );
	} catch {
		// Activity is presentation-only.
	}
	return {
		id,
		screenUrl,
		eventId: mintActivityId(),
		startedAt: performance.now(),
		risk,
	};
}

/**
 * Updates the visible entry and asynchronously records one bounded final event.
 *
 * @param {Object} invocation Activity handle.
 * @param {Object} options Final activity data.
 * @return {void}
 */
function finishActivity(
	invocation,
	{ ability, outcome, confirmation, errorCode = null, safeSummary = null }
) {
	try {
		activity.finish( invocation.id, outcome );
	} catch {
		// Activity is presentation-only.
	}

	try {
		activityRecorder.record( {
			event_id: invocation.eventId,
			run_id: RUN_ID,
			ability: ability.name,
			outcome,
			duration_ms: Math.max(
				0,
				Math.min(
					86400000,
					Math.round( performance.now() - invocation.startedAt )
				)
			),
			confirmation,
			error_code: errorCode,
			...( safeSummary ? { safe_summary: safeSummary } : {} ),
		} );
	} catch {
		// Audit-only recording must never alter the ability result.
	}
}

function currentPageContext() {
	const surface = document.body?.classList.contains( 'wp-admin' )
		? 'WordPress admin'
		: 'Site frontend';
	return surface + ' · ' + window.location.pathname;
}

/**
 * Hydrates the activity panel with this run's prior entries from the server.
 *
 * Called ONCE at adapter init (not on the store subscribe tick) so server history and
 * live entries never double-render. GETs the current run's recent rows (newest-first)
 * and, when there is at least one row, passes each to the isolated presenter.
 * Additively preserved legacy rows may retain a `screen_url`; normalized Batch 7
 * events are linkless because the server stores only their source page path.
 * Hydrated labels use the slash Ability name as-is; client-side label resolution
 * is not attempted (a minor cosmetic difference is acceptable).
 *
 * Audit/presentation-only and defensive: a `.catch` swallows any failure so it can never
 * surface to the page.
 *
 * @return {void}
 */
function hydrateActivityLog() {
	if ( ACTIVITY_CONFIG.canReview !== true ) {
		return;
	}

	activityRecorder
		.readRun( RUN_ID, 100 )
		.then( ( rows ) => {
			if ( ! Array.isArray( rows ) || rows.length === 0 ) {
				return;
			}

			for ( const row of rows ) {
				const screenUrl =
					typeof row.screen_url === 'string' ? row.screen_url : null;
				const timestamp = row.recorded_at_gmt
					? row.recorded_at_gmt.replace( ' ', 'T' ) + 'Z'
					: row.created?.replace?.( ' ', 'T' );

				activity.appendHistory( {
					label: row.ability,
					outcome: row.outcome,
					screenUrl,
					timeText: timestamp
						? new Date( timestamp ).toLocaleTimeString()
						: '',
					isWrite: screenUrl !== null && screenUrl !== '',
				} );
			}
		} )
		.catch( () => {} );
}

/** Throws when a removed/replaced Ability registration is invoked from stale UI. */
function throwIfRegistrationStale( signal ) {
	if ( ! signal?.aborted ) {
		return;
	}
	const error = new Error(
		'The Site tool registration is no longer valid for this document.'
	);
	error.code = 'webmcp_stale_registration';
	throw error;
}

/**
 * Returns a valid JSON Schema object for a tool's input.
 *
 * Abilities may declare no input schema, or an empty PHP `array()` that
 * serializes to `[]`, or an object without a `type`. WebMCP and schema
 * validators expect an object with a `type` (or a composition keyword), so we
 * coerce those cases to an open object schema and leave valid schemas as-is.
 *
 * @param {*} schema The ability's declared input schema.
 * @return {Object} A schema safe to register as a tool input.
 */
function normalizeInputSchema( schema ) {
	if ( ! schema || typeof schema !== 'object' || Array.isArray( schema ) ) {
		return { type: 'object', properties: {} };
	}

	if ( ! schema.type && ! schema.anyOf && ! schema.oneOf ) {
		return { type: 'object', ...schema };
	}

	return schema;
}
