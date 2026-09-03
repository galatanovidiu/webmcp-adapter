/** Registers the fixture provider's own client Ability category. */

import { registerAbilityCategory } from '@wordpress/abilities';

registerAbilityCategory( 'webmcp-provider-fixture', {
	label: 'WebMCP Provider Fixture',
	description:
		'Disposable page-scoped client Abilities used to verify third-party extension behavior.',
} );
