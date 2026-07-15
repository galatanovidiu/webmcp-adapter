/**
 * Frontend ability: update a block's attributes in the open editor.
 *
 * A client-side WRITE ability — precise edits and pattern tuning. Given a clientId
 * (from read-blocks or an insert result), it merges an attributes patch into that
 * block: recolor, restyle, retext, set align/fontSize/spacing, or populate media
 * (pass an image's {url, id, alt, sizeSlug}). Applies live and unsaved.
 *
 * CRITICAL: dispatch('core/block-editor').updateBlockAttributes SHALLOW-merges
 * top-level keys, so a naive {style:{spacing:...}} patch would CLOBBER an existing
 * style.color and silently de-style a block/pattern. This ability reads the current
 * attributes and DEEP-merges nested objects itself before dispatching.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive. Does NOT
 * save the post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

const isPlainObject = ( value ) =>
	value != null && typeof value === 'object' && ! Array.isArray( value );

// Deep-merge patch into base: recurse into nested plain objects, overwrite
// scalars and arrays. Enough to protect the nested `style` object; no lodash.
const deepMerge = ( base, patch ) => {
	const out = { ...base };
	for ( const key of Object.keys( patch ) ) {
		out[ key ] =
			isPlainObject( base[ key ] ) && isPlainObject( patch[ key ] )
				? deepMerge( base[ key ], patch[ key ] )
				: patch[ key ];
	}
	return out;
};

registerAbility( {
	name: 'webmcp/update-block-attributes',
	category: 'webmcp',
	label: 'Update block attributes',
	description:
		'Update the attributes of one or more existing blocks in the open WordPress block editor, by clientId (from read-blocks or an insert result). Pass a partial `attributes` object in the native Gutenberg shape; it is DEEP-merged into the block’s current attributes, so a nested style patch preserves existing style keys. Use it to recolor, restyle, retext, set align/fontSize/spacing, or populate an image/cover with {url, id, alt, sizeSlug}. Applies live and unsaved; does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			clientId: {
				type: 'string',
				description: 'The block to update. Use this or clientIds.',
			},
			clientIds: {
				type: 'array',
				items: { type: 'string' },
				description: 'Apply the same patch to several blocks.',
			},
			attributes: {
				type: 'object',
				description:
					'Partial native attributes to deep-merge into the block(s).',
			},
		},
		required: [ 'attributes' ],
		additionalProperties: false,
	},
	meta: { annotations: { readonly: false, clientRegistered: true } },
	callback: async ( { clientId, clientIds, attributes } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { updated: false, reason: NOT_IN_EDITOR };
		}

		const ids = Array.isArray( clientIds )
			? clientIds
			: clientId
			? [ clientId ]
			: [];
		if ( ids.length === 0 ) {
			return { updated: false, reason: 'Provide clientId or clientIds.' };
		}
		if ( ! isPlainObject( attributes ) ) {
			return { updated: false, reason: 'Provide an attributes object.' };
		}

		for ( const id of ids ) {
			const current = ctx.blockEditor.getBlock( id )?.attributes;
			if ( ! current ) {
				return { updated: false, reason: 'Unknown clientId: ' + id };
			}
			ctx.data
				.dispatch( 'core/block-editor' )
				.updateBlockAttributes( id, deepMerge( current, attributes ) );
		}

		return { updated: true, clientIds: ids };
	},
} );
