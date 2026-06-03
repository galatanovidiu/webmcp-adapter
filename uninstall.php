<?php
/**
 * Uninstall cleanup for the WebMCP Adapter.
 *
 * Drops the agent-activity table and deletes the schema-version option so no
 * plugin data remains after the user deletes the plugin. Runs only when
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

delete_option('webmcp_adapter_db_version');
