<?php
/**
 * Disposable WordPress runtime verification for the Batch 7 schema and retention.
 *
 * This intentionally rebuilds the activity table inside the fresh Playground
 * process supplied by `wp-playground-cli php`; never run it on a real site.
 */

declare(strict_types=1);

require_once '/wordpress/wp-load.php';

use Automattic\WebmcpAdapter\ActivityEventNormalizer;
use Automattic\WebmcpAdapter\ActivityMigrator;
use Automattic\WebmcpAdapter\ActivityRepository;
use Automattic\WebmcpAdapter\ActivityScreen;
use Automattic\WebmcpAdapter\Plugin;

$passed = 0;
$failed = 0;

function verify(string $label, bool $condition, string $detail = ''): void
{
	global $passed, $failed;
	if ($condition) {
		++$passed;
		echo "PASS {$label}\n";
		return;
	}
	++$failed;
	echo "FAIL {$label}" . ('' === $detail ? '' : " — {$detail}") . "\n";
}

global $wpdb, $wp_version;

verify('runtime is WordPress 7.0.4', str_starts_with((string) $wp_version, '7.0.4'), (string) $wp_version);

$migrator = new ActivityMigrator();
$table = $migrator->tableName();
$charset = $wpdb->get_charset_collate();

// Recreate only this disposable Playground table in the pre-Batch-7 shape.
$wpdb->query("DROP TABLE IF EXISTS {$table}"); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->query(
	"CREATE TABLE {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		run_id varchar(64) NOT NULL,
		user_id bigint(20) unsigned NOT NULL,
		session_token varchar(64) NOT NULL,
		created datetime NOT NULL,
		ability varchar(191) NOT NULL,
		outcome varchar(20) NOT NULL,
		screen_url text NULL,
		params longtext NULL,
		PRIMARY KEY (id)
	) {$charset}"
); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange
$wpdb->insert(
	$table,
	[
		'run_id' => 'legacy-run',
		'user_id' => 3,
		'session_token' => 'legacy-token-preserved-only-in-legacy-row',
		'created' => '2026-09-03 12:00:00',
		'ability' => 'webmcp/editor-context',
		'outcome' => 'ran',
		'screen_url' => 'https://example.test/wp-admin/',
		'params' => '{"legacy":"row"}',
	],
	['%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s']
);
update_option(ActivityMigrator::DB_VERSION_OPTION, '1');
$migrator->maybeMigrate();

$columns = $wpdb->get_col("SHOW COLUMNS FROM {$table}"); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange
$expectedColumns = [
	'event_id',
	'actor_hash',
	'recorded_at_gmt',
	'tool_name',
	'provider',
	'risk',
	'surface',
	'page_context',
	'page_path',
	'duration_ms',
	'confirmation_outcome',
	'error_code',
	'safe_summary',
];
verify('additive migration installs every normalized event column', [] === array_diff($expectedColumns, $columns), wp_json_encode($columns));
verify('migration advances the schema version', WEBMCP_ADAPTER_DB_VERSION === get_option(ActivityMigrator::DB_VERSION_OPTION));
$legacy = $wpdb->get_row("SELECT * FROM {$table} WHERE run_id = 'legacy-run'", ARRAY_A); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
verify('legacy row survives the additive migration', is_array($legacy) && 'legacy-token-preserved-only-in-legacy-row' === $legacy['session_token']);
verify('legacy row has nullable new columns', is_array($legacy) && null === $legacy['event_id'] && null === $legacy['recorded_at_gmt']);

$repository = new ActivityRepository($table);
$normalizer = new ActivityEventNormalizer();
$event = $normalizer->normalize(
	[
		'event_id' => '33333333-3333-4333-8333-333333333333',
		'run_id' => '44444444-4444-4444-8444-444444444444',
		'ability' => 'webmcp/get-page-context',
		'outcome' => 'ran',
		'duration_ms' => 12,
		'confirmation' => 'not_required',
		'error_code' => null,
	],
	[
		'surface' => 'wp-admin',
		'context' => 'dashboard',
		'path' => '/wp-admin/',
	],
	1,
	false
);
$newId = is_array($event) ? $repository->insert($event) : 0;
$stored = $newId > 0 ? $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", $newId), ARRAY_A) : null;
verify('normalized event inserts after legacy migration', is_array($stored));
verify('new event stores no raw login-session token', is_array($stored) && '' === $stored['session_token']);
verify('new event stores no raw parameter bag', is_array($stored) && null === $stored['params']);
verify('new event stores server-owned risk/provider/path', is_array($stored) && 'read' === $stored['risk'] && 'WebMCP Adapter' === $stored['provider'] && '/wp-admin/' === $stored['page_path']);
verify('default retention contract is seven days and 10,000 rows', 7 === ActivityRepository::DEFAULT_RETENTION_DAYS && 10000 === ActivityRepository::DEFAULT_RETENTION_ROWS);

wp_set_current_user(1);
$_GET['run'] = 'legacy-run';
ob_start();
(new ActivityScreen())->render();
$legacyReview = (string) ob_get_clean();
verify('administrator review renders legacy rows explicitly', str_contains($legacyReview, 'Legacy row') && str_contains($legacyReview, 'legacy-run'));
verify('administrator review never renders legacy session tokens', !str_contains($legacyReview, 'legacy-token-preserved-only-in-legacy-row'));
$_GET['run'] = $event['run_id'];
ob_start();
(new ActivityScreen())->render();
$normalizedReview = (string) ob_get_clean();
verify('administrator review renders normalized event fields', str_contains($normalizedReview, 'Provider / risk') && str_contains($normalizedReview, 'Safe summary') && str_contains($normalizedReview, 'WebMCP Adapter'));
unset($_GET['run']);

$oldEvent = $event;
$oldEvent['event_id'] = '55555555-5555-4555-8555-555555555555';
$oldEvent['recorded_at_gmt'] = gmdate('Y-m-d H:i:s', time() - (8 * DAY_IN_SECONDS));
$oldEvent['created'] = get_date_from_gmt($oldEvent['recorded_at_gmt']);
$repository->insert($oldEvent);
$repository->pruneOlderThan(7);
$oldCount = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE event_id = %s", $oldEvent['event_id']));
verify('seven-day pruning removes expired normalized events', 0 === $oldCount);

for ($index = 0; $index < 12; $index++) {
	$capEvent = $event;
	$capEvent['event_id'] = sprintf('66666666-6666-4666-8666-%012d', $index);
	$capEvent['run_id'] = sprintf('77777777-7777-4777-8777-%012d', $index);
	$repository->insert($capEvent);
}
$beforeCap = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}"); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
$repository->pruneToCap(10);
$afterCap = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}"); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
verify('row-cap pruning removes only overflow rows', $beforeCap > 10 && 10 === $afterCap, "{$beforeCap} -> {$afterCap}");

verify('daily pruning hook is scheduled', false !== wp_next_scheduled(Plugin::ACTIVITY_PRUNE_HOOK));

echo "{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
