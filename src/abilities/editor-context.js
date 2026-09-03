/**
 * Frontend ability: report what is open in the block editor.
 *
 * A read-only client-side ability — the orientation read. Its `callback` reads the
 * Gutenberg editor data stores in the current tab and returns:
 *
 * - which document is open (id, type, title, status, block count) — a post/page in
 *   the post editor, or a template/template part/page in the Site Editor (there the
 *   postId is a string like "twentytwentyfive//home");
 * - document state: dirty/saveable/published/locked, permalink and preview link,
 *   the edited sidebar fields (slug, excerpt, featured_media, template), the
 *   current templateId and renderingMode, and undo/redo availability;
 * - the human's live SELECTION — the deictic anchor: when the user says "this" or
 *   "here", the selected blocks are what they mean.
 *
 * `readonly: true` → always exposed, never gated: it reads editor state and mutates
 * nothing. Returns `{ inEditor: false }` when the tab is not on a block-editor
 * screen (a list table, settings, etc.), so the agent can tell it is on the wrong
 * page and navigate first.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor, NOT_IN_EDITOR } from './store.js';

registerAbility( {
	name: 'webmcp/editor-context',
	category: 'webmcp',
	label: 'Editor context',
	description:
		'Report what is open in the WordPress block editor (Gutenberg) in this tab — works in the post editor and the Site Editor (there postId is a string like "theme//slug", so never assume it is a number). Returns the document (postId, postType, title, status, blockCount), its state (isDirty, isSaveable, isPublished, isLocked, permalink, previewLink — previewLink shows the LAST-SAVED content, not unsaved edits), the edited sidebar fields (slug, excerpt, featuredMediaId, template), templateId + renderingMode, hasUndo/hasRedo, and the human’s current `selection` (their selected blocks with rootClientId+index, plus a text caret anchor when the selection is inside one rich-text attribute; offsets are rich-text value offsets, not HTML-string offsets). When the user says "this" or "here", target the selection. Read this to orient before running editor write tools. Returns inEditor:false when the tab is not on a block-editor screen.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	// readonly:true → always exposed. clientRegistered survives client-side (no
	// REST trip strips custom keys), marking this as a browser-only ability.
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
	},
	callback: async () => {
		const ctx = getEditor();
		if ( ! ctx ) {
			return { inEditor: false, reason: NOT_IN_EDITOR };
		}
		const { editor, blockEditor } = ctx;

		// The human's live selection: which blocks, where they sit, and — when the
		// caret is inside one rich-text attribute — the exact anchor. Newer
		// selectors are optional-chained so the read degrades, never throws.
		let selection = null;
		const selectedIds = blockEditor.getSelectedBlockClientIds();
		if ( selectedIds.length ) {
			const names = blockEditor.getBlockNamesByClientId( selectedIds );
			const start = blockEditor.getSelectionStart();
			const end = blockEditor.getSelectionEnd();
			selection = {
				blocks: selectedIds.map( ( id, at ) => ( {
					clientId: id,
					name: names[ at ],
					rootClientId: blockEditor.getBlockRootClientId( id ) || '',
					index: blockEditor.getBlockIndex( id ),
				} ) ),
				// A text anchor only when the range sits inside ONE block's one
				// rich-text attribute; offsets index the rich-text VALUE.
				...( start?.attributeKey && start.clientId === end?.clientId
					? {
							textAnchor: {
								clientId: start.clientId,
								attributeKey: start.attributeKey,
								startOffset: start.offset,
								endOffset: end.offset,
							},
					  }
					: {} ),
				isTyping: blockEditor.isTyping(),
			};
		}

		return {
			inEditor: true,
			postId: editor.getCurrentPostId(),
			postType: editor.getCurrentPostType(),
			// getEditedPostAttribute returns the current (possibly unsaved) value.
			title: editor.getEditedPostAttribute( 'title' ),
			status: editor.getEditedPostAttribute( 'status' ),
			slug: editor.getEditedPostAttribute( 'slug' ),
			excerpt: editor.getEditedPostAttribute( 'excerpt' ),
			featuredMediaId: editor.getEditedPostAttribute( 'featured_media' ),
			template: editor.getEditedPostAttribute( 'template' ),
			blockCount: blockEditor.getBlockCount(),
			isDirty: editor.isEditedPostDirty(),
			isSaveable: editor.isEditedPostSaveable(),
			isPublished: editor.isCurrentPostPublished(),
			isLocked: editor.isPostLocked?.() ?? false,
			isSavingLocked: editor.isPostSavingLocked?.() ?? false,
			permalink: editor.getPermalink(),
			// Stale by design: the preview shows the last-saved content.
			previewLink: editor.getEditedPostPreviewLink?.() ?? null,
			// Null when the user cannot read templates or none applies.
			templateId: editor.getCurrentTemplateId?.() ?? null,
			renderingMode: editor.getRenderingMode?.() ?? null,
			hasUndo: editor.hasEditorUndo(),
			hasRedo: editor.hasEditorRedo(),
			selection,
		};
	},
} );
