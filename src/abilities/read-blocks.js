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
 * screen. rootClientId / maxDepth / includeAttributes cap token cost on big trees;
 * `names` skips the tree entirely and returns a flat match list (targeting mode);
 * `attributeKeys` projects only the attributes the task needs. A block that failed
 * markup validation carries isValid:false (emitted only when false) — the agent's
 * only signal that a pattern/import produced a broken block.
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
		'Read the live (unsaved) block tree of the content open in the WordPress block editor (Gutenberg) in this tab — post editor or Site Editor. Returns each block as {clientId, name, attributes, innerBlocks}; rich-text attributes (content, citation, …) are HTML strings. Use the clientIds to target update-block-attributes, remove-blocks, move-blocks, replace-blocks, and insert-blocks. To FIND blocks instead of walking the tree, pass `names` (e.g. ["core/heading"]): returns a flat `matches` list with each block’s rootClientId and index, nested blocks included. Pass rootClientId to read one subtree, maxDepth to cap depth, includeAttributes:false for a cheap structural map, or attributeKeys to project only some attributes. A block that failed markup validation carries isValid:false. Returns inEditor:false when the tab is not on a block-editor screen.',
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
			names: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Targeting mode: return a flat `matches` list of every block of these type(s) (e.g. ["core/heading", "core/button"]), wherever it nests, instead of the tree.',
			},
			attributeKeys: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Return only these top-level attribute keys (e.g. ["content", "level"]). Cuts token cost on text sweeps.',
			},
		},
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
	callback: async ( {
		rootClientId,
		maxDepth,
		includeAttributes,
		names,
		attributeKeys,
	} = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inEditor: false, reason: NOT_IN_EDITOR };
		}

		const project = ( attributes ) =>
			Array.isArray( attributeKeys )
				? Object.fromEntries(
						attributeKeys
							.filter( ( key ) => key in attributes )
							.map( ( key ) => [ key, attributes[ key ] ] )
				  )
				: attributes;

		// Emitted only when false: insert-blocks output is valid by construction,
		// so a flag on every block would be noise.
		const validity = ( id ) =>
			ctx.blockEditor.isBlockValid?.( id ) === false
				? { isValid: false }
				: {};

		// Targeting mode: getBlocksByName walks every descendant, so nested hits
		// are included without the agent reading the whole tree.
		if ( Array.isArray( names ) && names.length ) {
			const matches = ctx.blockEditor
				.getBlocksByName( names )
				.map( ( id ) => {
					const block = ctx.blockEditor.getBlock( id );
					return {
						clientId: id,
						name: block.name,
						rootClientId:
							ctx.blockEditor.getBlockRootClientId( id ) || '',
						index: ctx.blockEditor.getBlockIndex( id ),
						...( includeAttributes !== false
							? { attributes: project( block.attributes ) }
							: {} ),
						...validity( id ),
					};
				} );
			return { inEditor: true, matches };
		}

		const map = ( block, depth ) => ( {
			clientId: block.clientId,
			name: block.name,
			...( includeAttributes !== false
				? { attributes: project( block.attributes ) }
				: {} ),
			...validity( block.clientId ),
			innerBlocks:
				maxDepth != null && depth >= maxDepth
					? []
					: block.innerBlocks.map( ( child ) =>
							map( child, depth + 1 )
					  ),
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
