<?php
/**
 * Uninstall cleanup for the WebMCP Adapter.
 *
 * Drops the agent-activity table, clears scheduled retention, and deletes the
 * plugin's options and temporary anonymous rate-limit counters. Runs only when
 * WordPress triggers an uninstall.
 *
 * @package WebmcpAdapter
 */

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}

global $wpdb;

$table = $wpdb->prefix . 'webmcp_activity';

// Identifier is a trusted, code-defined table name (not user input); dbDelta
// and DROP TABLE do not accept placeholders for the table identifier here.
$wpdb->query("DROP TABLE IF EXISTS {$table}");

wp_clear_scheduled_hook('webmcp_adapter_prune_activity');

foreach (
	[
		'webmcp_adapter_db_version',
		'webmcp_enable_write_tools',
		'webmcp_enable_destructive_tools',
		'webmcp_allow_automated_confirmation',
	] as $option
) {
	delete_option($option);
}

$rateTransient = $wpdb->esc_like('_transient_webmcp_rate_') . '%';
$rateTimeout   = $wpdb->esc_like('_transient_timeout_webmcp_rate_') . '%';
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$rateTransient,
		$rateTimeout
	)
);
