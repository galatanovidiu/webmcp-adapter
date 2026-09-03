#!/usr/bin/env node
/**
 * Characterize the current page inventories and assert the agreed page-scoped
 * contract with system Chrome.
 *
 * The current baseline must pass before runtime restructuring:
 *   node tools/verify-page-scoping.mjs --expect=current
 *
 * The agreed contract is intentionally red during Batch 0:
 *   node tools/verify-page-scoping.mjs --expect=agreed
 *
 * Batch 2's independently green transition state:
 *   node tools/verify-page-scoping.mjs --expect=batch2
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
const expectedMode = readExpectedMode();

const CURRENT_READ_NAMES = [
	'webmcp.editor-context',
	'webmcp.get-theme-design-tokens',
	'webmcp.list-block-types',
	'webmcp.list-patterns',
	'webmcp.list-templates',
	'webmcp.read-blocks',
].sort();
const CURRENT_WRITE_NAMES = [
	...CURRENT_READ_NAMES,
	'webmcp.edit-post-attributes',
	'webmcp.insert-blocks',
	'webmcp.insert-pattern',
	'webmcp.move-blocks',
	'webmcp.remove-blocks',
	'webmcp.replace-blocks',
	'webmcp.undo',
	'webmcp.update-block-attributes',
].sort();
const CURRENT_COMPLETE_NAMES = [
	...CURRENT_WRITE_NAMES,
	'webmcp.save-post',
].sort();

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

const AGREED_INVENTORIES = {
	dashboard: [ ...ADMIN_BASE_NAMES ].sort(),
	'general-settings': [
		...ADMIN_BASE_NAMES,
		'wordpress.settings.stage-general-form',
	].sort(),
	'post-editor': [ ...ADMIN_BASE_NAMES, ...EDITOR_NAMES ].sort(),
	'site-editor': [ ...ADMIN_BASE_NAMES, ...EDITOR_NAMES ].sort(),
	'authenticated-frontend': [
		...FRONTEND_BASE_NAMES,
		'webmcp.list-admin-destinations',
	].sort(),
	'anonymous-frontend': [ ...FRONTEND_BASE_NAMES ].sort(),
	'authentication-screen': [],
};

const BATCH_2_INVENTORIES = {
	dashboard: [ ...ADMIN_BASE_NAMES ].sort(),
	'general-settings': [ ...ADMIN_BASE_NAMES ].sort(),
	'post-editor': [
		...ADMIN_BASE_NAMES,
		...CURRENT_READ_NAMES,
		'webmcp.navigate',
	].sort(),
	'site-editor': [
		...ADMIN_BASE_NAMES,
		...CURRENT_READ_NAMES,
		'webmcp.navigate',
	].sort(),
	'authenticated-frontend': [
		...FRONTEND_BASE_NAMES,
		'webmcp.list-admin-destinations',
	].sort(),
	'anonymous-frontend': [ ...FRONTEND_BASE_NAMES ].sort(),
	'authentication-screen': [],
};

const BATCH_3_INVENTORIES = {
	...BATCH_2_INVENTORIES,
	'post-editor': [ ...ADMIN_BASE_NAMES, ...CURRENT_READ_NAMES ].sort(),
	'site-editor': [ ...ADMIN_BASE_NAMES, ...CURRENT_READ_NAMES ].sort(),
};

const BATCH_4_INVENTORIES = {
	...AGREED_INVENTORIES,
	'general-settings': [ ...ADMIN_BASE_NAMES ].sort(),
};

function readExpectedMode() {
	const option = process.argv.find( ( argument ) =>
		argument.startsWith( '--expect=' )
	);
	const mode = option?.slice( '--expect='.length ) || 'agreed';
	if (
		! [ 'current', 'batch2', 'batch3', 'batch4', 'agreed' ].includes( mode )
	) {
		console.error(
			'Usage: verify-page-scoping.mjs --expect=current|batch2|batch3|batch4|agreed'
		);
		process.exit( 1 );
	}
	return mode;
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

async function openAndInventory( page, pathname ) {
	const requestedUrl = new URL( pathname, `${ WP_URL }/` );
	await page.goto( requestedUrl.href, {
		waitUntil: 'domcontentloaded',
	} );
	const actualUrl = new URL( page.url() );
	if (
		actualUrl.origin !== requestedUrl.origin ||
		actualUrl.pathname !== requestedUrl.pathname
	) {
		throw new Error(
			`Expected ${ requestedUrl.href }, reached ${ actualUrl.href }.`
		);
	}
	return settledToolNames( page );
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

function verifyCurrentBaseline( inventories ) {
	const recognizedAdminInventory = [
		CURRENT_READ_NAMES,
		CURRENT_WRITE_NAMES,
		CURRENT_COMPLETE_NAMES,
	].find( ( expected ) => sameNames( inventories.dashboard, expected ) );

	let passed = true;
	if ( recognizedAdminInventory ) {
		console.log(
			`  PASS dashboard: recognized current ${ recognizedAdminInventory.length }-tool gated inventory`
		);
	} else {
		console.log(
			`  FAIL dashboard: unrecognized current inventory (${ inventories.dashboard.join(
				', '
			) })`
		);
		passed = false;
	}

	for ( const context of [
		'general-settings',
		'post-editor',
		'site-editor',
	] ) {
		passed =
			checkExact(
				`${ context } matches the global Dashboard inventory`,
				inventories[ context ],
				inventories.dashboard
			) && passed;
	}

	for ( const context of [
		'authenticated-frontend',
		'anonymous-frontend',
		'authentication-screen',
	] ) {
		passed =
			checkExact(
				`${ context } has no current adapter inventory`,
				inventories[ context ],
				[]
			) && passed;
	}

	return passed;
}

function verifyExactContract( inventories, expectedInventories ) {
	let passed = true;
	for ( const [ context, expected ] of Object.entries(
		expectedInventories
	) ) {
		passed =
			checkExact( context, inventories[ context ], expected ) && passed;
	}
	return passed;
}

const browserContext = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = browserContext.pages()[ 0 ] || ( await browserContext.newPage() );

let passed = false;
try {
	await logIn( page );

	const inventories = {
		dashboard: await openAndInventory( page, '/wp-admin/' ),
		'general-settings': await openAndInventory(
			page,
			'/wp-admin/options-general.php'
		),
		'post-editor': await openAndInventory(
			page,
			'/wp-admin/post.php?post=1&action=edit'
		),
		'site-editor': await openAndInventory(
			page,
			'/wp-admin/site-editor.php'
		),
		'authenticated-frontend': await openAndInventory( page, '/' ),
	};

	await browserContext.clearCookies();
	inventories[ 'anonymous-frontend' ] = await openAndInventory( page, '/' );
	inventories[ 'authentication-screen' ] = await openAndInventory(
		page,
		'/wp-login.php'
	);

	console.log( `\n== Page inventory: ${ expectedMode } contract ==` );
	passed =
		expectedMode === 'current'
			? verifyCurrentBaseline( inventories )
			: verifyExactContract(
					inventories,
					expectedMode === 'batch2'
						? BATCH_2_INVENTORIES
						: expectedMode === 'batch3'
						? BATCH_3_INVENTORIES
						: expectedMode === 'batch4'
						? BATCH_4_INVENTORIES
						: AGREED_INVENTORIES
			  );
} finally {
	await browserContext.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}

process.exit( passed ? 0 : 1 );
