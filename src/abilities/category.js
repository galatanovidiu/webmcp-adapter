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
	description:
		'Frontend WordPress Site tools for ChatGPT Work and Codex in the ChatGPT desktop app built-in browser.',
} );
