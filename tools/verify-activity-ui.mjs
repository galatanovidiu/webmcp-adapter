#!/usr/bin/env node
/**
 * Verify the Batch 6 activity and confirmation UI against a real WordPress 7.0
 * document through system Chrome's WebMCP implementation.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromPlaywrightSkill = createRequire(
	new URL(
		'../.agents/skills/webmcp-playwright/package.json',
		import.meta.url
	)
);
let chromium;
try {
	( { chromium } = requireFromPlaywrightSkill( 'playwright' ) );
} catch {
	console.error(
		'Playwright is not installed. Run: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix .agents/skills/webmcp-playwright'
	);
	process.exit( 2 );
}

const WP_URL = ( process.env.WP_URL || 'http://localhost:8888' ).replace(
	/\/$/,
	''
);
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'password';
const PROFILE_DIR = path.join(
	os.tmpdir(),
	'webmcp-activity-ui-' + Date.now()
);
const FLAGS = [
	'--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
];
let standardInputMode = null;
let pass = 0;
let fail = 0;
const failures = [];

function check( label, condition, detail = '' ) {
	if ( condition ) {
		pass++;
		console.log( '  PASS ' + label );
		return;
	}
	fail++;
	failures.push( label + ( detail ? ' — ' + detail : '' ) );
	console.log( '  FAIL ' + label + ( detail ? ' — ' + detail : '' ) );
}

async function waitForActivity( page ) {
	await page.waitForFunction(
		() =>
			Boolean( document.querySelector( '#webmcp-activity' )?.shadowRoot ),
		null,
		{ timeout: 8000 }
	);
}

async function logIn( page ) {
	await page.goto( WP_URL + '/wp-admin/', { waitUntil: 'domcontentloaded' } );
	if (
		! page.url().includes( 'wp-login.php' ) &&
		! ( await page.$( '#user_login' ) )
	) {
		return;
	}
	await page.fill( '#user_login', WP_USER );
	await page.fill( '#user_pass', WP_PASS );
	await Promise.all( [
		page.waitForNavigation( { waitUntil: 'domcontentloaded' } ),
		page.click( '#wp-submit' ),
	] );
}

async function detectStandardInputMode( page ) {
	if (
		standardInputMode ||
		! ( await page.evaluate(
			() => typeof document.modelContext?.executeTool === 'function'
		) )
	) {
		return;
	}
	standardInputMode = await page.evaluate( async () => {
		const tool = ( await document.modelContext.getTools() ).find(
			( item ) =>
				item.window === window &&
				item.name === 'webmcp.get-page-context'
		);
		try {
			await document.modelContext.executeTool( tool, {} );
			return 'object';
		} catch ( error ) {
			if (
				! /^UnknownError: Failed to parse input arguments\.?$/i.test(
					String( error )
				)
			) {
				throw error;
			}
			await document.modelContext.executeTool( tool, '{}' );
			return 'string';
		}
	} );
}

async function registerProbes( page ) {
	await page.evaluate( async () => {
		const abilities = await import( '@wordpress/abilities' );
		const register = ( name, label, risk, callback ) => {
			if ( abilities.getAbility( name ) ) {
				return;
			}
			abilities.registerAbility( {
				name,
				category: 'webmcp',
				label,
				description: 'Batch 6 ' + risk + ' test probe.',
				input_schema: {
					type: 'object',
					properties: {
						display: { type: 'string' },
						secret: { type: 'string' },
					},
					additionalProperties: false,
				},
				meta: {
					annotations: {
						readonly: false,
						destructive: false,
						idempotent: false,
					},
					webmcp: { risk, provider: 'Batch 6 probe' },
				},
				callback,
			} );
		};
		register(
			'webmcp-probe/activity-delay',
			'Activity <img src=x onerror="window.__activityInjected=true">',
			'reversible',
			async () => {
				await new Promise( ( resolve ) =>
					window.setTimeout( resolve, 350 )
				);
				return { delayed: true };
			}
		);
		register(
			'webmcp-probe/activity-failure',
			'Expected failure',
			'reversible',
			async () => {
				throw new Error( 'expected activity probe failure' );
			}
		);
		register(
			'webmcp-probe/consequential',
			'Consequential probe',
			'consequential',
			async () => {
				window.__consequentialRan =
					( window.__consequentialRan || 0 ) + 1;
				return { ran: true };
			}
		);
		register(
			'webmcp-probe/persistent',
			'Persistent probe',
			'persistent',
			async () => ( { ran: true } )
		);
		register(
			'webmcp-probe/privileged',
			'Privileged <img src=x onerror="window.__confirmInjected=true">',
			'privileged',
			async () => {
				window.__privilegedRan = ( window.__privilegedRan || 0 ) + 1;
				return { ran: true };
			}
		);
	} );
}

async function waitForTool( page, name ) {
	await page.waitForFunction(
		async ( toolName ) => {
			if ( typeof document.modelContext?.getTools === 'function' ) {
				return ( await document.modelContext.getTools() ).some(
					( tool ) => tool.window === window && tool.name === toolName
				);
			}
			const legacy =
				navigator.modelContextTesting || document.modelContextTesting;
			return legacy
				? ( await legacy.listTools() ).some(
						( tool ) => tool.name === toolName
				  )
				: false;
		},
		name,
		{ timeout: 8000 }
	);
}

async function startTool( page, name, args = {} ) {
	await page.evaluate(
		async ( [ toolName, input, inputMode ] ) => {
			let promise;
			if (
				typeof document.modelContext?.getTools === 'function' &&
				typeof document.modelContext?.executeTool === 'function'
			) {
				const tool = ( await document.modelContext.getTools() ).find(
					( item ) => item.window === window && item.name === toolName
				);
				promise = document.modelContext.executeTool(
					tool,
					inputMode === 'object' ? JSON.parse( input ) : input
				);
			} else {
				const legacy =
					navigator.modelContextTesting ||
					document.modelContextTesting;
				promise = legacy.executeTool( toolName, input );
			}
			window.__webmcpBatch6Result = promise.then(
				( value ) => ( { ok: true, value } ),
				( error ) => ( {
					ok: false,
					name: error.name,
					message: error.message,
				} )
			);
		},
		[ name, JSON.stringify( args ), standardInputMode ]
	);
}

async function finishTool( page ) {
	const outcome = await page.evaluate( () => window.__webmcpBatch6Result );
	if ( outcome.ok && typeof outcome.value === 'string' ) {
		outcome.value = JSON.parse( outcome.value );
	} else if ( outcome.ok && outcome.value?.content?.[ 0 ]?.text ) {
		outcome.value = JSON.parse( outcome.value.content[ 0 ].text );
	}
	return outcome;
}

async function snapshot( page ) {
	return page.evaluate( () => {
		const host = document.querySelector( '#webmcp-activity' );
		const root = host?.shadowRoot;
		const toggle = root?.querySelector( '[data-webmcp-activity-toggle]' );
		const panel = root?.querySelector( '[data-webmcp-activity-panel]' );
		const badge = root?.querySelector( '[data-webmcp-activity-count]' );
		const rect = toggle?.getBoundingClientRect();
		const hostStyle = host ? window.getComputedStyle( host ) : null;
		const toggleStyle = toggle ? window.getComputedStyle( toggle ) : null;
		const entries = [
			...( root?.querySelectorAll( '[data-webmcp-activity-entry]' ) ||
				[] ),
		].map( ( entry ) => ( {
			label: entry.querySelector( '[data-webmcp-activity-label]' )
				?.textContent,
			outcome: entry.querySelector( '[data-webmcp-activity-outcome]' )
				?.textContent,
		} ) );
		return {
			host: Boolean( host ),
			shadow: Boolean( root ),
			lightChildren: host?.childElementCount,
			expanded: toggle?.getAttribute( 'aria-expanded' ),
			toggleLabel: toggle?.getAttribute( 'aria-label' ),
			toggleHidden: toggle?.hidden,
			panelHidden: panel?.hidden,
			badgeHidden: badge?.hidden,
			badgeText: badge?.textContent,
			width: rect?.width,
			height: rect?.height,
			hostPosition: hostStyle?.position,
			hostDisplay: hostStyle?.display,
			toggleDisplay: toggleStyle?.display,
			entries,
			liveRole: root
				?.querySelector( '[data-webmcp-activity-live]' )
				?.getAttribute( 'role' ),
			liveMode: root
				?.querySelector( '[data-webmcp-activity-live]' )
				?.getAttribute( 'aria-live' ),
			hostileElements: root?.querySelectorAll(
				'img,script,iframe,object'
			).length,
			injected: Boolean( window.__activityInjected ),
		};
	} );
}

const browserContext = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = browserContext.pages()[ 0 ] || ( await browserContext.newPage() );

try {
	console.log( '\n== B6.1: frontend activity surface ==' );
	await page.goto( WP_URL + '/', { waitUntil: 'domcontentloaded' } );
	await page.evaluate( () => window.sessionStorage.clear() );
	await page.reload( { waitUntil: 'domcontentloaded' } );
	await waitForActivity( page );
	const initial = await snapshot( page );
	check(
		'activity uses an isolated shadow root',
		initial.host && initial.shadow && initial.lightChildren === 0,
		JSON.stringify( initial )
	);
	check(
		'fresh tabs show only the minimized icon',
		initial.expanded === 'false' &&
			initial.toggleHidden === false &&
			initial.panelHidden === true &&
			initial.badgeHidden === true,
		JSON.stringify( initial )
	);
	check(
		'activity icon has an accessible name and 48px target',
		/Open Site tools activity/.test( initial.toggleLabel || '' ) &&
			initial.width >= 48 &&
			initial.height >= 48,
		JSON.stringify( initial )
	);
	check(
		'activity announcements use a polite status region',
		initial.liveRole === 'status' && initial.liveMode === 'polite',
		JSON.stringify( initial )
	);
	await page.addStyleTag( {
		content:
			'#webmcp-activity{position:static!important;display:none!important;font-size:80px!important}' +
			'button,section,ol,li{all:unset!important;display:none!important}',
	} );
	const isolated = await snapshot( page );
	check(
		'theme and admin selectors cannot hide or restyle the activity surface',
		isolated.hostPosition === 'fixed' &&
			isolated.hostDisplay === 'block' &&
			isolated.toggleDisplay === 'grid' &&
			isolated.width === 48 &&
			isolated.height === 48,
		JSON.stringify( isolated )
	);
	const activityAria = await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-toggle]' )
		.ariaSnapshot();
	check(
		'activity icon is exposed as a named button in the accessibility tree',
		/button "Open Site tools activity"/.test( activityAria ),
		activityAria
	);
	await page.setViewportSize( { width: 320, height: 568 } );
	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-toggle]' )
		.click();
	const mobilePanel = await page.evaluate( () => {
		const panel = document
			.querySelector( '#webmcp-activity' )
			?.shadowRoot?.querySelector( '[data-webmcp-activity-panel]' );
		const rect = panel?.getBoundingClientRect();
		return {
			left: rect?.left,
			right: rect?.right,
			width: rect?.width,
			viewport: window.innerWidth,
		};
	} );
	check(
		'expanded activity panel fits a 320px viewport',
		mobilePanel.left >= 0 &&
			mobilePanel.right <= mobilePanel.viewport &&
			mobilePanel.width <= 288,
		JSON.stringify( mobilePanel )
	);
	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-close]' )
		.click();
	await page.setViewportSize( { width: 1280, height: 720 } );

	await detectStandardInputMode( page );
	// The harmless input-shape probe is itself activity. Open and close the panel
	// once so the delayed probe below starts from a cleared unseen count.
	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-toggle]' )
		.click();
	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-close]' )
		.click();
	await registerProbes( page );
	await waitForTool( page, 'webmcp-probe.activity-delay' );
	await startTool( page, 'webmcp-probe.activity-delay', {
		display: '<svg onload="window.__activityInjected=true">',
	} );
	await page.waitForFunction( () =>
		document
			.querySelector( '#webmcp-activity' )
			?.shadowRoot?.querySelector(
				'[data-webmcp-activity-outcome="running"]'
			)
	);
	const running = await snapshot( page );
	check(
		'running appears immediately and increments the unseen count',
		running.entries[ 0 ]?.outcome === 'Running' &&
			running.badgeHidden === false &&
			running.badgeText === '1',
		JSON.stringify( running )
	);

	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-toggle]' )
		.focus();
	await page.keyboard.press( 'Enter' );
	const expanded = await snapshot( page );
	check(
		'keyboard activation expands the panel and clears the badge',
		expanded.expanded === 'true' &&
			expanded.toggleHidden === true &&
			expanded.panelHidden === false &&
			expanded.badgeHidden === true,
		JSON.stringify( expanded )
	);
	const delayed = await finishTool( page );
	check( 'delayed activity probe completed', delayed.ok === true );
	const completed = await snapshot( page );
	check(
		'running entry updates in place to its final state',
		completed.entries[ 0 ].outcome === 'Ran',
		JSON.stringify( completed )
	);
	check(
		'untrusted activity text is rendered without markup',
		completed.hostileElements === 0 && completed.injected === false,
		JSON.stringify( completed )
	);

	await page.reload( { waitUntil: 'domcontentloaded' } );
	await waitForActivity( page );
	const persisted = await snapshot( page );
	check(
		'expanded state survives reload in sessionStorage',
		persisted.expanded === 'true' && persisted.panelHidden === false,
		JSON.stringify( persisted )
	);
	await page
		.locator( '#webmcp-activity' )
		.locator( '[data-webmcp-activity-close]' )
		.focus();
	await page.keyboard.press( 'Escape' );
	const escaped = await snapshot( page );
	const focusRestored = await page.evaluate( () =>
		document
			.querySelector( '#webmcp-activity' )
			?.shadowRoot?.activeElement?.hasAttribute(
				'data-webmcp-activity-toggle'
			)
	);
	check(
		'Escape minimizes the panel and restores icon focus',
		escaped.expanded === 'false' &&
			escaped.panelHidden === true &&
			focusRestored === true,
		JSON.stringify( escaped )
	);
	check(
		'minimized state is stored for this tab',
		( await page.evaluate( () =>
			window.sessionStorage.getItem( 'webmcpActivityExpanded' )
		) ) === 'false'
	);

	console.log( '\n== B6.2: outcomes and risk confirmation ==' );
	await registerProbes( page );
	await waitForTool( page, 'webmcp-probe.activity-failure' );
	await startTool( page, 'webmcp-probe.activity-failure' );
	const failedResult = await finishTool( page );
	const failedSnapshot = await snapshot( page );
	check(
		'failed invocation reaches a final state without being swallowed',
		failedResult.ok === false &&
			failedSnapshot.entries[ 0 ]?.outcome === 'Failed',
		JSON.stringify( { failedResult, failedSnapshot } )
	);
	await waitForTool( page, 'webmcp-probe.persistent' );
	await startTool( page, 'webmcp-probe.persistent' );
	const persistent = await finishTool( page );
	check(
		'persistent risk runs without the consequential confirmation layer',
		persistent.ok === true &&
			persistent.value?.ran === true &&
			( await page.locator( '[data-webmcp-confirm-host]' ).count() ) ===
				0,
		JSON.stringify( persistent )
	);

	await startTool( page, 'webmcp-probe.privileged', {
		display: '<img src=x onerror="window.__confirmInjected=true">',
		secret: 'never-display-this-secret',
	} );
	await page.waitForFunction( () =>
		Boolean(
			document
				.querySelector( '[data-webmcp-confirm-host]' )
				?.shadowRoot?.querySelector( '[data-webmcp-confirm-dialog]' )
		)
	);
	const confirmation = await page.evaluate( () => {
		const root = document.querySelector(
			'[data-webmcp-confirm-host]'
		)?.shadowRoot;
		const text = root?.textContent || '';
		return {
			risk: root?.querySelector( '[data-webmcp-confirm-risk]' )
				?.textContent,
			provider: root?.querySelector( '[data-webmcp-confirm-provider]' )
				?.textContent,
			action: root?.querySelector( '[data-webmcp-confirm-action]' )
				?.textContent,
			page: root?.querySelector( '[data-webmcp-confirm-page]' )
				?.textContent,
			summary: root?.querySelector( '[data-webmcp-confirm-summary]' )
				?.textContent,
			hostileElements: root?.querySelectorAll(
				'img,script,iframe,object'
			).length,
			secretVisible: text.includes( 'never-display-this-secret' ),
			injected: Boolean( window.__confirmInjected ),
		};
	} );
	check(
		'privileged risk confirms even when destructive is false',
		confirmation.risk === 'Privileged' &&
			confirmation.provider === 'Batch 6 probe' &&
			confirmation.action.includes( 'Privileged <img' ) &&
			confirmation.page.includes( new URL( page.url() ).pathname ),
		JSON.stringify( confirmation )
	);
	check(
		'confirmation redacts sensitive values and renders text safely',
		confirmation.summary.includes( '[redacted]' ) &&
			confirmation.secretVisible === false &&
			confirmation.hostileElements === 0 &&
			confirmation.injected === false,
		JSON.stringify( confirmation )
	);
	const defaultConfirmationFocus = await page.evaluate( () =>
		document
			.querySelector( '[data-webmcp-confirm-host]' )
			?.shadowRoot?.activeElement?.hasAttribute(
				'data-webmcp-confirm-cancel'
			)
	);
	await page.keyboard.press( 'Shift+Tab' );
	const wrappedConfirmationFocus = await page.evaluate( () =>
		document
			.querySelector( '[data-webmcp-confirm-host]' )
			?.shadowRoot?.activeElement?.hasAttribute(
				'data-webmcp-confirm-accept'
			)
	);
	check(
		'confirmation defaults to decline and traps reverse keyboard focus',
		defaultConfirmationFocus === true && wrappedConfirmationFocus === true
	);
	await page.evaluate( () =>
		document
			.querySelector( '[data-webmcp-confirm-host]' )
			?.shadowRoot?.querySelector( '[data-webmcp-confirm-accept]' )
			?.click()
	);
	await page.waitForTimeout( 100 );
	check(
		'synthetic click cannot approve privileged confirmation',
		( await page.locator( '[data-webmcp-confirm-host]' ).count() ) === 1 &&
			( await page.evaluate( () => window.__privilegedRan || 0 ) ) === 0
	);
	await page.keyboard.press( 'Escape' );
	const declined = await finishTool( page );
	check(
		'keyboard decline is structured and does not run the privileged callback',
		declined.ok === true &&
			declined.value?.cancelled === true &&
			( await page.evaluate( () => window.__privilegedRan || 0 ) ) === 0,
		JSON.stringify( declined )
	);

	await startTool( page, 'webmcp-probe.consequential', {
		display: 'publish',
	} );
	await page.waitForFunction( () =>
		Boolean( document.querySelector( '[data-webmcp-confirm-host]' ) )
	);
	await page
		.locator( '[data-webmcp-confirm-host]' )
		.locator( '[data-webmcp-confirm-accept]' )
		.click();
	const approved = await finishTool( page );
	check(
		'trusted click approves consequential confirmation',
		approved.ok === true &&
			approved.value?.ran === true &&
			( await page.evaluate( () => window.__consequentialRan || 0 ) ) ===
				1,
		JSON.stringify( approved )
	);

	const timing = await page.evaluate( async () => {
		const adapterScript = [ ...document.scripts ].find( ( script ) =>
			script.src.includes( '/webmcp-adapter/src/adapter.js' )
		);
		const moduleUrl = new URL( './confirmation.js', adapterScript.src );
		const { confirmRiskyAction } = await import( moduleUrl.href );
		const ability = {
			name: 'webmcp-probe/timing',
			category: 'webmcp',
			label: 'Timing probe',
			meta: { webmcp: { provider: 'Batch 6 probe' } },
		};
		const controller = new AbortController();
		const abortedPromise = confirmRiskyAction(
			ability,
			{},
			{
				risk: 'privileged',
				signal: controller.signal,
				timeoutMs: 1000,
			}
		).then(
			() => ( { resolved: true } ),
			( error ) => ( { resolved: false, name: error.name } )
		);
		controller.abort();
		const aborted = await abortedPromise;
		const afterAbort = document.querySelectorAll(
			'[data-webmcp-confirm-host]'
		).length;
		const expired = await confirmRiskyAction(
			ability,
			{},
			{
				risk: 'consequential',
				timeoutMs: 20,
			}
		);
		const afterExpiry = document.querySelectorAll(
			'[data-webmcp-confirm-host]'
		).length;
		return { aborted, afterAbort, expired, afterExpiry };
	} );
	check(
		'confirmation cancellation removes the dialog with AbortError',
		timing.aborted.resolved === false &&
			timing.aborted.name === 'AbortError' &&
			timing.afterAbort === 0,
		JSON.stringify( timing )
	);
	check(
		'confirmation expiry remains a distinct safe decline',
		timing.expired.approved === false &&
			timing.expired.reason === 'expired' &&
			timing.afterExpiry === 0,
		JSON.stringify( timing )
	);
	const outcomeCoverage = await page.evaluate( async () => {
		const adapterScript = [ ...document.scripts ].find( ( script ) =>
			script.src.includes( '/webmcp-adapter/src/adapter.js' )
		);
		const moduleUrl = new URL( './activity.js', adapterScript.src );
		const { createActivityPresenter } = await import( moduleUrl.href );
		const presenter = createActivityPresenter();
		for ( const outcome of [ 'expired', 'cancelled', 'stale' ] ) {
			presenter.appendHistory( {
				label: outcome + ' probe',
				outcome,
				screenUrl: null,
				isWrite: false,
				timeText: 'now',
			} );
		}
		return [
			...document
				.querySelector( '#webmcp-activity' )
				.shadowRoot.querySelectorAll(
					'[data-webmcp-activity-outcome]'
				),
		].map( ( element ) =>
			element.getAttribute( 'data-webmcp-activity-outcome' )
		);
	} );
	check(
		'all terminal activity outcomes have safe presentation states',
		[ 'ran', 'failed', 'declined', 'expired', 'cancelled', 'stale' ].every(
			( outcome ) => outcomeCoverage.includes( outcome )
		),
		JSON.stringify( outcomeCoverage )
	);

	console.log( '\n== B6.3: wp-admin and authentication screens ==' );
	await logIn( page );
	await waitForActivity( page );
	const admin = await snapshot( page );
	check(
		'wp-admin mounts the same isolated minimized activity surface',
		admin.host &&
			admin.shadow &&
			admin.expanded === 'false' &&
			admin.panelHidden === true,
		JSON.stringify( admin )
	);
	await page.goto( WP_URL + '/wp-login.php?action=lostpassword', {
		waitUntil: 'domcontentloaded',
	} );
	check(
		'authentication screens do not mount activity UI',
		( await page.locator( '#webmcp-activity' ).count() ) === 0
	);
} finally {
	await browserContext.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}

console.log( '\n==== ' + pass + ' passed, ' + fail + ' failed ====' );
if ( failures.length ) {
	console.log( 'Failures:' );
	for ( const failure of failures ) {
		console.log( '  - ' + failure );
	}
}
process.exit( fail ? 1 : 0 );
