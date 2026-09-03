/**
 * Consequential and privileged in-page confirmation.
 *
 * The dialog is isolated in a shadow root. All provider, action, page, and
 * summary values are rendered with textContent after sensitive-value redaction.
 */

const SENSITIVE_KEY_PARTS = [
	'password',
	'passwd',
	'pwd',
	'secret',
	'token',
	'nonce',
	'api_key',
	'apikey',
	'access_key',
	'private_key',
	'authorization',
	'email',
	'credential',
	'credit_card',
	'card_number',
	'ssn',
	'cookie',
	'session',
];
const MAX_SUMMARY_DEPTH = 5;
const MAX_SUMMARY_ENTRIES = 100;
const MAX_SUMMARY_STRING_LENGTH = 240;

/**
 * Shows an in-page confirmation and resolves the user's choice.
 *
 * @param {Object} ability Ability record.
 * @param {Object} params Invocation arguments.
 * @param {Object} options Confirmation context.
 * @param {string} options.risk Consequential or privileged risk.
 * @param {AbortSignal} options.signal Optional invocation signal.
 * @param {number} options.timeoutMs Maximum wait before expiry.
 * @param {string} options.pageContext Redacted current-page description.
 * @return {Promise<{approved: boolean, reason: string}>} The decision.
 */
export function confirmRiskyAction(
	ability,
	params,
	{ risk, signal, timeoutMs = 60000, pageContext = defaultPageContext() } = {}
) {
	throwIfAborted( signal );

	return new Promise( ( resolve, reject ) => {
		const previousFocus = deepActiveElement();
		const provider =
			ability.meta?.webmcp?.provider ??
			ability.category ??
			ability.name?.split( '/' )[ 0 ] ??
			'WordPress';
		const action = ability.label ?? ability.name ?? 'Site tool action';
		const riskLabel =
			risk === 'privileged' ? 'Privileged' : 'Consequential';

		const host = document.createElement( 'div' );
		host.setAttribute( 'data-webmcp-confirm-host', '' );
		if ( typeof signal?.addEventListener === 'function' ) {
			host.setAttribute( 'data-webmcp-confirm-abort-aware', '' );
		}
		host.style.cssText =
			'all:initial!important;position:fixed!important;inset:0!important;' +
			'z-index:2147483647!important;display:block!important;margin:0!important;' +
			'padding:0!important;border:0!important;width:auto!important;height:auto!important;' +
			'max-width:none!important;max-height:none!important;color-scheme:light!important;' +
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
			'font-size:14px!important;color:#1d2327!important;';

		const root = host.attachShadow( { mode: 'open' } );
		const style = document.createElement( 'style' );
		style.textContent = confirmationStyles();

		const overlay = document.createElement( 'div' );
		overlay.className = 'overlay';
		overlay.setAttribute( 'data-webmcp-confirm-overlay', '' );
		const dialog = document.createElement( 'section' );
		dialog.className = 'dialog';
		dialog.setAttribute( 'data-webmcp-confirm-dialog', '' );
		dialog.setAttribute( 'role', 'alertdialog' );
		dialog.setAttribute( 'aria-modal', 'true' );
		dialog.setAttribute( 'aria-labelledby', 'webmcp-confirm-title' );
		dialog.setAttribute( 'aria-describedby', 'webmcp-confirm-intro' );

		const riskElement = document.createElement( 'span' );
		riskElement.className = 'risk';
		riskElement.setAttribute( 'data-webmcp-confirm-risk', '' );
		riskElement.textContent = riskLabel;
		const title = document.createElement( 'h2' );
		title.id = 'webmcp-confirm-title';
		title.textContent = 'Confirm ' + riskLabel.toLowerCase() + ' action';
		const intro = document.createElement( 'p' );
		intro.id = 'webmcp-confirm-intro';
		intro.className = 'intro';
		intro.textContent =
			'Review what this Site tool will do before you approve it.';

		const details = document.createElement( 'dl' );
		details.className = 'details';
		appendDetail(
			details,
			'Provider',
			String( provider ),
			'data-webmcp-confirm-provider'
		);
		appendDetail(
			details,
			'Action',
			String( action ),
			'data-webmcp-confirm-action'
		);
		appendDetail(
			details,
			'Page',
			String( pageContext ),
			'data-webmcp-confirm-page'
		);

		const summaryLabel = document.createElement( 'h3' );
		summaryLabel.textContent = 'Action summary';
		const summary = document.createElement( 'pre' );
		summary.setAttribute( 'data-webmcp-confirm-summary', '' );
		summary.textContent = safeSummary( params );

		const actions = document.createElement( 'div' );
		actions.className = 'actions';
		const decline = document.createElement( 'button' );
		decline.type = 'button';
		decline.className = 'decline';
		decline.setAttribute( 'data-webmcp-confirm-cancel', '' );
		decline.textContent = 'Decline';
		const approve = document.createElement( 'button' );
		approve.type = 'button';
		approve.className = 'approve';
		approve.setAttribute( 'data-webmcp-confirm-accept', '' );
		approve.textContent = 'Approve';
		actions.append( decline, approve );

		dialog.append(
			riskElement,
			title,
			intro,
			details,
			summaryLabel,
			summary,
			actions
		);
		overlay.append( dialog );
		root.append( style, overlay );
		( document.body ?? document.documentElement ).append( host );

		let settled = false;
		let timeoutId = null;
		const cleanup = () => {
			document.removeEventListener( 'keydown', onKey, true );
			signal?.removeEventListener?.( 'abort', onAbort );
			if ( timeoutId !== null ) {
				window.clearTimeout( timeoutId );
			}
			host.remove();
			if ( previousFocus?.isConnected ) {
				previousFocus.focus();
			}
		};
		const finish = ( approved, reason ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			resolve( { approved, reason } );
		};
		const onAbort = () => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			reject( createAbortError() );
		};
		const onKey = ( event ) => {
			if ( event.key === 'Escape' ) {
				event.preventDefault();
				finish( false, 'declined' );
				return;
			}
			if ( event.key !== 'Tab' ) {
				return;
			}
			const active = root.activeElement;
			if ( event.shiftKey && ( active === decline || active === null ) ) {
				event.preventDefault();
				approve.focus();
			} else if ( ! event.shiftKey && active === approve ) {
				event.preventDefault();
				decline.focus();
			}
		};

		decline.addEventListener( 'click', () => finish( false, 'declined' ) );
		approve.addEventListener( 'click', ( event ) => {
			if ( ! event.isTrusted ) {
				return;
			}
			finish( true, 'confirmed' );
		} );
		document.addEventListener( 'keydown', onKey, true );
		signal?.addEventListener?.( 'abort', onAbort, { once: true } );
		timeoutId = window.setTimeout(
			() => finish( false, 'expired' ),
			timeoutMs
		);
		if ( signal?.aborted ) {
			onAbort();
			return;
		}

		// The safe choice receives focus. Pressing Enter therefore declines.
		decline.focus();
	} );
}

function appendDetail( list, label, value, attribute ) {
	const wrapper = document.createElement( 'div' );
	const term = document.createElement( 'dt' );
	term.textContent = label;
	const description = document.createElement( 'dd' );
	description.setAttribute( attribute, '' );
	description.textContent = value;
	wrapper.append( term, description );
	list.append( wrapper );
}

function defaultPageContext() {
	const surface = document.body?.classList.contains( 'wp-admin' )
		? 'WordPress admin'
		: 'Site frontend';
	return surface + ' · ' + window.location.pathname;
}

function deepActiveElement() {
	let active = document.activeElement;
	while ( active?.shadowRoot?.activeElement ) {
		active = active.shadowRoot.activeElement;
	}
	return active;
}

function safeSummary( value ) {
	const state = { count: 0 };
	const redacted = redactValue( value, '', 0, state );
	try {
		return JSON.stringify( redacted, null, 2 ) ?? String( redacted );
	} catch {
		return '[unavailable]';
	}
}

function redactValue( value, key, depth, state ) {
	if ( isSensitiveKey( key ) ) {
		return '[redacted]';
	}
	if ( state.count >= MAX_SUMMARY_ENTRIES || depth > MAX_SUMMARY_DEPTH ) {
		return '[redacted]';
	}
	state.count++;

	if ( Array.isArray( value ) ) {
		return value
			.slice( 0, MAX_SUMMARY_ENTRIES - state.count )
			.map( ( item ) => redactValue( item, '', depth + 1, state ) );
	}
	if ( value && typeof value === 'object' ) {
		const output = {};
		for ( const [ childKey, childValue ] of Object.entries( value ) ) {
			if ( state.count >= MAX_SUMMARY_ENTRIES ) {
				break;
			}
			output[ childKey ] = redactValue(
				childValue,
				childKey,
				depth + 1,
				state
			);
		}
		return output;
	}
	if ( typeof value === 'string' ) {
		return value.length > MAX_SUMMARY_STRING_LENGTH
			? value.slice( 0, MAX_SUMMARY_STRING_LENGTH ) + '…'
			: value;
	}
	if ( value === null || [ 'boolean', 'number' ].includes( typeof value ) ) {
		return value;
	}
	return '[redacted]';
}

function isSensitiveKey( key ) {
	const normalized = String( key ).toLowerCase();
	return SENSITIVE_KEY_PARTS.some( ( part ) => normalized.includes( part ) );
}

/**
 * Throws an AbortError when an invocation has been cancelled.
 *
 * @param {AbortSignal} signal Optional invocation signal.
 * @return {void}
 */
export function throwIfAborted( signal ) {
	if ( ! signal?.aborted ) {
		return;
	}
	if ( typeof signal.throwIfAborted === 'function' ) {
		signal.throwIfAborted();
	}
	throw createAbortError();
}

function createAbortError() {
	if ( typeof DOMException === 'function' ) {
		return new DOMException(
			'The WebMCP invocation was cancelled.',
			'AbortError'
		);
	}
	const error = new Error( 'The WebMCP invocation was cancelled.' );
	error.name = 'AbortError';
	return error;
}

function confirmationStyles() {
	return `
		:host {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			font-size: 14px;
			color: #1d2327;
		}
		*, *::before, *::after { box-sizing: border-box; }
		button { font: inherit; -webkit-appearance: none; appearance: none; }
		.overlay {
			position: fixed;
			inset: 0;
			display: grid;
			place-items: center;
			padding: 20px;
			background: rgba(16,17,20,.68);
		}
		.dialog {
			width: min(500px, 100%);
			max-height: calc(100vh - 40px);
			overflow: auto;
			padding: 24px;
			border: 1px solid #c3c4c7;
			border-radius: 12px;
			background: #fff;
			color: #1d2327;
			box-shadow: 0 18px 54px rgba(0,0,0,.38);
		}
		.risk {
			display: inline-block;
			margin: 0 0 8px;
			padding: 3px 8px;
			border-radius: 10px;
			background: #fcf0f1;
			color: #8a1f11;
			font-size: 11px;
			font-weight: 750;
			letter-spacing: .06em;
			line-height: 1.3;
			text-transform: uppercase;
		}
		h2 {
			margin: 0 0 8px;
			color: #1d2327;
			font-size: 20px;
			font-weight: 700;
			line-height: 1.3;
		}
		.intro {
			margin: 0 0 18px;
			color: #50575e;
			line-height: 1.5;
		}
		.details {
			display: grid;
			gap: 10px;
			margin: 0 0 18px;
		}
		.details div {
			display: grid;
			grid-template-columns: 88px 1fr;
			gap: 10px;
		}
		dt {
			color: #646970;
			font-size: 12px;
			font-weight: 650;
		}
		dd {
			min-width: 0;
			margin: 0;
			overflow-wrap: anywhere;
			color: #1d2327;
			font-weight: 600;
		}
		h3 {
			margin: 0 0 6px;
			color: #50575e;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: .04em;
			line-height: 1.4;
			text-transform: uppercase;
		}
		pre {
			max-height: 190px;
			margin: 0 0 20px;
			padding: 12px;
			overflow: auto;
			border: 1px solid #dcdcde;
			border-radius: 8px;
			background: #f6f7f7;
			color: #1d2327;
			font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}
		.actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: 10px;
		}
		.actions button {
			min-height: 44px;
			padding: 8px 16px;
			border-radius: 7px;
			font-weight: 650;
			cursor: pointer;
		}
		.decline {
			border: 1px solid #8c8f94;
			background: #fff;
			color: #1d2327;
		}
		.approve {
			border: 1px solid #b32d2e;
			background: #b32d2e;
			color: #fff;
		}
		.decline:hover { background: #f0f0f1; }
		.approve:hover { background: #8a2424; }
		button:focus-visible {
			outline: 3px solid #72aee6;
			outline-offset: 3px;
		}
		@media (max-width: 480px) {
			.dialog { padding: 20px; }
			.details div { grid-template-columns: 1fr; gap: 2px; }
			.actions button { flex: 1; }
		}
	`;
}
