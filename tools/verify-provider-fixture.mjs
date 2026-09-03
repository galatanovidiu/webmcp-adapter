#!/usr/bin/env node
/**
 * Verify the Batch 8 third-party provider contract with system Chrome.
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
		'Playwright is not installed in the webmcp-playwright skill.'
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
	`webmcp-provider-fixture-${ Date.now() }`
);
const FLAGS = [
	'--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport',
];

const READ_ABILITY = 'webmcp-provider-fixture/get-panel-state';
const WRITE_ABILITY = 'webmcp-provider-fixture/set-panel-tone';
const READ_TOOL = 'webmcp-provider-fixture.get-panel-state';
const WRITE_TOOL = 'webmcp-provider-fixture.set-panel-tone';
const ADMIN_BASE = [
	'webmcp.get-page-context',
	'webmcp.list-admin-destinations',
];
const PRIMARY_INVENTORY = [ ...ADMIN_BASE, READ_TOOL, WRITE_TOOL ].sort();
const SECONDARY_INVENTORY = [ ...ADMIN_BASE, WRITE_TOOL ].sort();
const DASHBOARD_INVENTORY = [ ...ADMIN_BASE ].sort();
const GENERAL_SETTINGS_INVENTORY = [
	...ADMIN_BASE,
	'wordpress.settings.stage-general-form',
].sort();
const FRONTEND_INVENTORY = [
	'webmcp.get-page-context',
	'webmcp.list-admin-destinations',
	'webmcp.list-site-destinations',
].sort();
const ANONYMOUS_INVENTORY = [
	'webmcp.get-page-context',
	'webmcp.list-site-destinations',
].sort();
const EDITOR_INVENTORY = [
	...ADMIN_BASE,
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
].sort();

let pass = 0;
let fail = 0;
let inputMode = null;
const failures = [];
const abilityCatalogRequests = [];
const pageErrors = [];

function check( label, condition, detail = '' ) {
	if ( condition ) {
		pass++;
		console.log( `  PASS ${ label }` );
		return;
	}
	fail++;
	failures.push( label + ( detail ? ` — ${ detail }` : '' ) );
	console.log( `  FAIL ${ label }${ detail ? ` — ${ detail }` : '' }` );
}

function sameNames( actual, expected ) {
	return JSON.stringify( actual ) === JSON.stringify( expected );
}

function normalizeTool( tool ) {
	let inputSchema = tool.inputSchema;
	if ( typeof inputSchema === 'string' ) {
		try {
			inputSchema = JSON.parse( inputSchema );
		} catch {}
	}
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema,
		annotations: tool.annotations,
	};
}

async function listTools( page ) {
	return page.evaluate( async () => {
		const normalize = ( tool ) => {
			let inputSchema = tool.inputSchema;
			if ( typeof inputSchema === 'string' ) {
				try {
					inputSchema = JSON.parse( inputSchema );
				} catch {}
			}
			return {
				name: tool.name,
				title: tool.title,
				description: tool.description,
				inputSchema,
				annotations: tool.annotations,
			};
		};
		if ( typeof document.modelContext?.getTools === 'function' ) {
			return ( await document.modelContext.getTools() )
				.filter( ( tool ) => tool.window === window )
				.map( normalize );
		}
		const legacy =
			navigator.modelContextTesting || document.modelContextTesting;
		return legacy ? ( await legacy.listTools() ).map( normalize ) : null;
	} );
}

async function waitForInventory( page, expected, timeoutMs = 30000 ) {
	const deadline = Date.now() + timeoutMs;
	let previous = '';
	let stableReads = 0;
	let tools = [];
	while ( Date.now() < deadline ) {
		tools = ( await listTools( page ) ) ?? [];
		const names = tools.map( ( tool ) => tool.name ).sort();
		const serialized = sameNames( names, expected )
			? JSON.stringify( names )
			: '';
		stableReads =
			serialized && serialized === previous ? stableReads + 1 : 0;
		previous = serialized;
		if ( stableReads >= 2 ) {
			return tools.map( normalizeTool );
		}
		await page.waitForTimeout( 250 );
	}
	return tools.map( normalizeTool );
}

async function openAndCheck( page, pathname, expected, label ) {
	const requested = new URL( pathname, `${ WP_URL }/` );
	await page.goto( requested.href, { waitUntil: 'domcontentloaded' } );
	const reached = new URL( page.url() );
	check(
		`${ label } navigation reaches the requested page`,
		reached.origin === requested.origin &&
			reached.pathname === requested.pathname,
		page.url()
	);
	const tools = await waitForInventory( page, expected );
	const names = tools.map( ( tool ) => tool.name ).sort();
	check(
		`${ label } has the exact ${ expected.length }-tool inventory`,
		sameNames( names, expected ),
		names.join( ', ' )
	);
	return tools;
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

async function detectInputMode( page ) {
	if ( inputMode ) {
		return;
	}
	inputMode = await page.evaluate( async () => {
		if ( typeof document.modelContext?.executeTool !== 'function' ) {
			return 'legacy';
		}
		const tool = ( await document.modelContext.getTools() ).find(
			( item ) =>
				item.window === window &&
				item.name === 'webmcp.get-page-context'
		);
		if ( ! tool ) {
			throw new Error(
				'The no-input page-context probe is not registered in this document.'
			);
		}
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

async function executeTool( page, name, args = {} ) {
	const raw = await page.evaluate(
		async ( [ toolName, input, mode ] ) => {
			if (
				typeof document.modelContext?.getTools === 'function' &&
				typeof document.modelContext?.executeTool === 'function'
			) {
				const tool = ( await document.modelContext.getTools() ).find(
					( item ) => item.window === window && item.name === toolName
				);
				if ( ! tool ) {
					throw new Error( `Unknown WebMCP tool: ${ toolName }` );
				}
				return document.modelContext.executeTool(
					tool,
					mode === 'object' ? input : JSON.stringify( input )
				);
			}
			const legacy =
				navigator.modelContextTesting || document.modelContextTesting;
			return legacy.executeTool( toolName, JSON.stringify( input ) );
		},
		[ name, args, inputMode ]
	);
	if ( typeof raw === 'string' ) {
		return JSON.parse( raw );
	}
	if ( raw?.content?.[ 0 ]?.text ) {
		return JSON.parse( raw.content[ 0 ].text );
	}
	return raw;
}

async function executeAndCaptureActivity( page, ability, tool, args = {} ) {
	const responsePromise = page.waitForResponse(
		( response ) => {
			if (
				response.request().method() !== 'POST' ||
				! response.url().includes( '/wp-json/webmcp/v1/activity' )
			) {
				return false;
			}
			try {
				return response.request().postDataJSON()?.ability === ability;
			} catch {
				return false;
			}
		},
		{ timeout: 8000 }
	);
	const result = await executeTool( page, tool, args );
	const response = await responsePromise;
	return {
		result,
		status: response.status(),
		payload: response.request().postDataJSON(),
	};
}

async function executeFailureAndCaptureActivity(
	page,
	ability,
	tool,
	args = {}
) {
	const responsePromise = page.waitForResponse(
		( response ) => {
			if (
				response.request().method() !== 'POST' ||
				! response.url().includes( '/wp-json/webmcp/v1/activity' )
			) {
				return false;
			}
			try {
				return response.request().postDataJSON()?.ability === ability;
			} catch {
				return false;
			}
		},
		{ timeout: 8000 }
	);
	let error = null;
	try {
		await executeTool( page, tool, args );
	} catch ( caught ) {
		error = String( caught );
	}
	const response = await responsePromise;
	return {
		error,
		status: response.status(),
		payload: response.request().postDataJSON(),
	};
}

async function abilityContracts( page ) {
	return page.evaluate(
		async ( names ) => {
			const { getAbility, getAbilityCategory } = await import(
				'@wordpress/abilities'
			);
			const pick = ( ability ) =>
				ability
					? {
							name: ability.name,
							category: ability.category,
							input_schema: ability.input_schema,
							output_schema: ability.output_schema,
							annotations: ability.meta?.annotations,
							risk: ability.meta?.webmcp?.risk ?? null,
							provider: ability.meta?.webmcp?.provider ?? null,
							hasPermissionCallback:
								typeof ability.permissionCallback ===
								'function',
					  }
					: null;
			return {
				category: getAbilityCategory( 'webmcp-provider-fixture' ),
				read: pick( getAbility( names.read ) ),
				write: pick( getAbility( names.write ) ),
			};
		},
		{ read: READ_ABILITY, write: WRITE_ABILITY }
	);
}

async function listRunActivity( page ) {
	return page.evaluate( async () => {
		const node = document.getElementById(
			'wp-script-module-data-webmcp-adapter/adapter'
		);
		const activity = JSON.parse( node?.textContent || '{}' ).activity || {};
		const runId = window.sessionStorage.getItem( 'webmcpRunId' );
		const url = new URL( activity.endpoint );
		url.searchParams.set( 'run_id', runId );
		url.searchParams.set( 'limit', '100' );
		const response = await fetch( url, {
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': activity.nonce,
				'X-WebMCP-Activity-Token': activity.token,
			},
		} );
		return { status: response.status, rows: await response.json(), runId };
	} );
}

const browserContext = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = browserContext.pages()[ 0 ] || ( await browserContext.newPage() );
page.on( 'request', ( request ) => {
	if ( request.url().includes( '/wp-abilities/v1/abilities' ) ) {
		abilityCatalogRequests.push( request.url() );
	}
} );
page.on( 'pageerror', ( error ) => pageErrors.push( String( error ) ) );

try {
	await logIn( page );

	console.log( '\n== B8.1: page ownership and contracts ==' );
	const primaryTools = await openAndCheck(
		page,
		'/wp-admin/admin.php?page=webmcp-provider-fixture-primary',
		PRIMARY_INVENTORY,
		'primary fixture page'
	);
	await detectInputMode( page );
	const contracts = await abilityContracts( page );
	check(
		'fixture category is independently client registered',
		contracts.category?.slug === 'webmcp-provider-fixture' &&
			contracts.category?.meta?.annotations?.clientRegistered === true,
		JSON.stringify( contracts.category )
	);
	check(
		'both fixture Abilities carry exact category, provenance, and annotations',
		contracts.read?.category === 'webmcp-provider-fixture' &&
			contracts.write?.category === 'webmcp-provider-fixture' &&
			contracts.read?.annotations?.clientRegistered === true &&
			contracts.write?.annotations?.clientRegistered === true &&
			[ 'readonly', 'destructive', 'idempotent' ].every(
				( key ) =>
					typeof contracts.read?.annotations?.[ key ] === 'boolean'
			) &&
			[ 'readonly', 'destructive', 'idempotent' ].every(
				( key ) =>
					typeof contracts.write?.annotations?.[ key ] === 'boolean'
			) &&
			contracts.read.risk === null &&
			contracts.write.risk === 'reversible' &&
			contracts.read.hasPermissionCallback &&
			contracts.write.hasPermissionCallback,
		JSON.stringify( contracts )
	);
	const readTool = primaryTools.find( ( tool ) => tool.name === READ_TOOL );
	const writeTool = primaryTools.find( ( tool ) => tool.name === WRITE_TOOL );
	const descriptorBytes = {
		read: Buffer.byteLength( JSON.stringify( readTool ) ),
		write: Buffer.byteLength( JSON.stringify( writeTool ) ),
	};
	console.log(
		`  INFO fixture descriptor bytes: read=${ descriptorBytes.read }, write=${ descriptorBytes.write }`
	);
	check(
		'projected read descriptor preserves title, schema, and safe hints',
		readTool?.title === 'Get Panel State' &&
			readTool?.inputSchema?.type === 'object' &&
			readTool?.annotations?.readOnlyHint === true &&
			readTool?.annotations?.untrustedContentHint === true,
		JSON.stringify( readTool )
	);
	check(
		'projected reversible descriptor preserves exact enum and write hint',
		writeTool?.title === 'Set Panel Tone' &&
			sameNames(
				[ ...writeTool.inputSchema.properties.tone.enum ].sort(),
				[ 'calm', 'focus' ]
			) &&
			writeTool?.annotations?.readOnlyHint === false &&
			writeTool?.annotations?.untrustedContentHint === true,
		JSON.stringify( writeTool )
	);

	console.log( '\n== B8.2: execution, reversal, and observability ==' );
	const read = await executeAndCaptureActivity(
		page,
		READ_ABILITY,
		READ_TOOL
	);
	check(
		'page-only read returns the exact live primary state',
		read.status === 201 &&
			JSON.stringify( read.result ) ===
				JSON.stringify( {
					page: 'primary',
					tone: 'calm',
				} ),
		JSON.stringify( read )
	);
	const invalid = await executeFailureAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'loud' }
	);
	check(
		'input schema rejects an unsupported tone before mutation',
		invalid.status === 201 &&
			Boolean( invalid.error ) &&
			invalid.payload?.outcome === 'failed' &&
			( await page
				.locator( '[data-webmcp-provider-panel]' )
				.getAttribute( 'data-webmcp-provider-tone' ) ) === 'calm',
		JSON.stringify( invalid )
	);
	const changed = await executeAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'focus' }
	);
	check(
		'reversible Ability changes only the visible primary panel state',
		changed.status === 201 &&
			changed.result?.applied === true &&
			changed.result?.changed === true &&
			changed.result?.page === 'primary' &&
			changed.result?.previousTone === 'calm' &&
			changed.result?.tone === 'focus' &&
			( await page
				.locator( '[data-webmcp-provider-panel]' )
				.getAttribute( 'data-webmcp-provider-tone' ) ) === 'focus' &&
			( await page
				.locator( '[data-webmcp-provider-tone-output]' )
				.textContent() ) === 'focus',
		JSON.stringify( changed )
	);
	check(
		'reversible Ability does not open consequential confirmation',
		( await page.locator( '[data-webmcp-confirm-accept]' ).count() ) === 0
	);
	await page.evaluate( () => {
		const panel = document.querySelector( '[data-webmcp-provider-panel]' );
		window.__webmcpFixtureNoopMutations = [];
		window.__webmcpFixtureNoopObserver = new MutationObserver(
			( records ) =>
				window.__webmcpFixtureNoopMutations.push( ...records )
		);
		window.__webmcpFixtureNoopObserver.observe( panel, {
			attributes: true,
			childList: true,
			characterData: true,
			subtree: true,
		} );
	} );
	const unchanged = await executeAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'focus' }
	);
	const noopMutationCount = await page.evaluate( async () => {
		await Promise.resolve();
		window.__webmcpFixtureNoopObserver.disconnect();
		const count = window.__webmcpFixtureNoopMutations.length;
		delete window.__webmcpFixtureNoopObserver;
		delete window.__webmcpFixtureNoopMutations;
		return count;
	} );
	check(
		'repeating the same tone is a live idempotent no-op with no DOM mutation',
		unchanged.status === 201 &&
			unchanged.result?.applied === true &&
			unchanged.result?.changed === false &&
			unchanged.result?.previousTone === 'focus' &&
			unchanged.result?.tone === 'focus' &&
			noopMutationCount === 0,
		JSON.stringify( unchanged )
	);
	const restored = await executeAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: changed.result.previousTone }
	);
	check(
		'calling with previousTone restores the exact original state',
		restored.status === 201 &&
			restored.result?.applied === true &&
			restored.result?.previousTone === 'focus' &&
			restored.result?.tone === 'calm' &&
			( await page
				.locator( '[data-webmcp-provider-panel]' )
				.getAttribute( 'data-webmcp-provider-tone' ) ) === 'calm',
		JSON.stringify( restored )
	);

	await page.evaluate( () => {
		const output = document.querySelector(
			'[data-webmcp-provider-tone-output]'
		);
		window.__webmcpDetachedFixtureOutput = {
			output,
			parent: output?.parentNode ?? null,
			next: output?.nextSibling ?? null,
		};
		output?.remove();
	} );
	const missingOutput = await executeAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'calm' }
	);
	await page.evaluate( () => {
		const detached = window.__webmcpDetachedFixtureOutput;
		detached?.parent?.insertBefore( detached.output, detached.next );
		delete window.__webmcpDetachedFixtureOutput;
	} );
	check(
		'missing visible output is a bounded refusal, never false no-op success',
		missingOutput.status === 201 &&
			missingOutput.result?.applied === false &&
			missingOutput.result?.changed === false &&
			missingOutput.result?.reason ===
				'The fixture panel output is not available in this document.' &&
			missingOutput.payload?.outcome === 'failed' &&
			( await page
				.locator( '[data-webmcp-provider-panel]' )
				.getAttribute( 'data-webmcp-provider-tone' ) ) === 'calm',
		JSON.stringify( missingOutput )
	);

	await page.evaluate( () => {
		const panel = document.querySelector( '[data-webmcp-provider-panel]' );
		window.__webmcpDetachedFixturePanel = {
			panel,
			parent: panel?.parentNode ?? null,
			next: panel?.nextSibling ?? null,
		};
		panel?.remove();
	} );
	const stalePermission = await page.evaluate( async ( name ) => {
		const { getAbility } = await import( '@wordpress/abilities' );
		return getAbility( name )?.permissionCallback?.( { tone: 'focus' } );
	}, WRITE_ABILITY );
	const stale = await executeFailureAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'focus' }
	);
	await page.evaluate( () => {
		const detached = window.__webmcpDetachedFixturePanel;
		detached?.parent?.insertBefore( detached.panel, detached.next );
		delete window.__webmcpDetachedFixturePanel;
	} );
	check(
		'live permission revalidation refuses a detached panel without mutation',
		stalePermission === false &&
			stale.status === 201 &&
			Boolean( stale.error ) &&
			stale.payload?.outcome === 'failed' &&
			( await page
				.locator( '[data-webmcp-provider-panel]' )
				.getAttribute( 'data-webmcp-provider-tone' ) ) === 'calm',
		JSON.stringify( stale )
	);

	console.log( '\n== B8.3: late add/remove lifecycle ==' );
	const staleHandleCaptured = await page.evaluate( async ( name ) => {
		if ( typeof document.modelContext?.getTools !== 'function' ) {
			return false;
		}
		window.__webmcpRemovedFixtureHandle = (
			await document.modelContext.getTools()
		).find( ( tool ) => tool.window === window && tool.name === name );
		return Boolean( window.__webmcpRemovedFixtureHandle );
	}, READ_TOOL );
	await page.click( '[data-webmcp-provider-remove-read]' );
	const afterRemoval = await waitForInventory( page, SECONDARY_INVENTORY );
	const removalState = await page.evaluate( async ( name ) => {
		const { getAbility } = await import( '@wordpress/abilities' );
		return {
			inStore: Boolean( getAbility( name ) ),
			status: document.querySelector(
				'[data-webmcp-provider-registration-status]'
			)?.textContent,
		};
	}, READ_ABILITY );
	check(
		'unregister removes the real Ability and aborts its WebMCP tool',
		! removalState.inStore &&
			removalState.status.trim() === 'Removed' &&
			! afterRemoval.some( ( tool ) => tool.name === READ_TOOL ),
		JSON.stringify( { removalState, afterRemoval } )
	);
	const staleHandleCall = await page.evaluate( async ( mode ) => {
		if (
			typeof document.modelContext?.executeTool !== 'function' ||
			! window.__webmcpRemovedFixtureHandle
		) {
			return { supported: false };
		}
		try {
			await document.modelContext.executeTool(
				window.__webmcpRemovedFixtureHandle,
				mode === 'string' ? '{}' : {}
			);
			return { supported: true, rejected: false };
		} catch ( error ) {
			return {
				supported: true,
				rejected: true,
				name: error.name,
				message: error.message,
			};
		} finally {
			delete window.__webmcpRemovedFixtureHandle;
		}
	}, inputMode );
	check(
		'a stale handle from an aborted registration rejects without executing',
		staleHandleCaptured &&
			staleHandleCall.supported === true &&
			staleHandleCall.rejected === true,
		JSON.stringify( staleHandleCall )
	);

	await page.click( '[data-webmcp-provider-restore-read]' );
	const afterRestore = await waitForInventory( page, PRIMARY_INVENTORY );
	const restoreState = await page.evaluate( async ( name ) => {
		const { getAbility } = await import( '@wordpress/abilities' );
		const ability = getAbility( name );
		return {
			clientRegistered:
				ability?.meta?.annotations?.clientRegistered === true,
			status: document.querySelector(
				'[data-webmcp-provider-registration-status]'
			)?.textContent,
		};
	}, READ_ABILITY );
	check(
		'late re-registration restores exactly one projected read tool',
		restoreState.clientRegistered &&
			restoreState.status.trim() === 'Registered' &&
			afterRestore.filter( ( tool ) => tool.name === READ_TOOL )
				.length === 1,
		JSON.stringify( { restoreState, afterRestore } )
	);

	console.log( '\n== B8.4: navigation inventories and shared module ==' );
	await openAndCheck(
		page,
		'/wp-admin/admin.php?page=webmcp-provider-fixture-secondary',
		SECONDARY_INVENTORY,
		'secondary fixture page'
	);
	const secondaryChanged = await executeAndCaptureActivity(
		page,
		WRITE_ABILITY,
		WRITE_TOOL,
		{ tone: 'focus' }
	);
	check(
		'the same shared Ability executes against the live secondary page',
		secondaryChanged.status === 201 &&
			secondaryChanged.result?.page === 'secondary' &&
			secondaryChanged.result?.previousTone === 'calm' &&
			secondaryChanged.result?.tone === 'focus',
		JSON.stringify( secondaryChanged )
	);
	await executeAndCaptureActivity( page, WRITE_ABILITY, WRITE_TOOL, {
		tone: 'calm',
	} );

	const activity = await listRunActivity( page );
	const providerRows = Array.isArray( activity.rows )
		? activity.rows.filter( ( row ) =>
				[ READ_ABILITY, WRITE_ABILITY ].includes( row.ability )
		  )
		: [];
	const storedRead = providerRows.find(
		( row ) => row.ability === READ_ABILITY
	);
	const storedWrites = providerRows.filter(
		( row ) => row.ability === WRITE_ABILITY
	);
	const successfulWrites = storedWrites.filter(
		( row ) => row.outcome === 'ran'
	);
	const failedWrites = storedWrites.filter(
		( row ) => row.outcome === 'failed'
	);
	check(
		'Batch 7 ingestion accepts the paired fixture read event',
		activity.status === 200 &&
			storedRead?.provider === 'WebMCP Provider Fixture' &&
			storedRead?.risk === 'read' &&
			storedRead?.tool_name === READ_TOOL &&
			storedRead?.outcome === 'ran' &&
			storedRead?.confirmation_outcome === 'not_required',
		JSON.stringify( storedRead )
	);
	check(
		'Batch 7 ingestion accepts bounded events from both shared-page contexts',
		successfulWrites.length >= 5 &&
			successfulWrites.every(
				( row ) =>
					row.provider === 'WebMCP Provider Fixture' &&
					row.risk === 'reversible' &&
					row.tool_name === WRITE_TOOL &&
					row.outcome === 'ran' &&
					row.confirmation_outcome === 'not_required'
			) &&
			[
				...new Set(
					successfulWrites.map( ( row ) => row.page_context )
				),
			].length === 2,
		JSON.stringify( successfulWrites )
	);
	check(
		'fixture validation and stale-context failures store only bounded error events',
		failedWrites.length >= 3 &&
			failedWrites.every(
				( row ) =>
					row.provider === 'WebMCP Provider Fixture' &&
					row.risk === 'reversible' &&
					[ 'ability_execution_failed', 'ability_refused' ].includes(
						row.error_code
					) &&
					row.safe_summary &&
					Object.keys( row.safe_summary ).length === 0
			) &&
			failedWrites.some(
				( row ) => row.error_code === 'ability_refused'
			) &&
			failedWrites.some(
				( row ) => row.error_code === 'ability_execution_failed'
			),
		JSON.stringify( failedWrites )
	);

	await openAndCheck( page, '/wp-admin/', DASHBOARD_INVENTORY, 'Dashboard' );
	await openAndCheck(
		page,
		'/wp-admin/options-general.php',
		GENERAL_SETTINGS_INVENTORY,
		'General Settings'
	);
	await openAndCheck(
		page,
		'/wp-admin/post.php?post=1&action=edit',
		EDITOR_INVENTORY,
		'post editor'
	);
	await openAndCheck(
		page,
		'/',
		FRONTEND_INVENTORY,
		'authenticated frontend'
	);
	await browserContext.clearCookies();
	await openAndCheck( page, '/', ANONYMOUS_INVENTORY, 'anonymous frontend' );
	await openAndCheck( page, '/wp-login.php', [], 'authentication screen' );

	await logIn( page );
	await openAndCheck(
		page,
		'/wp-admin/admin.php?page=webmcp-provider-fixture-primary',
		PRIMARY_INVENTORY,
		'primary fixture page after full navigation'
	);

	check(
		'provider never requests the server Ability catalog',
		abilityCatalogRequests.length === 0,
		abilityCatalogRequests.join( ', ' )
	);
	check(
		'provider flow causes no uncaught page error',
		pageErrors.length === 0,
		pageErrors.join( ' | ' )
	);

	console.log( `\n${ pass } passed, ${ fail } failed` );
	if ( fail > 0 ) {
		console.error( failures.join( '\n' ) );
		process.exitCode = 1;
	}
} finally {
	await browserContext.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}
