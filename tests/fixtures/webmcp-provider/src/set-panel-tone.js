/** Registers the reversible Ability shared by exactly two fixture pages. */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-provider-fixture/category';
import {
	ALLOWED_TONES,
	applyPanelTone,
	findPanel,
	readPanelState,
} from 'webmcp-provider-fixture/panel-state';

const TONE_SCHEMA = {
	type: 'string',
	enum: ALLOWED_TONES,
};

registerAbility( {
	name: 'webmcp-provider-fixture/set-panel-tone',
	category: 'webmcp-provider-fixture',
	label: 'Set Panel Tone',
	description:
		'Set the visible fixture panel tone to exactly `calm` or `focus` on either fixture page. This changes only the current page, does not persist the panel state, and is reversible by calling this Ability again with the returned `previousTone`. A result with `applied: true` and `tone` matching the request is the success signal, and an unavailable live panel is refused without mutation.',
	input_schema: {
		type: 'object',
		properties: {
			tone: {
				...TONE_SCHEMA,
				description:
					"Visible panel tone; use exactly `calm` or `focus`. Pass the prior result's `previousTone` to reverse a change.",
			},
		},
		required: [ 'tone' ],
		additionalProperties: false,
	},
	output_schema: {
		type: 'object',
		properties: {
			applied: { type: 'boolean' },
			changed: { type: 'boolean' },
			page: {
				type: [ 'string', 'null' ],
				enum: [ 'primary', 'secondary', null ],
			},
			previousTone: {
				type: [ 'string', 'null' ],
				enum: [ ...ALLOWED_TONES, null ],
			},
			tone: {
				type: [ 'string', 'null' ],
				enum: [ ...ALLOWED_TONES, null ],
			},
			reason: { type: [ 'string', 'null' ] },
		},
		required: [
			'applied',
			'changed',
			'page',
			'previousTone',
			'tone',
			'reason',
		],
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: true,
		},
		webmcp: {
			provider: 'WebMCP Provider Fixture',
			risk: 'reversible',
		},
	},
	permissionCallback: async () => readPanelState( findPanel() ).available,
	callback: async ( params = {} ) =>
		applyPanelTone( findPanel(), params?.tone ),
} );
