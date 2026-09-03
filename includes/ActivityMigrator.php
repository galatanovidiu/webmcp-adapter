<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Creates and migrates the Site tools activity table.
 *
 * Owns the custom table `{prefix}webmcp_activity` and its schema version. The
 * adapter records every agent tool call into this table so activity survives
 * navigation and is reviewable as past sessions. Migration is gated by an option
 * compared against {@see WEBMCP_ADAPTER_DB_VERSION}, so {@see self::maybeMigrate()}
 * no-ops cheaply once the schema is current.
 *
 * Multisite is out of scope: the table is per-site (uses `$wpdb->prefix`).
 *
 * @since 0.8.0
 */
final class ActivityMigrator
{
	/**
	 * Option name storing the installed activity-table schema version.
	 *
	 * @var string
	 */
	public const DB_VERSION_OPTION = 'webmcp_adapter_db_version';

	/**
	 * Returns the fully-qualified activity table name for the current site.
	 *
	 * @return string The prefixed table name (for example `wp_webmcp_activity`).
	 */
	public function tableName(): string
	{
		return $GLOBALS['wpdb']->prefix . 'webmcp_activity';
	}

	/**
	 * Creates or upgrades the activity table when the schema version differs.
	 *
	 * Compares the stored schema version against {@see WEBMCP_ADAPTER_DB_VERSION}.
	 * When they match this returns immediately (the common case on every request).
	 * Otherwise it runs the table migration and records the new version.
	 *
	 * @return void
	 */
	public function maybeMigrate(): void
	{
		if (get_option(self::DB_VERSION_OPTION) === WEBMCP_ADAPTER_DB_VERSION) {
			return;
		}

		$this->createTable();

		update_option(self::DB_VERSION_OPTION, WEBMCP_ADAPTER_DB_VERSION);
	}

	/**
	 * Creates the activity table via dbDelta.
	 *
	 * Uses `dbDelta()`, which is idempotent: it creates the table or adds missing
	 * columns and keys. The schema string follows dbDelta's strict formatting rules
	 * (each field on its own line, two spaces after `PRIMARY KEY`, lowercase types).
	 *
	 * @return void
	 */
	private function createTable(): void
	{
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$wpdb            = $GLOBALS['wpdb'];
		$table           = $this->tableName();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			run_id varchar(64) NOT NULL,
			user_id bigint(20) unsigned NOT NULL,
			session_token varchar(64) NOT NULL DEFAULT '',
			created datetime NOT NULL,
			ability varchar(191) NOT NULL,
			outcome varchar(20) NOT NULL,
			screen_url text NULL,
			params longtext NULL,
			event_id varchar(64) NULL,
			actor_hash char(64) NULL,
			recorded_at_gmt datetime NULL,
			tool_name varchar(191) NULL,
			provider varchar(100) NULL,
			risk varchar(20) NULL,
			surface varchar(20) NULL,
			page_context varchar(100) NULL,
			page_path text NULL,
			duration_ms bigint(20) unsigned NULL,
			confirmation_outcome varchar(20) NULL,
			error_code varchar(64) NULL,
			safe_summary text NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY event_id (event_id),
			KEY run_id (run_id),
			KEY user_id (user_id),
			KEY created (created),
			KEY recorded_at_gmt (recorded_at_gmt)
		) {$charset_collate};";

		dbDelta($sql);
	}
}
