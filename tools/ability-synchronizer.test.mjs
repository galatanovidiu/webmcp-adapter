import test from 'node:test';
import assert from 'node:assert/strict';
import { createAbilitySynchronizer } from '../src/ability-synchronizer.js';
import {
	classifyAbilityRisk,
	toWebMcpToolName,
} from '../src/adapter-contract.js';

function readAbility( name, overrides = {} ) {
	return {
		name,
		label: `Read ${ name }`,
		description: `Read ${ name } from the current page.`,
		input_schema: {
			type: 'object',
			properties: {},
			additionalProperties: false,
		},
		meta: {
			annotations: {
				readonly: true,
				clientRegistered: true,
			},
		},
		callback: async () => ( { ok: true } ),
		...overrides,
	};
}

function writeAbility( name, risk ) {
	return readAbility( name, {
		meta: {
			annotations: {
				readonly: false,
				clientRegistered: true,
			},
			...( risk ? { webmcp: { risk } } : {} ),
		},
	} );
}

function createHarness( initialAbilities = [] ) {
	let abilities = initialAbilities;
	let subscriber = null;
	let failuresRemaining = 0;
	const attempts = [];
	const activeTools = new Map();
	const diagnostics = [];

	const synchronizer = createAbilitySynchronizer( {
		classifyAbilityRisk,
		getAbilities: () => abilities,
		subscribe: ( callback ) => {
			subscriber = callback;
			return () => {
				subscriber = null;
			};
		},
		registerAbility: async ( ability, registration ) => {
			attempts.push( { ability, ...registration } );
			if ( failuresRemaining > 0 ) {
				failuresRemaining--;
				throw new Error( 'registration rejected' );
			}

			if ( activeTools.has( registration.toolName ) ) {
				throw new Error( `duplicate tool ${ registration.toolName }` );
			}
			activeTools.set( registration.toolName, ability );
			registration.signal.addEventListener(
				'abort',
				() => activeTools.delete( registration.toolName ),
				{ once: true }
			);
		},
		reportDiagnostic: ( diagnostic ) => diagnostics.push( diagnostic ),
		toWebMcpToolName,
	} );

	return {
		synchronizer,
		attempts,
		activeTools,
		diagnostics,
		setAbilities( nextAbilities ) {
			abilities = nextAbilities;
		},
		async notify() {
			assert.equal( typeof subscriber, 'function' );
			await subscriber();
		},
		rejectNextRegistration() {
			failuresRemaining++;
		},
	};
}

test( 'registers initial and late frontend Abilities once with dot names', async () => {
	const initial = readAbility( 'vendor/initial-read' );
	const late = readAbility( 'vendor/late-read' );
	const harness = createHarness( [ initial ] );

	await harness.synchronizer.start();
	assert.deepEqual(
		[ ...harness.activeTools.keys() ],
		[ 'vendor.initial-read' ]
	);

	harness.setAbilities( [ initial, late ] );
	await harness.notify();
	await harness.notify();
	assert.deepEqual( [ ...harness.activeTools.keys() ].sort(), [
		'vendor.initial-read',
		'vendor.late-read',
	] );
	assert.equal( harness.attempts.length, 2 );
} );

test( 'excludes server and mixed-provenance Abilities', async () => {
	const harness = createHarness( [
		readAbility( 'vendor/server', {
			meta: {
				annotations: {
					readonly: true,
					serverRegistered: true,
				},
			},
		} ),
		readAbility( 'vendor/mixed', {
			meta: {
				annotations: {
					readonly: true,
					clientRegistered: true,
					serverRegistered: true,
				},
			},
		} ),
	] );

	await harness.synchronizer.start();
	assert.equal( harness.activeTools.size, 0 );
	assert.equal( harness.attempts.length, 0 );
} );

test( 'fails closed for missing and invalid mutation risks', async () => {
	const harness = createHarness( [
		writeAbility( 'vendor/missing-risk' ),
		writeAbility( 'vendor/invalid-risk', 'destructive' ),
		writeAbility( 'vendor/reversible-write', 'reversible' ),
	] );

	await harness.synchronizer.start();
	assert.deepEqual(
		[ ...harness.activeTools.keys() ],
		[ 'vendor.reversible-write' ]
	);
	assert.deepEqual( harness.diagnostics.map( ( item ) => item.code ).sort(), [
		'invalid-risk',
		'missing-risk',
	] );
} );

test( 'rejects ambiguous Ability and projected tool names', async () => {
	const duplicateA = readAbility( 'vendor/duplicate', {
		label: 'Duplicate A',
	} );
	const duplicateB = readAbility( 'vendor/duplicate', {
		label: 'Duplicate B',
	} );
	const harness = createHarness( [
		duplicateA,
		duplicateB,
		readAbility( 'vendor/foo.bar' ),
		readAbility( 'vendor/foo/bar' ),
	] );

	await harness.synchronizer.start();
	assert.equal( harness.activeTools.size, 0 );
	assert.deepEqual( harness.diagnostics.map( ( item ) => item.code ).sort(), [
		'ability-name-collision',
		'tool-name-collision',
	] );
} );

test( 'aborts a registration when its Ability disappears', async () => {
	const ability = readAbility( 'vendor/removable' );
	const harness = createHarness( [ ability ] );

	await harness.synchronizer.start();
	const [ registration ] = harness.attempts;
	assert.equal( registration.signal.aborted, false );

	harness.setAbilities( [] );
	await harness.notify();
	assert.equal( registration.signal.aborted, true );
	assert.equal( harness.activeTools.size, 0 );
} );

test( 'aborts and replaces a changed same-name definition', async () => {
	const original = readAbility( 'vendor/replaceable' );
	const replacement = readAbility( 'vendor/replaceable', {
		label: 'Replacement definition',
	} );
	const harness = createHarness( [ original ] );

	await harness.synchronizer.start();
	const firstRegistration = harness.attempts[ 0 ];
	harness.setAbilities( [ replacement ] );
	await harness.notify();

	assert.equal( firstRegistration.signal.aborted, true );
	assert.equal( harness.attempts.length, 2 );
	assert.equal(
		harness.activeTools.get( 'vendor.replaceable' ),
		replacement
	);
	assert.ok(
		harness.diagnostics.some(
			( item ) => item.code === 'definition-replaced'
		)
	);
} );

test( 'a rejected registration stays retryable without becoming active', async () => {
	const ability = readAbility( 'vendor/retryable' );
	const harness = createHarness( [ ability ] );
	harness.rejectNextRegistration();

	await harness.synchronizer.start();
	assert.equal( harness.activeTools.size, 0 );
	assert.equal( harness.attempts.length, 1 );
	assert.ok(
		harness.diagnostics.some(
			( item ) => item.code === 'registration-failed'
		)
	);

	await harness.notify();
	assert.equal( harness.attempts.length, 2 );
	assert.equal( harness.activeTools.has( 'vendor.retryable' ), true );
} );
