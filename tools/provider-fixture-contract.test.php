<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class WP_Error
{
	public function __construct(
		private string $code,
		private string $message = '',
		private array $data = []
	) {
	}

	public function get_error_code(): string
	{
		return $this->code;
	}
}

$testActions = [];
$testFilters = [];
$testModules = [];
$testEnqueuedModules = [];

function add_action(string $hook, $callback): void
{
	global $testActions;
	$testActions[$hook][] = $callback;
}

function add_filter(string $hook, $callback): void
{
	global $testFilters;
	$testFilters[$hook][] = $callback;
}

function apply_filters(string $hook, $value)
{
	global $testFilters;
	foreach ($testFilters[$hook] ?? [] as $callback) {
		$value = $callback($value);
	}

	return $value;
}

function __(string $message): string
{
	return $message;
}

function current_time(string $type, bool $gmt = false): string
{
	return $gmt ? '2026-09-03 10:00:00' : '2026-09-03 13:00:00';
}

function wp_salt(string $scheme = 'auth'): string
{
	return 'fixture-test-salt-' . $scheme;
}

function add_menu_page(): string
{
	return 'toplevel_page_webmcp-provider-fixture-primary';
}

function add_submenu_page(): string
{
	return 'webmcp-provider-fixture_page_webmcp-provider-fixture-secondary';
}

function wp_register_script_module(string $id, string $src, array $deps, string $version): void
{
	global $testModules;
	$testModules[$id] = compact('src', 'deps', 'version');
}

function wp_enqueue_script_module(string $id): void
{
	global $testEnqueuedModules;
	$testEnqueuedModules[] = $id;
}

function plugin_dir_url(string $file): string
{
	return 'https://example.test/wp-content/plugins/webmcp-provider-fixture/';
}

require_once __DIR__ . '/../includes/ActivityEventNormalizer.php';
require_once __DIR__ . '/../tests/fixtures/webmcp-provider/webmcp-provider.php';

use Automattic\WebmcpAdapter\ActivityEventNormalizer;
use WebMCP\ProviderFixture\Plugin;

$passed = 0;
$failed = 0;

function check(string $label, bool $condition, string $detail = ''): void
{
	global $passed, $failed;
	if ($condition) {
		++$passed;
		echo "PASS {$label}\n";
		return;
	}
	++$failed;
	echo "FAIL {$label}" . ('' === $detail ? '' : " — {$detail}") . "\n";
}

check(
	'fixture registers only normal admin and activity hooks',
	isset($testActions['admin_menu'], $testActions['admin_enqueue_scripts'], $testFilters['webmcp_activity_ability_definitions'])
);

$plugin = new Plugin();
$plugin->registerPages();
$plugin->enqueueForPage('toplevel_page_webmcp-provider-fixture-primary');
check(
	'primary page enqueues the page-only read and shared write',
	[
		'webmcp-provider-fixture/set-panel-tone',
		'webmcp-provider-fixture/get-panel-state',
	] === $testEnqueuedModules,
	json_encode($testEnqueuedModules)
);
check(
	'fixture Ability modules depend on the WordPress client Ability API and category',
	in_array('@wordpress/abilities', $testModules['webmcp-provider-fixture/get-panel-state']['deps'], true) &&
		in_array('webmcp-provider-fixture/category', $testModules['webmcp-provider-fixture/get-panel-state']['deps'], true) &&
		in_array('@wordpress/abilities', $testModules['webmcp-provider-fixture/set-panel-tone']['deps'], true) &&
		in_array('webmcp-provider-fixture/category', $testModules['webmcp-provider-fixture/set-panel-tone']['deps'], true)
);

$testEnqueuedModules = [];
$plugin->enqueueForPage('webmcp-provider-fixture_page_webmcp-provider-fixture-secondary');
check(
	'secondary page enqueues only the shared write',
	['webmcp-provider-fixture/set-panel-tone'] === $testEnqueuedModules,
	json_encode($testEnqueuedModules)
);

$testEnqueuedModules = [];
$plugin->enqueueForPage('dashboard');
check('unrelated admin pages enqueue no fixture module', [] === $testEnqueuedModules);

$definitions = apply_filters('webmcp_activity_ability_definitions', []);
check(
	'fixture pairs both Abilities with exact server-side activity allowlist entries',
	[
		'webmcp-provider-fixture/get-panel-state' => [
			'provider' => 'WebMCP Provider Fixture',
			'risk'     => 'read',
		],
		'webmcp-provider-fixture/set-panel-tone' => [
			'provider' => 'WebMCP Provider Fixture',
			'risk'     => 'reversible',
		],
	] === $definitions,
	json_encode($definitions)
);

$normalizer = new ActivityEventNormalizer();
$context = [
	'surface' => 'wp-admin',
	'context' => 'toplevel_page_webmcp-provider-fixture-primary',
	'path'    => '/wp-admin/admin.php',
];
$base = [
	'event_id'    => '11111111-1111-4111-8111-111111111111',
	'run_id'      => '22222222-2222-4222-8222-222222222222',
	'outcome'     => 'ran',
	'duration_ms' => 2,
	'confirmation' => 'not_required',
	'error_code'  => null,
];
$readEvent = $normalizer->normalize(
	$base + ['ability' => 'webmcp-provider-fixture/get-panel-state'],
	$context,
	1,
	false
);
check(
	'fixture read event is accepted with server-side provider and risk',
	is_array($readEvent) &&
		'WebMCP Provider Fixture' === $readEvent['provider'] &&
		'read' === $readEvent['risk'] &&
		'webmcp-provider-fixture.get-panel-state' === $readEvent['tool_name']
);

$writeEvent = $normalizer->normalize(
	array_merge(
		$base,
		[
			'event_id' => '33333333-3333-4333-8333-333333333333',
			'ability'  => 'webmcp-provider-fixture/set-panel-tone',
		]
	),
	$context,
	1,
	false
);
check(
	'fixture reversible event is accepted without confirmation',
	is_array($writeEvent) &&
		'reversible' === $writeEvent['risk'] &&
		'not_required' === $writeEvent['confirmation_outcome']
);

$invalidOutcome = $normalizer->normalize(
	array_merge(
		$base,
		[
			'event_id'  => '44444444-4444-4444-8444-444444444444',
			'ability'   => 'webmcp-provider-fixture/set-panel-tone',
			'outcome'   => 'declined',
			'error_code' => 'confirmation_declined',
		]
	),
	$context,
	1,
	false
);
check(
	'fixture definition cannot admit a confirmation-only outcome for reversible risk',
	$invalidOutcome instanceof WP_Error && 'webmcp_activity_invalid_outcome' === $invalidOutcome->get_error_code()
);

echo "{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
