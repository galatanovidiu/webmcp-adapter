/**
 * Frontend ability: report the post open in the block editor.
 *
 * A read-only client-side ability. Its `callback` reads the Gutenberg editor's
 * data store (`core/editor`) in the current tab and returns which post is open —
 * id, type, title, status — plus the top-level block count. Use it to confirm the
 * tab is on the intended post BEFORE running an editor write ability, so the human
 * watching the page sees the edit land where they expect.
 *
 * `readonly: true` → always exposed, never gated: it reads editor state and mutates
 * nothing. Returns `{ inEditor: false }` when the tab is not on a block-editor
 * screen (a list table, settings, etc.), so the agent can tell it is on the wrong
 * page and navigate first.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';

registerAbility( {
	name: 'webmcp/editor-context',
	category: 'webmcp',
	label: 'Editor context',
	description:
		'Report which post is open in the WordPress block editor (Gutenberg) in this tab: post id, type, title, status, and how many top-level blocks it has. Read this to confirm you are on the right post before running an editor write tool. Returns inEditor:false when the tab is not on a block-editor screen.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	// readonly:true → always exposed. clientRegistered survives client-side (no
	// REST trip strips custom keys), marking this as a browser-only ability.
	meta: { annotations: { readonly: true, clientRegistered: true } },
	callback: async () => {
		// The core/editor store exists only on a block-editor screen. Off it,
		// select() may return undefined or throw (version-dependent), so treat
		// any failure as "not in the editor" rather than erroring the tool call.
		let editor;
		try {
			editor = window.wp?.data?.select?.( 'core/editor' );
		} catch {
			editor = undefined;
		}

		const postId = editor?.getCurrentPostId?.();
		if ( ! postId ) {
			return {
				inEditor: false,
				reason: 'This tab is not editing a post in the block editor.',
			};
		}

		const blockEditor = window.wp.data.select( 'core/block-editor' );

		return {
			inEditor: true,
			postId,
			postType: editor.getCurrentPostType(),
			// getEditedPostAttribute returns the current (possibly unsaved) value.
			title: editor.getEditedPostAttribute( 'title' ),
			status: editor.getEditedPostAttribute( 'status' ),
			blockCount: blockEditor ? blockEditor.getBlockCount() : 0,
		};
	},
} );
