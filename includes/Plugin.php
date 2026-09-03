<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Bootstraps the WebMCP Adapter.
 *
 * Registers and enqueues the browser adapter script module that maps
 * WordPress abilities onto the WebMCP API (document.modelContext).
 *
 * @since 0.1.0
 */
final class Plugin
{
	/**
	 * Script module handle for the browser adapter.
	 *
	 * @var string
	 */
	private const MODULE_HANDLE = 'webmcp-adapter/adapter';

	/**
	 * Registers WordPress hooks.
	 *
	 * @return void
	 */
	public function register(): void
	{
		(new Settings())->register();

		// Create or upgrade the agent-activity table on admin load. The migrator
		// no-ops cheaply once the schema version matches, so running it on every
		// admin request is safe (this is an admin-only plugin).
		add_action('admin_init', [new ActivityMigrator(), 'maybeMigrate']);

		// Register the gated record/list REST routes (webmcp/v1/activity). The
		// controller hooks itself onto rest_api_init.
		(new ActivityRestController())->register();

		// Server-rendered "Agent activity" review screen under Tools. Reads the
		// activity store; manage_options only.
		(new ActivityScreen())->register();

		// Admin-only by default. Front-end exposure is opt-in and added later.
		add_action('admin_enqueue_scripts', [$this, 'enqueueAdapter']);

		// Ship the exposure toggles to the adapter as script-module data. The
		// filter is registered unconditionally at load because core prints module
		// data late (`print_script_module_data`), only for queued modules.
		add_filter('script_module_data_' . self::MODULE_HANDLE, [$this, 'addModuleData']);
	}

	/**
	 * Registers and enqueues the adapter script module.
	 *
	 * Depends on the Abilities API client module. The adapter reads the client
	 * ability store and registers frontend abilities as WebMCP tools. It does not
	 * load or expose server abilities.
	 *
	 * @return void
	 */
	public function enqueueAdapter(): void
	{
		// Abilities API (server) must be present.
		if (!function_exists('wp_get_abilities')) {
			return;
		}

		// Script Modules API must be present (WordPress 6.5+).
		if (!function_exists('wp_register_script_module') || !function_exists('wp_enqueue_script_module')) {
			return;
		}

		wp_register_script_module(
			self::MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/adapter.js',
			['@wordpress/abilities'],
			WEBMCP_ADAPTER_VERSION
		);

		wp_enqueue_script_module(self::MODULE_HANDLE);
	}

	/**
	 * Adds the write and destructive toggles to the adapter's script-module data.
	 *
	 * Core serializes this array into a `<script type="application/json"
	 * id="wp-script-module-data-webmcp-adapter/adapter">` tag the adapter reads on
	 * load. The flags are ALWAYS emitted (never an empty array) so their absence is
	 * unambiguous: a missing tag means the filter did not run, which the adapter
	 * treats — like a false value — as writes disabled (fail-safe).
	 * `allowAutomatedConfirmation` is the default-OFF demo flag that relaxes the
	 * in-page synthetic-click guard. `screenLinks` is the writes-only map
	 * of ability name to an admin-relative URL template; `adminUrl` is the wp-admin
	 * base used to build an absolute link from such a template.
	 *
	 * @param array<string,mixed> $data Existing module data.
	 * @return array<string,mixed> Data including the exposure flags, screen-link map,
	 *                             and wp-admin base URL.
	 */
	public function addModuleData(array $data): array
	{
		$data['writeToolsEnabled']       = Settings::isEnabled();
		$data['destructiveToolsEnabled'] = Settings::isDestructiveEnabled();
		$data['allowAutomatedConfirmation'] = Settings::isAutomatedConfirmationAllowed();
		// Writes-only map of ability name to an admin-relative URL template (with
		// {param} tokens). Abilities register their own screen via this filter; the
		// adapter resolves a write tool to its wp-admin URL at log time.
		$data['screenLinks'] = apply_filters('webmcp_screen_links', array());
		$data['adminUrl']    = admin_url();

		return $data;
	}
}
