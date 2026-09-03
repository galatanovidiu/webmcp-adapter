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
 * Risk `reversible`: this is an unsaved, undoable editor edit. It does not save the
 * post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import {
	getEditor,
	NOT_IN_EDITOR,
	findUnknownBlockNames,
	buildBlocks,
	snapshotTree,
} from './store.js';

registerAbility( {
	name: 'webmcp/insert-blocks',
	category: 'webmcp',
	label: 'Insert blocks',
	description:
		'Build and insert one or more blocks into the content open in the WordPress block editor (Gutenberg) — post editor or Site Editor — live and unsaved. Provide `blocks`: an array of nodes, each {name, attributes?, innerBlocks?}, where innerBlocks is an array of the same node shape (recursive) — so one call can build a whole nested section (e.g. cover > heading + paragraph + buttons > button). Attributes use the native Gutenberg shape: top-level preset attrs (backgroundColor, textColor, gradient, fontSize, align, anchor, layout, content, level, text) plus a nested `style` object (style.spacing.padding, style.color, style.typography, style.border). Use list-block-types for the valid attribute keys and get-theme-design-tokens for on-brand slugs. Position with rootClientId (default top level) and index (default append; 0 to prepend). Returns the created clientId tree. Tips the schema can’t enforce: a solid-color cover needs dimRatio:100 (50 looks washed out); a core/quote body is innerBlocks paragraphs + a citation attribute, NOT the deprecated `value`; on a colored band set a contrasting textColor. Media wiring: a core/image needs BOTH {id, url} (plus alt, sizeSlug) — url alone silently loses srcset and the media-library link; a core/cover image background is {url, id, backgroundType:"image", dimRatio} (it also supports useFeaturedImage:true); a gallery is core/gallery with core/image innerBlocks (its top-level ids/images attrs are legacy — do not set them). To duplicate an existing block, read-blocks its subtree and insert that same spec (first check supports.multiple in list-block-types). Does not save the post.',
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
							description:
								'Native Gutenberg attributes for this block.',
						},
						innerBlocks: {
							type: 'array',
							description:
								'Child nodes (same {name, attributes, innerBlocks} shape).',
						},
					},
					required: [ 'name' ],
				},
			},
			rootClientId: {
				type: 'string',
				description:
					'Insert inside this block. Omit for the top level.',
			},
			index: {
				type: 'integer',
				minimum: 0,
				description:
					'Position in the target list. Omit to append; 0 to prepend.',
			},
		},
		required: [ 'blocks' ],
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: false,
			clientRegistered: true,
		},
		webmcp: { risk: 'reversible' },
	},
	callback: async ( { blocks, rootClientId, index } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inserted: false, reason: NOT_IN_EDITOR };
		}
		if ( ! Array.isArray( blocks ) || blocks.length === 0 ) {
			return {
				inserted: false,
				reason: 'Provide a non-empty blocks array.',
			};
		}

		// Validate every block name up front so a typo fails clearly instead of
		// inserting a broken block.
		const unknown = findUnknownBlockNames( blocks, ctx.blocks );
		if ( unknown.length ) {
			return { inserted: false, unknownBlocks: unknown };
		}

		const built = buildBlocks( blocks, ctx.blocks );
		const tree = snapshotTree( built );

		const root = rootClientId || '';
		const at =
			index != null ? index : ctx.blockEditor.getBlockCount( root );
		// updateSelection:false — do not steal focus during scripted composition.
		await ctx.data
			.dispatch( 'core/block-editor' )
			.insertBlocks( built, at, root, false );

		// insertBlocks fails SILENTLY on allowedBlocks/parent/ancestor/templateLock.
		// Re-read to confirm the first block actually landed.
		if ( ! ctx.blockEditor.getBlock( built[ 0 ].clientId ) ) {
			return {
				inserted: false,
				reason: 'The target rejected the blocks (allowedBlocks or templateLock).',
			};
		}

		return { inserted: true, tree };
	},
} );
