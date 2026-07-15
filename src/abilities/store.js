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

/**
 * Collects the unknown block names in a recursive {name, attributes, innerBlocks}
 * spec, so a typo fails clearly before anything is built. Shared by insert-blocks
 * and replace-blocks.
 *
 * @param {Array}  nodes  Spec nodes.
 * @param {Object} blocks The wp.blocks namespace.
 * @return {string[]} De-duplicated unknown names ([] when all are registered).
 */
export function findUnknownBlockNames( nodes, blocks ) {
	const unknown = [];
	const walk = ( list ) => {
		for ( const node of list ) {
			if ( ! blocks.getBlockType( node?.name ) ) {
				unknown.push( node?.name );
			}
			if ( Array.isArray( node?.innerBlocks ) ) {
				walk( node.innerBlocks );
			}
		}
	};
	walk( nodes );
	return [ ...new Set( unknown ) ];
}

/**
 * Builds real block instances from a recursive spec. createBlock mints a clientId
 * per block and sanitizes attributes, so the result is valid by construction.
 *
 * @param {Array}  nodes  Spec nodes ({name, attributes?, innerBlocks?}).
 * @param {Object} blocks The wp.blocks namespace.
 * @return {Array} Block instances ready for insertBlocks/replaceBlocks.
 */
export function buildBlocks( nodes, blocks ) {
	const build = ( node ) =>
		blocks.createBlock(
			node.name,
			node.attributes ?? {},
			( node.innerBlocks ?? [] ).map( build )
		);
	return nodes.map( build );
}

/**
 * Snapshots built blocks to a plain {clientId, name, innerBlocks} tree — the
 * result shape the agent uses to target follow-up writes. Snapshot BEFORE
 * dispatch; the dispatch returns nothing useful.
 *
 * @param {Array} built Block instances.
 * @return {Array} The clientId tree.
 */
export function snapshotTree( built ) {
	const snapshot = ( block ) => ( {
		clientId: block.clientId,
		name: block.name,
		innerBlocks: block.innerBlocks.map( snapshot ),
	} );
	return built.map( snapshot );
}
