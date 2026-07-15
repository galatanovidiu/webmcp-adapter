/**
 * Frontend ability: list the block patterns available in this install.
 *
 * A read-only client-side ability. It returns lightweight metadata (name, title,
 * categories, blockTypes, source) for the designed patterns registered by the
 * theme, core, and the pattern directory — the highest-leverage "beauty floor":
 * one pick with insert-pattern drops a full designed section. Metadata only; the
 * pattern markup is fetched by insert-pattern to keep this payload small.
 *
 * readonly:true → always exposed. THE async trap: a synchronous
 * select('core').getBlockPatterns() returns [] until its resolver has fetched, so
 * this awaits resolveSelect('core').getBlockPatterns() (which resolves AND caches,
 * warming insert-pattern). By default it filters out context-bound patterns
 * (query / post-content / template-part slots) that do not belong in free page
 * body; pass includeContextBound:true to keep them.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';

// Patterns bound to a specific slot, not free page-body insertion.
const CONTEXT_BOUND = [
	'core/query',
	'core/post-content',
	'core/template-part',
	'core/comments',
];

registerAbility( {
	name: 'webmcp/list-patterns',
	category: 'webmcp',
	label: 'List patterns',
	description:
		'List the block patterns available in this WordPress install (theme, core, pattern directory) as metadata: {name, title, categories, blockTypes, source}, plus the registered category names. Pick a pattern name and pass it to insert-pattern to drop a full designed section into the open editor. Pass category to filter (e.g. call-to-action, about, gallery, testimonials, services, header, footer). By default context-bound patterns (query/post-content/template-part) are hidden; pass includeContextBound:true to include them.',
	input_schema: {
		type: 'object',
		properties: {
			category: {
				type: 'string',
				description: 'Filter to patterns in this category.',
			},
			includeContextBound: {
				type: 'boolean',
				description:
					'Default false. true keeps query/post-content/template-part patterns.',
			},
		},
		additionalProperties: false,
	},
	meta: { annotations: { readonly: true, clientRegistered: true } },
	callback: async ( { category, includeContextBound } = {} ) => {
		const data = window.wp?.data;
		if ( ! data?.resolveSelect ) {
			return { patterns: [], reason: 'The block editor is not loaded.' };
		}

		let patterns;
		try {
			// resolveSelect waits for the resolver AND caches — a plain select()
			// returns [] before the fetch completes.
			patterns = await data.resolveSelect( 'core' ).getBlockPatterns();
		} catch {
			return { patterns: [], reason: 'Could not load patterns.' };
		}

		let list = patterns ?? [];
		if ( ! includeContextBound ) {
			list = list.filter(
				( pattern ) =>
					! ( pattern.blockTypes ?? [] ).some( ( type ) =>
						CONTEXT_BOUND.includes( type )
					)
			);
		}
		if ( category ) {
			list = list.filter( ( pattern ) =>
				( pattern.categories ?? [] ).includes( category )
			);
		}

		const categories = (
			data.select( 'core' ).getBlockPatternCategories?.() ?? []
		).map( ( entry ) => entry.name );

		return {
			patterns: list.map( ( pattern ) => ( {
				name: pattern.name,
				title: pattern.title,
				categories: pattern.categories,
				blockTypes: pattern.blockTypes,
				source: pattern.source,
			} ) ),
			categories,
		};
	},
} );
