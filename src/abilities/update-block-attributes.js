/**
 * Frontend ability: update block attributes in the open editor.
 *
 * A client-side WRITE ability — precise edits and pattern tuning. Given clientIds
 * (from read-blocks or an insert result), it merges an attributes patch into each
 * block: recolor, restyle, retext, set align/fontSize/spacing, or populate media
 * (a core/image needs BOTH {id, url} — url alone loses srcset and the library
 * link). Applies live and unsaved.
 *
 * CRITICAL: dispatch('core/block-editor').updateBlockAttributes SHALLOW-merges
 * top-level keys, so a naive {style:{spacing:...}} patch would CLOBBER an existing
 * style.color and silently de-style a block/pattern. This ability reads the current
 * attributes and DEEP-merges nested objects itself before dispatching.
 *
 * Everything lands in ONE dispatch with {uniqueByBlock:true} (a distinct attribute
 * object per clientId), so one tool call costs exactly ONE undo step — the old
 * per-id loop cost the human N Ctrl+Zs to revert one agent action.
 *
 * Deep-merge can never DELETE a key (and JSON input cannot express undefined), so
 * `unset` takes dot-paths to remove after the merge. A top-level unset dispatches
 * {key: undefined} explicitly — the reducer spreads the patch over the existing
 * attributes, so merely omitting the key would leave the old value in place.
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

// Remove one dot-path from a merged attributes copy. Top level sets an explicit
// undefined (see the header on why omission is not enough); nested levels rebuild
// the top-level object without the key, since the whole top-level key is
// re-dispatched anyway.
const unsetPath = ( attributes, path ) => {
	const parts = path.split( '.' );
	if ( parts.length === 1 ) {
		return { ...attributes, [ parts[ 0 ] ]: undefined };
	}
	const prune = ( node, [ head, ...rest ] ) => {
		if ( ! isPlainObject( node ) ) {
			return node;
		}
		const out = { ...node };
		if ( rest.length === 0 ) {
			delete out[ head ];
		} else {
			out[ head ] = prune( out[ head ], rest );
		}
		return out;
	};
	return prune( attributes, parts );
};

registerAbility( {
	name: 'webmcp/update-block-attributes',
	category: 'webmcp',
	label: 'Update block attributes',
	description:
		'Update the attributes of one or more existing blocks in the open WordPress block editor, by clientId (from read-blocks or an insert result). Pass a partial `attributes` object in the native Gutenberg shape; it is DEEP-merged into each block’s current attributes, so a nested style patch preserves existing style keys. For a DIFFERENT patch per block, pass `updates` instead: [{clientId, attributes}, …]. `unset` removes attribute keys by dot-path after the merge (e.g. "style.color.background"; a key with a schema default reverts to that default). One call = one undo step, however many blocks it touches. Use it to recolor, restyle, retext, set align/fontSize/spacing, or populate media — a core/image needs BOTH {id, url} (plus alt, sizeSlug); to lock a block set attributes {lock:{move:true, remove:true}}. Applies live and unsaved; does not save the post.',
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
			updates: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						clientId: { type: 'string' },
						attributes: { type: 'object' },
					},
					required: [ 'clientId', 'attributes' ],
				},
				description:
					'Per-block patches, one entry per block, applied in one call (one undo step). Use INSTEAD of clientId(s)+attributes.',
			},
			unset: {
				type: 'array',
				items: { type: 'string' },
				description:
					'Attribute dot-paths to remove from every targeted block after the merge, e.g. ["align", "style.color.background"].',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: { readonly: false, clientRegistered: true },
		webmcp: { risk: 'reversible' },
	},
	callback: async ( {
		clientId,
		clientIds,
		attributes,
		updates,
		unset,
	} = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { updated: false, reason: NOT_IN_EDITOR };
		}

		const sharedIds = Array.isArray( clientIds )
			? clientIds
			: clientId
			? [ clientId ]
			: [];
		if ( Array.isArray( updates ) && sharedIds.length ) {
			return {
				updated: false,
				reason: 'Provide either updates or clientId(s), not both.',
			};
		}

		// Normalize both modes to one target list: [{id, patch}].
		let targets;
		if ( Array.isArray( updates ) ) {
			if (
				! updates.length ||
				! updates.every(
					( entry ) =>
						entry?.clientId && isPlainObject( entry.attributes )
				)
			) {
				return {
					updated: false,
					reason: 'Each updates entry needs clientId and an attributes object.',
				};
			}
			targets = updates.map( ( entry ) => ( {
				id: entry.clientId,
				patch: entry.attributes,
			} ) );
		} else {
			if ( ! sharedIds.length ) {
				return {
					updated: false,
					reason: 'Provide clientId, clientIds, or updates.',
				};
			}
			if ( ! isPlainObject( attributes ) && ! unset?.length ) {
				return {
					updated: false,
					reason: 'Provide an attributes object and/or unset paths.',
				};
			}
			targets = sharedIds.map( ( id ) => ( {
				id,
				patch: attributes ?? {},
			} ) );
		}

		// Validate every id up front and fail atomically: under uniqueByBlock a
		// missing keyed entry THROWS in the reducer instead of no-opping.
		const unknown = targets
			.map( ( target ) => target.id )
			.filter( ( id ) => ! ctx.blockEditor.getBlock( id ) );
		if ( unknown.length ) {
			return {
				updated: false,
				reason:
					'Unknown clientId(s): ' +
					[ ...new Set( unknown ) ].join( ', ' ),
			};
		}

		const keyed = {};
		for ( const { id, patch } of targets ) {
			let merged = deepMerge(
				ctx.blockEditor.getBlock( id ).attributes,
				patch
			);
			for ( const path of unset ?? [] ) {
				merged = unsetPath( merged, path );
			}
			keyed[ id ] = merged;
		}

		// ONE dispatch for the whole batch: uniqueByBlock reads keyed[clientId]
		// per block, and a single dispatch is a single undo step.
		const ids = targets.map( ( target ) => target.id );
		ctx.data
			.dispatch( 'core/block-editor' )
			.updateBlockAttributes( ids, keyed, { uniqueByBlock: true } );

		return { updated: true, clientIds: ids };
	},
} );
