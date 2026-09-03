/**
 * In-tab Site tools activity presentation.
 *
 * The UI lives in an open shadow root so WordPress admin and theme rules cannot
 * restyle it, and its own styles cannot leak into the document. Dynamic values
 * are assigned with textContent and links are restricted to this HTTP(S) origin.
 */

const STORAGE_KEY = 'webmcpActivityExpanded';
const OUTCOME_LABELS = {
	running: 'Running',
	ran: 'Ran',
	failed: 'Failed',
	declined: 'Declined',
	expired: 'Expired',
	cancelled: 'Cancelled',
	stale: 'Stale',
};

/**
 * Creates the activity presenter for one document.
 *
 * @return {Object} Activity presentation controls.
 */
export function createActivityPresenter() {
	let elements = null;
	let nextEntryId = 1;
	let unseenCount = 0;
	const entries = new Map();

	function mount() {
		if ( elements ) {
			return elements.host;
		}

		const existing = document.getElementById( 'webmcp-activity' );
		if ( existing?.shadowRoot ) {
			elements = collectElements( existing );
			return existing;
		}

		const host = document.createElement( 'div' );
		host.id = 'webmcp-activity';
		host.style.cssText =
			'all:initial!important;position:fixed!important;right:16px!important;' +
			'bottom:16px!important;z-index:2147483646!important;display:block!important;' +
			'margin:0!important;padding:0!important;border:0!important;' +
			'width:auto!important;height:auto!important;max-width:none!important;' +
			'max-height:none!important;line-height:normal!important;color-scheme:light!important;' +
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
			'font-size:14px!important;color:#1d2327!important;';

		const root = host.attachShadow( { mode: 'open' } );
		const style = document.createElement( 'style' );
		style.textContent = activityStyles();

		const toggle = document.createElement( 'button' );
		toggle.type = 'button';
		toggle.className = 'launcher';
		toggle.setAttribute( 'data-webmcp-activity-toggle', '' );
		toggle.setAttribute( 'aria-controls', 'webmcp-activity-panel' );
		toggle.setAttribute( 'aria-expanded', 'false' );
		toggle.setAttribute( 'aria-label', 'Open Site tools activity' );
		toggle.append( createActivityIcon() );

		const badge = document.createElement( 'span' );
		badge.className = 'count';
		badge.setAttribute( 'data-webmcp-activity-count', '' );
		badge.setAttribute( 'aria-hidden', 'true' );
		badge.hidden = true;
		toggle.append( badge );

		const panel = document.createElement( 'section' );
		panel.id = 'webmcp-activity-panel';
		panel.className = 'panel';
		panel.setAttribute( 'data-webmcp-activity-panel', '' );
		panel.setAttribute( 'aria-labelledby', 'webmcp-activity-title' );
		panel.hidden = true;

		const header = document.createElement( 'header' );
		header.className = 'header';
		const headingGroup = document.createElement( 'div' );
		headingGroup.className = 'heading-group';
		const eyebrow = document.createElement( 'span' );
		eyebrow.className = 'eyebrow';
		eyebrow.textContent = 'Site tools';
		const title = document.createElement( 'h2' );
		title.id = 'webmcp-activity-title';
		title.textContent = 'Agent activity';
		headingGroup.append( eyebrow, title );

		const close = document.createElement( 'button' );
		close.type = 'button';
		close.className = 'close';
		close.setAttribute( 'data-webmcp-activity-close', '' );
		close.setAttribute( 'aria-label', 'Close Site tools activity' );
		close.textContent = '×';
		header.append( headingGroup, close );

		const empty = document.createElement( 'p' );
		empty.className = 'empty';
		empty.setAttribute( 'data-webmcp-activity-empty', '' );
		empty.textContent = 'No activity in this tab yet.';

		const list = document.createElement( 'ol' );
		list.className = 'list';
		list.setAttribute( 'data-webmcp-activity-list', '' );
		list.hidden = true;

		const live = document.createElement( 'p' );
		live.className = 'visually-hidden';
		live.setAttribute( 'data-webmcp-activity-live', '' );
		live.setAttribute( 'role', 'status' );
		live.setAttribute( 'aria-live', 'polite' );
		live.setAttribute( 'aria-atomic', 'true' );

		panel.append( header, empty, list );
		root.append( style, toggle, panel, live );
		( document.body ?? document.documentElement ).append( host );
		elements = {
			host,
			root,
			toggle,
			badge,
			panel,
			close,
			empty,
			list,
			live,
		};

		toggle.addEventListener( 'click', () => setExpanded( true ) );
		close.addEventListener( 'click', () => setExpanded( false ) );
		root.addEventListener( 'keydown', ( event ) => {
			if ( event.key !== 'Escape' || panel.hidden ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			setExpanded( false );
		} );

		setExpanded( readExpandedState(), { persist: false, focus: false } );
		return host;
	}

	function start( { label, screenUrl = null, isWrite = false } ) {
		mount();
		const id = nextEntryId++;
		const entry = appendEntry( {
			label,
			outcome: 'running',
			screenUrl,
			isWrite,
			prepend: true,
		} );
		entries.set( id, entry );

		if ( elements.panel.hidden ) {
			unseenCount++;
			renderUnseenCount();
		}
		announce( OUTCOME_LABELS.running + ': ' + String( label ) );
		return id;
	}

	function finish( id, outcome ) {
		const entry = entries.get( id );
		if ( ! entry ) {
			return;
		}
		setEntryOutcome( entry, outcome );
		entries.delete( id );
		const label = entry.querySelector(
			'[data-webmcp-activity-label]'
		)?.textContent;
		announce(
			( OUTCOME_LABELS[ outcome ] ?? String( outcome ) ) +
				': ' +
				( label ?? '' )
		);
	}

	function appendHistory( entry ) {
		mount();
		appendEntry( { ...entry, prepend: false } );
	}

	function appendEntry( {
		label,
		outcome,
		screenUrl,
		isWrite,
		prepend,
		timeText = new Date().toLocaleTimeString(),
	} ) {
		elements.empty.hidden = true;
		elements.list.hidden = false;

		const item = document.createElement( 'li' );
		item.className = 'entry';
		item.setAttribute( 'data-webmcp-activity-entry', '' );
		const meta = document.createElement( 'div' );
		meta.className = 'meta';
		const time = document.createElement( 'time' );
		time.textContent = String( timeText );
		const attribution = document.createElement( 'span' );
		attribution.className = 'attribution';
		attribution.textContent = 'Agent';
		const outcomeElement = document.createElement( 'span' );
		outcomeElement.className = 'outcome';
		outcomeElement.setAttribute( 'data-webmcp-activity-outcome', '' );
		meta.append( time, attribution, outcomeElement );

		const labelElement = document.createElement( 'div' );
		labelElement.className = 'label';
		labelElement.setAttribute( 'data-webmcp-activity-label', '' );
		labelElement.textContent = String( label );
		item.append( meta, labelElement );

		const safeUrl = isWrite ? toSafeScreenUrl( screenUrl ) : null;
		if ( safeUrl ) {
			const link = document.createElement( 'a' );
			link.href = safeUrl;
			link.textContent = 'Open screen';
			item.append( link );
		}

		setEntryOutcome( item, outcome );
		if ( prepend ) {
			elements.list.prepend( item );
		} else {
			elements.list.append( item );
		}
		return item;
	}

	function setEntryOutcome( entry, outcome ) {
		const normalized = Object.prototype.hasOwnProperty.call(
			OUTCOME_LABELS,
			outcome
		)
			? outcome
			: 'failed';
		const outcomeElement = entry.querySelector(
			'[data-webmcp-activity-outcome]'
		);
		outcomeElement.dataset.webmcpActivityOutcome = normalized;
		outcomeElement.textContent = OUTCOME_LABELS[ normalized ];
		entry.dataset.webmcpActivityState = normalized;
	}

	function setExpanded( expanded, { persist = true, focus = true } = {} ) {
		mount();
		elements.toggle.hidden = expanded;
		elements.panel.hidden = ! expanded;
		elements.toggle.setAttribute( 'aria-expanded', String( expanded ) );
		elements.toggle.setAttribute(
			'aria-label',
			expanded
				? 'Site tools activity is open'
				: 'Open Site tools activity'
		);

		if ( expanded ) {
			unseenCount = 0;
			renderUnseenCount();
			if ( focus ) {
				elements.close.focus();
			}
		} else if ( focus ) {
			elements.toggle.focus();
		}
		if ( persist ) {
			writeExpandedState( expanded );
		}
	}

	function renderUnseenCount() {
		elements.badge.hidden = unseenCount === 0;
		elements.badge.textContent =
			unseenCount > 99 ? '99+' : String( unseenCount );
		elements.toggle.setAttribute(
			'aria-label',
			unseenCount === 0
				? 'Open Site tools activity'
				: 'Open Site tools activity, ' +
						unseenCount +
						' new ' +
						( unseenCount === 1 ? 'item' : 'items' )
		);
	}

	function announce( message ) {
		elements.live.textContent = '';
		window.requestAnimationFrame( () => {
			if ( elements ) {
				elements.live.textContent = message;
			}
		} );
	}

	return { mount, start, finish, appendHistory };
}

function collectElements( host ) {
	const root = host.shadowRoot;
	return {
		host,
		root,
		toggle: root.querySelector( '[data-webmcp-activity-toggle]' ),
		badge: root.querySelector( '[data-webmcp-activity-count]' ),
		panel: root.querySelector( '[data-webmcp-activity-panel]' ),
		close: root.querySelector( '[data-webmcp-activity-close]' ),
		empty: root.querySelector( '[data-webmcp-activity-empty]' ),
		list: root.querySelector( '[data-webmcp-activity-list]' ),
		live: root.querySelector( '[data-webmcp-activity-live]' ),
	};
}

function readExpandedState() {
	try {
		return window.sessionStorage.getItem( STORAGE_KEY ) === 'true';
	} catch {
		return false;
	}
}

function writeExpandedState( expanded ) {
	try {
		window.sessionStorage.setItem( STORAGE_KEY, String( expanded ) );
	} catch {
		// Storage is optional; the current document still keeps its state.
	}
}

function toSafeScreenUrl( value ) {
	if ( typeof value !== 'string' || value === '' ) {
		return null;
	}
	try {
		const url = new URL( value, window.location.href );
		if (
			url.origin !== window.location.origin ||
			! [ 'http:', 'https:' ].includes( url.protocol )
		) {
			return null;
		}
		return url.href;
	} catch {
		return null;
	}
}

function createActivityIcon() {
	const namespace = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS( namespace, 'svg' );
	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'aria-hidden', 'true' );
	svg.setAttribute( 'focusable', 'false' );
	const path = document.createElementNS( namespace, 'path' );
	path.setAttribute(
		'd',
		'M7 7.5h10M7 12h7M7 16.5h4M5 3.5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9l-5 2v-16a2 2 0 0 1 2-2Z'
	);
	svg.append( path );
	return svg;
}

function activityStyles() {
	return `
		:host {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			font-size: 14px;
			color: #1d2327;
		}
		*, *::before, *::after { box-sizing: border-box; }
		[hidden] { display: none !important; }
		button, a { font: inherit; }
		button { -webkit-appearance: none; appearance: none; }
		.launcher {
			position: relative;
			display: grid;
			place-items: center;
			width: 48px;
			height: 48px;
			margin: 0;
			padding: 0;
			border: 1px solid rgba(255,255,255,.24);
			border-radius: 50%;
			background: #24272d;
			color: #fff;
			box-shadow: 0 5px 18px rgba(0,0,0,.24);
			cursor: pointer;
		}
		.launcher:hover { background: #101114; }
		.launcher:focus-visible, .close:focus-visible, a:focus-visible {
			outline: 3px solid #72aee6;
			outline-offset: 3px;
		}
		.launcher svg {
			width: 24px;
			height: 24px;
			fill: none;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-linejoin: round;
			stroke-width: 1.7;
		}
		.count {
			position: absolute;
			top: -4px;
			right: -4px;
			display: grid;
			place-items: center;
			min-width: 20px;
			height: 20px;
			padding: 0 5px;
			border: 2px solid #fff;
			border-radius: 10px;
			background: #b32d2e;
			color: #fff;
			font-size: 11px;
			font-weight: 700;
			line-height: 1;
		}
		.panel {
			width: min(360px, calc(100vw - 32px));
			max-height: min(520px, calc(100vh - 32px));
			overflow: hidden;
			border: 1px solid #c3c4c7;
			border-radius: 12px;
			background: #fff;
			color: #1d2327;
			box-shadow: 0 12px 36px rgba(0,0,0,.22);
		}
		.header {
			display: flex;
			align-items: center;
			gap: 12px;
			min-height: 60px;
			padding: 8px 8px 8px 16px;
			border-bottom: 1px solid #dcdcde;
			background: #24272d;
			color: #fff;
		}
		.heading-group { flex: 1; min-width: 0; }
		.eyebrow {
			display: block;
			margin: 0 0 1px;
			color: #a7c7e7;
			font-size: 10px;
			font-weight: 700;
			letter-spacing: .1em;
			line-height: 1.3;
			text-transform: uppercase;
		}
		h2 {
			margin: 0;
			color: inherit;
			font-size: 15px;
			font-weight: 650;
			line-height: 1.3;
		}
		.close {
			display: grid;
			place-items: center;
			width: 44px;
			height: 44px;
			margin: 0;
			padding: 0;
			border: 0;
			border-radius: 8px;
			background: transparent;
			color: #fff;
			font-size: 26px;
			line-height: 1;
			cursor: pointer;
		}
		.close:hover { background: rgba(255,255,255,.1); }
		.empty {
			margin: 0;
			padding: 22px 18px;
			color: #646970;
			line-height: 1.5;
		}
		.list {
			max-height: min(420px, calc(100vh - 92px));
			margin: 0;
			padding: 0;
			overflow: auto;
			list-style: none;
		}
		.entry {
			display: grid;
			gap: 5px;
			margin: 0;
			padding: 12px 16px;
			border-top: 1px solid #dcdcde;
		}
		.entry:first-child { border-top: 0; }
		.meta {
			display: flex;
			align-items: center;
			gap: 7px;
			color: #646970;
			font-size: 11px;
			line-height: 1.4;
		}
		.attribution {
			padding: 1px 6px;
			border-radius: 8px;
			background: #f0f0f1;
			color: #3c434a;
		}
		.outcome {
			margin-left: auto;
			padding: 1px 7px;
			border-radius: 8px;
			background: #f0f0f1;
			color: #3c434a;
			font-weight: 700;
		}
		.outcome[data-webmcp-activity-outcome="running"] {
			background: #e7f5ff; color: #004f7c;
		}
		.outcome[data-webmcp-activity-outcome="ran"] {
			background: #edfaef; color: #00450c;
		}
		.outcome[data-webmcp-activity-outcome="failed"] {
			background: #fcf0f1; color: #8a1f11;
		}
		.outcome[data-webmcp-activity-outcome="declined"],
		.outcome[data-webmcp-activity-outcome="expired"] {
			background: #fcf9e8; color: #674e00;
		}
		.outcome[data-webmcp-activity-outcome="cancelled"],
		.outcome[data-webmcp-activity-outcome="stale"] {
			background: #f0f0f1; color: #50575e;
		}
		.label {
			overflow-wrap: anywhere;
			color: #1d2327;
			font-weight: 600;
			line-height: 1.4;
		}
		a {
			justify-self: start;
			color: #135e96;
			font-size: 12px;
			font-weight: 600;
			text-decoration: underline;
			text-underline-offset: 2px;
		}
		.visually-hidden {
			position: absolute !important;
			width: 1px !important;
			height: 1px !important;
			margin: -1px !important;
			padding: 0 !important;
			overflow: hidden !important;
			clip: rect(0 0 0 0) !important;
			clip-path: inset(50%) !important;
			border: 0 !important;
			white-space: nowrap !important;
		}
		@media (prefers-reduced-motion: reduce) {
			*, *::before, *::after {
				scroll-behavior: auto !important;
				transition-duration: .01ms !important;
			}
		}
	`;
}
