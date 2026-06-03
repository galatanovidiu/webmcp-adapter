<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Admin setting that gates write-tool exposure (the catalog's Option-B model).
 *
 * Owns a single boolean option, `webmcp_enable_write_tools` (default off). When
 * off, the browser adapter exposes only read-only abilities as WebMCP tools; when
 * on, non-destructive write abilities are exposed too. The option is the EXPOSURE
 * gate only — each ability's `permission_callback` (capability) remains the hard
 * authorization guard underneath in all cases.
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
	 * Gates exposure of DESTRUCTIVE write abilities (permanent deletes, plugin
	 * activate/deactivate, theme switch, connector register/unregister, permalink
	 * and site-editor data changes). Independent of and additional to
	 * {@see self::OPTION}: a destructive tool is exposed only when BOTH toggles are
	 * on. Default off; capability remains the hard guard underneath.
	 *
	 * @var string
	 */
	public const OPTION_DESTRUCTIVE = 'webmcp_enable_destructive_tools';

	/**
	 * Option name storing the dangerous-tools toggle.
	 *
	 * Gates exposure of the strictest tier (T3): abilities annotated
	 * `dangerous` (in addition to `destructive`). These install/update/delete
	 * plugins and themes on disk, write a small allow-list of options, or
	 * generate a privacy export. Independent of and additional to
	 * {@see self::OPTION} and {@see self::OPTION_DESTRUCTIVE}: a dangerous tool
	 * is exposed only when all THREE toggles are on AND it is individually opted
	 * in via {@see self::OPTION_DANGEROUS_OPTIN}. Default off; capability remains
	 * the hard guard underneath.
	 *
	 * @var string
	 */
	public const OPTION_DANGEROUS = 'webmcp_enable_dangerous_tools';

	/**
	 * Option name storing the per-ability dangerous-tools opt-in.
	 *
	 * Stores an array of dangerous ability names the admin has individually armed.
	 * Enabling the tier toggle ({@see self::OPTION_DANGEROUS}) is not enough on its
	 * own: a dangerous ability is exposed only when its name is also present here,
	 * so arming the tier does not arm every dangerous tool at once.
	 *
	 * @var string
	 */
	public const OPTION_DANGEROUS_OPTIN = 'webmcp_dangerous_tools_optin';

	/**
	 * Option name storing the "allow automated confirmation" toggle.
	 *
	 * When OFF (default), the in-page destructive/dangerous confirmation modal
	 * accepts only a real human click — the adapter rejects synthetic, script-
	 * dispatched clicks via `event.isTrusted`. When a human turns this ON, the
	 * adapter relaxes that gate so a script or agent can click the confirmation
	 * automatically. Intended for demos / proof-of-concept recordings ONLY, never
	 * production. Enabling it is a deliberate `manage_options` action; the in-page
	 * agent cannot flip it. Default off; the three exposure toggles + capability
	 * remain the hard guards underneath.
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
	 * Returns whether dangerous tools are enabled at the tier level.
	 *
	 * Requires all THREE toggles: write, destructive, and dangerous. This is the
	 * tier gate only; an individual dangerous ability is exposed only when it is
	 * also opted in via {@see self::optedInTools()}. Fail-safe: any non-true stored
	 * value (including a missing option) reads as disabled.
	 *
	 * @return bool True when dangerous tools are enabled at the tier level.
	 */
	public static function isDangerousEnabled(): bool
	{
		return self::isDestructiveEnabled()
			&& true === rest_sanitize_boolean(get_option(self::OPTION_DANGEROUS, false));
	}

	/**
	 * Returns the registered dangerous tools as an `ability-name => label` map.
	 *
	 * The list is contributed by the abilities plugin through the
	 * `webmcp_dangerous_tools` filter; with no dangerous ability present the map is
	 * empty. The adapter does not own the catalog, so it reads it from the filter.
	 *
	 * @return array<string,string> Map of ability name to human-readable label.
	 */
	public static function dangerousTools(): array
	{
		return apply_filters('webmcp_dangerous_tools', array());
	}

	/**
	 * Returns the per-ability dangerous opt-in as a clean list of ability names.
	 *
	 * The stored value is intersected with the currently-known dangerous tool names
	 * so unknown or stale entries are dropped (fail-safe). Guards against a
	 * non-array stored value.
	 *
	 * @return array<int,string> Opted-in ability names that are currently known.
	 */
	public static function optedInTools(): array
	{
		$stored = get_option(self::OPTION_DANGEROUS_OPTIN, array());

		if (!is_array($stored)) {
			return array();
		}

		return array_values(array_intersect($stored, array_keys(self::dangerousTools())));
	}

	/**
	 * Returns whether automated (non-human) confirmation is allowed.
	 *
	 * Default-OFF escape hatch for demos: when true, the in-page confirmation modal
	 * accepts synthetic clicks so a script can drive destructive/dangerous tools
	 * end-to-end. When false (the default), only a real human click confirms.
	 * Fail-safe: any non-true stored value (including a missing option) reads as
	 * disabled (human-only).
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

		register_setting(
			self::PAGE,
			self::OPTION_DANGEROUS,
			[
				'type'              => 'boolean',
				'description'       => __('Expose dangerous write abilities as WebMCP tools.', 'webmcp-adapter'),
				'sanitize_callback' => static fn($value): bool => true === rest_sanitize_boolean($value),
				'default'           => false,
				'show_in_rest'      => false,
			]
		);

		register_setting(
			self::PAGE,
			self::OPTION_DANGEROUS_OPTIN,
			[
				'type'              => 'array',
				'description'       => __('Per-ability opt-in for dangerous WebMCP tools.', 'webmcp-adapter'),
				'sanitize_callback' => [$this, 'sanitizeOptIn'],
				'default'           => array(),
				'show_in_rest'      => false,
			]
		);

		add_settings_section(
			'webmcp_adapter_dangerous',
			__('Dangerous tools', 'webmcp-adapter'),
			[$this, 'renderDangerousSectionIntro'],
			self::PAGE
		);

		add_settings_field(
			self::OPTION_DANGEROUS,
			__('Enable dangerous tools', 'webmcp-adapter'),
			[$this, 'renderDangerousField'],
			self::PAGE,
			'webmcp_adapter_dangerous',
			['label_for' => self::OPTION_DANGEROUS]
		);

		add_settings_field(
			self::OPTION_DANGEROUS_OPTIN,
			__('Arm individual dangerous tools', 'webmcp-adapter'),
			[$this, 'renderDangerousOptInField'],
			self::PAGE,
			'webmcp_adapter_dangerous'
		);

		register_setting(
			self::PAGE,
			self::OPTION_ALLOW_AUTOMATED_CONFIRMATION,
			[
				'type'              => 'boolean',
				'description'       => __('Allow a script or agent to confirm the in-page destructive prompt automatically (demo only).', 'webmcp-adapter'),
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
			'webmcp_adapter_dangerous',
			['label_for' => self::OPTION_ALLOW_AUTOMATED_CONFIRMATION]
		);
	}

	/**
	 * Sanitizes the per-ability dangerous opt-in array.
	 *
	 * Casts the submitted value to an array, cleans each entry as an ability-name
	 * string, and keeps ONLY entries present in the currently-known dangerous tools
	 * (deny unknown). Returns a clean, re-indexed list of ability names.
	 *
	 * @param mixed $value The submitted option value.
	 * @return array<int,string> The sanitized, allow-listed opt-in names.
	 */
	public function sanitizeOptIn($value): array
	{
		$value = is_array($value) ? $value : array();
		$known = array_keys(self::dangerousTools());

		$clean = array();
		foreach ($value as $entry) {
			$entry = sanitize_text_field((string) $entry);

			if (in_array($entry, $known, true)) {
				$clean[] = $entry;
			}
		}

		return array_values(array_unique($clean));
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
			'When enabled, non-destructive write abilities (create, update, trash, comment moderation) are exposed to the in-browser AI agent as WebMCP tools. Capability checks still apply to every action. Default: off.',
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
			esc_html__('Expose write tools to the browser AI agent', 'webmcp-adapter')
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
			esc_html__('Also expose destructive tools (permanent deletes, plugin activate/deactivate, theme switch, connectors, permalink and site-editor changes)', 'webmcp-adapter'),
			esc_html__('Requires "Enable write tools" to also be on. Destructive tools are irreversible; each call pops an in-page confirmation you must approve before it runs. Default: off.', 'webmcp-adapter')
		);
	}

	/**
	 * Renders the dangerous-tools section description.
	 *
	 * @return void
	 */
	public function renderDangerousSectionIntro(): void
	{
		echo '<p>' . esc_html__(
			'Dangerous tools install, update, or delete plugins and themes on disk, write a small allow-list of options, or generate a privacy export. They require all three toggles ("Enable write tools", "Enable destructive tools", and "Enable dangerous tools") AND a per-tool opt-in below — arming the tier does not arm every tool at once. Capability checks still apply to every action. Default: off.',
			'webmcp-adapter'
		) . '</p>';
	}

	/**
	 * Renders the dangerous-tools tier checkbox field.
	 *
	 * @return void
	 */
	public function renderDangerousField(): void
	{
		$enabled = true === rest_sanitize_boolean(get_option(self::OPTION_DANGEROUS, false));

		printf(
			'<label for="%1$s"><input type="checkbox" id="%1$s" name="%1$s" value="1" %2$s /> %3$s</label><p class="description">%4$s</p>',
			esc_attr(self::OPTION_DANGEROUS),
			checked($enabled, true, false),
			esc_html__('Also expose dangerous tools (plugin/theme install, update, delete; allow-listed option writes; privacy export)', 'webmcp-adapter'),
			esc_html__('Requires "Enable write tools" AND "Enable destructive tools" to also be on, plus a per-tool opt-in below. Default: off.', 'webmcp-adapter')
		);
	}

	/**
	 * Renders the per-ability dangerous opt-in checkboxes.
	 *
	 * @return void
	 */
	public function renderDangerousOptInField(): void
	{
		$tools = self::dangerousTools();

		if (array() === $tools) {
			echo '<p class="description">' . esc_html__('No dangerous tools are currently registered.', 'webmcp-adapter') . '</p>';

			return;
		}

		$opted_in = self::optedInTools();

		foreach ($tools as $name => $label) {
			printf(
				'<label style="display:block"><input type="checkbox" name="%1$s[]" value="%2$s" %3$s /> %4$s</label>',
				esc_attr(self::OPTION_DANGEROUS_OPTIN),
				esc_attr($name),
				checked(in_array($name, $opted_in, true), true, false),
				esc_html($label)
			);
		}
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
			esc_html__('Let a script or AI agent confirm the in-page destructive prompt automatically, without a human click', 'webmcp-adapter'),
			esc_html__('SECURITY: for demos / proof-of-concept recordings ONLY. When on, the human-only confirmation guard is relaxed and an unattended agent can approve its own destructive actions. Leave off in production. Default: off.', 'webmcp-adapter')
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
			esc_html__('WebMCP: "Allow automated confirmation" is ON. The human-only confirmation guard is relaxed — an AI agent can approve its own destructive actions without a human click. Turn it off when you are done recording or testing.', 'webmcp-adapter')
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
		echo '<form action="options.php" method="post">';
		settings_fields(self::PAGE);
		do_settings_sections(self::PAGE);
		submit_button();
		echo '</form>';
		echo '</div>';
	}
}
