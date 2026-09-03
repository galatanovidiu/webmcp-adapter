/**
 * Shows an in-page confirmation for a destructive tool and resolves the choice.
 *
 * Arguments are rendered with textContent, never innerHTML. When the browser
 * supplies an AbortSignal to the tool callback, aborting removes the modal and
 * rejects before the caller can execute the ability.
 *
 * @param {Object}      ability              Ability record (for its label/name).
 * @param {Object}      params               Arguments the tool would run with.
 * @param {AbortSignal} signal               Optional invocation signal.
 * @param {boolean}     automatedConfirmation Whether synthetic confirmation is allowed.
 * @param {number}      timeoutMs            Maximum wait before a safe decline.
 * @return {Promise<{approved: boolean, reason: string}>} The confirmation decision.
 */
export function confirmDestructive(
	ability,
	params,
	signal,
	automatedConfirmation = false,
	timeoutMs = 60000
) {
	throwIfAborted( signal );

	return new Promise( ( resolve, reject ) => {
		const toolLabel = ability.label ?? ability.name;

		const overlay = document.createElement( 'div' );
		overlay.setAttribute( 'data-webmcp-confirm-overlay', '' );
		if ( typeof signal?.addEventListener === 'function' ) {
			overlay.setAttribute( 'data-webmcp-confirm-abort-aware', '' );
		}
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
		title.textContent = '⚠ Confirm persistent action';
		title.style.cssText =
			'margin:0 0 8px;font-size:16px;font-weight:600;color:#b32d2e;';

		const intro = document.createElement( 'p' );
		intro.style.cssText = 'margin:0 0 6px;';
		intro.textContent =
			'The AI agent is asking to run a persistent, consequential tool:';

		const tool = document.createElement( 'p' );
		tool.style.cssText = 'margin:0 0 10px;font-weight:600;';
		tool.textContent = toolLabel;

		let automationMarker = null;
		if ( automatedConfirmation ) {
			automationMarker = document.createElement( 'p' );
			automationMarker.setAttribute(
				'data-webmcp-confirm-automation',
				''
			);
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
		confirmBtn.textContent = 'Run persistent tool';
		confirmBtn.style.cssText =
			'padding:6px 14px;border-radius:4px;border:1px solid #b32d2e;' +
			'background:#b32d2e;color:#fff;cursor:pointer;font:inherit;';

		let settled = false;
		let timeoutId = null;
		const cleanup = () => {
			document.removeEventListener( 'keydown', onKey, true );
			signal?.removeEventListener?.( 'abort', onAbort );
			if ( timeoutId !== null ) {
				window.clearTimeout( timeoutId );
			}
			overlay.remove();
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
			}
		};

		cancelBtn.addEventListener( 'click', () =>
			finish( false, 'declined' )
		);
		confirmBtn.addEventListener( 'click', ( event ) => {
			if ( ! automatedConfirmation && ! event.isTrusted ) {
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

		buttons.append( cancelBtn, confirmBtn );
		dialog.append( title, intro, tool, argsLabel, args, buttons );
		if ( automationMarker ) {
			dialog.insertBefore( automationMarker, argsLabel );
		}
		overlay.append( dialog );
		( document.body ?? document.documentElement ).append( overlay );

		// Default focus on Cancel: the safe choice if the human presses Enter.
		cancelBtn.focus();
	} );
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

/**
 * Creates a consistent cancellation error across browser implementations.
 *
 * @return {DOMException|Error} An error named AbortError.
 */
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

/**
 * Serializes tool arguments for display without throwing.
 *
 * @param {*} value Value to serialize.
 * @return {string} Human-readable arguments.
 */
function safeStringify( value ) {
	try {
		return JSON.stringify( value, null, 2 ) ?? String( value );
	} catch {
		return '[unserializable arguments]';
	}
}
