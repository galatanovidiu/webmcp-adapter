<?php
/**
 * Plugin Name:       WebMCP Adapter
 * Plugin URI:        https://github.com/galatanovidiu/webmcp-adapter
 * Description:       Exposes frontend WordPress editor abilities as Site tools for ChatGPT Work and Codex in the ChatGPT desktop app's built-in browser.
 * Version:           0.15.1
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

define('WEBMCP_ADAPTER_VERSION', '0.15.1');
define('WEBMCP_ADAPTER_DB_VERSION', '1');
define('WEBMCP_ADAPTER_FILE', __FILE__);
define('WEBMCP_ADAPTER_DIR', plugin_dir_path(__FILE__));
define('WEBMCP_ADAPTER_URL', plugin_dir_url(__FILE__));

require_once WEBMCP_ADAPTER_DIR . 'includes/PageContext.php';
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
