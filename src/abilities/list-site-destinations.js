/**
 * Frontend Ability: discover visible semantic public navigation.
 */

import { registerAbility } from '@wordpress/abilities';
import 'webmcp-adapter/category';
import {
	DESTINATIONS_OUTPUT_SCHEMA,
	createDestination,
	normalizeText,
	uniqueDestinations,
} from 'webmcp-adapter/destinations';

registerAbility( {
	name: 'webmcp/list-site-destinations',
	category: 'webmcp',
	label: 'List Site Destinations',
	description:
		'Return visible same-site destinations from semantic navigation landmarks rendered on the current frontend page. Excludes arbitrary content links, placeholders, authentication links, action URLs, hidden links, external origins, and duplicates; results preserve rendered order.',
	input_schema: {
		type: 'object',
		properties: {},
		additionalProperties: false,
	},
	output_schema: DESTINATIONS_OUTPUT_SCHEMA,
	meta: {
		annotations: {
			readonly: true,
			destructive: false,
			idempotent: true,
			clientRegistered: true,
		},
	},
	callback: async () => {
		if ( document.body?.classList.contains( 'wp-admin' ) ) {
			return { destinations: [] };
		}

		const destinations = [];
		for ( const anchor of document.querySelectorAll( 'a[href]' ) ) {
			const landmark = anchor.closest( 'nav, [role="navigation"]' );
			if (
				! landmark ||
				landmark.closest( '#wpadminbar' ) ||
				isContentNavigation( landmark ) ||
				! isVisible( anchor )
			) {
				continue;
			}

			const destination = createDestination(
				{
					href: anchor.getAttribute( 'href' ),
					label: anchorLabel( anchor ),
					section: landmarkLabel( landmark ),
					idHint:
						anchor.id || anchor.closest( '[id]' )?.id || undefined,
				},
				window.location.href
			);
			if ( destination ) {
				destinations.push( destination );
			}
		}

		return { destinations: uniqueDestinations( destinations ) };
	},
} );

function anchorLabel( anchor ) {
	return normalizeText(
		anchor.getAttribute( 'aria-label' ) ||
			anchor.innerText ||
			anchor.textContent ||
			anchor.querySelector( 'img[alt]' )?.getAttribute( 'alt' ) ||
			anchor.getAttribute( 'title' )
	);
}

function landmarkLabel( landmark ) {
	const explicit = normalizeText( landmark.getAttribute( 'aria-label' ) );
	if ( explicit ) {
		return explicit;
	}
	if ( landmark.closest( 'header' ) ) {
		return 'Header';
	}
	if ( landmark.closest( 'footer' ) ) {
		return 'Footer';
	}
	return 'Navigation';
}

function isContentNavigation( landmark ) {
	return Boolean(
		landmark.closest(
			'main, article, .entry-content, .wp-block-post-content'
		) && ! landmark.closest( 'header, footer' )
	);
}

function isVisible( element ) {
	if (
		element.closest( '[hidden], [aria-hidden="true"]' ) ||
		element.getClientRects().length === 0
	) {
		return false;
	}
	const style = window.getComputedStyle( element );
	return style.display !== 'none' && style.visibility !== 'hidden';
}
