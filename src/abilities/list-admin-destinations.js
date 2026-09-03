/**
 * Frontend Ability: discover rendered WordPress management navigation.
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
	name: 'webmcp/list-admin-destinations',
	category: 'webmcp',
	label: 'List Admin Destinations',
	description:
		'Return same-site WordPress management destinations rendered for the current user. Reads the full wp-admin menu inside wp-admin and the admin toolbar on authenticated frontend pages; excludes authentication/action URLs, external origins, and duplicates while preserving rendered order.',
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
		const adminMenu = document.querySelector( '#adminmenu' );
		const root = adminMenu ?? document.querySelector( '#wpadminbar' );
		if ( ! root ) {
			return { destinations: [] };
		}

		const destinations = [];
		for ( const anchor of root.querySelectorAll( 'a[href]' ) ) {
			if ( anchor.closest( '[hidden], [aria-hidden="true"]' ) ) {
				continue;
			}

			const destination = createDestination(
				{
					href: anchor.getAttribute( 'href' ),
					label: adminLabel( anchor ),
					section: adminMenu
						? adminMenuSection( anchor )
						: toolbarSection( anchor ),
					idHint:
						anchor.closest( 'li[id]' )?.id ||
						anchor.id ||
						undefined,
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

function adminLabel( anchor ) {
	const clone = anchor.cloneNode( true );
	for ( const element of clone.querySelectorAll(
		'.wp-menu-arrow, .wp-menu-image, .update-plugins, .awaiting-mod, .plugin-count, .screen-reader-text, .ab-icon'
	) ) {
		element.remove();
	}
	return normalizeText(
		anchor.getAttribute( 'aria-label' ) ||
			clone.textContent ||
			anchor.getAttribute( 'title' )
	);
}

function adminMenuSection( anchor ) {
	const submenu = anchor.closest( '.wp-submenu' );
	if ( ! submenu ) {
		return 'Administration';
	}
	const topLevelItem = submenu.closest( 'li.menu-top' );
	return (
		normalizeText(
			topLevelItem?.querySelector( ':scope > a .wp-menu-name' )
				?.textContent
		) || 'Administration'
	);
}

function toolbarSection( anchor ) {
	const topLevelItem = anchor.closest( '#wp-toolbar > ul > li' );
	const topLevelAnchor = topLevelItem?.querySelector( ':scope > a' );
	if ( ! topLevelAnchor || topLevelAnchor === anchor ) {
		return 'Toolbar';
	}
	return adminLabel( topLevelAnchor ) || 'Toolbar';
}
