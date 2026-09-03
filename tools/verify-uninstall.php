<?php
/**
 * Verify complete uninstall cleanup inside a disposable WordPress runtime.
 *
 * Run only through `wp-playground-cli php`; this intentionally drops the
 * mounted plugin's activity table and clears its stored data in that process.
 */

declare(strict_types=1);

require_once '/wordpress/wp-load.php';

global $wpdb, $wp_version;

$passed = 0;
$failed = 0;

function verifyUninstall(string $label, bool $condition, string $detail = ''): void
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

verifyUninstall('runtime is WordPress 7.0.4', str_starts_with((string) $wp_version, '7.0.4'), (string) $wp_version);

$options = [
	'webmcp_adapter_db_version',
	'webmcp_enable_write_tools',
	'webmcp_enable_destructive_tools',
	'webmcp_allow_automated_confirmation',
];
foreach ($options as $option) {
	update_option($option, 'batch-9-uninstall-proof');
}
set_transient('webmcp_rate_batch_9_uninstall', 2, HOUR_IN_SECONDS);
wp_schedule_single_event(time() + HOUR_IN_SECONDS, 'webmcp_adapter_prune_activity');

$table = $wpdb->prefix . 'webmcp_activity';
verifyUninstall('activity table exists before uninstall', $table === $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)));
verifyUninstall('legacy options exist immediately before uninstall', !in_array(false, array_map('get_option', $options), true));
verifyUninstall('retention schedule exists immediately before uninstall', false !== wp_next_scheduled('webmcp_adapter_prune_activity'));
verifyUninstall('rate-limit transient exists immediately before uninstall', false !== get_transient('webmcp_rate_batch_9_uninstall'));

if (!defined('WP_UNINSTALL_PLUGIN')) {
	define('WP_UNINSTALL_PLUGIN', true);
}
require '/wordpress/wp-content/plugins/webmcp-adapter/uninstall.php';

$remainingRateRows = (int) $wpdb->get_var(
	$wpdb->prepare(
		"SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like('_transient_webmcp_rate_') . '%',
		$wpdb->esc_like('_transient_timeout_webmcp_rate_') . '%'
	)
);

verifyUninstall('activity table is removed by uninstall', null === $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)));
verifyUninstall('persistent plugin options are removed only by uninstall', !in_array(true, array_map(static fn(string $option): bool => false !== get_option($option), $options), true));
verifyUninstall('retention schedule is removed by uninstall', false === wp_next_scheduled('webmcp_adapter_prune_activity'));
verifyUninstall('rate-limit transients are removed by uninstall', 0 === $remainingRateRows, (string) $remainingRateRows);

echo "{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
