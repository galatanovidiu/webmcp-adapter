#!/usr/bin/env node
/**
 * Verify the General Settings staging Ability against a real WordPress document
 * through system Chrome's WebMCP API.
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
	`webmcp-general-form-${ Date.now() }`
);
const TOOL_NAME = 'wordpress.settings.stage-general-form';
const EXPECTED_NAMES = [
	TOOL_NAME,
	'webmcp.get-page-context',
	'webmcp.list-admin-destinations',
].sort();
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
		console.log( `  PASS ${ label }` );
		return;
	}

	fail++;
	failures.push( label + ( detail ? ` — ${ detail }` : '' ) );
	console.log( `  FAIL ${ label }${ detail ? ` — ${ detail }` : '' }` );
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
		return legacy ? ( await legacy.listTools() ).map( normalize ) : [];
	} );
}

async function stableTools( page, expectedCount ) {
	let tools = [];
	let previous = '';
	for ( let attempt = 0; attempt < 30; attempt++ ) {
		try {
			tools = await listTools( page );
		} catch {
			tools = [];
		}
		const current =
			tools.length === expectedCount
				? JSON.stringify( tools.map( ( tool ) => tool.name ).sort() )
				: '';
		if ( current && current === previous ) {
			return tools;
		}
		previous = current;
		await page.waitForTimeout( 500 );
	}
	return tools;
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

async function executeTool( page, name, args ) {
	const result = await page.evaluate(
		async ( [ toolName, input, inputMode ] ) => {
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
					inputMode === 'object' ? JSON.parse( input ) : input
				);
			}

			const legacy =
				navigator.modelContextTesting || document.modelContextTesting;
			if ( ! legacy ) {
				throw new Error( 'WebMCP is unavailable in this browser.' );
			}
			return legacy.executeTool( toolName, input );
		},
		[ name, JSON.stringify( args ), standardInputMode ]
	);

	if ( typeof result === 'string' ) {
		return JSON.parse( result );
	}
	if ( result?.content?.[ 0 ]?.text ) {
		return JSON.parse( result.content[ 0 ].text );
	}
	return result;
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

const browserContext = await chromium.launchPersistentContext( PROFILE_DIR, {
	channel: process.env.CHROME_CHANNEL || 'chrome',
	headless: process.env.HEADLESS !== '0',
	args: FLAGS,
} );
const page = browserContext.pages()[ 0 ] || ( await browserContext.newPage() );
const invocationRequests = [];
const optionUpdateRequests = [];
page.on( 'request', ( request ) => {
	if ( request.url().includes( '/wp-admin/options.php' ) ) {
		optionUpdateRequests.push( request.url() );
	}
	if ( request.resourceType() !== 'document' ) {
		invocationRequests.push( {
			url: request.url(),
			method: request.method(),
			postData: request.postData() || '',
		} );
	}
} );

try {
	await logIn( page );
	await page.goto( `${ WP_URL }/wp-admin/options-general.php`, {
		waitUntil: 'networkidle',
	} );

	const tools = await stableTools( page, EXPECTED_NAMES.length );
	const names = tools.map( ( tool ) => tool.name ).sort();
	check(
		'General Settings exposes the exact 3-tool inventory',
		JSON.stringify( names ) === JSON.stringify( EXPECTED_NAMES ),
		names.join( ', ' )
	);
	const tool = tools.find( ( item ) => item.name === TOOL_NAME );
	check(
		'staging tool is reversible, write-capable, and marks page output untrusted',
		tool?.annotations?.readOnlyHint === false &&
			tool?.annotations?.untrustedContentHint === true
	);
	check(
		'input schema is non-empty and closed',
		tool?.inputSchema?.minProperties === 1 &&
			tool?.inputSchema?.additionalProperties === false &&
			Object.keys( tool?.inputSchema?.properties ?? {} ).length === 10
	);
	await detectStandardInputMode( page );
	const rejectedInputs = await page.evaluate( async () => {
		const { executeAbility } = await import( '@wordpress/abilities' );
		const cases = {
			empty: {},
			unknown: { unsupported: true },
			invalidEmail: { administrationEmail: 'not-an-email' },
			invalidWeek: { weekStartsOn: 7 },
			emptyDateFormat: { dateFormat: '' },
		};
		const outcomes = {};
		for ( const [ name, input ] of Object.entries( cases ) ) {
			try {
				await executeAbility(
					'wordpress/settings/stage-general-form',
					input
				);
				outcomes[ name ] = false;
			} catch {
				outcomes[ name ] = true;
			}
		}
		return outcomes;
	} );
	check(
		'input schema rejects empty, unknown, malformed email, week, and format payloads',
		Object.values( rejectedInputs ).every( Boolean ),
		JSON.stringify( rejectedInputs )
	);

	const setup = await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		const timezone = form?.querySelector( '#timezone_string' );
		const timezoneValue = [ ...timezone.options ].find(
			( option ) => ! option.disabled && option.value !== timezone.value
		)?.value;
		const readOtherValues = () => ( {
			tagline: form.querySelector( '#blogdescription' ).value,
			membership: form.querySelector( '#users_can_register' ).checked,
			defaultRole: form.querySelector( '#default_role' ).value,
			siteLanguage: form.querySelector( '#WPLANG' ).value,
			dateFormat: form.querySelector(
				'input[name="date_format"]:checked'
			).value,
			timeFormat: form.querySelector(
				'input[name="time_format"]:checked'
			).value,
			weekStartsOn: form.querySelector( '#start_of_week' ).value,
		} );
		window.__webmcpFormEvents = [];
		for ( const control of [
			form.querySelector( '#blogname' ),
			form.querySelector( '#timezone_string' ),
		] ) {
			for ( const type of [ 'input', 'change' ] ) {
				control.addEventListener( type, ( event ) => {
					window.__webmcpFormEvents.push( {
						id: event.target.id,
						type: event.type,
					} );
				} );
			}
		}
		return {
			originalTitle: form.querySelector( '#blogname' ).value,
			originalTimezone: timezone.value,
			timezoneValue,
			otherValues: readOtherValues(),
		};
	} );

	const stagedTitle = `Batch 5 staged title ${ Date.now() }`;
	invocationRequests.length = 0;
	const result = await executeTool( page, TOOL_NAME, {
		siteTitle: stagedTitle,
		timezone: setup.timezoneValue,
	} );
	await page.waitForTimeout( 300 );

	check(
		'partial call reports only the named changed fields',
		result.staged === true &&
			JSON.stringify( [ ...result.changedFields ].sort() ) ===
				JSON.stringify( [ 'siteTitle', 'timezone' ] ) &&
			result.unchangedFields.length === 0 &&
			result.validationErrors.length === 0 &&
			result.requiresUserSave === true &&
			result.saveControlLabel === 'Save Changes',
		JSON.stringify( result )
	);
	check(
		'result returns field names but no staged values',
		! JSON.stringify( result ).includes( stagedTitle ) &&
			! JSON.stringify( result ).includes( setup.timezoneValue )
	);

	const visibleState = await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		return {
			title: form.querySelector( '#blogname' ).value,
			timezone: form.querySelector( '#timezone_string' ).value,
			otherValues: {
				tagline: form.querySelector( '#blogdescription' ).value,
				membership: form.querySelector( '#users_can_register' ).checked,
				defaultRole: form.querySelector( '#default_role' ).value,
				siteLanguage: form.querySelector( '#WPLANG' ).value,
				dateFormat: form.querySelector(
					'input[name="date_format"]:checked'
				).value,
				timeFormat: form.querySelector(
					'input[name="time_format"]:checked'
				).value,
				weekStartsOn: form.querySelector( '#start_of_week' ).value,
			},
			events: window.__webmcpFormEvents,
			stagedFields: [
				...form.querySelectorAll( '[data-webmcp-general-staged]' ),
			].map( ( element ) =>
				element.getAttribute( 'data-webmcp-staged-field' )
			),
			notice: form.querySelector( '[data-webmcp-general-review]' )
				?.textContent,
		};
	} );
	check(
		'only the provided controls changed',
		visibleState.title === stagedTitle &&
			visibleState.timezone === setup.timezoneValue &&
			JSON.stringify( visibleState.otherValues ) ===
				JSON.stringify( setup.otherValues ),
		JSON.stringify( visibleState )
	);
	check(
		'native input and change events fired for each changed control',
		[ 'blogname', 'timezone_string' ].every( ( id ) =>
			[ 'input', 'change' ].every( ( type ) =>
				visibleState.events.some(
					( event ) => event.id === id && event.type === type
				)
			)
		),
		JSON.stringify( visibleState.events )
	);
	check(
		'changed controls are highlighted and the review notice requires manual save',
		[ 'siteTitle', 'timezone' ].every( ( field ) =>
			visibleState.stagedFields.includes( field )
		) &&
			/Review staged changes/i.test( visibleState.notice || '' ) &&
			/Save Changes/i.test( visibleState.notice || '' )
	);
	const eventCountBeforeUnchanged = visibleState.events.length;
	const unchangedResult = await executeTool( page, TOOL_NAME, {
		siteTitle: stagedTitle,
	} );
	const eventCountAfterUnchanged = await page.evaluate(
		() => window.__webmcpFormEvents.length
	);
	check(
		'unchanged values do not dispatch events but retain the accumulated save requirement',
		unchangedResult.staged === true &&
			unchangedResult.changedFields.length === 0 &&
			JSON.stringify( unchangedResult.unchangedFields ) ===
				JSON.stringify( [ 'siteTitle' ] ) &&
			unchangedResult.requiresUserSave === true &&
			eventCountAfterUnchanged === eventCountBeforeUnchanged,
		JSON.stringify( unchangedResult )
	);
	const nonAuditRequests = invocationRequests.filter(
		( request ) => ! request.url.includes( '/wp-json/webmcp/v1/activity' )
	);
	check(
		'staging emits no application request or form submission',
		nonAuditRequests.length === 0 &&
			! invocationRequests.some( ( request ) =>
				request.url.includes( '/wp-admin/options.php' )
			),
		JSON.stringify( nonAuditRequests )
	);

	console.log( '\n== Live validation and remaining controls ==' );
	const beforeInvalid = await page.evaluate( () => ( {
		tagline: document.querySelector( '#blogdescription' ).value,
		defaultRole: document.querySelector( '#default_role' ).value,
		siteLanguage: document.querySelector( '#WPLANG' ).value,
		timezone: document.querySelector( '#timezone_string' ).value,
	} ) );
	const invalidResult = await executeTool( page, TOOL_NAME, {
		tagline: 'This must not stage beside invalid options',
		defaultRole: '__missing_role__',
		siteLanguage: '__missing_language__',
		timezone: '__missing_timezone__',
	} );
	const afterInvalid = await page.evaluate( () => ( {
		tagline: document.querySelector( '#blogdescription' ).value,
		defaultRole: document.querySelector( '#default_role' ).value,
		siteLanguage: document.querySelector( '#WPLANG' ).value,
		timezone: document.querySelector( '#timezone_string' ).value,
	} ) );
	check(
		'live option validation is atomic and field-specific',
		invalidResult.staged === false &&
			invalidResult.requiresUserSave === true &&
			JSON.stringify(
				invalidResult.validationErrors
					.map( ( error ) => error.field )
					.sort()
			) ===
				JSON.stringify(
					[ 'defaultRole', 'siteLanguage', 'timezone' ].sort()
				) &&
			JSON.stringify( afterInvalid ) === JSON.stringify( beforeInvalid ),
		JSON.stringify( invalidResult )
	);

	const remainingValues = await page.evaluate( () => {
		const chooseDifferent = ( selector ) => {
			const select = document.querySelector( selector );
			return [ ...select.options ].find(
				( option ) => ! option.disabled && option.value !== select.value
			)?.value;
		};
		const membership = document.querySelector(
			'#users_can_register'
		).checked;
		const weekStartsOn = document.querySelector( '#start_of_week' ).value;
		return {
			tagline: `Batch 5 staged tagline ${ Date.now() }`,
			membership: ! membership,
			defaultRole: chooseDifferent( '#default_role' ),
			siteLanguage: chooseDifferent( '#WPLANG' ),
			weekStartsOn: ( Number( weekStartsOn ) + 1 ) % 7,
		};
	} );
	const remainingResult = await executeTool(
		page,
		TOOL_NAME,
		remainingValues
	);
	const remainingState = await page.evaluate( () => ( {
		tagline: document.querySelector( '#blogdescription' ).value,
		membership: document.querySelector( '#users_can_register' ).checked,
		defaultRole: document.querySelector( '#default_role' ).value,
		siteLanguage: document.querySelector( '#WPLANG' ).value,
		weekStartsOn: Number(
			document.querySelector( '#start_of_week' ).value
		),
	} ) );
	check(
		'all remaining non-format controls stage through their live control types',
		remainingResult.staged === true &&
			remainingResult.changedFields.length === 5 &&
			Object.entries( remainingValues ).every(
				( [ field, value ] ) => remainingState[ field ] === value
			),
		JSON.stringify( remainingResult )
	);

	invocationRequests.length = 0;
	const directResult = await page.evaluate(
		async ( input ) => {
			const { executeAbility } = await import( '@wordpress/abilities' );
			return executeAbility(
				'wordpress/settings/stage-general-form',
				input
			);
		},
		{
			siteTitle: `Direct callback title ${ Date.now() }`,
			tagline: `Direct callback tagline ${ Date.now() }`,
			administrationEmail: 'direct-callback@example.test',
			membership: setup.otherValues.membership,
			defaultRole: setup.otherValues.defaultRole,
			siteLanguage: setup.otherValues.siteLanguage,
			timezone: setup.originalTimezone,
			dateFormat: 'Y-m-d\\TH:i',
			timeFormat: 'H:i:s',
			weekStartsOn: Number( setup.otherValues.weekStartsOn ),
		}
	);
	await page.waitForTimeout( 300 );
	check(
		'provider callback performs no request while staging every supported field',
		directResult.staged === true &&
			directResult.validationErrors.length === 0 &&
			invocationRequests.length === 0,
		JSON.stringify( invocationRequests )
	);

	console.log( '\n== Preset and custom date/time formats ==' );
	const formatInputs = await page.evaluate( () => {
		const dateRadios = [
			...document.querySelectorAll( 'input[name="date_format"]' ),
		];
		const timeRadios = [
			...document.querySelectorAll( 'input[name="time_format"]' ),
		];
		const dateCustom = document.querySelector(
			'#date_format_custom_radio'
		);
		const timeCustom = document.querySelector(
			'#time_format_custom_radio'
		);
		window.__webmcpFormatEvents = [];
		for ( const control of [
			...dateRadios,
			...timeRadios,
			document.querySelector( '#date_format_custom' ),
			document.querySelector( '#time_format_custom' ),
		] ) {
			for ( const type of [ 'input', 'change' ] ) {
				control.addEventListener( type, ( event ) => {
					window.__webmcpFormatEvents.push( {
						id: event.target.id,
						name: event.target.name,
						type: event.type,
						value: event.target.value,
					} );
				} );
			}
		}
		return {
			datePreset: dateRadios.find(
				( radio ) => ! radio.checked && radio !== dateCustom
			).value,
			timePreset: timeRadios.find(
				( radio ) => ! radio.checked && radio !== timeCustom
			).value,
			customDate:
				document.querySelector( '#date_format_custom' ).value ===
				'Y-m-d\\TH:i:s'
					? 'd/m/Y H:i:s'
					: 'Y-m-d\\TH:i:s',
			customTime:
				document.querySelector( '#time_format_custom' ).value ===
				'H:i:s T'
					? 'H:i:s O'
					: 'H:i:s T',
		};
	} );

	const firstFormatResult = await executeTool( page, TOOL_NAME, {
		dateFormat: formatInputs.datePreset,
		timeFormat: formatInputs.customTime,
	} );
	const firstFormatState = await page.evaluate( () => ( {
		dateRadio: document.querySelector( 'input[name="date_format"]:checked' )
			.value,
		timeRadioId: document.querySelector(
			'input[name="time_format"]:checked'
		).id,
		timeCustom: document.querySelector( '#time_format_custom' ).value,
		events: window.__webmcpFormatEvents,
	} ) );
	check(
		'preset date and custom time stage through the correct paired controls',
		firstFormatResult.staged === true &&
			firstFormatState.dateRadio === formatInputs.datePreset &&
			firstFormatState.timeRadioId === 'time_format_custom_radio' &&
			firstFormatState.timeCustom === formatInputs.customTime &&
			[ 'input', 'change' ].every( ( type ) =>
				firstFormatState.events.some(
					( event ) =>
						event.id === 'time_format_custom' && event.type === type
				)
			),
		JSON.stringify( firstFormatState )
	);

	await page.evaluate( () => {
		window.__webmcpFormatEvents = [];
	} );
	const secondFormatResult = await executeTool( page, TOOL_NAME, {
		dateFormat: formatInputs.customDate,
		timeFormat: formatInputs.timePreset,
	} );
	const secondFormatState = await page.evaluate( () => ( {
		dateRadioId: document.querySelector(
			'input[name="date_format"]:checked'
		).id,
		dateCustom: document.querySelector( '#date_format_custom' ).value,
		timeRadio: document.querySelector( 'input[name="time_format"]:checked' )
			.value,
		events: window.__webmcpFormatEvents,
	} ) );
	check(
		'custom date and preset time stage through the correct paired controls',
		secondFormatResult.staged === true &&
			secondFormatState.dateRadioId === 'date_format_custom_radio' &&
			secondFormatState.dateCustom === formatInputs.customDate &&
			secondFormatState.timeRadio === formatInputs.timePreset &&
			[ 'input', 'change' ].every( ( type ) =>
				secondFormatState.events.some(
					( event ) =>
						event.id === 'date_format_custom' && event.type === type
				)
			),
		JSON.stringify( secondFormatState )
	);

	console.log( '\n== Sensitive Administration Email ==' );
	const sensitiveEmail = `batch5-sensitive-${ Date.now() }@example.test`;
	invocationRequests.length = 0;
	const emailResult = await executeTool( page, TOOL_NAME, {
		administrationEmail: sensitiveEmail,
	} );
	await page.waitForTimeout( 500 );
	check(
		'administration email result identifies only the field and confirmation warning',
		emailResult.staged === true &&
			emailResult.changedFields.includes( 'administrationEmail' ) &&
			emailResult.warnings.length === 1 &&
			emailResult.warnings[ 0 ].field === 'administrationEmail' &&
			/email confirmation/i.test( emailResult.warnings[ 0 ].message ) &&
			! JSON.stringify( emailResult ).includes( sensitiveEmail ),
		JSON.stringify( emailResult )
	);
	const emailUi = await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		return {
			inputValue: form.querySelector( '#new_admin_email' ).value,
			noticeText: form.querySelector( '[data-webmcp-general-review]' )
				?.textContent,
			isHighlighted: form
				.querySelector( '#new_admin_email' )
				.hasAttribute( 'data-webmcp-general-staged' ),
		};
	} );
	check(
		'administration email is staged and highlighted without being copied into review text',
		emailUi.inputValue === sensitiveEmail &&
			emailUi.isHighlighted === true &&
			! ( emailUi.noticeText || '' ).includes( sensitiveEmail ),
		JSON.stringify( {
			isHighlighted: emailUi.isHighlighted,
			noticeText: emailUi.noticeText,
		} )
	);
	const activityRequests = invocationRequests.filter( ( request ) =>
		request.url.includes( '/wp-json/webmcp/v1/activity' )
	);
	check(
		'administration email is redacted before observability transport',
		activityRequests.length === 1 &&
			activityRequests.every(
				( request ) => ! request.postData.includes( sensitiveEmail )
			),
		JSON.stringify( activityRequests )
	);
	const storedActivity = await page.evaluate( async () => {
		const runId = window.sessionStorage.getItem( 'webmcpRunId' );
		return window.wp.apiFetch( {
			path:
				'/webmcp/v1/activity?run_id=' +
				encodeURIComponent( runId ) +
				'&limit=20',
		} );
	} );
	check(
		'administration email is absent from stored observability',
		! JSON.stringify( storedActivity ).includes( sensitiveEmail ) &&
			storedActivity.some(
				( entry ) =>
					entry.ability === 'wordpress/settings/stage-general-form' &&
					entry.params?.administrationEmail === '[redacted]'
			),
		JSON.stringify( storedActivity )
	);

	console.log( '\n== Feedback lifecycle and no persistence ==' );
	await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		form.reset();
	} );
	await page.waitForTimeout( 50 );
	let feedbackState = await page.evaluate( () => ( {
		notices: document.querySelectorAll( '[data-webmcp-general-review]' )
			.length,
		highlights: document.querySelectorAll( '[data-webmcp-general-staged]' )
			.length,
	} ) );
	check(
		'form reset clears review feedback',
		feedbackState.notices === 0 && feedbackState.highlights === 0,
		JSON.stringify( feedbackState )
	);

	await executeTool( page, TOOL_NAME, {
		siteTitle: `Submit feedback probe ${ Date.now() }`,
	} );
	await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		form.addEventListener( 'submit', ( event ) => event.preventDefault(), {
			once: true,
		} );
		form.requestSubmit();
	} );
	feedbackState = await page.evaluate( () => ( {
		notices: document.querySelectorAll( '[data-webmcp-general-review]' )
			.length,
		highlights: document.querySelectorAll( '[data-webmcp-general-staged]' )
			.length,
	} ) );
	check(
		'form submit clears review feedback before navigation',
		feedbackState.notices === 0 && feedbackState.highlights === 0,
		JSON.stringify( feedbackState )
	);

	await executeTool( page, TOOL_NAME, {
		siteTitle: `Replacement feedback probe ${ Date.now() }`,
	} );
	await page.evaluate( () => {
		const form = document.querySelector(
			'form input[name="option_page"][value="general"]'
		)?.form;
		form.replaceWith( form.cloneNode( true ) );
	} );
	await page.waitForTimeout( 50 );
	feedbackState = await page.evaluate( () => ( {
		notices: document.querySelectorAll( '[data-webmcp-general-review]' )
			.length,
		highlights: document.querySelectorAll( '[data-webmcp-general-staged]' )
			.length,
	} ) );
	check(
		'live form replacement clears copied review feedback',
		feedbackState.notices === 0 && feedbackState.highlights === 0,
		JSON.stringify( feedbackState )
	);
	const replacementResult = await executeTool( page, TOOL_NAME, {
		tagline: `Replacement form remains stageable ${ Date.now() }`,
	} );
	check(
		'callback revalidates and stages the replacement form',
		replacementResult.staged === true &&
			replacementResult.changedFields.includes( 'tagline' ),
		JSON.stringify( replacementResult )
	);

	const reloadTitle = `Reload discard title ${ Date.now() }`;
	const reloadEmail = `reload-discard-${ Date.now() }@example.test`;
	await executeTool( page, TOOL_NAME, {
		siteTitle: reloadTitle,
		administrationEmail: reloadEmail,
	} );
	await page.reload( { waitUntil: 'networkidle' } );
	const reloadedTools = await stableTools( page, EXPECTED_NAMES.length );
	const reloadedState = await page.evaluate( () => ( {
		title: document.querySelector( '#blogname' ).value,
		timezone: document.querySelector( '#timezone_string' ).value,
		emailIsStaged: document
			.querySelector( '#new_admin_email' )
			.value.includes( 'reload-discard-' ),
		notices: document.querySelectorAll( '[data-webmcp-general-review]' )
			.length,
		highlights: document.querySelectorAll( '[data-webmcp-general-staged]' )
			.length,
	} ) );
	check(
		'reload discards staged values and feedback without persistence',
		reloadedTools.length === EXPECTED_NAMES.length &&
			reloadedState.title === setup.originalTitle &&
			reloadedState.timezone === setup.originalTimezone &&
			reloadedState.emailIsStaged === false &&
			reloadedState.notices === 0 &&
			reloadedState.highlights === 0,
		JSON.stringify( reloadedState )
	);
	check(
		'no General Settings staging call submitted the WordPress options form',
		optionUpdateRequests.length === 0,
		JSON.stringify( optionUpdateRequests )
	);
} finally {
	await browserContext.close();
	fs.rmSync( PROFILE_DIR, { recursive: true, force: true } );
}

console.log( `\n==== ${ pass } passed, ${ fail } failed ====` );
if ( failures.length ) {
	console.log( 'Failures:' );
	for ( const failure of failures ) {
		console.log( `  - ${ failure }` );
	}
}
process.exit( fail ? 1 : 0 );
