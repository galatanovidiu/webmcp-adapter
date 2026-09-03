/**
 * Frontend ability: move blocks to a new position in the open editor.
 *
 * A client-side WRITE ability — restructuring without destroy-and-recreate.
 * `moveBlocksToPosition` reorders or reparents blocks PRESERVING their clientIds
 * and inner state, where a remove+insert would re-mint every clientId and cost two
 * undo steps.
 *
 * GOTCHA this file exists to guard: moveBlocksToPosition no-ops SILENTLY when any
 * of canMoveBlocks / canRemoveBlocks / canInsertBlocks refuses (lock, templateLock,
 * or the destination does not allow these block types). The callback re-reads the
 * block's parent and index after dispatch and reports the real outcome — same
 * silent-failure class the insert abilities already guard.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive. Does NOT
 * save the post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/move-blocks',
	category: 'webmcp',
	label: 'Move blocks',
	description:
		'Move one or more blocks to a new position in the content open in the WordPress block editor — reorder within a parent or reparent into another block — preserving their clientIds and inner state. The blocks must be siblings (same current parent). Target with toRootClientId (a container’s clientId; omit or "" = top level) and index (omit = append). Use it to restructure ("move testimonials above pricing") instead of remove+insert. Reports moved:false with a reason when the move is refused (lock, templateLock, or the destination does not allow these block types). Applies live and unsaved; does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			clientId: {
				type: 'string',
				description: 'The block to move. Use this or clientIds.',
			},
			clientIds: {
				type: 'array',
				items: { type: 'string' },
				description: 'Move several sibling blocks together.',
			},
			toRootClientId: {
				type: 'string',
				description:
					'Destination parent clientId. Omit or "" for the top level.',
			},
			index: {
				type: 'integer',
				minimum: 0,
				description:
					'Position in the destination. Omit to append; 0 to prepend.',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: { readonly: false, clientRegistered: true },
		webmcp: { risk: 'reversible' },
	},
	callback: async ( { clientId, clientIds, toRootClientId, index } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { moved: false, reason: NOT_IN_EDITOR };
		}

		const ids = Array.isArray( clientIds )
			? clientIds
			: clientId
			? [ clientId ]
			: [];
		if ( ids.length === 0 ) {
			return { moved: false, reason: 'Provide clientId or clientIds.' };
		}

		const unknown = ids.filter(
			( id ) => ! ctx.blockEditor.getBlock( id )
		);
		if ( unknown.length ) {
			return {
				moved: false,
				reason: 'Unknown clientId(s): ' + unknown.join( ', ' ),
			};
		}

		// moveBlocksToPosition moves the batch from ONE source parent; mixed
		// parents would silently misbehave, so require siblings up front.
		const from = ctx.blockEditor.getBlockRootClientId( ids[ 0 ] ) || '';
		const strays = ids.filter(
			( id ) =>
				( ctx.blockEditor.getBlockRootClientId( id ) || '' ) !== from
		);
		if ( strays.length ) {
			return {
				moved: false,
				reason:
					'clientIds must be siblings (same parent). Different parent: ' +
					strays.join( ', ' ),
			};
		}

		const to = toRootClientId || '';
		if ( to && ! ctx.blockEditor.getBlock( to ) ) {
			return {
				moved: false,
				reason: 'Unknown toRootClientId: ' + to,
			};
		}

		// Append index: within the same parent the blocks are removed before
		// re-insert, so the end of the list is count minus the batch.
		const at =
			index != null
				? index
				: ctx.blockEditor.getBlockCount( to ) -
				  ( to === from ? ids.length : 0 );
		const origIndex = ctx.blockEditor.getBlockIndex( ids[ 0 ] );

		await ctx.data
			.dispatch( 'core/block-editor' )
			.moveBlocksToPosition( ids, from, to, at );

		// The dispatch no-ops SILENTLY when refused — re-read to report the truth.
		// Same-parent: refused means the index did not change AND differs from the
		// request (an out-of-range index that core clamped still counts as moved).
		const newRoot = ctx.blockEditor.getBlockRootClientId( ids[ 0 ] ) || '';
		const newIndex = ctx.blockEditor.getBlockIndex( ids[ 0 ] );
		const moved =
			newRoot === to &&
			( from !== to || newIndex !== origIndex || newIndex === at );
		return moved
			? { moved: true, clientIds: ids, rootClientId: to, index: newIndex }
			: {
					moved: false,
					reason: 'The move was refused (lock, templateLock, or the destination does not allow these block types).',
			  };
	},
} );
