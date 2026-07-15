/**
 * Frontend ability: insert a designed block pattern into the open editor.
 *
 * A client-side WRITE ability — the beauty accelerator. Given a pattern name from
 * list-patterns, it drops that full theme-designed section into the OPEN editor in
 * one call, live and unsaved. It returns the inserted top-level clientIds so the
 * agent can then retext/recolor with update-block-attributes.
 *
 * The pattern markup is human-authored and pre-validated, so this is the ONLY place
 * wp.blocks.parse runs — never on agent-written HTML — so the invalid-block risk
 * does not apply. Uses resolveSelect('core').getBlockPatterns() (the same resolver
 * list-patterns warms).
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive (one
 * reversible unsaved insert). Does NOT save the post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/insert-pattern',
	category: 'webmcp',
	label: 'Insert pattern',
	description:
		'Insert a designed block pattern (a full, theme-styled section) into the post open in the WordPress block editor, live and unsaved. Pass a pattern `name` from list-patterns (e.g. "twentytwentyfive/banner-hero"). Position with rootClientId (default top level) and index (default append; 0 to prepend). Returns the inserted top-level clientIds — read-blocks that subtree to get inner clientIds, then tune with update-block-attributes. Does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'A pattern name from list-patterns.',
			},
			rootClientId: {
				type: 'string',
				description: 'Insert inside this block. Omit for the top level.',
			},
			index: {
				type: 'integer',
				minimum: 0,
				description: 'Position in the target list. Omit to append; 0 to prepend.',
			},
		},
		required: [ 'name' ],
		additionalProperties: false,
	},
	meta: { annotations: { readonly: false, clientRegistered: true } },
	callback: async ( { name, rootClientId, index } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inserted: false, reason: NOT_IN_EDITOR };
		}
		if ( ! name ) {
			return { inserted: false, reason: 'Provide a pattern name.' };
		}

		let patterns;
		try {
			patterns = await ctx.data.resolveSelect( 'core' ).getBlockPatterns();
		} catch {
			return { inserted: false, reason: 'Could not load patterns.' };
		}

		const pattern = ( patterns ?? [] ).find( ( entry ) => entry.name === name );
		if ( ! pattern ) {
			return { inserted: false, reason: 'Pattern not found: ' + name };
		}

		// parse() only ever runs here, on trusted human-authored pattern markup.
		const parsed = ctx.blocks.parse( pattern.content );
		if ( ! parsed.length ) {
			return { inserted: false, reason: 'Pattern parsed to no blocks.' };
		}

		const root = rootClientId || '';
		const at = index != null ? index : ctx.blockEditor.getBlockCount( root );
		await ctx.data
			.dispatch( 'core/block-editor' )
			.insertBlocks( parsed, at, root, false );

		if ( ! ctx.blockEditor.getBlock( parsed[ 0 ].clientId ) ) {
			return {
				inserted: false,
				reason:
					'The target rejected the pattern (allowedBlocks or templateLock).',
			};
		}

		return { inserted: true, clientIds: parsed.map( ( block ) => block.clientId ) };
	},
} );
