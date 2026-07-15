/**
 * Frontend ability: discover the block types available in the editor.
 *
 * A read-only client-side ability — the discoverability engine that replaces one
 * tool-per-block. It surfaces each block's attribute contract (the createBlock
 * input for insert-blocks) and its `supports` (which uniform design features —
 * color, spacing, typography, align — apply). By default it returns only the
 * ~14 layout "backbone" blocks to keep the payload small; pass full:true for all,
 * a category filter, or name for one block's full schema.
 *
 * readonly:true → always exposed. IMPORTANT for the agent: attribute keys NOT
 * declared in a block's `attributes` are silently dropped on serialize, so build
 * insert-blocks specs only from keys listed here. Some blocks also list a
 * DEPRECATED attribute (e.g. core/quote's `value`); prefer the modern innerBlocks
 * model.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';

// The layout blocks that build beautiful pages. Default view: the agent rarely
// needs all 109 registered types, so keep the discovery payload small.
const BACKBONE = new Set( [
	'core/cover',
	'core/group',
	'core/columns',
	'core/column',
	'core/media-text',
	'core/buttons',
	'core/button',
	'core/heading',
	'core/paragraph',
	'core/image',
	'core/spacer',
	'core/separator',
	'core/quote',
	'core/list',
] );

registerAbility( {
	name: 'webmcp/list-block-types',
	category: 'webmcp',
	label: 'List block types',
	description:
		'List WordPress block types with their attribute contract and design supports, so you can build valid insert-blocks specs. Each entry is {name, title, category, attributes, supports}: `attributes` are the only keys that round-trip (others are dropped on save); `supports` tells which design features (color, spacing, typography, align, anchor) the block accepts. Default returns the ~14 layout backbone blocks; pass name for one block’s full schema, category to filter, or full:true for all registered types. Note: some blocks list a deprecated attribute (e.g. core/quote `value`) — prefer the innerBlocks model.',
	input_schema: {
		type: 'object',
		properties: {
			name: {
				type: 'string',
				description: 'Return the full schema for this one block type.',
			},
			names: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Return full schemas for several block types in one call. Missing ones come back in a `notFound` list.',
			},
			category: {
				type: 'string',
				description:
					'Filter by category: text, media, design, widgets, embed, theme.',
			},
			full: {
				type: 'boolean',
				description:
					'Default false (backbone blocks only). true returns all registered types.',
			},
		},
		additionalProperties: false,
	},
	meta: { annotations: { readonly: true, clientRegistered: true } },
	callback: async ( { name, names, category, full } = {} ) => {
		const blocks = window.wp?.blocks;
		if ( ! blocks?.getBlockTypes ) {
			return { available: false, reason: 'The block editor is not loaded.' };
		}

		const shape = ( block ) => ( {
			name: block.name,
			title: block.title,
			category: block.category,
			attributes: block.attributes ?? {},
			supports: block.supports ?? {},
		} );

		if ( name ) {
			const blockType = blocks.getBlockType( name );
			return blockType
				? shape( blockType )
				: { found: false, reason: 'Unknown block type: ' + name };
		}

		if ( names ) {
			const blockTypes = [];
			const notFound = [];
			for ( const n of names ) {
				const blockType = blocks.getBlockType( n );
				if ( blockType ) {
					blockTypes.push( shape( blockType ) );
				} else {
					notFound.push( n );
				}
			}
			return notFound.length ? { blockTypes, notFound } : { blockTypes };
		}

		let types = blocks.getBlockTypes();
		if ( category ) {
			types = types.filter( ( block ) => block.category === category );
		} else if ( ! full ) {
			types = types.filter( ( block ) => BACKBONE.has( block.name ) );
		}

		return { blockTypes: types.map( shape ) };
	},
} );
