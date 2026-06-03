/**
 * WebMCP Adapter — browser adapter.
 *
 * Maps WordPress abilities (Abilities API client store) onto the browser
 * WebMCP API so in-browser AI agents can discover and run them as tools.
 *
 * Verified against WordPress 7.0 + Chrome 149 (WebMCPTesting flag): the two
 * read-only core abilities register as tools and execute successfully.
 */

// `@wordpress/core-abilities` populates the client store with server-registered
// abilities. On import it fetches `/wp-abilities/v1/abilities` over REST and then
// pushes each ability into the store imperatively (there is no store resolver).
import '@wordpress/core-abilities';
import { executeAbility, getAbilities, store as abilitiesStore } from '@wordpress/abilities';

// `navigator.modelContext` is the live API in Chrome 149; `document.modelContext`
// replaces it in Chrome 150. Prefer document, fall back to navigator.
const modelContext = document.modelContext || navigator.modelContext;

// Option-B write gate: write abilities become WebMCP tools only when the admin
// enabled the write setting. The flag is read ONCE here from server-provided
// script-module data; any missing/unparseable/non-true value is treated as
// disabled, so the gate fails safe (writes hidden). A setting change takes effect
// on the next page load.
const WRITE_TOOLS_ENABLED = readModuleFlag( 'writeToolsEnabled' );

// Destructive write abilities (permanent deletes, plugin activate/deactivate,
// theme switch, connectors, permalink/site-editor changes) are exposed only when
// this SECOND toggle is on AND writes are enabled. Read once here; any missing/
// unparseable/non-true value reads as disabled (fail-safe).
const DESTRUCTIVE_TOOLS_ENABLED = readModuleFlag( 'destructiveToolsEnabled' );

// Dangerous write abilities (plugin/theme install·update·delete, allow-listed
// option writes, privacy export) are the strictest tier. They are exposed only
// when this THIRD toggle is on AND writes and destructive are enabled AND the
// specific ability is individually opted in. Read once here; any missing/
// unparseable/non-true value reads as disabled (fail-safe).
const DANGEROUS_TOOLS_ENABLED = readModuleFlag( 'dangerousToolsEnabled' );

// The per-ability dangerous opt-in: only ability names in this set may be exposed
// as dangerous tools, even when the tier toggle is on. Read once here; a missing/
// unparseable value yields an empty set (fail-safe: nothing armed).
const DANGEROUS_OPTIN = new Set( readModuleArray( 'dangerousToolOptIn' ) );

// The canonical set of dangerous (T3) ability names, provided by the server. The
// Abilities API client store strips custom annotation keys (it keeps only
// readonly/destructive/idempotent), so the browser cannot read `dangerous` from an
// ability's annotations — it must recognize a dangerous tool by NAME. A missing/
// unparseable value yields an empty set (fail-safe: nothing treated as dangerous,
// but such a tool is still also `destructive` so it stays behind the destructive
// gate, never exposed under writes-only).
const DANGEROUS_NAMES = new Set( readModuleArray( 'dangerousToolNames' ) );

// Default-OFF demo escape hatch. When the admin turns this on, the in-page
// confirmation modal accepts synthetic (script-dispatched) clicks so a script or
// agent can drive destructive/dangerous tools end-to-end for a recording. When off
// (the default), the modal's accept path requires a real human click
// (`event.isTrusted`). Read once here; any missing/unparseable/non-true value reads
// as off (fail-safe: human-only).
const AUTOMATED_CONFIRMATION_ALLOWED = readModuleFlag( 'allowAutomatedConfirmation' );

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
	? 'Automated confirmation is currently ENABLED: your confirm action will be accepted without a human. '
	: 'A human must confirm this in the page before it runs; you cannot confirm it yourself. ';

// Prefixed to a destructive tool's description. WebMCP has no agent-consumed
// "destructive" hint, so the description tells the agent what to expect: running
// the tool pops an in-page confirmation the human must approve first.
const DESTRUCTIVE_NOTICE =
	'⚠ DESTRUCTIVE and irreversible. Running this tool asks the user to confirm in the page before it proceeds; they may decline. ';

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
 * `destructiveToolsEnabled`, `dangerousToolsEnabled`, `allowAutomatedConfirmation`)
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
 * Reads a named array from server-provided script-module data.
 *
 * Mirrors {@link readModuleFlag} but returns the named value when it is an array.
 * Anything else — a missing tag, invalid JSON, or a non-array value — reads as an
 * empty array (fail-safe).
 *
 * @param {string} key The array name to read.
 * @return {Array} The named array, or an empty array.
 */
function readModuleArray( key ) {
	const container = document.getElementById(
		'wp-script-module-data-webmcp-adapter/adapter'
	);

	if ( ! container ) {
		return [];
	}

	try {
		const parsed = JSON.parse( container.textContent );
		return Array.isArray( parsed?.[ key ] ) ? parsed[ key ] : [];
	} catch {
		return [];
	}
}

/**
 * Reads a named plain object from server-provided script-module data.
 *
 * Mirrors {@link readModuleArray} but returns the named value when it is a plain
 * object. Anything else — a missing tag, invalid JSON, null, or an array — reads as
 * an empty object (fail-safe).
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
 * dangerous write (the strictest tier) is identified by NAME (the client store
 * drops the `dangerous` annotation) and exposed only when the dangerous tier is on
 * AND that specific ability is individually opted in — checked BEFORE the
 * destructive branch, because dangerous abilities are also destructive. A
 * destructive write is exposed when both the write and destructive settings are
 * on. Any other write is exposed when writes are on.
 *
 * @param {Object} annotations The ability's `meta.annotations` object.
 * @param {string} abilityName The ability name (for the dangerous-name + opt-in checks).
 * @return {boolean} True if the ability should register as a tool.
 */
function shouldExpose( annotations, abilityName ) {
	if ( annotations.readonly === true ) {
		return true;
	}

	if ( ! WRITE_TOOLS_ENABLED ) {
		return false;
	}

	if ( DANGEROUS_NAMES.has( abilityName ) ) {
		return DANGEROUS_TOOLS_ENABLED && DANGEROUS_OPTIN.has( abilityName );
	}

	if ( annotations.destructive === true ) {
		return DESTRUCTIVE_TOOLS_ENABLED;
	}

	return true;
}

/**
 * Registers every ability as a WebMCP tool, now and as more arrive.
 *
 * Abilities load asynchronously, so the store is empty on first paint. We
 * register what is present, then subscribe and register any ability we have
 * not seen yet. Subscribing also covers abilities registered later at runtime.
 *
 * @return {void}
 */
function syncAbilitiesToTools() {
	const registered = new Set();

	const sync = () => {
		// getAbilities() is a synchronous data-store selector.
		for ( const ability of getAbilities() ) {
			if ( registered.has( ability.name ) ) {
				continue;
			}
			// Option-B gate. Writes are skipped without being marked registered,
			// so they are re-evaluated on later store ticks (the decision is fixed
			// per page load, so a skipped write stays skipped — fail-safe).
			if ( ! shouldExpose( ability.meta?.annotations ?? {}, ability.name ) ) {
				continue;
			}
			registered.add( ability.name );
			registerAbilityAsTool( ability );
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
 * @return {void}
 */
function registerAbilityAsTool( ability ) {
	const annotations = ability.meta?.annotations ?? {};
	const baseDescription =
		ability.description ?? ability.label ?? ability.name;
	const description =
		annotations.destructive === true
			? DESTRUCTIVE_NOTICE + CONFIRMATION_MODE_NOTICE + baseDescription
			: baseDescription;

	modelContext.registerTool( {
		name: toToolName( ability.name ),
		description,
		inputSchema: normalizeInputSchema( ability.input_schema ),
		annotations: {
			readOnlyHint: annotations.readonly === true,
		},
		execute: async ( params ) => {
			// Destructive tools require an in-page human confirmation before they
			// run. WebMCP has no built-in confirmation and the agent has no
			// "destructive" hint it consumes, so this is the project's enforcement
			// point: the human supervising the page must approve. Declining returns
			// a structured cancellation (not an error) so the agent knows the action
			// was refused, not that it failed.
			if ( annotations.destructive === true ) {
				const approved = await confirmDestructive(
					ability,
					params ?? {}
				);

				if ( ! approved ) {
					logActivity( {
						ability,
						params: params ?? {},
						outcome: 'declined',
					} );

					return JSON.stringify( {
						cancelled: true,
						reason:
							'The user declined this destructive action in the page.',
					} );
				}
			}

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

			return typeof result === 'string'
				? result
				: JSON.stringify( result );
		},
	} );
}

/**
 * Shows an in-page confirmation for a destructive tool and resolves the choice.
 *
 * Renders a modal dialog into the page showing the tool and the exact arguments
 * about to be sent, with Cancel (default, safe) and Confirm buttons. Resolves
 * `true` only when the human explicitly confirms; the Cancel button and the Escape
 * key resolve `false`. An outside/overlay-background click does NOT dismiss the
 * dialog (an accidental click must not cancel a destructive action). Arguments are
 * rendered with `textContent`
 * (never `innerHTML`), so agent-supplied values cannot inject markup into the page.
 *
 * @param {Object} ability The ability record (for its label/name).
 * @param {Object} params  The arguments the tool would run with.
 * @return {Promise<boolean>} Resolves true if the user confirmed, else false.
 */
function confirmDestructive( ability, params ) {
	return new Promise( ( resolve ) => {
		const toolLabel = ability.label ?? ability.name;

		const overlay = document.createElement( 'div' );
		overlay.setAttribute( 'data-webmcp-confirm-overlay', '' );
		overlay.style.cssText =
			'position:fixed;inset:0;z-index:2147483647;display:flex;' +
			'align-items:center;justify-content:center;' +
			'background:rgba(0,0,0,0.55);';

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'alertdialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'webmcp-confirm-title' );
		dialog.style.cssText =
			'background:#fff;color:#1e1e1e;max-width:460px;width:calc(100% - 40px);' +
			'border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.4);' +
			'padding:20px 22px;font:14px/1.5 -apple-system,system-ui,sans-serif;';

		const title = document.createElement( 'h2' );
		title.id = 'webmcp-confirm-title';
		title.textContent = '⚠ Confirm destructive action';
		title.style.cssText =
			'margin:0 0 8px;font-size:16px;font-weight:600;color:#b32d2e;';

		const intro = document.createElement( 'p' );
		intro.style.cssText = 'margin:0 0 6px;';
		intro.textContent =
			'The AI agent is asking to run a destructive, irreversible tool:';

		const tool = document.createElement( 'p' );
		tool.style.cssText = 'margin:0 0 10px;font-weight:600;';
		tool.textContent = toolLabel;

		// Visible marker when the human-only guard is relaxed for demos. Also gives
		// P3 verification a stable hook (`data-webmcp-confirm-automation`).
		let automationMarker = null;
		if ( AUTOMATED_CONFIRMATION_ALLOWED ) {
			automationMarker = document.createElement( 'p' );
			automationMarker.setAttribute( 'data-webmcp-confirm-automation', '' );
			automationMarker.textContent =
				'⚙ Automated confirmation enabled — a script may confirm this without a human.';
			automationMarker.style.cssText =
				'margin:0 0 10px;padding:6px 8px;border-radius:4px;' +
				'background:#fcf0c8;color:#664d03;font-size:12px;';
		}

		const argsLabel = document.createElement( 'p' );
		argsLabel.style.cssText =
			'margin:0 0 4px;font-size:12px;text-transform:uppercase;' +
			'letter-spacing:0.04em;color:#757575;';
		argsLabel.textContent = 'Arguments';

		const args = document.createElement( 'pre' );
		args.style.cssText =
			'margin:0 0 16px;max-height:180px;overflow:auto;background:#f0f0f1;' +
			'border-radius:4px;padding:10px;font-size:12px;white-space:pre-wrap;' +
			'word-break:break-word;';
		// textContent, never innerHTML: agent-supplied args are untrusted.
		args.textContent = safeStringify( params );

		const buttons = document.createElement( 'div' );
		buttons.style.cssText =
			'display:flex;gap:10px;justify-content:flex-end;';

		const cancelBtn = document.createElement( 'button' );
		cancelBtn.type = 'button';
		cancelBtn.setAttribute( 'data-webmcp-confirm-cancel', '' );
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText =
			'padding:6px 14px;border-radius:4px;border:1px solid #757575;' +
			'background:#fff;cursor:pointer;font:inherit;';

		const confirmBtn = document.createElement( 'button' );
		confirmBtn.type = 'button';
		confirmBtn.setAttribute( 'data-webmcp-confirm-accept', '' );
		confirmBtn.textContent = 'Run destructive tool';
		confirmBtn.style.cssText =
			'padding:6px 14px;border-radius:4px;border:1px solid #b32d2e;' +
			'background:#b32d2e;color:#fff;cursor:pointer;font:inherit;';

		let settled = false;
		const finish = ( approved ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			document.removeEventListener( 'keydown', onKey, true );
			overlay.remove();
			resolve( approved );
		};

		const onKey = ( event ) => {
			if ( event.key === 'Escape' ) {
				event.preventDefault();
				finish( false );
			}
		};

		cancelBtn.addEventListener( 'click', () => finish( false ) );
		confirmBtn.addEventListener( 'click', ( event ) => {
			// Human-only by default: reject synthetic, script-dispatched clicks
			// (event.isTrusted === false). A real human click passes; so does a
			// CDP-injected trusted click, which is the documented out-of-scope
			// adversary. The default-OFF automation toggle is the ONLY relaxation:
			// when on, a script may confirm for demos.
			if ( ! AUTOMATED_CONFIRMATION_ALLOWED && ! event.isTrusted ) {
				return;
			}
			finish( true );
		} );
		// Intentionally NO overlay-background click handler: an accidental click
		// outside the dialog must not dismiss a destructive confirmation. Cancelling
		// requires the explicit Cancel button or the Escape key (both deliberate).
		document.addEventListener( 'keydown', onKey, true );

		buttons.append( cancelBtn, confirmBtn );
		dialog.append( title, intro, tool, argsLabel, args, buttons );
		if ( automationMarker ) {
			dialog.insertBefore( automationMarker, argsLabel );
		}
		overlay.append( dialog );
		( document.body ?? document.documentElement ).append( overlay );

		// Default focus on Cancel: the safe choice if the human just hits Enter.
		cancelBtn.focus();
	} );
}

/**
 * Serializes tool arguments for display, tolerating values that cannot be
 * stringified (circular refs, etc.) without throwing.
 *
 * @param {*} value The value to serialize.
 * @return {string} A human-readable string, never throwing.
 */
function safeStringify( value ) {
	try {
		return JSON.stringify( value, null, 2 ) ?? String( value );
	} catch {
		return '[unserializable arguments]';
	}
}

/**
 * Mounts the agent-activity log panel once and returns its list element.
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
	panel.setAttribute( 'aria-label', 'WebMCP agent activity' );
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
	title.textContent = 'WebMCP agent activity';
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
 * Builds one agent-activity entry and adds it to the log list.
 *
 * Shared by live logging ({@link logActivity}) and server hydration
 * ({@link hydrateActivityLog}) so both render identical DOM. Each entry shows the
 * time, an "Agent" attribution marker, an outcome badge (ran / failed / declined),
 * and the action label. When `screenUrl` is a non-empty string it appends an
 * "Open screen ↗" link to that URL; otherwise no link is rendered. Every supplied
 * value is rendered with `textContent`, never `innerHTML`, so untrusted values
 * cannot inject markup.
 *
 * @param {HTMLElement} list              The log list element to add the entry to.
 * @param {Object}      entry             The entry to render.
 * @param {string}      entry.label       The action label (textContent).
 * @param {string}      entry.outcome     One of `'ran'`, `'failed'`, or `'declined'`.
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
 * Appends one agent-activity entry to the log panel (newest first) and records it.
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
 * @param {string} options.outcome One of `'ran'`, `'failed'`, or `'declined'`.
 * @return {void}
 */
function logActivity( { ability, params, outcome } ) {
	try {
		const list = mountActivityLog();
		const panel = document.getElementById( 'webmcp-activity-log' );
		const toggle = panel?.querySelector( '[data-webmcp-log-toggle]' );
		const collapsed =
			toggle?.getAttribute( 'aria-expanded' ) === 'false';

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
