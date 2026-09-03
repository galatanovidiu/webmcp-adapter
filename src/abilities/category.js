/**
 * Registers the `webmcp` ability category.
 *
 * registerAbility rejects an ability whose category is not already registered, so
 * this side-effect module must be imported before any provider Ability module.
 * Every first-party frontend Ability here shares this one category.
 *
 * @package WebmcpAdapter
 */

import { registerAbilityCategory } from '@wordpress/abilities';

registerAbilityCategory( 'webmcp', {
	label: 'WebMCP',
	description:
		'Frontend WordPress Site tools for ChatGPT Work and Codex in the ChatGPT desktop app built-in browser.',
} );
