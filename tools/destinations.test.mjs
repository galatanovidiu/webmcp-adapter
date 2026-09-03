import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createDestination,
	normalizeText,
	uniqueDestinations,
} from '../src/abilities/destinations.js';

const BASE_URL = 'https://example.test/current/?page=1';

test( 'creates a stable same-origin destination', () => {
	const first = createDestination(
		{
			href: '/sample-page/',
			label: '  Sample\n Page ',
			section: 'Primary navigation',
			idHint: 'menu-item-sample',
		},
		BASE_URL
	);
	const second = createDestination(
		{
			href: 'https://example.test/sample-page/',
			label: 'Sample Page',
			section: 'Primary navigation',
			idHint: 'menu-item-sample',
		},
		BASE_URL
	);

	assert.deepEqual( first, second );
	assert.equal( first.label, 'Sample Page' );
	assert.equal( first.url, 'https://example.test/sample-page/' );
	assert.equal( first.sameOrigin, true );
	assert.match( first.id, /^menu-item-sample-[a-z0-9]+$/ );
} );

test( 'rejects placeholders, external URLs, credentials, auth, and action links', () => {
	for ( const href of [
		'',
		'#',
		'https://outside.test/',
		'https://user:secret@example.test/',
		'/wp-login.php',
		'/wp-signup.php',
		'/wp-admin/admin-post.php?action=save',
		'/wp-admin/plugins.php?action=activate&plugin=example',
		'/wp-admin/post.php?post=1&action=trash',
		'/wp-admin/?_wpnonce=secret',
		'mailto:admin@example.test',
		'javascript:void(0)',
	] ) {
		assert.equal(
			createDestination(
				{ href, label: 'Blocked', section: 'Test' },
				BASE_URL
			),
			null,
			href
		);
	}
} );

test( 'keeps navigation URLs whose action only selects an editor screen', () => {
	const destination = createDestination(
		{
			href: '/wp-admin/post.php?post=1&action=edit',
			label: 'Edit Post',
			section: 'Posts',
		},
		BASE_URL
	);

	assert.equal(
		destination.url,
		'https://example.test/wp-admin/post.php?post=1&action=edit'
	);
} );

test( 'de-duplicates URLs in first-rendered order', () => {
	const first = createDestination(
		{ href: '/one/', label: 'One', section: 'Primary' },
		BASE_URL
	);
	const duplicate = createDestination(
		{ href: '/one/', label: 'Duplicate', section: 'Footer' },
		BASE_URL
	);
	const second = createDestination(
		{ href: '/two/', label: 'Two', section: 'Primary' },
		BASE_URL
	);

	assert.deepEqual( uniqueDestinations( [ first, duplicate, second ] ), [
		first,
		second,
	] );
} );

test( 'normalizes rendered whitespace and rejects non-string labels', () => {
	assert.equal( normalizeText( '  Site\n\tSettings ' ), 'Site Settings' );
	assert.equal( normalizeText( null ), '' );
	assert.equal(
		createDestination( { href: '/missing-label/', label: null }, BASE_URL ),
		null
	);
} );
