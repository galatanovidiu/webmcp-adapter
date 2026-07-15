/**
 * Frontend ability: save the open post to the database.
 *
 * The ONE deliberate DB-persistence gate in the editor set. Every other editor
 * ability stages unsaved edits; this one persists them — and, with the optional
 * `status` arg, implements the real publish flow (core's own publish button is
 * exactly editPost({status}, {undoIgnore:true}) + savePost()).
 *
 * destructive:true — BY DESIGN, even for a plain draft save: saving an
 * already-published post updates the live public page. The annotation routes the
 * call through the write + destructive settings AND the isTrusted confirmation
 * modal, where the human sees the ARGS — including status:"publish" — before
 * approving. That is also why status lives HERE and is rejected by write-tier
 * edit-post-attributes: the modal shows a call's args, not accumulated prior
 * edits, so a pre-staged status flip would turn an innocent-looking "save" into a
 * silent publish. On a failed save the staged status is reverted for the same
 * reason.
 *
 * savePost() returns undefined SILENTLY when the post is not saveable — the
 * callback pre-checks and reports, never fakes success.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/save-post',
	category: 'webmcp',
	label: 'Save post',
	description:
		'PERSIST the post open in the WordPress block editor to the database — the only editor tool that saves. Saves all staged edits (blocks and document fields). Optional `status` changes the post status in the same confirmed call: "publish" makes it publicly visible, "draft" un-publishes, "pending"/"private" likewise. Saving an already-published post updates the live page. Check editor-context first: isDirty tells whether there are unsaved changes. The human approves this call in a page dialog that shows these arguments.',
	input_schema: {
		type: 'object',
		properties: {
			status: {
				type: 'string',
				enum: [ 'draft', 'pending', 'private', 'publish' ],
				description:
					'Also set the post status as part of this save (e.g. "publish"). Omit to keep the current status.',
			},
		},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: false,
			destructive: true,
			clientRegistered: true,
		},
	},
	callback: async ( { status } = {} ) => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { saved: false, reason: NOT_IN_EDITOR };
		}
		const { editor } = ctx;

		if ( editor.isPostSavingLocked() ) {
			return {
				saved: false,
				reason: 'Saving is locked (a save is in flight or a plugin locked it).',
			};
		}

		const prevStatus = editor.getEditedPostAttribute( 'status' );
		const changingStatus = Boolean( status ) && status !== prevStatus;
		if ( changingStatus ) {
			// undoIgnore, like core's publish button: a status flip is not a
			// content edit the human should trip over in the undo history.
			await ctx.data
				.dispatch( 'core/editor' )
				.editPost( { status }, { undoIgnore: true } );
		}

		// isEditedPostSaveable means "has content worth saving" (title/excerpt/
		// content non-empty), NOT "has unsaved changes" — a clean published post
		// is still saveable and savePost would happily re-save it. The honest
		// no-op check is isEditedPostDirty. (Verified live: without this, a
		// clean-post save returned saved:true.)
		if ( ! changingStatus && ! editor.isEditedPostDirty() ) {
			return {
				saved: false,
				reason: 'Nothing to save: no unsaved changes.',
				status: prevStatus,
			};
		}
		if ( ! editor.isEditedPostSaveable() ) {
			// savePost would return undefined SILENTLY here — report instead.
			return {
				saved: false,
				reason: 'The post is not saveable (empty, or a save is in flight).',
			};
		}

		await ctx.data.dispatch( 'core/editor' ).savePost();

		if ( ! editor.didPostSaveRequestSucceed() ) {
			if ( changingStatus ) {
				// Un-arm the staged flip so the human's next manual Save cannot
				// silently publish what this call failed to.
				await ctx.data
					.dispatch( 'core/editor' )
					.editPost( { status: prevStatus }, { undoIgnore: true } );
			}
			return { saved: false, reason: 'The save request failed.' };
		}

		const post = editor.getCurrentPost();
		return {
			saved: true,
			postId: post.id,
			status: post.status,
			link: post.link,
		};
	},
} );
