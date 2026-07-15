/**
 * Frontend ability: build and insert blocks into the open editor.
 *
 * A client-side WRITE ability — THE universal author (it replaces insert-paragraph).
 * From a recursive structured spec ({name, attributes, innerBlocks}) it builds a
 * whole nested section or a single block with wp.blocks.createBlock and inserts it
 * into the OPEN editor at a chosen position, live and unsaved. Blocks are valid by
 * construction (no hand-written markup), so the invalid-block recovery UI never
 * appears. It returns the FULL created clientId tree so the agent can then target
 * any inner block with update-block-attributes / remove-blocks.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive (an
 * unsaved, undo-able editor edit). Does NOT save the post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/insert-blocks',
	category: 'webmcp',
	label: 'Insert blocks',
	description:
		'Build and insert one or more blocks into the post open in the WordPress block editor (Gutenberg), live and unsaved. Provide `blocks`: an array of nodes, each {name, attributes?, innerBlocks?}, where innerBlocks is an array of the same node shape (recursive) — so one call can build a whole nested section (e.g. cover > heading + paragraph + buttons > button). Attributes use the native Gutenberg shape: top-level preset attrs (backgroundColor, textColor, gradient, fontSize, align, anchor, layout, content, level, text) plus a nested `style` object (style.spacing.padding, style.color, style.typography, style.border). Use list-block-types for the valid attribute keys and get-theme-design-tokens for on-brand slugs. Position with rootClientId (default top level) and index (default append; 0 to prepend). Returns the created clientId tree. Tips the schema can’t enforce: a solid-color cover needs dimRatio:100 (50 looks washed out); a core/quote body is innerBlocks paragraphs + a citation attribute, NOT the deprecated `value`; on a colored band set a contrasting textColor. Does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			blocks: {
				type: 'array',
				minItems: 1,
				description:
					'Block nodes to insert. Each node: {name, attributes?, innerBlocks?}; innerBlocks items are the same node shape (recursive).',
				items: {
					type: 'object',
					properties: {
						name: {
							type: 'string',
							description: 'Block name, e.g. "core/group".',
						},
						attributes: {
							type: 'object',
							description: 'Native Gutenberg attributes for this block.',
						},
						innerBlocks: {
							type: 'array',
							description: 'Child nodes (same {name, attributes, innerBlocks} shape).',
						},
					},
					required: [ 'name' ],
				},
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
		required: [ 'blocks' ],
		additionalProperties: false,
	},
	// readonly omitted (a write) → hidden unless webmcp_enable_write_tools is on.
	meta: { annotations: { readonly: false, clientRegistered: true } },
	callback: async ( { blocks, rootClientId, index } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inserted: false, reason: NOT_IN_EDITOR };
		}
		if ( ! Array.isArray( blocks ) || blocks.length === 0 ) {
			return { inserted: false, reason: 'Provide a non-empty blocks array.' };
		}

		// Validate every block name up front so a typo fails clearly instead of
		// inserting a broken block.
		const unknown = [];
		const collect = ( nodes ) => {
			for ( const node of nodes ) {
				if ( ! ctx.blocks.getBlockType( node?.name ) ) {
					unknown.push( node?.name );
				}
				if ( Array.isArray( node?.innerBlocks ) ) {
					collect( node.innerBlocks );
				}
			}
		};
		collect( blocks );
		if ( unknown.length ) {
			return { inserted: false, unknownBlocks: [ ...new Set( unknown ) ] };
		}

		// Build recursively; createBlock mints a clientId per block. Snapshot the
		// tree BEFORE dispatch (dispatch returns nothing useful).
		const build = ( node ) =>
			ctx.blocks.createBlock(
				node.name,
				node.attributes ?? {},
				( node.innerBlocks ?? [] ).map( build )
			);
		const built = blocks.map( build );
		const snapshot = ( block ) => ( {
			clientId: block.clientId,
			name: block.name,
			innerBlocks: block.innerBlocks.map( snapshot ),
		} );
		const tree = built.map( snapshot );

		const root = rootClientId || '';
		const at = index != null ? index : ctx.blockEditor.getBlockCount( root );
		// updateSelection:false — do not steal focus during scripted composition.
		await ctx.data
			.dispatch( 'core/block-editor' )
			.insertBlocks( built, at, root, false );

		// insertBlocks fails SILENTLY on allowedBlocks/parent/ancestor/templateLock.
		// Re-read to confirm the first block actually landed.
		if ( ! ctx.blockEditor.getBlock( built[ 0 ].clientId ) ) {
			return {
				inserted: false,
				reason:
					'The target rejected the blocks (allowedBlocks or templateLock).',
			};
		}

		return { inserted: true, tree };
	},
} );
