/**
 * Frontend ability: list the site's templates and template parts.
 *
 * A read-only client-side ability — discovery for template work. It returns every
 * block template (page/post layouts) and template part (header, footer, sidebar)
 * with the two handles the other tools consume: the `slug` that
 * edit-post-attributes' `template` field takes, and an `editUrl` that navigate can
 * open in the Site Editor (where the shipped block tools work unchanged).
 *
 * readonly:true → always exposed. Uses resolveSelect, NOT select: the
 * wp_template/wp_template_part entity configs load LAZILY (a /wp/v2/types fetch
 * first), so a plain synchronous select() returns undefined forever on first use —
 * the same async-resolver class as getBlockPatterns. Works on any wp-admin screen
 * (the core store is not editor-bound).
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';

// Projects one REST record to the light shape the agent needs.
const shape = ( type ) => ( record ) => ( {
	id: record.id,
	slug: record.slug,
	title: record.title?.rendered || record.title?.raw || record.slug,
	theme: record.theme,
	...( record.area ? { area: record.area } : {} ),
	editUrl:
		'/wp-admin/site-editor.php?p=/' +
		type +
		'/' +
		encodeURIComponent( record.id ) +
		'&canvas=edit',
} );

registerAbility( {
	name: 'webmcp/list-templates',
	category: 'webmcp',
	label: 'List templates',
	description:
		'List this site’s block templates (page/post layouts) and template parts (header, footer, …) as {id, slug, title, theme, area?, editUrl}. Use a template `slug` in edit-post-attributes {template} to change the open page’s layout; use `editUrl` with navigate to open a template or template part in the Site Editor, where the block tools work the same (navigate is a full page load — check editor-context isDirty first). Template ids look like "theme//slug" — they are strings, not numbers.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
	},
	callback: async () => {
		const data = window.wp?.data;
		if ( ! data?.resolveSelect ) {
			return {
				templates: [],
				reason: 'The editor data layer is not loaded.',
			};
		}

		let templates, parts;
		try {
			// resolveSelect is REQUIRED: these entity configs load lazily, so a
			// plain select() returns undefined without ever fetching.
			[ templates, parts ] = await Promise.all( [
				data
					.resolveSelect( 'core' )
					.getEntityRecords( 'postType', 'wp_template', {
						per_page: -1,
					} ),
				data
					.resolveSelect( 'core' )
					.getEntityRecords( 'postType', 'wp_template_part', {
						per_page: -1,
					} ),
			] );
		} catch {
			return { templates: [], reason: 'Could not load templates.' };
		}

		// null (not []) after resolution means the request failed or the user
		// cannot read templates (edit_theme_options).
		if ( ! templates && ! parts ) {
			return {
				templates: [],
				reason: 'Templates are not readable for this user.',
			};
		}

		return {
			templates: ( templates ?? [] ).map( shape( 'wp_template' ) ),
			templateParts: ( parts ?? [] ).map( shape( 'wp_template_part' ) ),
		};
	},
} );
