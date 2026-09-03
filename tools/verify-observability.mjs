#!/usr/bin/env node
/**
 * Verify Batch 7 observability against WordPress 7.0.4 and system Chrome.
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
	'webmcp-observability-' + Date.now()
);
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

async function config( page ) {
	return page.evaluate( () => {
		const node = document.getElementById(
			'wp-script-module-data-webmcp-adapter/adapter'
		);
		return JSON.parse( node?.textContent || '{}' ).activity || {};
	} );
}

async function waitForTool( page, name ) {
	await page.waitForFunction(
		async ( toolName ) =>
			( await document.modelContext.getTools() ).some(
				( tool ) => tool.window === window && tool.name === toolName
			),
		name,
		{ timeout: 8000 }
	);
}

async function execute( page, name, args = {} ) {
	return page.evaluate(
		async ( [ toolName, input, mode ] ) => {
			const tool = ( await document.modelContext.getTools() ).find(
				( item ) => item.window === window && item.name === toolName
			);
			try {
				const result = await document.modelContext.executeTool(
					tool,
					mode === 'string' ? JSON.stringify( input ) : input
				);
				return { ok: true, result };
			} catch ( error ) {
				return { ok: false, name: error.name, message: error.message };
			}
		},
		[ name, args, standardInputMode ]
	);
}

async function detectInputModeAndCapture( page ) {
	const responsePromise = page.waitForResponse(
		( response ) =>
			response.request().method() === 'POST' &&
			response.url().includes( '/wp-json/webmcp/v1/activity' ),
		{ timeout: 8000 }
	);
	let outcome = await execute( page, 'webmcp.get-page-context', {} );
	if (
		! outcome.ok &&
		/^Failed to parse input arguments\.?$/i.test( outcome.message || '' )
	) {
		standardInputMode = 'string';
		outcome = await execute( page, 'webmcp.get-page-context', {} );
	} else {
		standardInputMode = 'object';
	}
	const response = await responsePromise;
	return {
		outcome,
		response,
		payload: response.request().postDataJSON(),
	};
}

async function directPost( page, event, overrides = {} ) {
	return page.evaluate(
		async ( [ payload, requestOverrides ] ) => {
			const node = document.getElementById(
				'wp-script-module-data-webmcp-adapter/adapter'
			);
			const activity =
				JSON.parse( node?.textContent || '{}' ).activity || {};
			const headers = {
				'Content-Type': 'application/json',
				'X-WebMCP-Activity-Token': activity.token,
				...( activity.nonce ? { 'X-WP-Nonce': activity.nonce } : {} ),
				...( requestOverrides.headers || {} ),
			};
			for ( const removed of requestOverrides.removeHeaders || [] ) {
				delete headers[ removed ];
			}
			const response = await fetch( activity.endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				headers,
				body: requestOverrides.body || JSON.stringify( payload ),
			} );
			let body = null;
			try {
				body = await response.json();
			} catch {}
			return { status: response.status, body };
		},
		[ event, overrides ]
	);
}

function event( overrides = {} ) {
	return {
		event_id: crypto.randomUUID(),
		run_id: crypto.randomUUID(),
		ability: 'webmcp/get-page-context',
		outcome: 'ran',
		duration_ms: 1,
		confirmation: 'not_required',
		error_code: null,
		...overrides,
	};
}

async function adminGet( page, query = '' ) {
	return page.evaluate( async ( suffix ) => {
		const node = document.getElementById(
			'wp-script-module-data-webmcp-adapter/adapter'
		);
		const activity = JSON.parse( node?.textContent || '{}' ).activity || {};
		const response = await fetch( activity.endpoint + suffix, {
			credentials: 'same-origin',
			headers: {
				'X-WP-Nonce': activity.nonce,
				'X-WebMCP-Activity-Token': activity.token,
			},
		} );
		return { status: response.status, body: await response.json() };
	}, query );
}

const context = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: [ '--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport' ],
} );
const page = context.pages()[ 0 ] || ( await context.newPage() );

try {
	console.log( '\n== B7.1: anonymous ingestion ==' );
	await page.goto( WP_URL + '/', { waitUntil: 'domcontentloaded' } );
	await page.evaluate( () => window.sessionStorage.clear() );
	await page.reload( { waitUntil: 'domcontentloaded' } );
	await waitForTool( page, 'webmcp.get-page-context' );
	const anonymousConfig = await config( page );
	check(
		'anonymous pages receive a signed token without a REST nonce',
		typeof anonymousConfig.token === 'string' &&
			anonymousConfig.token.length > 40 &&
			anonymousConfig.nonce === null &&
			anonymousConfig.authenticated === false,
		JSON.stringify( anonymousConfig )
	);
	const anonymousCall = await detectInputModeAndCapture( page );
	const anonymousEventId = anonymousCall.payload.event_id;
	const anonymousRunId = anonymousCall.payload.run_id;
	check(
		'anonymous WebMCP execution succeeds',
		anonymousCall.outcome.ok === true
	);
	check(
		'anonymous final event is accepted',
		anonymousCall.response.status() === 201
	);
	check(
		'transport contains only bounded final-event fields',
		Object.keys( anonymousCall.payload ).every( ( key ) =>
			[
				'event_id',
				'run_id',
				'ability',
				'outcome',
				'duration_ms',
				'confirmation',
				'error_code',
				'safe_summary',
			].includes( key )
		) &&
			! ( 'params' in anonymousCall.payload ) &&
			! ( 'result' in anonymousCall.payload ) &&
			anonymousCall.payload.outcome === 'ran',
		JSON.stringify( anonymousCall.payload )
	);

	const noToken = await directPost( page, event(), {
		removeHeaders: [ 'X-WebMCP-Activity-Token' ],
	} );
	check(
		'anonymous ingestion rejects a missing token',
		noToken.status === 403,
		JSON.stringify( noToken )
	);
	const unknownField = await directPost( page, event( { risk: 'read' } ) );
	check(
		'server rejects client-owned risk fields',
		unknownField.status === 400,
		JSON.stringify( unknownField )
	);
	const oversized = await directPost( page, event(), {
		body: JSON.stringify( event( { padding: 'x'.repeat( 4096 ) } ) ),
	} );
	check(
		'server rejects payloads over 4 KB',
		oversized.status === 413,
		JSON.stringify( oversized )
	);

	let rateLimited = null;
	for ( let index = 0; index < 65; index++ ) {
		const response = await directPost( page, event() );
		if ( response.status === 429 ) {
			rateLimited = { index, response };
			break;
		}
	}
	check(
		'anonymous fixed-window rate limit returns 429',
		rateLimited !== null,
		JSON.stringify( rateLimited )
	);

	console.log( '\n== B7.2: authenticated ingestion and review ==' );
	await logIn( page );
	await page.goto( WP_URL + '/wp-admin/', { waitUntil: 'domcontentloaded' } );
	await page.evaluate( () => window.sessionStorage.clear() );
	await page.reload( { waitUntil: 'domcontentloaded' } );
	await waitForTool( page, 'webmcp.get-page-context' );
	const authenticatedConfig = await config( page );
	check(
		'authenticated pages receive both REST nonce and signed context token',
		typeof authenticatedConfig.nonce === 'string' &&
			authenticatedConfig.nonce.length > 0 &&
			authenticatedConfig.authenticated === true &&
			authenticatedConfig.canReview === true,
		JSON.stringify( authenticatedConfig )
	);
	const authResponsePromise = page.waitForResponse(
		( response ) =>
			response.request().method() === 'POST' &&
			response.url().includes( '/wp-json/webmcp/v1/activity' ),
		{ timeout: 8000 }
	);
	const authCall = await execute( page, 'webmcp.get-page-context', {} );
	const authResponse = await authResponsePromise;
	const authPayload = authResponse.request().postDataJSON();
	check(
		'authenticated WebMCP execution succeeds and stores asynchronously',
		authCall.ok && authResponse.status() === 201
	);
	const missingNonce = await directPost( page, event(), {
		removeHeaders: [ 'X-WP-Nonce' ],
	} );
	check(
		'authenticated ingestion rejects a missing nonce',
		missingNonce.status === 403,
		JSON.stringify( missingNonce )
	);

	const sessionsResponse = await adminGet( page, '?limit=500' );
	check(
		'administrator session review succeeds',
		sessionsResponse.status === 200 &&
			Array.isArray( sessionsResponse.body )
	);
	const authSession = sessionsResponse.body.find(
		( session ) => session.run_id === authPayload.run_id
	);
	const anonymousSessions = sessionsResponse.body.filter(
		( session ) => session.user_id === 0 && session.actor_hash
	);
	check(
		'authenticated run is grouped under its WordPress user',
		authSession?.user_id > 0,
		JSON.stringify( authSession )
	);
	check(
		'anonymous run and actor identifiers are stored only as hashes',
		anonymousSessions.length > 0 &&
			anonymousSessions.every(
				( session ) =>
					session.run_id !== anonymousRunId &&
					session.run_id.length === 64 &&
					session.actor_hash.length === 64
			),
		JSON.stringify( anonymousSessions.slice( 0, 3 ) )
	);
	let anonymousStored = null;
	for ( const session of anonymousSessions ) {
		const rows = await adminGet(
			page,
			'?run_id=' + encodeURIComponent( session.run_id ) + '&limit=500'
		);
		anonymousStored =
			rows.body.find( ( row ) => row.event_id === anonymousEventId ) ||
			null;
		if ( anonymousStored ) {
			break;
		}
	}
	check(
		'stored anonymous event is server-normalized and exposes no session token',
		anonymousStored &&
			! ( 'session_token' in anonymousStored ) &&
			anonymousStored.risk === 'read' &&
			anonymousStored.provider === 'WebMCP Adapter' &&
			anonymousStored.tool_name === 'webmcp.get-page-context' &&
			anonymousStored.surface === 'frontend' &&
			anonymousStored.page_path === '/',
		JSON.stringify( anonymousStored )
	);

	console.log( '\n== B7.3: sensitive summary and terminal outcomes ==' );
	await page.goto( WP_URL + '/wp-admin/options-general.php', {
		waitUntil: 'domcontentloaded',
	} );
	await waitForTool( page, 'wordpress.settings.stage-general-form' );
	const sensitive = 'batch7-private@example.test';
	const settingsResponsePromise = page.waitForResponse(
		( response ) =>
			response.request().method() === 'POST' &&
			response.url().includes( '/wp-json/webmcp/v1/activity' ),
		{ timeout: 8000 }
	);
	const settingsCall = await execute(
		page,
		'wordpress.settings.stage-general-form',
		{
			administrationEmail: sensitive,
		}
	);
	const settingsResponse = await settingsResponsePromise;
	const settingsPayloadText = settingsResponse.request().postData() || '';
	const settingsPayload = settingsResponse.request().postDataJSON();
	check(
		'General Settings staging still succeeds without persistence',
		settingsCall.ok === true && settingsResponse.status() === 201
	);
	check(
		'sensitive email never enters the activity request',
		! settingsPayloadText.includes( sensitive ),
		settingsPayloadText
	);
	check(
		'client safe summary contains only field identifiers and save requirement',
		settingsPayload.safe_summary.changedFields.includes(
			'administrationEmail'
		) && settingsPayload.safe_summary.requiresUserSave === true,
		JSON.stringify( settingsPayload.safe_summary )
	);

	const terminalOutcomes = [
		'failed',
		'declined',
		'expired',
		'cancelled',
		'stale',
	];
	const terminalIds = [];
	for ( const outcome of terminalOutcomes ) {
		const response = await directPost(
			page,
			event( {
				...( [ 'declined', 'expired' ].includes( outcome )
					? { ability: 'webmcp/save-post' }
					: {} ),
				outcome,
				error_code:
					outcome === 'failed'
						? 'ability_execution_failed'
						: outcome === 'declined'
						? 'confirmation_declined'
						: outcome === 'expired'
						? 'confirmation_expired'
						: outcome === 'cancelled'
						? 'invocation_cancelled'
						: 'stale_context',
			} )
		);
		check(
			`server accepts bounded ${ outcome } outcome`,
			response.status === 201,
			JSON.stringify( response )
		);
		terminalIds.push( response.body?.event_id );
	}

	await page.goto( WP_URL + '/wp-admin/tools.php?page=webmcp-activity', {
		waitUntil: 'domcontentloaded',
	} );
	const reviewText = await page.locator( '#wpbody-content' ).innerText();
	check(
		'administrator review labels normalized and anonymous activity',
		reviewText.includes( 'Site tools activity' ) &&
			reviewText.includes( 'Anonymous' ) &&
			reviewText.includes( 'Actions' ),
		reviewText.slice( 0, 1000 )
	);

	console.log( `\n${ pass } passed, ${ fail } failed` );
	if ( fail > 0 ) {
		console.error( failures.join( '\n' ) );
		process.exitCode = 1;
	}
} finally {
	await context.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}
