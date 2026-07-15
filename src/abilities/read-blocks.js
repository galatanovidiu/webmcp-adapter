/**
 * Frontend ability: read the block tree from the open block editor.
 *
 * A read-only client-side ability — the agent's eyes on the OPEN editor and the
 * source of the clientIds every write ability targets. Returns the LIVE (unsaved)
 * block tree as {clientId, name, attributes, innerBlocks}. This is the live
 * core/block-editor state, distinct from the server ability that reads the
 * last-saved database copy.
 *
 * readonly:true → always exposed. Returns {inEditor:false} off a block-editor
 * screen. rootClientId / maxDepth / includeAttributes cap token cost on big trees.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/read-blocks',
	category: 'webmcp',
	label: 'Read blocks',
	description:
		'Read the live (unsaved) block tree of the post open in the WordPress block editor (Gutenberg) in this tab. Returns each block as {clientId, name, attributes, innerBlocks}. Use the clientIds to target update-block-attributes, remove-blocks, and insert-blocks. Pass rootClientId to read one subtree, maxDepth to cap depth, or includeAttributes:false for a cheap structural map. Returns inEditor:false when the tab is not on a block-editor screen.',
	input_schema: {
		type: 'object',
		properties: {
			rootClientId: {
				type: 'string',
				description:
					'Read only this block’s subtree. Omit to read the whole top level.',
			},
			maxDepth: {
				type: 'integer',
				minimum: 0,
				description: 'Cap nesting depth returned (omit for unbounded).',
			},
			includeAttributes: {
				type: 'boolean',
				description:
					'Default true. false returns only clientId+name+innerBlocks (cheap).',
			},
		},
		additionalProperties: false,
	},
	meta: { annotations: { readonly: true, clientRegistered: true } },
	callback: async ( { rootClientId, maxDepth, includeAttributes } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inEditor: false, reason: NOT_IN_EDITOR };
		}

		const map = ( block, depth ) => ( {
			clientId: block.clientId,
			name: block.name,
			...( includeAttributes !== false
				? { attributes: block.attributes }
				: {} ),
			innerBlocks:
				maxDepth != null && depth >= maxDepth
					? []
					: block.innerBlocks.map( ( child ) => map( child, depth + 1 ) ),
		} );

		// Curried selector: getBlocks(rootClientId), not getBlocks(state, ...).
		// getBlocks(undefined) returns the top level.
		return {
			inEditor: true,
			blocks: ctx.blockEditor
				.getBlocks( rootClientId )
				.map( ( block ) => map( block, 0 ) ),
		};
	},
} );
