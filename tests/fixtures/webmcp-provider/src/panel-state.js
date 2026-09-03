/**
 * Small browser-state service shared by both fixture Ability modules.
 */

export const ALLOWED_TONES = [ 'calm', 'focus' ];

const PANEL_SELECTOR = '[data-webmcp-provider-panel]';
const OUTPUT_SELECTOR = '[data-webmcp-provider-tone-output]';
const FIXTURE_PAGES = [ 'primary', 'secondary' ];

/** Returns the live fixture panel when this document still owns one. */
export function findPanel( root = document ) {
	const panel = root?.querySelector?.( PANEL_SELECTOR );
	return panel && typeof panel === 'object' ? panel : null;
}

/**
 * Reads one closed panel-state projection for the requested fixture pages.
 */
export function readPanelState( panel, allowedPages = FIXTURE_PAGES ) {
	const page = panel?.dataset?.webmcpProviderPage;
	const tone = panel?.dataset?.webmcpProviderTone;
	if (
		! Array.isArray( allowedPages ) ||
		! allowedPages.includes( page ) ||
		! ALLOWED_TONES.includes( tone )
	) {
		return {
			available: false,
			page: null,
			tone: null,
			reason:
				allowedPages.length === 1 && allowedPages[ 0 ] === 'primary'
					? 'The primary fixture panel is not available in this document.'
					: 'The fixture panel is not available in this document.',
		};
	}

	return { available: true, page, tone, reason: null };
}

/** Returns the exact public read shape for the primary page, or null if stale. */
export function readPrimaryPanelState( panel ) {
	const state = readPanelState( panel, [ 'primary' ] );
	return state.available ? { page: state.page, tone: state.tone } : null;
}

/**
 * Applies one visible, request-free, reversible panel-state transition.
 */
export function applyPanelTone( panel, requestedTone ) {
	const state = readPanelState( panel );
	if ( ! state.available ) {
		return {
			applied: false,
			changed: false,
			page: null,
			previousTone: null,
			tone: null,
			reason: state.reason,
		};
	}
	if ( ! ALLOWED_TONES.includes( requestedTone ) ) {
		return {
			applied: false,
			changed: false,
			page: state.page,
			previousTone: state.tone,
			tone: state.tone,
			reason: 'Use exactly `calm` or `focus` for the panel tone.',
		};
	}
	const output = panel.querySelector?.( OUTPUT_SELECTOR );
	if ( ! output || typeof output !== 'object' ) {
		return {
			applied: false,
			changed: false,
			page: state.page,
			previousTone: state.tone,
			tone: state.tone,
			reason: 'The fixture panel output is not available in this document.',
		};
	}
	const outputTone =
		typeof output.textContent === 'string' ? output.textContent.trim() : '';
	if ( requestedTone === state.tone && outputTone === requestedTone ) {
		return {
			applied: true,
			changed: false,
			page: state.page,
			previousTone: state.tone,
			tone: state.tone,
			reason: null,
		};
	}

	if ( panel.dataset.webmcpProviderTone !== requestedTone ) {
		panel.dataset.webmcpProviderTone = requestedTone;
	}
	if ( outputTone !== requestedTone ) {
		output.textContent = requestedTone;
	}

	return {
		applied: true,
		changed: requestedTone !== state.tone || outputTone !== requestedTone,
		page: state.page,
		previousTone: state.tone,
		tone: requestedTone,
		reason: null,
	};
}
