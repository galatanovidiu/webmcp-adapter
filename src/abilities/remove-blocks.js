/**
 * Frontend ability: remove blocks from the open editor by clientId.
 *
 * A client-side WRITE ability. Given clientId(s) from read-blocks or an insert
 * result, it deletes those blocks from the OPEN editor — remove an unwanted section
 * a pattern brought in, clean up a mis-built block, or clear pre-existing default
 * content (a stray "Hello world" paragraph) before building. Applies live and
 * unsaved.
 *
 * Risk `reversible`: like every editor mutation here it is an unsaved,
 * Ctrl+Z-undoable change; nothing is deleted from the database. It does not save.
 *
 * removeBlocks fails SILENTLY when removal is refused (a locked block, templateLock,
 * or a block-removal-prompt rule that diverts into a dialog), so the callback
 * re-reads each id after dispatch and reports what actually happened — same idiom
 * as insert-blocks' post-dispatch re-read.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/remove-blocks',
	category: 'webmcp',
	label: 'Remove blocks',
	description:
		'Remove one or more blocks from the content open in the WordPress block editor, by clientId (from read-blocks or an insert result). Use it to delete an unwanted section or clear pre-existing content before building. Reports blockedClientIds when removal is refused (locked block or templateLock). Applies live and unsaved (Ctrl+Z undoes it); does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			clientId: {
				type: 'string',
				description: 'The block to remove. Use this or clientIds.',
			},
			clientIds: {
				type: 'array',
				items: { type: 'string' },
				description: 'Remove several blocks.',
			},
			selectPrevious: {
				type: 'boolean',
				description:
					'Default true. Select the previous block after removal.',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
		webmcp: { risk: 'reversible' },
	},
	callback: async ( { clientId, clientIds, selectPrevious } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { removed: false, reason: NOT_IN_EDITOR };
		}

		const ids = Array.isArray( clientIds )
			? clientIds
			: clientId
			? [ clientId ]
			: [];
		if ( ids.length === 0 ) {
			return { removed: false, reason: 'Provide clientId or clientIds.' };
		}

		// Fail atomically on a bad id, so a typo is never reported as "removed".
		const unknown = ids.filter(
			( id ) => ! ctx.blockEditor.getBlock( id )
		);
		if ( unknown.length ) {
			return {
				removed: false,
				reason: 'Unknown clientId(s): ' + unknown.join( ', ' ),
			};
		}

		await ctx.data
			.dispatch( 'core/block-editor' )
			.removeBlocks( ids, selectPrevious ?? true );

		// removeBlocks refuses SILENTLY (locked block, templateLock, or a removal
		// prompt diverted the dispatch). Re-read each id to report the truth.
		const blocked = ids.filter( ( id ) => ctx.blockEditor.getBlock( id ) );
		if ( blocked.length ) {
			return {
				removed: false,
				removedClientIds: ids.filter(
					( id ) => ! blocked.includes( id )
				),
				blockedClientIds: blocked,
				reason: 'Removal was refused for some blocks (locked block or templateLock).',
			};
		}

		return { removed: true, clientIds: ids };
	},
} );
