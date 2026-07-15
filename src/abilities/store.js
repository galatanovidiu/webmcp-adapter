/**
 * Shared helper for the editor abilities — NOT an ability itself.
 *
 * The barrel (index.js) does NOT import this; the ability files import
 * { getEditor } from it. It centralizes the one guard every editor ability
 * needs: confirm a post is open in the block editor and hand back the data
 * stores. The core/editor store exists only on a block-editor screen; off it
 * select() may return undefined or throw (version-dependent), so the read is
 * wrapped and any failure yields null ("not in the editor").
 *
 * @package WebmcpAdapter
 */

/**
 * Returns the editor data handles when a post is open in the block editor.
 *
 * @return {?{data:Object, editor:Object, blockEditor:Object, blocks:Object}}
 *   The wp.data namespace, the core/editor and core/block-editor selectors, and
 *   wp.blocks — or null when this tab is not editing a post in the block editor.
 */
export function getEditor() {
	try {
		const data = window.wp?.data;
		const editor = data?.select?.( 'core/editor' );
		if ( ! editor?.getCurrentPostId?.() ) {
			return null;
		}
		return {
			data,
			editor,
			blockEditor: data.select( 'core/block-editor' ),
			blocks: window.wp.blocks,
		};
	} catch {
		return null;
	}
}

const NOT_IN_EDITOR = 'This tab is not editing a post in the block editor.';

export { NOT_IN_EDITOR };
