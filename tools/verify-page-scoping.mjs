#!/usr/bin/env node
/**
 * Verify the final page-scoped inventory and authentication-screen exclusion
 * contract with current system Chrome.
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
	`webmcp-page-scoping-${ Date.now() }`
);
const FLAGS = [
	'--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
];

const ADMIN_BASE_NAMES = [
	'webmcp.get-page-context',
	'webmcp.list-admin-destinations',
];
const FRONTEND_BASE_NAMES = [
	'webmcp.get-page-context',
	'webmcp.list-site-destinations',
];
const EDITOR_NAMES = [
	'webmcp.edit-post-attributes',
	'webmcp.editor-context',
	'webmcp.get-theme-design-tokens',
	'webmcp.insert-blocks',
	'webmcp.insert-pattern',
	'webmcp.list-block-types',
	'webmcp.list-patterns',
	'webmcp.list-templates',
	'webmcp.move-blocks',
	'webmcp.read-blocks',
	'webmcp.remove-blocks',
	'webmcp.replace-blocks',
	'webmcp.save-post',
	'webmcp.undo',
	'webmcp.update-block-attributes',
];
const EDITOR_INVENTORY = [ ...ADMIN_BASE_NAMES, ...EDITOR_NAMES ].sort();
const AUTHENTICATED_FRONTEND_INVENTORY = [
	...FRONTEND_BASE_NAMES,
	'webmcp.list-admin-destinations',
].sort();
const ANONYMOUS_FRONTEND_INVENTORY = [ ...FRONTEND_BASE_NAMES ].sort();

const EXPECTED_INVENTORIES = {
	dashboard: [ ...ADMIN_BASE_NAMES ].sort(),
	'general-settings': [
		...ADMIN_BASE_NAMES,
		'wordpress.settings.stage-general-form',
	].sort(),
	'post-editor': EDITOR_INVENTORY,
	'page-editor': EDITOR_INVENTORY,
	'compatible-cpt-editor': EDITOR_INVENTORY,
	'site-editor': EDITOR_INVENTORY,
	'primary-fixture': [
		...ADMIN_BASE_NAMES,
		'webmcp-provider-fixture.get-panel-state',
		'webmcp-provider-fixture.set-panel-tone',
	].sort(),
	'secondary-fixture': [
		...ADMIN_BASE_NAMES,
		'webmcp-provider-fixture.set-panel-tone',
	].sort(),
	'authenticated-home': AUTHENTICATED_FRONTEND_INVENTORY,
	'authenticated-singular': AUTHENTICATED_FRONTEND_INVENTORY,
	'anonymous-home': ANONYMOUS_FRONTEND_INVENTORY,
	'anonymous-singular': ANONYMOUS_FRONTEND_INVENTORY,
	login: [],
	'lost-password': [],
	registration: [],
};

function sameNames( actual, expected ) {
	return JSON.stringify( actual ) === JSON.stringify( expected );
}

function difference( left, right ) {
	return left.filter( ( name ) => ! right.includes( name ) );
}

function checkExact( label, actual, expected ) {
	if ( sameNames( actual, expected ) ) {
		console.log( `  PASS ${ label }: ${ actual.length } exact tools` );
		return true;
	}

	console.log(
		`  FAIL ${ label }: expected ${ expected.length }, received ${ actual.length }`
	);
	const missing = difference( expected, actual );
	const unexpected = difference( actual, expected );
	if ( missing.length ) {
		console.log( `       missing: ${ missing.join( ', ' ) }` );
	}
	if ( unexpected.length ) {
		console.log( `       unexpected: ${ unexpected.join( ', ' ) }` );
	}
	return false;
}

function check( label, condition, detail = '' ) {
	console.log(
		`  ${ condition ? 'PASS' : 'FAIL' } ${ label }${
			detail ? `: ${ detail }` : ''
		}`
	);
	return condition;
}

async function listTools( page ) {
	return page.evaluate( async () => {
		if ( typeof document.modelContext?.getTools === 'function' ) {
			return ( await document.modelContext.getTools() )
				.filter( ( tool ) => tool.window === window )
				.map( ( tool ) => tool.name )
				.sort();
		}

		const legacy =
			navigator.modelContextTesting || document.modelContextTesting;
		return legacy
			? ( await legacy.listTools() ).map( ( tool ) => tool.name ).sort()
			: null;
	} );
}

async function settledToolNames( page ) {
	let previous = null;
	let stableReads = 0;

	for ( let attempt = 0; attempt < 24; attempt++ ) {
		await page.waitForTimeout( 500 );
		const names = await listTools( page );
		if ( names === null ) {
			throw new Error( `WebMCP is unavailable on ${ page.url() }.` );
		}

		const serialized = JSON.stringify( names );
		stableReads = serialized === previous ? stableReads + 1 : 0;
		previous = serialized;
		if ( stableReads >= 5 ) {
			return names;
		}
	}

	return JSON.parse( previous );
}

async function inspectAdapterSurface( page ) {
	return page.evaluate( () => {
		const host = document.querySelector( '#webmcp-activity' );
		const root = host?.shadowRoot;
		const toggle = root?.querySelector( '[data-webmcp-activity-toggle]' );
		const panel = root?.querySelector( '[data-webmcp-activity-panel]' );
		const adapterAssets = [ ...document.scripts ].filter(
			( script ) =>
				script.src.includes( '/webmcp-adapter/' ) ||
				script.textContent.includes( '/webmcp-adapter/' )
		).length;

		return {
			activityHosts:
				document.querySelectorAll( '#webmcp-activity' ).length,
			minimizedAccessible:
				toggle instanceof HTMLButtonElement &&
				toggle.hidden === false &&
				toggle.getAttribute( 'aria-expanded' ) === 'false' &&
				Boolean( toggle.getAttribute( 'aria-label' ) ) &&
				panel instanceof HTMLElement &&
				panel.hidden === true,
			adapterAssets,
		};
	} );
}

async function openAndInspect( page, requested ) {
	const requestedUrl = new URL( requested, `${ WP_URL }/` );
	await page.goto( requestedUrl.href, { waitUntil: 'domcontentloaded' } );
	const actualUrl = new URL( page.url() );
	if (
		actualUrl.origin !== requestedUrl.origin ||
		actualUrl.pathname !== requestedUrl.pathname
	) {
		throw new Error(
			`Expected ${ requestedUrl.href }, reached ${ actualUrl.href }.`
		);
	}

	return {
		tools: await settledToolNames( page ),
		surface: await inspectAdapterSurface( page ),
	};
}

async function logIn( page ) {
	await page.goto( `${ WP_URL }/wp-admin/`, {
		waitUntil: 'domcontentloaded',
	} );
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

async function verifySiteEditorShellRoute( page ) {
	const marker = `batch-9-${ Date.now() }`;
	await page.evaluate( ( value ) => {
		window.__webmcpBatch9ShellMarker = value;
	}, marker );
	await page.waitForTimeout( 1500 );

	const routeButton = page.getByRole( 'button', {
		name: 'Pages',
		exact: true,
	} );
	if (
		( await routeButton.count() ) !== 1 ||
		! ( await routeButton.isVisible() )
	) {
		return {
			passed: false,
			detail: 'the Pages in-shell route button was unavailable',
		};
	}

	await routeButton.click();
	await page.waitForTimeout( 2000 );
	const names = await settledToolNames( page );
	const shellSurvived = await page.evaluate(
		( value ) => window.__webmcpBatch9ShellMarker === value,
		marker
	);

	return {
		passed:
			shellSurvived &&
			new URL( page.url() ).searchParams.get( 'p' ) === '/page' &&
			sameNames( names, EDITOR_INVENTORY ),
		detail: JSON.stringify( {
			shellSurvived,
			url: page.url(),
			toolCount: names.length,
		} ),
	};
}

const browserContext = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = browserContext.pages()[ 0 ] || ( await browserContext.newPage() );

let passed = true;
try {
	await logIn( page );

	const scenarios = {
		dashboard: await openAndInspect( page, '/wp-admin/' ),
		'general-settings': await openAndInspect(
			page,
			'/wp-admin/options-general.php'
		),
		'post-editor': await openAndInspect(
			page,
			'/wp-admin/post.php?post=1&action=edit'
		),
		'page-editor': await openAndInspect(
			page,
			'/wp-admin/post-new.php?post_type=page'
		),
		'compatible-cpt-editor': await openAndInspect(
			page,
			'/wp-admin/post-new.php?post_type=webmcp_note'
		),
		'site-editor': await openAndInspect(
			page,
			'/wp-admin/site-editor.php'
		),
	};
	const shellRoute = await verifySiteEditorShellRoute( page );

	scenarios[ 'primary-fixture' ] = await openAndInspect(
		page,
		'/wp-admin/admin.php?page=webmcp-provider-fixture-primary'
	);
	scenarios[ 'secondary-fixture' ] = await openAndInspect(
		page,
		'/wp-admin/admin.php?page=webmcp-provider-fixture-secondary'
	);
	scenarios[ 'authenticated-home' ] = await openAndInspect( page, '/' );
	scenarios[ 'authenticated-singular' ] = await openAndInspect(
		page,
		'/sample-page/'
	);

	await browserContext.clearCookies();
	scenarios[ 'anonymous-home' ] = await openAndInspect( page, '/' );
	scenarios[ 'anonymous-singular' ] = await openAndInspect(
		page,
		'/sample-page/'
	);
	scenarios.login = await openAndInspect( page, '/wp-login.php' );
	scenarios[ 'lost-password' ] = await openAndInspect(
		page,
		'/wp-login.php?action=lostpassword'
	);
	scenarios.registration = await openAndInspect(
		page,
		'/wp-login.php?action=register'
	);

	console.log( '\n== Final page-scoped inventory ==' );
	for ( const [ label, expected ] of Object.entries(
		EXPECTED_INVENTORIES
	) ) {
		passed =
			checkExact( label, scenarios[ label ].tools, expected ) && passed;
	}

	console.log( '\n== Eligible-page activity presentation ==' );
	for ( const label of Object.keys( EXPECTED_INVENTORIES ).filter(
		( name ) => EXPECTED_INVENTORIES[ name ].length > 0
	) ) {
		const surface = scenarios[ label ].surface;
		passed =
			check(
				`${ label } starts with one minimized accessible activity control`,
				surface.activityHosts === 1 && surface.minimizedAccessible,
				JSON.stringify( surface )
			) && passed;
	}

	console.log( '\n== Authentication-screen exclusion ==' );
	for ( const label of [ 'login', 'lost-password', 'registration' ] ) {
		const surface = scenarios[ label ].surface;
		passed =
			check(
				`${ label } loads no activity UI or adapter assets`,
				surface.activityHosts === 0 && surface.adapterAssets === 0,
				JSON.stringify( surface )
			) && passed;
	}

	console.log( '\n== Site Editor shell lifecycle ==' );
	passed =
		check(
			'in-shell route keeps the top-level document and exact editor inventory',
			shellRoute.passed,
			shellRoute.detail
		) && passed;
} finally {
	await browserContext.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}

process.exit( passed ? 0 : 1 );
