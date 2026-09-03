#!/usr/bin/env node

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
const { chromium } = requireFromPlaywrightSkill( 'playwright' );

const WP_URL = ( process.env.WP_URL || 'http://localhost:8888' ).replace(
	/\/$/,
	''
);
const WP_USER = process.env.WP_USER || 'admin';
const WP_PASS = process.env.WP_PASS || 'password';
const PROFILE_DIR = path.join(
	os.tmpdir(),
	`webmcp-destinations-${ Date.now() }`
);
const FLAGS = [
	'--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
];

let pass = 0;
let fail = 0;
let inputMode = null;

function check( label, condition, detail = '' ) {
	if ( condition ) {
		pass++;
		console.log( `  PASS ${ label }` );
		return;
	}
	fail++;
	console.log( `  FAIL ${ label }${ detail ? ` — ${ detail }` : '' }` );
}

async function toolNames( page ) {
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
			: [];
	} );
}

async function waitForTool( page, name ) {
	for ( let attempt = 0; attempt < 30; attempt++ ) {
		const names = await toolNames( page );
		if ( names.includes( name ) ) {
			return names;
		}
		await page.waitForTimeout( 300 );
	}
	throw new Error( `Tool ${ name } did not register on ${ page.url() }.` );
}

async function detectInputMode( page ) {
	if (
		inputMode ||
		! ( await page.evaluate(
			() => typeof document.modelContext?.executeTool === 'function'
		) )
	) {
		return;
	}

	inputMode = await page.evaluate( async () => {
		const probe = ( await document.modelContext.getTools() ).find(
			( tool ) =>
				tool.window === window &&
				tool.name === 'webmcp.get-page-context'
		);
		try {
			await document.modelContext.executeTool( probe, {} );
			return 'object';
		} catch ( error ) {
			if (
				! /^UnknownError: Failed to parse input arguments\.?$/i.test(
					String( error )
				)
			) {
				throw error;
			}
			await document.modelContext.executeTool( probe, '{}' );
			return 'string';
		}
	} );
}

async function callTool( page, name ) {
	await waitForTool( page, name );
	await detectInputMode( page );
	const raw = await page.evaluate(
		async ( [ toolName, standardInputMode ] ) => {
			if (
				typeof document.modelContext?.getTools === 'function' &&
				typeof document.modelContext?.executeTool === 'function'
			) {
				const tool = ( await document.modelContext.getTools() ).find(
					( item ) => item.window === window && item.name === toolName
				);
				return document.modelContext.executeTool(
					tool,
					standardInputMode === 'object' ? {} : '{}'
				);
			}
			const legacy =
				navigator.modelContextTesting || document.modelContextTesting;
			return legacy.executeTool( toolName, '{}' );
		},
		[ name, inputMode ]
	);
	return typeof raw === 'string' ? JSON.parse( raw ) : raw;
}

function validDestinationShape( destination ) {
	return (
		destination &&
		typeof destination.id === 'string' &&
		typeof destination.label === 'string' &&
		typeof destination.section === 'string' &&
		typeof destination.url === 'string' &&
		destination.sameOrigin === true &&
		new URL( destination.url ).origin === new URL( WP_URL ).origin
	);
}

function containsUnsafeDestination( destinations ) {
	return destinations.some( ( destination ) => {
		const url = new URL( destination.url );
		return (
			url.searchParams.has( '_wpnonce' ) ||
			[ 'logout', 'delete', 'trash', 'activate' ].includes(
				url.searchParams.get( 'action' )
			) ||
			/wp-(?:login|signup|register)\.php$/.test( url.pathname )
		);
	} );
}

async function addSiteFixtures( page ) {
	await page.evaluate( () => {
		const nav = document.createElement( 'nav' );
		nav.setAttribute( 'aria-label', 'Fixture Navigation' );
		nav.style.cssText =
			'position:fixed;left:10px;top:10px;display:block;z-index:1';
		for ( const [ href, label, style = '' ] of [
			[ '/?fixture=site-destination', 'Fixture Site Destination' ],
			[ '/?fixture=site-destination', 'Duplicate Fixture Destination' ],
			[ '#', 'Placeholder' ],
			[ 'https://example.invalid/', 'External Fixture' ],
			[ '/wp-login.php', 'Login Fixture' ],
			[ '/?fixture=hidden', 'Hidden Fixture', 'display:none' ],
		] ) {
			const anchor = document.createElement( 'a' );
			anchor.href = href;
			anchor.textContent = label;
			anchor.style.cssText = style;
			nav.append( anchor );
		}
		document.body.append( nav );

		const article = document.createElement( 'article' );
		const contentLink = document.createElement( 'a' );
		contentLink.href = '/?fixture=content-link';
		contentLink.textContent = 'Arbitrary Content Fixture';
		article.append( contentLink );
		document.body.append( article );
	} );
}

async function logIn( page ) {
	await page.goto( `${ WP_URL }/wp-admin/`, {
		waitUntil: 'domcontentloaded',
	} );
	if ( ! page.url().includes( 'wp-login.php' ) ) {
		return;
	}
	await page.fill( '#user_login', WP_USER );
	await page.fill( '#user_pass', WP_PASS );
	await Promise.all( [
		page.waitForNavigation( { waitUntil: 'domcontentloaded' } ),
		page.click( '#wp-submit' ),
	] );
}

const context = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = context.pages()[ 0 ] || ( await context.newPage() );
const abilityRequests = [];
page.on( 'request', ( request ) => {
	if ( request.url().includes( '/wp-abilities/v1/abilities' ) ) {
		abilityRequests.push( request.url() );
	}
} );

try {
	await logIn( page );
	const dashboardNames = await waitForTool(
		page,
		'webmcp.list-admin-destinations'
	);
	check(
		'navigation-execution tool is absent',
		! dashboardNames.includes( 'webmcp.navigate' )
	);
	const adminResult = await callTool(
		page,
		'webmcp.list-admin-destinations'
	);
	check(
		'wp-admin menu returns rendered destinations',
		adminResult.destinations.length > 5,
		JSON.stringify( adminResult ).slice( 0, 300 )
	);
	check(
		'admin destinations use the stable result shape',
		adminResult.destinations.every( validDestinationShape )
	);
	check(
		'admin destinations exclude unsafe action and authentication URLs',
		! containsUnsafeDestination( adminResult.destinations )
	);
	check(
		'admin destinations include rendered Settings navigation',
		adminResult.destinations.some(
			( destination ) =>
				destination.label === 'Settings' ||
				destination.section === 'Settings'
		)
	);
	await page.evaluate( () => {
		const menu = document.querySelector( '#adminmenu' );
		const item = document.createElement( 'li' );
		item.id = 'menu-fixture-provider';
		item.className = 'menu-top';
		item.innerHTML =
			'<a href="admin.php?page=fixture-provider"><span class="wp-menu-name">Fixture Provider</span></a>' +
			'<a href="admin.php?page=fixture-action&amp;action=delete&amp;_wpnonce=secret">Unsafe Fixture Action</a>';
		menu.append( item );
	} );
	const extendedAdminResult = await callTool(
		page,
		'webmcp.list-admin-destinations'
	);
	check(
		'provider-rendered admin navigation appears automatically',
		extendedAdminResult.destinations.filter(
			( destination ) => destination.label === 'Fixture Provider'
		).length === 1
	);
	check(
		'provider-rendered admin action URLs remain excluded',
		! extendedAdminResult.destinations.some(
			( destination ) => destination.label === 'Unsafe Fixture Action'
		)
	);

	const navigationDestination =
		adminResult.destinations.find( ( destination ) =>
			[ '/wp-admin/', '/wp-admin/index.php' ].includes(
				new URL( destination.url ).pathname
			)
		) ?? adminResult.destinations[ 0 ];
	const navigationUrl = new URL( navigationDestination.url );
	await page.goto( navigationUrl.href, {
		waitUntil: 'domcontentloaded',
	} );
	check(
		'ordinary browser navigation opens a returned destination',
		new URL( page.url() ).pathname === navigationUrl.pathname
	);

	await page.goto( `${ WP_URL }/`, { waitUntil: 'domcontentloaded' } );
	await addSiteFixtures( page );
	const siteResult = await callTool( page, 'webmcp.list-site-destinations' );
	const fixtureDestinations = siteResult.destinations.filter(
		( destination ) =>
			destination.url.includes( 'fixture=site-destination' )
	);
	check(
		'visible semantic site destination is returned once',
		fixtureDestinations.length === 1,
		JSON.stringify( siteResult.destinations )
	);
	check(
		'site destinations exclude hidden, external, auth, placeholder, and content links',
		! siteResult.destinations.some(
			( destination ) =>
				/fixture=(?:hidden|content-link)/.test( destination.url ) ||
				/login|external|placeholder/i.test( destination.label )
		)
	);

	const toolbarResult = await callTool(
		page,
		'webmcp.list-admin-destinations'
	);
	check(
		'authenticated frontend reads admin-toolbar destinations',
		toolbarResult.destinations.length > 0 &&
			toolbarResult.destinations.every( validDestinationShape )
	);

	await context.clearCookies();
	await page.goto( `${ WP_URL }/`, { waitUntil: 'domcontentloaded' } );
	const anonymousNames = await waitForTool(
		page,
		'webmcp.list-site-destinations'
	);
	check(
		'anonymous frontend does not expose admin destinations',
		! anonymousNames.includes( 'webmcp.list-admin-destinations' )
	);
	check(
		'no server Ability catalog request was made',
		abilityRequests.length === 0,
		abilityRequests.join( ', ' )
	);
} finally {
	await context.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}

console.log( `\n==== ${ pass } passed, ${ fail } failed ====` );
process.exit( fail ? 1 : 0 );
