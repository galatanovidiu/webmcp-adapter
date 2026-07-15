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
