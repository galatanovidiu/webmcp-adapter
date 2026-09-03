import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildSafeActivitySummary,
	classifyResolvedActivity,
	mintActivityId,
} from '../src/activity-observability.js';

test( 'resolved activity outcomes distinguish success, refusal, and stale context', () => {
	assert.deepEqual( classifyResolvedActivity( { destinations: [] } ), {
		outcome: 'ran',
		errorCode: null,
	} );
	assert.deepEqual(
		classifyResolvedActivity( { saved: false, reason: 'Locked.' } ),
		{
			outcome: 'failed',
			errorCode: 'ability_refused',
		}
	);
	assert.deepEqual(
		classifyResolvedActivity( {
			inEditor: false,
			reason: 'This tab is not editing a post in the block editor.',
		} ),
		{ outcome: 'stale', errorCode: 'stale_context' }
	);
	assert.deepEqual(
		classifyResolvedActivity( {
			staged: false,
			validationErrors: [ { field: 'form', message: 'Unavailable.' } ],
		} ),
		{ outcome: 'stale', errorCode: 'stale_context' }
	);
} );

test( 'only allowlisted General Settings identifiers enter safe summaries', () => {
	assert.deepEqual(
		buildSafeActivitySummary( 'wordpress/settings/stage-general-form', {
			changedFields: [
				'siteTitle',
				'administrationEmail',
				'siteTitle',
				'password',
			],
			unchangedFields: [ 'timezone' ],
			requiresUserSave: true,
			administrationEmail: 'private@example.test',
			warnings: [ { message: 'private@example.test' } ],
		} ),
		{
			changedFields: [ 'siteTitle', 'administrationEmail' ],
			unchangedFields: [ 'timezone' ],
			requiresUserSave: true,
		}
	);
	assert.equal(
		buildSafeActivitySummary( 'webmcp/read-blocks', { content: 'secret' } ),
		null
	);
} );

test( 'activity identifiers are valid distinct UUIDs', () => {
	const first = mintActivityId();
	const second = mintActivityId();
	const pattern =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	assert.match( first, pattern );
	assert.match( second, pattern );
	assert.notEqual( first, second );
} );
