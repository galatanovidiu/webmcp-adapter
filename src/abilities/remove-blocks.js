/**
 * Frontend ability: remove blocks from the open editor by clientId.
 *
 * A client-side WRITE ability. Given clientId(s) from read-blocks or an insert
 * result, it deletes those blocks from the OPEN editor — remove an unwanted section
 * a pattern brought in, clean up a mis-built block, or clear pre-existing default
 * content (a stray "Hello world" paragraph) before building. Applies live and
 * unsaved.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. NOT destructive-tier: like
 * every edit here it is an unsaved, Ctrl+Z-undo-able editor change, nothing is
 * deleted from the database. (Upgrade path: set meta.annotations.destructive:true
 * to route it through the confirmation modal if a site wants confirm-on-delete.)
 * Does NOT save the post.
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
		'Remove one or more blocks from the post open in the WordPress block editor, by clientId (from read-blocks or an insert result). Use it to delete an unwanted section or clear pre-existing content before building. Applies live and unsaved (Ctrl+Z undoes it); does not save the post.',
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
	meta: { annotations: { readonly: false, clientRegistered: true } },
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

		await ctx.data
			.dispatch( 'core/block-editor' )
			.removeBlocks( ids, selectPrevious ?? true );

		return { removed: true, clientIds: ids };
	},
} );
