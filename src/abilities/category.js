/**
 * Registers the `webmcp` ability category.
 *
 * registerAbility rejects an ability whose category is not already registered, so
 * this side-effect module must be imported before any ability file in this
 * directory (the barrel imports it first). Every frontend ability here shares this
 * one category.
 *
 * @package WebmcpAdapter
 */

import { registerAbilityCategory } from '@wordpress/abilities';

registerAbilityCategory( 'webmcp', {
	label: 'WebMCP',
	description: 'Client-side abilities that actuate the browser tab.',
} );
