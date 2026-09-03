<?php

declare(strict_types=1);

define('WP_UNINSTALL_PLUGIN', true);

$deletedOptions = [];
$clearedHooks   = [];

function delete_option(string $option): void
{
	global $deletedOptions;
	$deletedOptions[] = $option;
}

function wp_clear_scheduled_hook(string $hook): void
{
	global $clearedHooks;
	$clearedHooks[] = $hook;
}

final class UninstallWpdb
{
	public string $prefix = 'wp_';

	public string $options = 'wp_options';

	/** @var list<string> */
	public array $queries = [];

	public function esc_like(string $value): string
	{
		return $value;
	}

	public function prepare(string $query, string ...$values): string
	{
		foreach ($values as $value) {
			$query = preg_replace('/%s/', "'{$value}'", $query, 1) ?? $query;
		}

		return $query;
	}

	public function query(string $query): int
	{
		$this->queries[] = $query;

		return 1;
	}
}

$wpdb = new UninstallWpdb();

require __DIR__ . '/../uninstall.php';

$expectedOptions = [
	'webmcp_adapter_db_version',
	'webmcp_enable_write_tools',
	'webmcp_enable_destructive_tools',
	'webmcp_allow_automated_confirmation',
];

$checks = [
	'activity table is dropped' => in_array('DROP TABLE IF EXISTS wp_webmcp_activity', $wpdb->queries, true),
	'retention schedule is cleared' => ['webmcp_adapter_prune_activity'] === $clearedHooks,
	'all persistent plugin options are deleted' => $expectedOptions === $deletedOptions,
	'anonymous rate-limit transients and timeouts are deleted' => 2 === count($wpdb->queries) &&
		str_contains($wpdb->queries[1], "option_name LIKE '_transient_webmcp_rate_%'") &&
		str_contains($wpdb->queries[1], "option_name LIKE '_transient_timeout_webmcp_rate_%'"),
];

$failed = 0;
foreach ($checks as $label => $passed) {
	echo ($passed ? 'PASS ' : 'FAIL ') . $label . "\n";
	$failed += $passed ? 0 : 1;
}

echo (count($checks) - $failed) . ' passed, ' . $failed . " failed\n";
exit($failed > 0 ? 1 : 0);
