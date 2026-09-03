<?php

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

if (!defined('DAY_IN_SECONDS')) {
	define('DAY_IN_SECONDS', 86400);
}

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

	public function get_error_data(): array
	{
		return $this->data;
	}
}

final class WP_REST_Request implements ArrayAccess
{
	public function __construct(
		private array $json = [],
		private array $headers = [],
		private ?string $body = null
	) {
		$this->headers = array_change_key_case($headers, CASE_LOWER);
	}

	public function get_json_params(): array
	{
		return $this->json;
	}

	public function get_header(string $name): string
	{
		return (string) ($this->headers[strtolower(str_replace('_', '-', $name))] ?? '');
	}

	public function get_body(): string
	{
		return $this->body ?? (string) json_encode($this->json);
	}

	public function offsetExists(mixed $offset): bool
	{
		return isset($this->json[$offset]);
	}

	public function offsetGet(mixed $offset): mixed
	{
		return $this->json[$offset] ?? null;
	}

	public function offsetSet(mixed $offset, mixed $value): void
	{
		$this->json[$offset] = $value;
	}

	public function offsetUnset(mixed $offset): void
	{
		unset($this->json[$offset]);
	}
}

final class WP_REST_Response
{
	public function __construct(private array $data, private int $status)
	{
	}

	public function get_data(): array
	{
		return $this->data;
	}

	public function get_status(): int
	{
		return $this->status;
	}
}

final class TestWpdb
{
	public int $insert_id = 0;
	public array $inserted = [];
	public array $prepared = [];

	public function insert(string $table, array $data, array $formats): int
	{
		$this->inserted[] = ['table' => $table, 'data' => $data, 'formats' => $formats];
		$this->insert_id++;

		return 1;
	}

	public function prepare(string $query, ...$args): string
	{
		$this->prepared[] = [$query, $args];

		return $query;
	}

	public function get_var(string $query)
	{
		return null;
	}

	public function query(string $query): int
	{
		return 0;
	}
}

$testFilters = [];
$testTransients = [];
$testActions = [];
$testAuthenticated = false;

function apply_filters(string $hook, $value, ...$args)
{
	global $testFilters;

	return isset($testFilters[$hook]) ? $testFilters[$hook]($value, ...$args) : $value;
}

function __(string $message): string
{
	return $message;
}

function wp_json_encode($value): string
{
	return (string) json_encode($value);
}

function wp_salt(string $scheme = 'auth'): string
{
	return 'test-salt-' . $scheme;
}

function wp_parse_url(string $url, int $component)
{
	return parse_url($url, $component);
}

function current_time(string $type, bool $gmt = false): string
{
	return $gmt ? '2026-09-03 10:00:00' : '2026-09-03 13:00:00';
}

function get_transient(string $key)
{
	global $testTransients;

	return $testTransients[$key] ?? false;
}

function get_date_from_gmt(string $date): string
{
	return $date;
}

function is_user_logged_in(): bool
{
	global $testAuthenticated;

	return $testAuthenticated;
}

function wp_verify_nonce(string $nonce, string $action): bool
{
	return 'valid-rest-nonce' === $nonce && 'wp_rest' === $action;
}

function get_current_user_id(): int
{
	return 7;
}

function current_user_can(string $capability): bool
{
	return 'manage_options' === $capability;
}

function do_action(string $hook, ...$args): void
{
	global $testActions;
	$testActions[$hook][] = $args;
}

function set_transient(string $key, $value, int $expiration): bool
{
	global $testTransients;
	$testTransients[$key] = $value;

	return true;
}

require_once __DIR__ . '/../includes/ActivityToken.php';
require_once __DIR__ . '/../includes/ActivityRateLimiter.php';
require_once __DIR__ . '/../includes/ActivityEventNormalizer.php';
require_once __DIR__ . '/../includes/ActivityRepository.php';
require_once __DIR__ . '/../includes/ActivityRestController.php';

use Automattic\WebmcpAdapter\ActivityEventNormalizer;
use Automattic\WebmcpAdapter\ActivityRateLimiter;
use Automattic\WebmcpAdapter\ActivityRepository;
use Automattic\WebmcpAdapter\ActivityRestController;
use Automattic\WebmcpAdapter\ActivityToken;

$passed = 0;
$failed = 0;

function check(string $label, bool $condition): void
{
	global $passed, $failed;
	if ($condition) {
		++$passed;
		echo "PASS {$label}\n";
		return;
	}
	++$failed;
	echo "FAIL {$label}\n";
}

$pageContext = [
	'surface' => 'frontend',
	'pageType' => 'singular',
	'url' => 'https://example.test/private/?token=must-not-survive',
];
$tokenService = new ActivityToken();
$anonymousToken = $tokenService->issue($pageContext, 'anonymous');
$anonymousClaims = $tokenService->validate($anonymousToken, 'anonymous');
check('anonymous token validates for its audience', is_array($anonymousClaims));
check('signed context stores only the page path', is_array($anonymousClaims) && '/private/' === $anonymousClaims['path']);
check('token audience cannot be changed', $tokenService->validate($anonymousToken, 'authenticated') instanceof WP_Error);
$tampered = substr($anonymousToken, 0, -1) . ('a' === substr($anonymousToken, -1) ? 'b' : 'a');
check('tampered token is rejected', $tokenService->validate($tampered, 'anonymous') instanceof WP_Error);

$normalizer = new ActivityEventNormalizer();
$payload = [
	'event_id' => '11111111-1111-4111-8111-111111111111',
	'run_id' => '22222222-2222-4222-8222-222222222222',
	'ability' => 'wordpress/settings/stage-general-form',
	'outcome' => 'ran',
	'duration_ms' => 27,
	'confirmation' => 'forged-client-value',
	'error_code' => 'arbitrary-message',
	'safe_summary' => [
		'changedFields' => ['siteTitle', 'administrationEmail'],
		'requiresUserSave' => true,
	],
];
$event = $normalizer->normalize($payload, $anonymousClaims, 0, true);
check('allowlisted event normalizes', is_array($event));
check('anonymous raw run id is not persisted', is_array($event) && $event['run_id'] !== $payload['run_id']);
check('anonymous actor is a keyed hash', is_array($event) && 64 === strlen((string) $event['actor_hash']));
check('normalized event contains no login-session token field', is_array($event) && !array_key_exists('session_token', $event));
check('risk and provider come from the server allowlist', is_array($event) && 'reversible' === $event['risk'] && 'WordPress' === $event['provider']);
check('tool name is projected server-side', is_array($event) && 'wordpress.settings.stage-general-form' === $event['tool_name']);
check('non-risky confirmation is normalized server-side', is_array($event) && 'not_required' === $event['confirmation_outcome']);
check('successful events discard arbitrary error codes', is_array($event) && null === $event['error_code']);
check('raw params and outputs do not exist in normalized events', is_array($event) && !array_key_exists('params', $event));
check('safe summary contains identifiers, not values', is_array($event) && is_array($event['safe_summary']) && !str_contains((string) json_encode($event['safe_summary']), 'example.test'));

$unknownField = $normalizer->normalize($payload + ['risk' => 'read'], $anonymousClaims, 0, true);
check('client risk and other unknown fields are rejected', $unknownField instanceof WP_Error && 'webmcp_activity_unknown_field' === $unknownField->get_error_code());
$unknownAbility = $payload;
$unknownAbility['ability'] = 'third-party/not-allowlisted';
check('unknown abilities fail the server allowlist', $normalizer->normalize($unknownAbility, $anonymousClaims, 0, true) instanceof WP_Error);
$unsafeSummary = $payload;
$unsafeSummary['safe_summary']['emailValue'] = 'private@example.test';
check('summary fields outside the strict allowlist are rejected', $normalizer->normalize($unsafeSummary, $anonymousClaims, 0, true) instanceof WP_Error);
$unexpectedSummary = $payload;
$unexpectedSummary['ability'] = 'webmcp/get-page-context';
check('abilities without summary rules reject all summaries', $normalizer->normalize($unexpectedSummary, $anonymousClaims, 0, true) instanceof WP_Error);
$impossibleOutcome = $payload;
$impossibleOutcome['ability'] = 'webmcp/get-page-context';
$impossibleOutcome['outcome'] = 'declined';
unset($impossibleOutcome['safe_summary']);
check('outcomes impossible for an Ability risk are rejected', $normalizer->normalize($impossibleOutcome, $anonymousClaims, 0, true) instanceof WP_Error);

$testFilters['webmcp_activity_anonymous_rate_limit'] = static fn(): int => 2;
$limiter = new ActivityRateLimiter();
check('anonymous limiter accepts first event', $limiter->consume('token-a', $payload['run_id'], '192.0.2.1'));
check('anonymous limiter accepts second event', $limiter->consume('token-a', $payload['run_id'], '192.0.2.1'));
check('anonymous limiter rejects over-limit event', !$limiter->consume('token-a', $payload['run_id'], '192.0.2.1'));
check('transient keys contain no raw IP or run identifier', !str_contains(implode(' ', array_keys($testTransients)), '192.0.2.1') && !str_contains(implode(' ', array_keys($testTransients)), $payload['run_id']));

$GLOBALS['wpdb'] = new TestWpdb();
$testAuthenticated = true;
$authenticatedToken = $tokenService->issue($pageContext, 'authenticated');
$repository = new ActivityRepository('wp_webmcp_activity');
$controller = new ActivityRestController($repository, $tokenService, new ActivityRateLimiter(), $normalizer);
$request = new WP_REST_Request(
	$payload,
	[
		'x-wp-nonce' => 'valid-rest-nonce',
		'x-webmcp-activity-token' => $authenticatedToken,
	]
);
$response = $controller->record($request);
check('authenticated nonce ingestion stores one event', $response instanceof WP_REST_Response && 201 === $response->get_status());
$inserted = $GLOBALS['wpdb']->inserted[0]['data'] ?? [];
check('controller insert still contains no raw session token', '' === ($inserted['session_token'] ?? null));
check('controller never inserts raw params', array_key_exists('params', $inserted) && null === $inserted['params']);
$export = $testActions['webmcp_activity_stored'][0][0] ?? null;
check('exporter action receives only the normalized event', is_array($export) && $export['event_id'] === $inserted['event_id'] && !array_key_exists('session_token', $export) && !array_key_exists('params', $export));
check('retention runs after successful storage', count($GLOBALS['wpdb']->prepared) >= 2);
check('default retention is seven days and 10,000 rows', 7 === ActivityRepository::DEFAULT_RETENTION_DAYS && 10000 === ActivityRepository::DEFAULT_RETENTION_ROWS);

$missingNonce = new WP_REST_Request(
	$payload,
	['x-webmcp-activity-token' => $authenticatedToken]
);
$permission = $controller->recordPermissionCheck($missingNonce);
check('authenticated ingestion fails closed without a REST nonce', $permission instanceof WP_Error && 'webmcp_activity_invalid_nonce' === $permission->get_error_code());
$oversized = new WP_REST_Request(
	$payload,
	[
		'x-wp-nonce' => 'valid-rest-nonce',
		'x-webmcp-activity-token' => $authenticatedToken,
	],
	str_repeat('x', 4097)
);
$permission = $controller->recordPermissionCheck($oversized);
check('oversized payloads are rejected before ingestion', $permission instanceof WP_Error && 413 === ($permission->get_error_data()['status'] ?? null));

echo "{$passed} passed, {$failed} failed\n";
exit($failed > 0 ? 1 : 0);
