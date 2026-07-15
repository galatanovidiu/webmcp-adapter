/**
 * Frontend abilities — registration barrel.
 *
 * Each import registers one client-side ability into the Abilities client store as
 * a side effect. The adapter imports this file once; the store subscription then
 * turns each into a WebMCP tool. Add a frontend ability by dropping a file in this
 * directory and importing it here — adapter.js does not change.
 *
 * @package WebmcpAdapter
 */

// Category first: registerAbility rejects an ability whose category is not yet
// registered, and static imports evaluate in source order.
import './category.js';
import './navigate.js';
import './editor-context.js';
// Generic block-CRUD substrate + discovery + patterns: a small set of tools that
// works across all registered block types, so the agent composes any layout
// (insert-paragraph is retired — it is insert-blocks with {name:'core/paragraph'}).
import './read-blocks.js';
import './list-block-types.js';
import './get-theme-design-tokens.js';
import './list-patterns.js';
import './list-templates.js';
import './insert-blocks.js';
import './update-block-attributes.js';
import './insert-pattern.js';
import './remove-blocks.js';
// Restructure + document-level control: move/replace preserve position and undo
// atomicity; edit-post-attributes covers the sidebar fields; undo is the recovery
// half of the write set; save-post is the ONE destructive-tier persistence gate.
import './move-blocks.js';
import './replace-blocks.js';
import './edit-post-attributes.js';
import './undo.js';
import './save-post.js';
