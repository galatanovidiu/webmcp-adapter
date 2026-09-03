/** Registers the precise read owned only by the primary fixture page. */

import {
	getAbility,
	registerAbility,
	unregisterAbility,
} from '@wordpress/abilities';
import 'webmcp-provider-fixture/category';
import {
	findPanel,
	readPrimaryPanelState,
} from 'webmcp-provider-fixture/panel-state';

const ABILITY_NAME = 'webmcp-provider-fixture/get-panel-state';

const definition = {
	name: ABILITY_NAME,
	category: 'webmcp-provider-fixture',
	label: 'Get Panel State',
	description:
		"Return the primary fixture panel's exact `page` and visible `tone`. Use `webmcp-provider-fixture/set-panel-tone` when the visible tone should change. This read is available only while the live primary fixture panel exists and does not inspect any other WordPress page state.",
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	output_schema: {
		type: 'object',
		properties: {
			page: { type: 'string', enum: [ 'primary' ] },
			tone: { type: 'string', enum: [ 'calm', 'focus' ] },
		},
		required: [ 'page', 'tone' ],
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
		},
		webmcp: { provider: 'WebMCP Provider Fixture' },
	},
	permissionCallback: async () =>
		readPrimaryPanelState( findPanel() ) !== null,
	callback: async () => {
		const state = readPrimaryPanelState( findPanel() );
		if ( ! state ) {
			throw new Error(
				'The primary fixture panel is no longer available in this document.'
			);
		}
		return state;
	},
};

const status = document.querySelector(
	'[data-webmcp-provider-registration-status]'
);

function setStatus( message ) {
	if ( status ) {
		status.textContent = message;
	}
}

function registerPanelStateAbility() {
	if ( getAbility( ABILITY_NAME ) ) {
		setStatus( 'Registered' );
		return;
	}
	registerAbility( definition );
	setStatus( 'Registered' );
}

document
	.querySelector( '[data-webmcp-provider-remove-read]' )
	?.addEventListener( 'click', () => {
		unregisterAbility( ABILITY_NAME );
		setStatus( 'Removed' );
	} );

document
	.querySelector( '[data-webmcp-provider-restore-read]' )
	?.addEventListener( 'click', () => {
		registerPanelStateAbility();
	} );

registerPanelStateAbility();
