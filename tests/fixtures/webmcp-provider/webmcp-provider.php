<?php
/**
 * Plugin Name:       WebMCP Provider Fixture
 * Description:       Disposable page-scoped client Ability provider used by the WebMCP Adapter acceptance suite.
 * Version:           0.1.0
 * Requires at least: 7.0
 * Requires PHP:      8.1
 * License:           GPL-2.0-or-later
 * Text Domain:       webmcp-provider-fixture
 */

declare(strict_types=1);

namespace WebMCP\ProviderFixture;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Registers two fixture-owned admin pages and their client Ability modules.
 */
final class Plugin
{
	private const VERSION = '0.1.0';

	private const PRIMARY_SLUG = 'webmcp-provider-fixture-primary';

	private const SECONDARY_SLUG = 'webmcp-provider-fixture-secondary';

	private const CATEGORY_MODULE = 'webmcp-provider-fixture/category';

	private const PANEL_STATE_MODULE = 'webmcp-provider-fixture/panel-state';

	private const READ_MODULE = 'webmcp-provider-fixture/get-panel-state';

	private const TONE_MODULE = 'webmcp-provider-fixture/set-panel-tone';

	/** @var array<string,string> Admin page hook suffixes keyed by fixture page. */
	private array $pageHooks = [];

	/** Registers the fixture's normal WordPress extension hooks. */
	public function register(): void
	{
		add_action('admin_menu', [$this, 'registerPages']);
		add_action('admin_enqueue_scripts', [$this, 'enqueueForPage']);
		add_filter(
			'webmcp_activity_ability_definitions',
			[$this, 'addActivityDefinitions']
		);
	}

	/** Adds two plugin-owned pages used to prove one-page and shared providers. */
	public function registerPages(): void
	{
		$this->pageHooks['primary'] = add_menu_page(
			__('WebMCP Fixture', 'webmcp-provider-fixture'),
			__('WebMCP Fixture', 'webmcp-provider-fixture'),
			'read',
			self::PRIMARY_SLUG,
			[$this, 'renderPrimaryPage'],
			'dashicons-admin-generic',
			81
		);
		$this->pageHooks['secondary'] = add_submenu_page(
			self::PRIMARY_SLUG,
			__('Shared Fixture Page', 'webmcp-provider-fixture'),
			__('Shared Fixture Page', 'webmcp-provider-fixture'),
			'read',
			self::SECONDARY_SLUG,
			[$this, 'renderSecondaryPage']
		);
	}

	/**
	 * Enqueues the shared tone Ability on both fixture pages and the read only on
	 * the primary page. Module presence is the complete page-selection contract.
	 */
	public function enqueueForPage(string $hookSuffix): void
	{
		$page = array_search($hookSuffix, $this->pageHooks, true);
		if (!is_string($page)) {
			return;
		}
		if (!function_exists('wp_register_script_module') || !function_exists('wp_enqueue_script_module')) {
			return;
		}

		$baseUrl = plugin_dir_url(__FILE__);
		wp_register_script_module(
			self::PANEL_STATE_MODULE,
			$baseUrl . 'src/panel-state.js',
			[],
			self::VERSION
		);
		wp_register_script_module(
			self::CATEGORY_MODULE,
			$baseUrl . 'src/category.js',
			['@wordpress/abilities'],
			self::VERSION
		);
		wp_register_script_module(
			self::TONE_MODULE,
			$baseUrl . 'src/set-panel-tone.js',
			[
				'@wordpress/abilities',
				self::CATEGORY_MODULE,
				self::PANEL_STATE_MODULE,
			],
			self::VERSION
		);
		wp_register_script_module(
			self::READ_MODULE,
			$baseUrl . 'src/get-panel-state.js',
			[
				'@wordpress/abilities',
				self::CATEGORY_MODULE,
				self::PANEL_STATE_MODULE,
			],
			self::VERSION
		);

		wp_enqueue_script_module(self::TONE_MODULE);
		if ('primary' === $page) {
			wp_enqueue_script_module(self::READ_MODULE);
		}
	}

	/**
	 * Adds bounded server-side activity allowlist entries for both client Abilities.
	 *
	 * The adapter stays provider-neutral: WordPress invokes this normal filter only
	 * when the fixture plugin is active.
	 *
	 * @param array<string,array<string,mixed>> $definitions Existing definitions.
	 * @return array<string,array<string,mixed>> Definitions including the fixture.
	 */
	public function addActivityDefinitions(array $definitions): array
	{
		$definitions['webmcp-provider-fixture/get-panel-state'] = [
			'provider' => 'WebMCP Provider Fixture',
			'risk'     => 'read',
		];
		$definitions['webmcp-provider-fixture/set-panel-tone'] = [
			'provider' => 'WebMCP Provider Fixture',
			'risk'     => 'reversible',
		];

		return $definitions;
	}

	/** Renders the page owning the read and shared reversible Abilities. */
	public function renderPrimaryPage(): void
	{
		$this->renderPage(
			'primary',
			__('Primary fixture page', 'webmcp-provider-fixture'),
			__('This page owns the panel-state read and shares the visible tone setter.', 'webmcp-provider-fixture'),
			true
		);
	}

	/** Renders the second page owning only the shared reversible Ability. */
	public function renderSecondaryPage(): void
	{
		$this->renderPage(
			'secondary',
			__('Shared fixture page', 'webmcp-provider-fixture'),
			__('This page loads the same visible tone setter and does not load the primary-page read.', 'webmcp-provider-fixture'),
			false
		);
	}

	private function renderPage(string $page, string $title, string $description, bool $showLifecycleControls): void
	{
		if (!current_user_can('read')) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php echo esc_html($title); ?></h1>
			<p><?php echo esc_html($description); ?></p>
			<div
				class="card"
				data-webmcp-provider-panel
				data-webmcp-provider-page="<?php echo esc_attr($page); ?>"
				data-webmcp-provider-tone="calm"
			>
				<h2><?php esc_html_e('Fixture panel', 'webmcp-provider-fixture'); ?></h2>
				<p>
					<?php esc_html_e('Current tone:', 'webmcp-provider-fixture'); ?>
					<output data-webmcp-provider-tone-output>calm</output>
				</p>
			</div>
			<?php if ($showLifecycleControls) : ?>
				<h2><?php esc_html_e('Ability lifecycle', 'webmcp-provider-fixture'); ?></h2>
				<p>
					<button type="button" class="button" data-webmcp-provider-remove-read>
						<?php esc_html_e('Remove panel-state read', 'webmcp-provider-fixture'); ?>
					</button>
					<button type="button" class="button" data-webmcp-provider-restore-read>
						<?php esc_html_e('Restore panel-state read', 'webmcp-provider-fixture'); ?>
					</button>
					<output data-webmcp-provider-registration-status aria-live="polite">
						<?php esc_html_e('Registered', 'webmcp-provider-fixture'); ?>
					</output>
				</p>
			<?php endif; ?>
		</div>
		<?php
	}
}

(new Plugin())->register();
