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
	 * Script module handle for pure adapter contract helpers.
	 *
	 * @var string
	 */
	private const ADAPTER_CONTRACT_MODULE_HANDLE = 'webmcp-adapter/adapter-contract';

	/**
	 * Script module handle for Ability registration lifecycle synchronization.
	 *
	 * @var string
	 */
	private const ABILITY_SYNCHRONIZER_MODULE_HANDLE = 'webmcp-adapter/ability-synchronizer';

	/**
	 * Script module handle for the legacy all-admin editor provider.
	 *
	 * @var string
	 */
	private const EDITOR_PROVIDER_MODULE_HANDLE = 'webmcp-adapter/editor-provider';

	/** @var string Shared first-party Ability category module. */
	private const CATEGORY_MODULE_HANDLE = 'webmcp-adapter/category';

	/** @var string Shared destination normalization module. */
	private const DESTINATIONS_MODULE_HANDLE = 'webmcp-adapter/destinations';

	/** @var string Page-context Ability provider module. */
	private const PAGE_CONTEXT_MODULE_HANDLE = 'webmcp-adapter/page-context';

	/** @var string Public navigation Ability provider module. */
	private const SITE_DESTINATIONS_MODULE_HANDLE = 'webmcp-adapter/site-destinations';

	/** @var string Management navigation Ability provider module. */
	private const ADMIN_DESTINATIONS_MODULE_HANDLE = 'webmcp-adapter/admin-destinations';

	/**
	 * Registers WordPress hooks.
	 *
	 * @return void
	 */
	public function register(): void
	{
		// Create or upgrade the Site tools activity table on admin load. The migrator
		// no-ops cheaply once the schema version matches, so running it on every
		// admin request is safe (this is an admin-only plugin).
		add_action('admin_init', [new ActivityMigrator(), 'maybeMigrate']);

		// Register the gated record/list REST routes (webmcp/v1/activity). The
		// controller hooks itself onto rest_api_init.
		(new ActivityRestController())->register();

		// Server-rendered "Site tools activity" review screen under Tools. Reads the
		// activity store; manage_options only.
		(new ActivityScreen())->register();

		add_action('admin_enqueue_scripts', [$this, 'enqueueAdmin']);
		add_action('wp_enqueue_scripts', [$this, 'enqueueFrontend']);

		// Ship shared activity-link data to the adapter. The filter is registered
		// unconditionally because core prints data late, only for queued modules.
		add_filter('script_module_data_' . self::MODULE_HANDLE, [$this, 'addModuleData']);
		add_filter(
			'script_module_data_' . self::PAGE_CONTEXT_MODULE_HANDLE,
			[$this, 'addPageContextModuleData']
		);
	}

	/**
	 * Enqueues providers for the current wp-admin document.
	 *
	 * Depends on the Abilities API client module. The adapter reads the client
	 * ability store and registers frontend abilities as WebMCP tools. It does not
	 * load or expose server abilities.
	 *
	 * @return void
	 */
	public function enqueueAdmin(): void
	{
		if (!$this->registerModules()) {
			return;
		}

		wp_enqueue_script_module(self::PAGE_CONTEXT_MODULE_HANDLE);
		wp_enqueue_script_module(self::ADMIN_DESTINATIONS_MODULE_HANDLE);

		$screen = function_exists('get_current_screen') ? get_current_screen() : null;
		if ($screen instanceof \WP_Screen && $screen->is_block_editor()) {
			wp_enqueue_script_module(self::EDITOR_PROVIDER_MODULE_HANDLE);
		}

		wp_enqueue_script_module(self::MODULE_HANDLE);
	}

	/**
	 * Enqueues providers for the current normal frontend document.
	 *
	 * @return void
	 */
	public function enqueueFrontend(): void
	{
		if (!$this->registerModules()) {
			return;
		}

		// WordPress 7.0's @wordpress/abilities module reads these classic globals.
		wp_enqueue_script('wp-data');
		wp_enqueue_script('wp-i18n');

		wp_enqueue_script_module(self::PAGE_CONTEXT_MODULE_HANDLE);
		wp_enqueue_script_module(self::SITE_DESTINATIONS_MODULE_HANDLE);
		if (is_user_logged_in()) {
			wp_enqueue_script_module(self::ADMIN_DESTINATIONS_MODULE_HANDLE);
		}
		wp_enqueue_script_module(self::MODULE_HANDLE);
	}

	/**
	 * Registers the bridge and provider script modules once for this request.
	 *
	 * @return bool Whether the required WordPress APIs are available.
	 */
	private function registerModules(): bool
	{
		if (!function_exists('wp_get_abilities')) {
			return false;
		}
		if (!function_exists('wp_register_script_module') || !function_exists('wp_enqueue_script_module')) {
			return false;
		}

		wp_register_script_module(
			self::ADAPTER_CONTRACT_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/adapter-contract.js',
			[],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::ABILITY_SYNCHRONIZER_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/ability-synchronizer.js',
			[self::ADAPTER_CONTRACT_MODULE_HANDLE],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::CATEGORY_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/category.js',
			['@wordpress/abilities'],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::DESTINATIONS_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/destinations.js',
			[],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::PAGE_CONTEXT_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/page-context.js',
			['@wordpress/abilities', self::CATEGORY_MODULE_HANDLE],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::SITE_DESTINATIONS_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/list-site-destinations.js',
			[
				'@wordpress/abilities',
				self::CATEGORY_MODULE_HANDLE,
				self::DESTINATIONS_MODULE_HANDLE,
			],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::ADMIN_DESTINATIONS_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/list-admin-destinations.js',
			[
				'@wordpress/abilities',
				self::CATEGORY_MODULE_HANDLE,
				self::DESTINATIONS_MODULE_HANDLE,
			],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::EDITOR_PROVIDER_MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/abilities/index.js',
			['@wordpress/abilities', self::CATEGORY_MODULE_HANDLE],
			WEBMCP_ADAPTER_VERSION
		);

		wp_register_script_module(
			self::MODULE_HANDLE,
			WEBMCP_ADAPTER_URL . 'src/adapter.js',
			[
				'@wordpress/abilities',
				self::ABILITY_SYNCHRONIZER_MODULE_HANDLE,
			],
			WEBMCP_ADAPTER_VERSION
		);

		return true;
	}

	/**
	 * Adds the minimal current-document context to its provider module.
	 *
	 * @param array<string,mixed> $data Existing module data.
	 * @return array<string,mixed> Page context data.
	 */
	public function addPageContextModuleData(array $data): array
	{
		return array_merge($data, (new PageContext())->build());
	}

	/**
	 * Adds activity-link data to the adapter's script-module data.
	 *
	 * Core serializes this array into a `<script type="application/json"
	 * id="wp-script-module-data-webmcp-adapter/adapter">` tag the adapter reads on
	 * load. `screenLinks` is the writes-only map of Ability name to an
	 * admin-relative URL template; `adminUrl` is the wp-admin base used to build an
	 * absolute link from such a template.
	 *
	 * @param array<string,mixed> $data Existing module data.
	 * @return array<string,mixed> Data including the screen-link map and wp-admin URL.
	 */
	public function addModuleData(array $data): array
	{
		// Writes-only map of ability name to an admin-relative URL template (with
		// {param} tokens). Abilities register their own screen via this filter; the
		// adapter resolves a write tool to its wp-admin URL at log time.
		$data['screenLinks'] = apply_filters('webmcp_screen_links', array());
		$data['adminUrl']    = admin_url();

		return $data;
	}
}
