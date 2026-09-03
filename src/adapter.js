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
import { confirmDestructive, throwIfAborted } from './confirmation.js';
// Frontend abilities: client-side abilities register into the same store on import,
// so the subscribe-based sync below turns each into a WebMCP tool automatically.
import './abilities/index.js';

// `navigator.modelContext` is the live API in Chrome 149; `document.modelContext`
// replaces it in Chrome 150. Prefer document, fall back to navigator.
const modelContext = document.modelContext || navigator.modelContext;

// Option-B write gate: write abilities become WebMCP tools only when the admin
// enabled the write setting. The flag is read ONCE here from server-provided
// script-module data; any missing/unparseable/non-true value is treated as
// disabled, so the gate fails safe (writes hidden). A setting change takes effect
// on the next page load.
const WRITE_TOOLS_ENABLED = readModuleFlag( 'writeToolsEnabled' );

// The destructive save/publish ability is exposed only when this SECOND toggle
// is on AND writes are enabled. Read once here; any missing/unparseable/non-true
// value reads as disabled (fail-safe).
const DESTRUCTIVE_TOOLS_ENABLED = readModuleFlag( 'destructiveToolsEnabled' );

// Default-OFF demo escape hatch. When the admin turns this on, the in-page
// confirmation modal accepts synthetic (script-dispatched) clicks so a script or
// agent can drive destructive tools end-to-end for a recording. When off
// (the default), the modal rejects page-script synthetic clicks
// (`event.isTrusted === false`). This is a page-script boundary, not proof that a
// privileged browser automation client is human. Read once here; any
// missing/unparseable/non-true value reads as off (fail-safe).
const AUTOMATED_CONFIRMATION_ALLOWED = readModuleFlag(
	'allowAutomatedConfirmation'
);

// Writes-only map of ability NAME to an admin-relative URL template with {param}
// tokens (e.g. `post.php?post={id}&action=edit`). The server supplies it via the
// `webmcp_screen_links` filter; reads and some writes are absent (linkless). Read
// once here; a missing/unparseable/non-object value yields an empty map (fail-safe:
// every tool is linkless).
const SCREEN_LINKS = readModuleObject( 'screenLinks' );

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
		const minted = crypto.randomUUID();
		window.sessionStorage.setItem( 'webmcpRunId', minted );
		return minted;
	} catch {
		return crypto.randomUUID();
	}
} )();

// Appended to a destructive tool's description so the agent is TOLD the live
// confirmation mode. Honest disclosure only — a non-compliant agent can ignore it,
// which is a known, accepted risk for this proof of concept (tracked as follow-up).
const CONFIRMATION_MODE_NOTICE = AUTOMATED_CONFIRMATION_ALLOWED
	? 'Automated confirmation is currently ENABLED: page-script confirmation is accepted. '
	: 'The page requires a trusted confirmation click before this runs; page script cannot synthesize it. ';

// Prefixed to a destructive tool's description. WebMCP has no agent-consumed
// "destructive" hint, so the description tells the agent what to expect: running
// the tool pops an in-page confirmation the supervising user can approve first.
const DESTRUCTIVE_NOTICE =
	'⚠ PERSISTENT and consequential. Running this tool asks the user to confirm in the page before it proceeds; they may decline. ';

if ( modelContext && typeof modelContext.registerTool === 'function' ) {
	syncAbilitiesToTools();
	// Hydrate the panel with this run's prior activity ONCE here, at adapter init —
	// not on the store subscribe tick — so server history and live entries never
	// double-render.
	hydrateActivityLog();
}

/**
 * Reads a named boolean toggle from server-provided script-module data.
 *
 * The PHP side prints the adapter's boolean flags (e.g. `writeToolsEnabled`,
 * `destructiveToolsEnabled`, `allowAutomatedConfirmation`)
 * into a JSON script tag with id `wp-script-module-data-webmcp-adapter/adapter`.
 * Anything else — a missing tag, invalid JSON, or a non-true value — reads as
 * disabled (fail-safe).
 *
 * @param {string} key The flag name to read.
 * @return {boolean} True only when the named flag is explicitly true.
 */
function readModuleFlag( key ) {
	const container = document.getElementById(
		'wp-script-module-data-webmcp-adapter/adapter'
	);

	if ( ! container ) {
		return false;
	}

	try {
		return JSON.parse( container.textContent )?.[ key ] === true;
	} catch {
		return false;
	}
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
 * Decides whether an ability may be exposed as a WebMCP tool (Option B).
 *
 * Read-only abilities are always exposed. With writes off, no write is exposed. A
 * destructive write is exposed when both the write and destructive settings are
 * on. Any other write is exposed when writes are on.
 *
 * @param {Object} annotations The ability's `meta.annotations` object.
 * @return {boolean} True if the ability should register as a tool.
 */
function shouldExpose( annotations ) {
	if ( annotations.readonly === true ) {
		return true;
	}

	if ( ! WRITE_TOOLS_ENABLED ) {
		return false;
	}

	if ( annotations.destructive === true ) {
		return DESTRUCTIVE_TOOLS_ENABLED;
	}

	return true;
}

/**
 * Registers every frontend ability as a WebMCP tool, now and as more arrive.
 *
 * `@wordpress/abilities` marks browser-owned abilities with
 * `meta.annotations.clientRegistered`. Server abilities are excluded even if
 * another plugin loads them into the shared store. We register what is present,
 * then subscribe for frontend abilities registered later at runtime.
 *
 * @return {void}
 */
function syncAbilitiesToTools() {
	const registered = new Set();
	const pending = new Set();

	const sync = () => {
		// getAbilities() is a synchronous data-store selector.
		for ( const ability of getAbilities() ) {
			const annotations = ability.meta?.annotations ?? {};

			if (
				annotations.clientRegistered !== true ||
				annotations.serverRegistered === true
			) {
				continue;
			}

			if (
				registered.has( ability.name ) ||
				pending.has( ability.name )
			) {
				continue;
			}
			// Option-B gate. Writes are skipped without being marked registered,
			// so they are re-evaluated on later store ticks (the decision is fixed
			// per page load, so a skipped write stays skipped — fail-safe).
			if ( ! shouldExpose( annotations ) ) {
				continue;
			}

			pending.add( ability.name );
			Promise.resolve()
				.then( () => registerAbilityAsTool( ability ) )
				.then( () => registered.add( ability.name ) )
				.catch( ( error ) => {
					console.warn(
						`WebMCP could not register frontend ability "${ ability.name }".`,
						error
					);
				} )
				.finally( () => pending.delete( ability.name ) );
		}
	};

	sync();

	// wp-data ships as a classic-script dependency of @wordpress/abilities.
	window.wp?.data?.subscribe?.( sync, abilitiesStore );
}

/**
 * Registers one ability as a WebMCP tool.
 *
 * @param {Object} ability The ability record from the client store.
 * @return {Promise<void>|void} Registration completion when the API is asynchronous.
 */
function registerAbilityAsTool( ability ) {
	const annotations = ability.meta?.annotations ?? {};
	const baseDescription =
		ability.description ?? ability.label ?? ability.name;
	const description =
		annotations.destructive === true
			? DESTRUCTIVE_NOTICE + CONFIRMATION_MODE_NOTICE + baseDescription
			: baseDescription;

	return modelContext.registerTool( {
		name: toToolName( ability.name ),
		title: ability.label ?? ability.name,
		description,
		inputSchema: normalizeInputSchema( ability.input_schema ),
		annotations: {
			readOnlyHint: annotations.readonly === true,
			// WordPress content, labels, and metadata may contain user-authored text.
			untrustedContentHint: true,
		},
		execute: async ( params, context = {} ) => {
			const signal = context?.signal;
			throwIfAborted( signal );

			// Destructive tools require an in-page trusted confirmation before they
			// run. WebMCP has no built-in confirmation and the agent has no
			// "destructive" hint it consumes, so this is the project's enforcement
			// point: the user supervising the page can approve. Declining returns
			// a structured cancellation (not an error) so the agent knows the action
			// was refused, not that it failed.
			if ( annotations.destructive === true ) {
				const decision = await confirmDestructive(
					ability,
					params ?? {},
					signal,
					AUTOMATED_CONFIRMATION_ALLOWED
				);

				if ( ! decision.approved ) {
					const expired = decision.reason === 'expired';
					logActivity( {
						ability,
						params: params ?? {},
						outcome: expired ? 'expired' : 'declined',
					} );

					return {
						cancelled: true,
						reason: expired
							? 'The confirmation expired before approval.'
							: 'The user declined this destructive action in the page.',
					};
				}
			}

			// The invocation may have been cancelled while the confirmation was
			// visible. Never let a late click execute an already-cancelled action.
			throwIfAborted( signal );

			let result;
			try {
				result = await executeAbility( ability.name, params ?? {} );
			} catch ( error ) {
				logActivity( {
					ability,
					params: params ?? {},
					outcome: 'failed',
				} );
				throw error; // never swallow the rejection
			}

			logActivity( {
				ability,
				params: params ?? {},
				outcome: 'ran',
			} );

			return result;
		},
	} );
}

/**
 * Mounts the Site tools activity log panel once and returns its list element.
 *
 * Builds a fixed bottom-right panel (a convenience signal, NOT a native WP admin
 * notice and NOT an audit record): a header with the title, a collapse/expand
 * toggle, and a hidden "new activity" dot, plus a scrollable `role="log"` list with
 * `aria-live="polite"` so screen readers announce appended entries. Idempotent: when
 * the panel already exists it returns the existing list element. The z-index sits one
 * below the L6 confirmation modal (2147483647) so a confirmation still overlays it.
 *
 * This only mounts the container; {@link logActivity} appends entries.
 *
 * @return {HTMLElement} The list element entries are prepended to.
 */
function mountActivityLog() {
	const existing = document.getElementById( 'webmcp-activity-log' );
	if ( existing ) {
		return existing.querySelector( '[data-webmcp-log-list]' );
	}

	const panel = document.createElement( 'section' );
	panel.id = 'webmcp-activity-log';
	panel.setAttribute( 'aria-label', 'ChatGPT Work and Codex Site tools activity' );
	panel.style.cssText =
		'position:fixed;bottom:16px;right:16px;z-index:2147483646;width:320px;' +
		'max-width:calc(100% - 32px);background:#fff;color:#1e1e1e;' +
		'border:1px solid #c3c4c7;border-radius:8px;' +
		'box-shadow:0 6px 24px rgba(0,0,0,0.18);' +
		'font:13px/1.5 -apple-system,system-ui,sans-serif;overflow:hidden;';

	const header = document.createElement( 'div' );
	header.style.cssText =
		'display:flex;align-items:center;gap:8px;padding:8px 12px;' +
		'background:#1e1e1e;color:#fff;';

	const title = document.createElement( 'span' );
	title.id = 'webmcp-activity-log-title';
	title.textContent = 'ChatGPT Work and Codex Site tools activity';
	title.style.cssText = 'flex:1;font-weight:600;font-size:13px;';

	// Hidden by default; revealed when a write/destructive entry arrives collapsed.
	const dot = document.createElement( 'span' );
	dot.setAttribute( 'data-webmcp-log-dot', '' );
	dot.setAttribute( 'aria-hidden', 'true' );
	dot.style.cssText =
		'display:none;width:8px;height:8px;border-radius:50%;background:#d63638;';

	const toggle = document.createElement( 'button' );
	toggle.type = 'button';
	toggle.setAttribute( 'data-webmcp-log-toggle', '' );
	toggle.setAttribute( 'aria-expanded', 'true' );
	toggle.setAttribute( 'aria-controls', 'webmcp-activity-log-list' );
	toggle.textContent = 'Collapse';
	toggle.style.cssText =
		'padding:2px 8px;border-radius:4px;border:1px solid #757575;' +
		'background:transparent;color:#fff;cursor:pointer;font:inherit;font-size:12px;';

	const list = document.createElement( 'ol' );
	list.id = 'webmcp-activity-log-list';
	list.setAttribute( 'data-webmcp-log-list', '' );
	list.setAttribute( 'role', 'log' );
	list.setAttribute( 'aria-live', 'polite' );
	list.setAttribute( 'aria-relevant', 'additions' );
	list.style.cssText =
		'margin:0;padding:0;list-style:none;max-height:320px;overflow-y:auto;';

	toggle.addEventListener( 'click', () => {
		const collapsed = toggle.getAttribute( 'aria-expanded' ) === 'false';
		// Expand.
		if ( collapsed ) {
			list.style.display = '';
			toggle.setAttribute( 'aria-expanded', 'true' );
			toggle.textContent = 'Collapse';
			// Expanding clears the unseen-activity cue.
			dot.style.display = 'none';
			return;
		}
		// Collapse.
		list.style.display = 'none';
		toggle.setAttribute( 'aria-expanded', 'false' );
		toggle.textContent = 'Expand';
	} );

	header.append( title, dot, toggle );
	panel.append( header, list );
	( document.body ?? document.documentElement ).append( panel );

	return list;
}

/**
 * Builds one Site tools activity entry and adds it to the log list.
 *
 * Shared by live logging ({@link logActivity}) and server hydration
 * ({@link hydrateActivityLog}) so both render identical DOM. Each entry shows the
 * time, an "Agent" attribution marker, an outcome badge (ran / failed / declined / expired),
 * and the action label. When `screenUrl` is a non-empty string it appends an
 * "Open screen ↗" link to that URL; otherwise no link is rendered. Every supplied
 * value is rendered with `textContent`, never `innerHTML`, so untrusted values
 * cannot inject markup.
 *
 * @param {HTMLElement} list              The log list element to add the entry to.
 * @param {Object}      entry             The entry to render.
 * @param {string}      entry.label       The action label (textContent).
 * @param {string}      entry.outcome     One of `'ran'`, `'failed'`, `'declined'`, or `'expired'`.
 * @param {?string}     entry.screenUrl   The screen link URL, or null/empty for no link.
 * @param {string}      entry.timeText    The formatted time text (textContent).
 * @param {boolean}     entry.isWrite     True for a write/destructive entry (link-bearing).
 * @param {boolean}     entry.prepend     True to prepend (newest first), false to append.
 * @return {HTMLElement} The created `<li>` entry element.
 */
function appendActivityEntry(
	list,
	{ label, outcome, screenUrl, timeText, isWrite, prepend }
) {
	const entry = document.createElement( 'li' );
	entry.style.cssText =
		'padding:8px 12px;border-top:1px solid #e0e0e0;' +
		'display:flex;flex-direction:column;gap:2px;';

	const meta = document.createElement( 'div' );
	meta.style.cssText =
		'display:flex;align-items:center;gap:6px;font-size:11px;color:#757575;';

	const time = document.createElement( 'span' );
	time.textContent = timeText;

	const attribution = document.createElement( 'span' );
	attribution.textContent = 'Agent';
	attribution.style.cssText =
		'padding:0 5px;border-radius:3px;background:#f0f0f1;color:#3c434a;';

	const badge = document.createElement( 'span' );
	const badgeStyles = {
		ran: 'background:#edfaef;color:#00450c;',
		failed: 'background:#fcf0f1;color:#8a1f11;',
		declined: 'background:#fcf9e8;color:#674e00;',
		expired: 'background:#f0f0f1;color:#50575e;',
	};
	badge.textContent = outcome;
	badge.style.cssText =
		'margin-left:auto;padding:0 6px;border-radius:3px;font-weight:600;' +
		( badgeStyles[ outcome ] ?? 'background:#f0f0f1;color:#3c434a;' );

	meta.append( time, attribution, badge );

	const labelEl = document.createElement( 'div' );
	labelEl.style.cssText = 'font-weight:600;word-break:break-word;';
	labelEl.textContent = label;

	entry.append( meta, labelEl );

	// A non-empty screen url is the link signal: writes carry one, reads never do.
	if ( isWrite && typeof screenUrl === 'string' && screenUrl !== '' ) {
		const link = document.createElement( 'a' );
		link.href = screenUrl;
		link.textContent = 'Open screen ↗';
		link.style.cssText = 'font-size:12px;color:#2271b1;';
		entry.append( link );
	}

	if ( prepend ) {
		list.prepend( entry );
	} else {
		list.append( entry );
	}

	return entry;
}

/**
 * Appends one Site tools activity entry to the log panel (newest first) and records it.
 *
 * Lazy-mounts the panel via {@link mountActivityLog} so it appears on the first
 * entry, not before, then renders the entry via {@link appendActivityEntry} (newest
 * first). For a write/destructive ability (`meta.annotations.readonly !== true`) it
 * resolves a same-origin screen link via {@link resolveScreenLink}; reads, and writes
 * with no resolvable link, render no link. A write/destructive entry appended while the
 * panel is collapsed reveals the header "new activity" dot.
 *
 * After rendering, it POSTs the action to the activity API (fire-and-forget): this is
 * audit-only and must NEVER affect the tool call. The POST is not awaited and a `.catch`
 * swallows any rejection, and the whole body is wrapped so a rendering error can never
 * propagate to the caller (the tool action and its result are unaffected).
 *
 * @param {Object} options         The entry to log.
 * @param {Object} options.ability The ability record (label/name/meta).
 * @param {Object} options.params  The action's arguments (for the screen link).
 * @param {string} options.outcome One of `'ran'`, `'failed'`, `'declined'`, or `'expired'`.
 * @return {void}
 */
function logActivity( { ability, params, outcome } ) {
	try {
		const list = mountActivityLog();
		const panel = document.getElementById( 'webmcp-activity-log' );
		const toggle = panel?.querySelector( '[data-webmcp-log-toggle]' );
		const collapsed = toggle?.getAttribute( 'aria-expanded' ) === 'false';

		// Writes/destructive may carry a screen link; reads never do.
		const isWrite = ability.meta?.annotations?.readonly !== true;
		const screenUrl = isWrite
			? resolveScreenLink( ability.name, params ?? {} )
			: null;

		appendActivityEntry( list, {
			label: ability.label ?? ability.name,
			outcome,
			screenUrl,
			timeText: new Date().toLocaleTimeString(),
			isWrite,
			prepend: true,
		} );

		// Reveal the unseen-activity cue only for writes/destructive arriving while
		// collapsed; reads keep their salience low (per the design note).
		if ( isWrite && collapsed ) {
			const dot = panel?.querySelector( '[data-webmcp-log-dot]' );
			if ( dot ) {
				dot.style.display = 'inline-block';
			}
		}

		// Static reveal honours reduced-motion: no animation is used, so nothing to gate.

		// Record the action server-side (audit-only). Fire-and-forget: not awaited and
		// the `.catch` swallows any rejection, so a recording failure can never surface
		// to the caller or alter the tool action/result. The server fills user/session/
		// created and redacts params; nonce is carried by wp.apiFetch.
		if ( window.wp?.apiFetch ) {
			window.wp
				.apiFetch( {
					path: '/webmcp/v1/activity',
					method: 'POST',
					data: {
						run_id: RUN_ID,
						ability: ability.name,
						outcome,
						screen_url: screenUrl,
						params: params ?? {},
					},
				} )
				.catch( () => {} );
		}
	} catch {
		// Logging is presentation-only: swallow rendering errors so they never reach
		// the caller or alter the tool action/result.
	}
}

/**
 * Hydrates the activity panel with this run's prior entries from the server.
 *
 * Called ONCE at adapter init (not on the store subscribe tick) so server history and
 * live entries never double-render. GETs the current run's recent rows (newest-first)
 * and, when there is at least one row, mounts the panel and renders each via
 * {@link appendActivityEntry} with `prepend: false` — server history renders newest-first
 * below any live entries. A row is treated as link-bearing when its `screen_url` is a
 * non-empty string (only writes carry one server-side, so that presence is the correct
 * link signal). Hydrated labels use the slash ability name as-is; client-side label
 * resolution is not attempted (a minor cosmetic difference is acceptable).
 *
 * Audit/presentation-only and defensive: a `.catch` swallows any failure so it can never
 * surface to the page.
 *
 * @return {void}
 */
function hydrateActivityLog() {
	if ( ! window.wp?.apiFetch ) {
		return;
	}

	window.wp
		.apiFetch( {
			path:
				'/webmcp/v1/activity?run_id=' +
				encodeURIComponent( RUN_ID ) +
				'&limit=100',
		} )
		.then( ( rows ) => {
			if ( ! Array.isArray( rows ) || rows.length === 0 ) {
				return;
			}

			const list = mountActivityLog();

			for ( const row of rows ) {
				const screenUrl =
					typeof row.screen_url === 'string' ? row.screen_url : null;

				appendActivityEntry( list, {
					label: row.ability,
					outcome: row.outcome,
					screenUrl,
					timeText: new Date( row.created ).toLocaleTimeString(),
					isWrite: screenUrl !== null && screenUrl !== '',
					prepend: false,
				} );
			}
		} )
		.catch( () => {} );
}

/**
 * Converts an ability name into a WebMCP-safe tool name.
 *
 * Ability names use `namespace/name`; WebMCP tool names disallow `/`.
 *
 * @param {string} abilityName The ability name.
 * @return {string} A tool-safe name.
 */
function toToolName( abilityName ) {
	return abilityName.replace( /\//g, '-' );
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
