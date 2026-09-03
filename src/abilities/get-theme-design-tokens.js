/**
 * Frontend ability: report the active theme's design tokens (presets).
 *
 * A read-only client-side ability. It reads the editor settings and returns the
 * theme's preset colors, gradients, font sizes, font families, spacing scale, and
 * content/wide widths — each with its slug — plus an applyHint explaining how to
 * apply them. This lets the agent stay ON-BRAND (use slug 'primary', not an
 * arbitrary hex) instead of off-scale custom values.
 *
 * readonly:true → always exposed. The preset arrays are shaped differently across
 * WordPress versions: colors/gradients/fontSizes are flat arrays, while
 * fontFamilies and spacingSizes arrive as {default, theme} objects. `flatten`
 * handles both. Returns {inEditor:false} off a block-editor screen.
 *
 * @package WebmcpAdapter
 */

import { registerAbility } from '@wordpress/abilities';
import { getEditor } from './store.js';

// Preset lists arrive either flat (array) or grouped by origin ({default, theme,
// custom}) depending on WP version. Normalize both to one flat array.
const flatten = ( value ) => {
	if ( Array.isArray( value ) ) {
		return value;
	}
	if ( value && typeof value === 'object' ) {
		return [
			...( value.default ?? [] ),
			...( value.theme ?? [] ),
			...( value.custom ?? [] ),
		];
	}
	return [];
};

// Keep the last entry per slug (theme overrides default).
const bySlug = ( list, valueKey ) => {
	const map = new Map();
	for ( const item of list ) {
		map.set( item.slug, {
			name: item.name,
			slug: item.slug,
			[ valueKey ]: item[ valueKey ],
		} );
	}
	return [ ...map.values() ];
};

const APPLY_HINT =
	'Preset color/gradient/fontSize/fontFamily go on the TOP-LEVEL attribute ' +
	'(backgroundColor, textColor, gradient, fontSize, fontFamily) as the slug. ' +
	'Spacing goes INSIDE style.spacing as the reference string ' +
	'"var:preset|spacing|<slug>". On any colored band ALWAYS set a contrasting ' +
	'textColor so text stays readable. Prefer a preset slug > a var:preset ' +
	'reference > a raw custom hex/rem, in that order.';

registerAbility( {
	name: 'webmcp/get-theme-design-tokens',
	category: 'webmcp',
	label: 'Theme design tokens',
	description:
		'Report the active theme’s design tokens (presets) so inserted blocks stay on-brand: colors, gradients, font sizes, font families, spacing sizes — each with its slug — plus contentSize/wideSize and an applyHint on how to apply them. Use these slugs in insert-blocks / update-block-attributes instead of arbitrary hex or rem. Returns inEditor:false when the tab is not on a block-editor screen.',
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
		const ctx = getEditor();
		if ( ! ctx ) {
			return {
				inEditor: false,
				reason: 'This tab is not editing a post in the block editor.',
			};
		}

		const settings = ctx.blockEditor.getSettings();
		const features = settings.__experimentalFeatures ?? {};

		return {
			inEditor: true,
			colors: bySlug(
				flatten( settings.colors ?? features.color?.palette ),
				'color'
			),
			gradients: bySlug(
				flatten( settings.gradients ?? features.color?.gradients ),
				'gradient'
			),
			fontSizes: bySlug(
				flatten( settings.fontSizes ?? features.typography?.fontSizes ),
				'size'
			),
			fontFamilies: bySlug(
				flatten(
					settings.fontFamilies ?? features.typography?.fontFamilies
				),
				'fontFamily'
			),
			spacingSizes: bySlug(
				flatten(
					settings.spacingSizes ?? features.spacing?.spacingSizes
				),
				'size'
			),
			layout: features.layout ?? {},
			applyHint: APPLY_HINT,
		};
	},
} );
