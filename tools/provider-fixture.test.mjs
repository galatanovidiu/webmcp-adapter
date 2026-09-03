import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	ALLOWED_TONES,
	applyPanelTone,
	readPanelState,
	readPrimaryPanelState,
} from '../tests/fixtures/webmcp-provider/src/panel-state.js';

const ROOT = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'..'
);

function panel( page = 'primary', tone = 'calm' ) {
	const toneOutput = { textContent: tone };
	return {
		dataset: {
			webmcpProviderPage: page,
			webmcpProviderTone: tone,
		},
		querySelector( selector ) {
			return selector === '[data-webmcp-provider-tone-output]'
				? toneOutput
				: null;
		},
		toneOutput,
	};
}

test( 'fixture read returns one exact bounded panel state', () => {
	assert.deepEqual( ALLOWED_TONES, [ 'calm', 'focus' ] );
	assert.deepEqual( readPrimaryPanelState( panel() ), {
		page: 'primary',
		tone: 'calm',
	} );
	assert.equal( readPrimaryPanelState( panel( 'secondary' ) ), null );
	assert.equal( readPanelState( panel() ).available, true );
} );

test( 'fixture write is precise, idempotent, and reversible', () => {
	const target = panel();
	assert.deepEqual( applyPanelTone( target, 'focus' ), {
		applied: true,
		changed: true,
		page: 'primary',
		previousTone: 'calm',
		tone: 'focus',
		reason: null,
	} );
	assert.equal( target.dataset.webmcpProviderTone, 'focus' );
	assert.equal( target.toneOutput.textContent, 'focus' );

	assert.deepEqual( applyPanelTone( target, 'focus' ), {
		applied: true,
		changed: false,
		page: 'primary',
		previousTone: 'focus',
		tone: 'focus',
		reason: null,
	} );

	assert.deepEqual( applyPanelTone( target, 'calm' ), {
		applied: true,
		changed: true,
		page: 'primary',
		previousTone: 'focus',
		tone: 'calm',
		reason: null,
	} );
	assert.equal( target.dataset.webmcpProviderTone, 'calm' );
} );

test( 'fixture write refuses invalid input or stale page state without mutation', () => {
	const target = panel();
	assert.deepEqual( applyPanelTone( target, 'loud' ), {
		applied: false,
		changed: false,
		page: 'primary',
		previousTone: 'calm',
		tone: 'calm',
		reason: 'Use exactly `calm` or `focus` for the panel tone.',
	} );
	assert.equal( target.dataset.webmcpProviderTone, 'calm' );

	const stale = panel( 'other' );
	assert.deepEqual( applyPanelTone( stale, 'focus' ), {
		applied: false,
		changed: false,
		page: null,
		previousTone: null,
		tone: null,
		reason: 'The fixture panel is not available in this document.',
	} );
	assert.equal( stale.dataset.webmcpProviderTone, 'calm' );

	const missingOutput = panel();
	missingOutput.querySelector = () => null;
	assert.deepEqual( applyPanelTone( missingOutput, 'calm' ), {
		applied: false,
		changed: false,
		page: 'primary',
		previousTone: 'calm',
		tone: 'calm',
		reason: 'The fixture panel output is not available in this document.',
	} );
} );

test( 'fixture write repairs desynchronized visible state before reporting success', () => {
	const target = panel( 'secondary', 'focus' );
	target.toneOutput.textContent = 'calm';
	assert.deepEqual( applyPanelTone( target, 'focus' ), {
		applied: true,
		changed: true,
		page: 'secondary',
		previousTone: 'focus',
		tone: 'focus',
		reason: null,
	} );
	assert.equal( target.dataset.webmcpProviderTone, 'focus' );
	assert.equal( target.toneOutput.textContent, 'focus' );
} );

test( 'fixture uses only WordPress extension seams and adapter stays provider-neutral', () => {
	const plugin = fs.readFileSync(
		path.join( ROOT, 'tests/fixtures/webmcp-provider/webmcp-provider.php' ),
		'utf8'
	);
	const modules = [
		'category.js',
		'get-panel-state.js',
		'set-panel-tone.js',
	].map( ( file ) =>
		fs.readFileSync(
			path.join( ROOT, 'tests/fixtures/webmcp-provider/src', file ),
			'utf8'
		)
	);
	const adapter = fs.readFileSync(
		path.join( ROOT, 'src/adapter.js' ),
		'utf8'
	);

	assert.match( plugin, /admin_enqueue_scripts/ );
	assert.match( plugin, /wp_register_script_module/ );
	assert.match( plugin, /webmcp_activity_ability_definitions/ );
	assert.ok(
		modules.every(
			( source ) =>
				source.includes( '@wordpress/abilities' ) ||
				source.includes( 'webmcp-provider-fixture/panel-state' )
		)
	);
	assert.ok( ! plugin.includes( 'document.modelContext' ) );
	assert.ok(
		modules.every( ( source ) => ! source.includes( 'registerTool' ) )
	);
	assert.ok( ! adapter.includes( 'webmcp-provider-fixture' ) );
	assert.ok( ! adapter.includes( 'Fixture Provider' ) );
} );
