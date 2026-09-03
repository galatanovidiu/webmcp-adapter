/**
 * Frontend Ability provider shell for rendered WordPress management navigation.
 */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-adapter/category';

registerAbility( {
	name: 'webmcp/list-admin-destinations',
	category: 'webmcp',
	label: 'List Admin Destinations',
	description:
		'Return WordPress management destinations rendered for the current user. Destination extraction is not available in this provider batch, so the list is currently empty.',
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
