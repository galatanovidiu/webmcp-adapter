/**
 * Frontend ability: edit the open post's document-level fields.
 *
 * A client-side WRITE ability — the sidebar counterpart of the block writes. The
 * block tools cover the post BODY; this one covers everything else the document
 * panel edits: title, slug, excerpt, featured image, page template, date,
 * discussion toggles, meta, and taxonomy terms. It dispatches
 * `core/editor.editPost`, which stages the change as a live UNSAVED entity edit —
 * exactly like typing in the sidebar. Nothing persists until save.
 *
 * `status` and `content` are REJECTED here on purpose (not just absent from the
 * schema — the callback enforces it, and the taxonomy passthrough is blocklisted
 * against post-field names): the confirmation modal shows a CALL's args, not
 * accumulated prior edits, so a write-tier status flip would arm the human's next
 * innocent-looking Save into a silent publish. Status changes belong to the
 * destructive-tier save-post tool, where the modal displays them.
 *
 * Not readonly → gated behind webmcp_enable_write_tools. Not destructive. Does NOT
 * save the post.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

// Direct editPost fields the schema accepts. status/content are deliberately
// absent (see the header); everything else the document sidebar edits is here.
const FIELDS = [
	'title',
	'slug',
	'excerpt',
	'featured_media',
	'template',
	'date',
	'comment_status',
	'ping_status',
	'meta',
];

// Post-entity fields a `taxonomies` key must never collide with — the taxonomy
// map is spread into the same edits object, so this blocklist keeps it from
// smuggling in a reserved field (most importantly status/content/password).
const RESERVED = new Set( [
	...FIELDS,
	'status',
	'content',
	'password',
	'author',
	'date_gmt',
	'format',
	'sticky',
	'blocks',
	'selection',
] );

registerAbility( {
	name: 'webmcp/edit-post-attributes',
	category: 'webmcp',
	label: 'Edit post attributes',
	description:
		'Edit the document-level fields of the post open in the WordPress block editor, live and unsaved (the sidebar updates immediately; Ctrl+Z undoes it). Fields: title, slug, excerpt, featured_media (attachment id from the media tools; 0 clears it), template (a slug from list-templates; "" = theme default), date (ISO 8601 — changing it on a published post can change date-based permalinks), comment_status / ping_status ("open"/"closed"), meta (an object of REST-registered meta keys — unregistered keys are silently dropped on save; the merge is shallow, one level), and `taxonomies`: term-ID arrays keyed by the taxonomy rest_base (e.g. {"categories":[3,7],"tags":[12]} — IDs only, creating terms is out of scope). Post status can NOT be set here — use save-post. Does not save the post.',
	input_schema: {
		type: 'object',
		properties: {
			title: { type: 'string' },
			slug: { type: 'string' },
			excerpt: { type: 'string' },
			featured_media: {
				type: 'integer',
				minimum: 0,
				description: 'Attachment id; 0 clears the featured image.',
			},
			template: {
				type: 'string',
				description:
					'Page-template slug from list-templates; "" restores the theme default.',
			},
			date: {
				type: 'string',
				description: 'ISO 8601 date-time, e.g. "2026-07-15T09:00:00".',
			},
			comment_status: { type: 'string', enum: [ 'open', 'closed' ] },
			ping_status: { type: 'string', enum: [ 'open', 'closed' ] },
			meta: {
				type: 'object',
				description:
					'REST-registered meta keys only; shallow-merged one level.',
			},
			taxonomies: {
				type: 'object',
				description:
					'Term-ID arrays keyed by taxonomy rest_base, e.g. {"categories":[3],"tags":[7,9]}.',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: { readonly: false, clientRegistered: true },
		webmcp: { risk: 'reversible' },
	},
	callback: async ( params = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { updated: false, reason: NOT_IN_EDITOR };
		}

		// Belt over the schema's braces: the client schema is not a trust
		// boundary, and status must never ride a write-tier call (see header).
		if ( 'status' in params || 'content' in params ) {
			return {
				updated: false,
				reason: 'status/content are not editable here. Use save-post for status; use the block tools for content.',
			};
		}

		const edits = {};
		for ( const field of FIELDS ) {
			if ( field in params ) {
				edits[ field ] = params[ field ];
			}
		}

		if ( params.taxonomies != null ) {
			if (
				typeof params.taxonomies !== 'object' ||
				Array.isArray( params.taxonomies )
			) {
				return {
					updated: false,
					reason: 'taxonomies must be an object of term-ID arrays keyed by rest_base.',
				};
			}
			const bad = Object.keys( params.taxonomies ).filter(
				( key ) =>
					RESERVED.has( key ) ||
					! Array.isArray( params.taxonomies[ key ] )
			);
			if ( bad.length ) {
				return {
					updated: false,
					reason:
						'Invalid taxonomies key(s): ' +
						bad.join( ', ' ) +
						'. Keys must be taxonomy rest_base names with term-ID arrays.',
				};
			}
			Object.assign( edits, params.taxonomies );
		}

		if ( ! Object.keys( edits ).length ) {
			return { updated: false, reason: 'Provide at least one field.' };
		}

		await ctx.data.dispatch( 'core/editor' ).editPost( edits );

		// Read the edited values back so the result confirms what is now staged.
		const applied = {};
		for ( const key of Object.keys( edits ) ) {
			applied[ key ] = ctx.editor.getEditedPostAttribute( key );
		}

		return { updated: true, applied };
	},
} );
