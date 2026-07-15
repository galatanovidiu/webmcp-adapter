<?php
/**
 * Plugin Name:       WebMCP Adapter
 * Plugin URI:        https://github.com/Automattic/wpwebmcp
 * Description:       Bridges the WordPress Abilities API to the browser WebMCP API (document.modelContext), exposing registered abilities as tools to in-browser AI agents.
 * Version:           0.9.0
 * Requires at least: 7.0
 * Requires PHP:      8.1
 * Author:            Automattic
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       webmcp-adapter
 *
 * @package WebmcpAdapter
 */

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

define('WEBMCP_ADAPTER_VERSION', '0.9.0');
define('WEBMCP_ADAPTER_DB_VERSION', '1');
define('WEBMCP_ADAPTER_FILE', __FILE__);
define('WEBMCP_ADAPTER_DIR', plugin_dir_path(__FILE__));
define('WEBMCP_ADAPTER_URL', plugin_dir_url(__FILE__));

require_once WEBMCP_ADAPTER_DIR . 'includes/Settings.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/Plugin.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/ActivityMigrator.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/ActivityRepository.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/ActivityRedactor.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/ActivityRestController.php';
require_once WEBMCP_ADAPTER_DIR . 'includes/ActivityScreen.php';

add_action(
	'plugins_loaded',
	static function (): void {
		(new Plugin())->register();
	}
);
