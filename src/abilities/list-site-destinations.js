/**
 * Frontend Ability provider shell for rendered public navigation discovery.
 */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-adapter/category';

registerAbility( {
	name: 'webmcp/list-site-destinations',
	category: 'webmcp',
	label: 'List Site Destinations',
	description:
		'Return public navigation destinations rendered on the current frontend page. Destination extraction is not available in this provider batch, so the list is currently empty.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
	},
	callback: async () => ( { destinations: [] } ),
} );
