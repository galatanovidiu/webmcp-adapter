<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Admin settings that gate frontend write-tool exposure.
 *
 * Owns the default-off write and destructive exposure options. With writes off,
 * the browser adapter exposes only read-only frontend abilities. With writes on,
 * non-destructive editor mutations become available; the separate destructive
 * option adds the save/publish tool.
 *
 * Changing the setting requires `manage_options`. The value is read by
 * {@see Plugin::addModuleData()} and shipped to the adapter as script-module data.
 *
 * @since 0.2.0
 */
final class Settings
{
	/**
	 * Option name storing the write-tools toggle.
	 *
	 * @var string
	 */
	public const OPTION = 'webmcp_enable_write_tools';

	/**
	 * Option name storing the destructive-tools toggle.
	 *
	 * Gates exposure of the destructive frontend save/publish ability. Independent
	 * of and additional to {@see self::OPTION}: the tool is exposed only when BOTH
	 * toggles are on. Default off.
	 *
	 * @var string
	 */
	public const OPTION_DESTRUCTIVE = 'webmcp_enable_destructive_tools';

	/**
	 * Option name storing the "allow automated confirmation" toggle.
	 *
	 * When OFF (default), the in-page destructive confirmation modal
	 * rejects synthetic, page-script-dispatched clicks via `event.isTrusted`.
	 * This is not proof of human intent: privileged browser automation can still
	 * produce a trusted event. When an administrator turns this ON, the
	 * adapter relaxes that gate so ChatGPT Work, Codex, or a test script can click the confirmation
	 * automatically. Intended for demos / proof-of-concept recordings ONLY, never
	 * production. Enabling it is a deliberate `manage_options` action; the in-page
	 * Site tools client cannot flip it. Default off; the exposure toggles remain the hard
	 * guards underneath.
	 *
	 * @var string
	 */
	public const OPTION_ALLOW_AUTOMATED_CONFIRMATION = 'webmcp_allow_automated_confirmation';

	/**
	 * Settings group / page slug.
	 *
	 * @var string
	 */
	private const PAGE = 'webmcp-adapter';

	/**
	 * Registers the admin-side hooks for the setting and its options page.
	 *
	 * @return void
	 */
	public function register(): void
	{
		add_action('admin_init', [$this, 'registerSetting']);
		add_action('admin_menu', [$this, 'registerPage']);
		add_action('admin_notices', [$this, 'renderAutomatedConfirmationNotice']);
	}

	/**
	 * Returns whether write tools are enabled.
	 *
	 * Fail-safe: any non-true stored value (including a missing option) reads as
	 * disabled. This mirrors the adapter's client-side default.
	 *
	 * @return bool True when write tools are enabled.
	 */
	public static function isEnabled(): bool
	{
		return true === rest_sanitize_boolean(get_option(self::OPTION, false));
	}

	/**
	 * Returns whether destructive write tools are enabled.
	 *
	 * Requires BOTH the write-tools toggle and the destructive-tools toggle: a
	 * destructive ability is never exposed unless writes are enabled too. Fail-safe:
	 * any non-true stored value (including a missing option) reads as disabled.
	 *
	 * @return bool True when destructive write tools are enabled.
	 */
	public static function isDestructiveEnabled(): bool
	{
		return self::isEnabled()
			&& true === rest_sanitize_boolean(get_option(self::OPTION_DESTRUCTIVE, false));
	}

	/**
	 * Returns whether automated (non-human) confirmation is allowed.
	 *
	 * Default-OFF escape hatch for demos: when true, the in-page confirmation modal
	 * accepts synthetic clicks so a script can drive destructive tools
	 * end-to-end. When false (the default), page-script synthetic clicks are
	 * rejected.
	 * Fail-safe: any non-true stored value (including a missing option) reads as
	 * disabled.
	 *
	 * @return bool True when automated confirmation is allowed.
	 */
	public static function isAutomatedConfirmationAllowed(): bool
	{
		return true === rest_sanitize_boolean(get_option(self::OPTION_ALLOW_AUTOMATED_CONFIRMATION, false));
	}

	/**
	 * Registers the option and its single settings field.
	 *
	 * @return void
	 */
	public function registerSetting(): void
	{
		register_setting(
			self::PAGE,
			self::OPTION,
			[
				'type'              => 'boolean',
				'description'       => __('Expose write abilities as WebMCP tools.', 'webmcp-adapter'),
				'sanitize_callback' => static fn($value): bool => true === rest_sanitize_boolean($value),
				'default'           => false,
				'show_in_rest'      => false,
			]
		);

		add_settings_section(
			'webmcp_adapter_writes',
			__('Write tools', 'webmcp-adapter'),
			[$this, 'renderSectionIntro'],
			self::PAGE
		);

		add_settings_field(
			self::OPTION,
			__('Enable write tools', 'webmcp-adapter'),
			[$this, 'renderField'],
			self::PAGE,
			'webmcp_adapter_writes',
			['label_for' => self::OPTION]
		);

		register_setting(
			self::PAGE,
			self::OPTION_DESTRUCTIVE,
			[
				'type'              => 'boolean',
				'description'       => __('Expose destructive write abilities as WebMCP tools.', 'webmcp-adapter'),
				'sanitize_callback' => static fn($value): bool => true === rest_sanitize_boolean($value),
				'default'           => false,
				'show_in_rest'      => false,
			]
		);

		add_settings_field(
			self::OPTION_DESTRUCTIVE,
			__('Enable destructive tools', 'webmcp-adapter'),
			[$this, 'renderDestructiveField'],
			self::PAGE,
			'webmcp_adapter_writes',
			['label_for' => self::OPTION_DESTRUCTIVE]
		);

		add_settings_section(
			'webmcp_adapter_confirmation',
			__('Confirmation', 'webmcp-adapter'),
			[$this, 'renderConfirmationSectionIntro'],
			self::PAGE
		);

		register_setting(
			self::PAGE,
			self::OPTION_ALLOW_AUTOMATED_CONFIRMATION,
			[
				'type'              => 'boolean',
				'description'       => __('Allow ChatGPT Work, Codex, or a test script to confirm the in-page persistence prompt automatically (demo only).', 'webmcp-adapter'),
				'sanitize_callback' => static fn($value): bool => true === rest_sanitize_boolean($value),
				'default'           => false,
				'show_in_rest'      => false,
			]
		);

		add_settings_field(
			self::OPTION_ALLOW_AUTOMATED_CONFIRMATION,
			__('Allow automated confirmation (demo)', 'webmcp-adapter'),
			[$this, 'renderAutomatedConfirmationField'],
			self::PAGE,
			'webmcp_adapter_confirmation',
			['label_for' => self::OPTION_ALLOW_AUTOMATED_CONFIRMATION]
		);
	}

	/**
	 * Registers the options page under the Settings menu.
	 *
	 * @return void
	 */
	public function registerPage(): void
	{
		add_options_page(
			__('WebMCP', 'webmcp-adapter'),
			__('WebMCP', 'webmcp-adapter'),
			'manage_options',
			self::PAGE,
			[$this, 'renderPage']
		);
	}

	/**
	 * Renders the section description.
	 *
	 * @return void
	 */
	public function renderSectionIntro(): void
	{
		echo '<p>' . esc_html__(
			'When enabled, frontend editor abilities can stage unsaved block and document changes in the open editor. Default: off.',
			'webmcp-adapter'
		) . '</p>';
	}

	/**
	 * Renders the checkbox field.
	 *
	 * @return void
	 */
	public function renderField(): void
	{
		$enabled = self::isEnabled();

		printf(
			'<label for="%1$s"><input type="checkbox" id="%1$s" name="%1$s" value="1" %2$s /> %3$s</label>',
			esc_attr(self::OPTION),
			checked($enabled, true, false),
			esc_html__('Expose write tools to ChatGPT Work and Codex', 'webmcp-adapter')
		);
	}

	/**
	 * Renders the destructive-tools checkbox field.
	 *
	 * @return void
	 */
	public function renderDestructiveField(): void
	{
		$enabled = true === rest_sanitize_boolean(get_option(self::OPTION_DESTRUCTIVE, false));

		printf(
			'<label for="%1$s"><input type="checkbox" id="%1$s" name="%1$s" value="1" %2$s /> %3$s</label><p class="description">%4$s</p>',
			esc_attr(self::OPTION_DESTRUCTIVE),
			checked($enabled, true, false),
			esc_html__('Also expose the save/publish tool', 'webmcp-adapter'),
			esc_html__('Requires "Enable write tools" to also be on. Saving persists the open editor state; each call pops an in-page confirmation you must approve before it runs. Default: off.', 'webmcp-adapter')
		);
	}

	/**
	 * Renders the confirmation section description.
	 *
	 * @return void
	 */
	public function renderConfirmationSectionIntro(): void
	{
		echo '<p>' . esc_html__(
			'Save and publish calls require an in-page trusted event. The testing option below relaxes the page-script synthetic-click guard and should stay off outside a disposable demo.',
			'webmcp-adapter'
		) . '</p>';
	}

	/**
	 * Renders the "allow automated confirmation" checkbox field.
	 *
	 * @return void
	 */
	public function renderAutomatedConfirmationField(): void
	{
		$enabled = self::isAutomatedConfirmationAllowed();

		printf(
			'<label for="%1$s"><input type="checkbox" id="%1$s" name="%1$s" value="1" %2$s /> %3$s</label><p class="description">%4$s</p>',
			esc_attr(self::OPTION_ALLOW_AUTOMATED_CONFIRMATION),
			checked($enabled, true, false),
			esc_html__('Let ChatGPT Work, Codex, or a test script confirm the in-page persistence prompt automatically, without a trusted event', 'webmcp-adapter'),
			esc_html__('SECURITY: for demos / proof-of-concept recordings ONLY. When on, the page-script synthetic-click guard is relaxed and ChatGPT Work or Codex can approve a persistence action automatically. Leave off in production. Default: off.', 'webmcp-adapter')
		);
	}

	/**
	 * Shows a persistent admin warning while automated confirmation is enabled.
	 *
	 * A default-OFF safety bypass must never be silently left on. While the toggle
	 * is on, every admin page shows a warning so an operator notices it and can turn
	 * it back off after a demo.
	 *
	 * @return void
	 */
	public function renderAutomatedConfirmationNotice(): void
	{
		if (!self::isAutomatedConfirmationAllowed() || !current_user_can('manage_options')) {
			return;
		}

		printf(
			'<div class="notice notice-warning"><p>%s</p></div>',
			esc_html__('WebMCP: "Allow automated confirmation" is ON. The page-script synthetic-click guard is relaxed — ChatGPT Work or Codex can approve a persistence action without a trusted click. Turn it off when you are done recording or testing.', 'webmcp-adapter')
		);
	}

	/**
	 * Renders the options page.
	 *
	 * @return void
	 */
	public function renderPage(): void
	{
		if (!current_user_can('manage_options')) {
			return;
		}

		echo '<div class="wrap">';
		echo '<h1>' . esc_html(get_admin_page_title()) . '</h1>';
		echo '<p>' . esc_html__(
			'This plugin exposes frontend WordPress editor abilities as Site tools for ChatGPT Work and Codex in the ChatGPT desktop app’s built-in browser.',
			'webmcp-adapter'
		) . '</p>';
		echo '<form action="options.php" method="post">';
		settings_fields(self::PAGE);
		do_settings_sections(self::PAGE);
		submit_button();
		echo '</form>';
		echo '</div>';
	}
}
