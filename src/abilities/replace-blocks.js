/**
 * Frontend ability: replace or transform blocks in the open editor.
 *
 * A client-side WRITE ability with three modes over one dispatch
 * (`replaceBlocks`), each an atomic single-undo swap at the same position:
 *
 * - `blocks`   — literal replacement from the same recursive spec insert-blocks
 *                uses;
 * - `transformTo` — convert via the block library's REGISTERED transforms
 *                (wp.blocks.switchToBlockType): heading↔paragraph,
 *                paragraphs→list, anything→core/group (grouping). This is the one
 *                generic entry to per-block transform semantics — reproducing it
 *                from remove+insert would need per-block knowledge;
 * - `ungroup`  — dissolve a wrapper into its children (core's Ungroup action).
 *
 * Silent-failure guards: switchToBlockType returns null SILENTLY when no
 * transform exists (the callback returns the possible targets instead), and
 * replaceBlocks no-ops SILENTLY when the parent refuses a replacement block
 * (canInsertBlockType) — the callback re-reads after dispatch, same idiom as
 * insert-blocks.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive. Does
 * NOT save the post.
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
	name: 'webmcp/replace-blocks',
	category: 'webmcp',
	label: 'Replace blocks',
	description:
		'Replace or transform blocks in the content open in the WordPress block editor, by clientId, atomically (one undo step, same position). Exactly one mode: `blocks` swaps in a literal spec (same recursive {name, attributes?, innerBlocks?} shape as insert-blocks); `transformTo` converts via the registered block transforms — e.g. "core/heading" from a paragraph, "core/list" from several paragraphs, "core/group" to wrap the blocks in a group — preserving content where the transform defines it (if no transform exists, the result lists possibleTransforms instead); `ungroup:true` dissolves one wrapper block into its children. Multiple clientIds must be siblings (same parent). The old clientIds are DESTROYED — use the returned tree to target follow-up edits. Applies live and unsaved; does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			clientId: {
				type: 'string',
				description: 'The block to replace. Use this or clientIds.',
			},
			clientIds: {
				type: 'array',
				items: { type: 'string' },
				description: 'Replace several sibling blocks together.',
			},
			blocks: {
				type: 'array',
				minItems: 1,
				description:
					'Literal mode: replacement nodes, each {name, attributes?, innerBlocks?} (recursive).',
				items: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						attributes: { type: 'object' },
						innerBlocks: { type: 'array' },
					},
					required: [ 'name' ],
				},
			},
			transformTo: {
				type: 'string',
				description:
					'Transform mode: target block type name (e.g. "core/heading", "core/list", "core/group" to wrap).',
			},
			ungroup: {
				type: 'boolean',
				description:
					'Ungroup mode: dissolve one wrapper block into its children (single clientId only).',
			},
		},
		additionalProperties: false,
	},
	meta: { annotations: { readonly: false, clientRegistered: true } },
	callback: async ( { clientId, clientIds, blocks, transformTo, ungroup } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { replaced: false, reason: NOT_IN_EDITOR };
		}

		const modes =
			( Array.isArray( blocks ) && blocks.length ? 1 : 0 ) +
			( transformTo ? 1 : 0 ) +
			( ungroup ? 1 : 0 );
		if ( modes !== 1 ) {
			return {
				replaced: false,
				reason: 'Provide exactly one of blocks, transformTo, or ungroup.',
			};
		}

		let ids = Array.isArray( clientIds )
			? clientIds
			: clientId
			? [ clientId ]
			: [];
		if ( ids.length === 0 ) {
			return { replaced: false, reason: 'Provide clientId or clientIds.' };
		}

		const unknown = ids.filter( ( id ) => ! ctx.blockEditor.getBlock( id ) );
		if ( unknown.length ) {
			return {
				replaced: false,
				reason: 'Unknown clientId(s): ' + unknown.join( ', ' ),
			};
		}

		// replaceBlocks and multi-block transforms operate on one sibling run;
		// mixed parents would misbehave. Enforce it, then normalize to document
		// order (transforms expect it, and callers should not have to sort).
		const root = ctx.blockEditor.getBlockRootClientId( ids[ 0 ] ) || '';
		const strays = ids.filter(
			( id ) =>
				( ctx.blockEditor.getBlockRootClientId( id ) || '' ) !== root
		);
		if ( strays.length ) {
			return {
				replaced: false,
				reason: 'clientIds must be siblings (same parent). Different parent: ' +
					strays.join( ', ' ),
			};
		}
		ids = [ ...ids ].sort(
			( a, b ) =>
				ctx.blockEditor.getBlockIndex( a ) -
				ctx.blockEditor.getBlockIndex( b )
		);

		let replacement;
		if ( ungroup ) {
			if ( ids.length !== 1 ) {
				return {
					replaced: false,
					reason: 'ungroup takes a single clientId.',
				};
			}
			const block = ctx.blockEditor.getBlock( ids[ 0 ] );
			const blockType = ctx.blocks.getBlockType( block.name );
			// Core's own gate: the grouping block or a type with an ungroup
			// transform, and it must actually have children.
			const isWrapper =
				block.name ===
					ctx.data.select( 'core/blocks' ).getGroupingBlockName() ||
				blockType?.transforms?.ungroup;
			if ( ! isWrapper || ! block.innerBlocks.length ) {
				return {
					replaced: false,
					reason: 'This block cannot be ungrouped (not a wrapper, or it has no children).',
				};
			}
			replacement = blockType?.transforms?.ungroup
				? blockType.transforms.ungroup(
						block.attributes,
						block.innerBlocks
				  )
				: block.innerBlocks;
		} else if ( transformTo ) {
			if ( ! ctx.blocks.getBlockType( transformTo ) ) {
				return {
					replaced: false,
					reason: 'Unknown block type: ' + transformTo,
				};
			}
			const targets = ctx.blockEditor.getBlocksByClientId( ids );
			// switchToBlockType returns null SILENTLY when no transform matches
			// — answer with what IS possible instead of a shrug.
			const out = ctx.blocks.switchToBlockType( targets, transformTo );
			if ( ! out || ! out.length ) {
				return {
					replaced: false,
					reason: 'No registered transform from [' +
						targets.map( ( block ) => block.name ).join( ', ' ) +
						'] to ' +
						transformTo +
						'.',
					possibleTransforms: ctx.blocks
						.getPossibleBlockTransformations( targets )
						.map( ( type ) => type.name ),
				};
			}
			replacement = out;
		} else {
			const bad = findUnknownBlockNames( blocks, ctx.blocks );
			if ( bad.length ) {
				return { replaced: false, unknownBlocks: bad };
			}
			replacement = buildBlocks( blocks, ctx.blocks );
		}

		const tree = snapshotTree( replacement );
		await ctx.data
			.dispatch( 'core/block-editor' )
			.replaceBlocks( ids, replacement );

		// replaceBlocks no-ops SILENTLY when the parent refuses any replacement
		// block (canInsertBlockType) — re-read to confirm it landed.
		if ( ! ctx.blockEditor.getBlock( replacement[ 0 ].clientId ) ) {
			return {
				replaced: false,
				reason: 'The parent rejected the replacement blocks (allowedBlocks or templateLock).',
			};
		}

		return { replaced: true, tree };
	},
} );
