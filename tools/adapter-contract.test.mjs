import test from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyAbilityRisk,
	requiresConfirmationForRisk,
	toAbilityName,
	toWebMcpToolName,
} from '../src/adapter-contract.js';

test( 'Ability name projection preserves segment boundaries without dash collisions', () => {
	const abilityNames = [
		'vendor/foo-bar',
		'vendor/foo/bar',
		'webmcp/editor-context',
		'wordpress/settings/stage-general-form',
	];
	const projected = abilityNames.map( toWebMcpToolName );

	assert.deepEqual( projected, [
		'vendor.foo-bar',
		'vendor.foo.bar',
		'webmcp.editor-context',
		'wordpress.settings.stage-general-form',
	] );
	assert.equal( new Set( projected ).size, abilityNames.length );
	assert.deepEqual( projected.map( toAbilityName ), abilityNames );
} );

test( 'read-only Abilities classify as read without risk metadata', () => {
	assert.deepEqual(
		classifyAbilityRisk( {
			meta: { annotations: { readonly: true } },
		} ),
		{ ok: true, risk: 'read' }
	);
} );

test( 'supported mutation risks classify exactly', () => {
	for ( const risk of [
		'reversible',
		'persistent',
		'consequential',
		'privileged',
	] ) {
		assert.deepEqual(
			classifyAbilityRisk( {
				meta: {
					annotations: { readonly: false },
					webmcp: { risk },
				},
			} ),
			{ ok: true, risk }
		);
	}
} );

test( 'mutations with missing risk metadata fail closed', () => {
	for ( const ability of [
		{},
		{ meta: {} },
		{ meta: { annotations: { readonly: false } } },
		{ meta: { annotations: { readonly: false, risk: 'reversible' } } },
	] ) {
		assert.deepEqual( classifyAbilityRisk( ability ), {
			ok: false,
			risk: null,
			diagnostic: 'missing-risk',
		} );
	}
} );

test( 'mutations with invalid risk metadata fail closed', () => {
	for ( const risk of [ null, '', 'read', 'destructive', 'Reversible' ] ) {
		assert.deepEqual(
			classifyAbilityRisk( {
				meta: {
					annotations: { readonly: false },
					webmcp: { risk },
				},
			} ),
			{ ok: false, risk: null, diagnostic: 'invalid-risk' }
		);
	}
} );

test( 'only consequential and privileged risks require in-page confirmation', () => {
	assert.equal( requiresConfirmationForRisk( 'read' ), false );
	assert.equal( requiresConfirmationForRisk( 'reversible' ), false );
	assert.equal( requiresConfirmationForRisk( 'persistent' ), false );
	assert.equal( requiresConfirmationForRisk( 'consequential' ), true );
	assert.equal( requiresConfirmationForRisk( 'privileged' ), true );
	assert.equal( requiresConfirmationForRisk( 'unknown' ), false );
} );
