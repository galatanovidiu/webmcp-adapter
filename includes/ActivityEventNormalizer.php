<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

use WP_Error;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Builds the one server-owned activity event shape accepted by storage/export.
 *
 * The request may choose identifiers and report one bounded terminal outcome. All
 * other stored values are derived from signed server context, the current user,
 * and an exact server-side Ability definition allowlist.
 */
final class ActivityEventNormalizer
{
	/** @var array<int,string> Request keys accepted by the ingestion contract. */
	private const REQUEST_FIELDS = [
		'event_id',
		'run_id',
		'ability',
		'outcome',
		'duration_ms',
		'confirmation',
		'error_code',
		'safe_summary',
	];

	/** @var array<int,string> Terminal outcomes accepted from the client. */
	private const OUTCOMES = [
		'ran',
		'failed',
		'declined',
		'expired',
		'cancelled',
		'stale',
	];

	/** @var array<int,string> Supported server-side risk classes. */
	private const RISKS = [
		'read',
		'reversible',
		'persistent',
		'consequential',
		'privileged',
	];

	/** @var array<int,string> Safe General Settings field identifiers. */
	private const GENERAL_SETTINGS_FIELDS = [
		'siteTitle',
		'tagline',
		'administrationEmail',
		'membership',
		'defaultRole',
		'siteLanguage',
		'timezone',
		'dateFormat',
		'timeFormat',
		'weekStartsOn',
	];

	/**
	 * Normalizes one request into the exact persistence/export event contract.
	 *
	 * @param array<string,mixed>      $payload   Decoded request JSON.
	 * @param array<string,int|string> $context   Valid signed token claims.
	 * @param int                      $userId    Current WordPress user id or 0.
	 * @param bool                     $anonymous Whether this is anonymous ingestion.
	 * @return array<string,mixed>|WP_Error Normalized event or validation error.
	 */
	public function normalize(array $payload, array $context, int $userId, bool $anonymous)
	{
		$unknown = array_diff(array_keys($payload), self::REQUEST_FIELDS);
		if ([] !== $unknown) {
			return $this->error('webmcp_activity_unknown_field', 'The activity payload contains an unsupported field.');
		}

		$eventId = $this->uuid($payload['event_id'] ?? null);
		$rawRunId = $this->uuid($payload['run_id'] ?? null);
		$ability = $this->abilityName($payload['ability'] ?? null);
		$outcome = is_string($payload['outcome'] ?? null) ? $payload['outcome'] : '';
		$duration = $payload['duration_ms'] ?? null;
		if (
			null === $eventId ||
			null === $rawRunId ||
			null === $ability ||
			!in_array($outcome, self::OUTCOMES, true) ||
			!is_int($duration) ||
			$duration < 0 ||
			$duration > 86400000
		) {
			return $this->error('webmcp_activity_invalid_event', 'The activity event is invalid.');
		}

		/**
		 * Filters the server-owned activity Ability definitions.
		 *
		 * Each definition must provide a bounded provider and one supported risk.
		 * Optional `summary_fields` rules explicitly allow safe summary fields.
		 *
		 * @since 0.16.0
		 *
		 * @param array<string,array<string,mixed>> $definitions Ability definitions keyed by Ability name.
		 */
		$definitions = apply_filters('webmcp_activity_ability_definitions', $this->defaultDefinitions());
		$definition = is_array($definitions) && is_array($definitions[$ability] ?? null)
			? $definitions[$ability]
			: null;
		if (null === $definition) {
			return $this->error('webmcp_activity_unknown_ability', 'The activity Ability is not allowlisted.');
		}

		$risk = is_string($definition['risk'] ?? null) ? $definition['risk'] : '';
		$provider = is_string($definition['provider'] ?? null) ? trim($definition['provider']) : '';
		if (!in_array($risk, self::RISKS, true) || '' === $provider) {
			return $this->error('webmcp_activity_invalid_definition', 'The activity Ability definition is invalid.');
		}
		if (
			in_array($outcome, ['declined', 'expired'], true) &&
			!in_array($risk, ['consequential', 'privileged'], true)
		) {
			return $this->error('webmcp_activity_invalid_outcome', 'The activity outcome is not valid for this Ability.');
		}

		$confirmation = $this->normalizeConfirmation(
			$payload['confirmation'] ?? null,
			$risk,
			$outcome
		);
		if (null === $confirmation) {
			return $this->error('webmcp_activity_invalid_confirmation', 'The activity confirmation outcome is invalid.');
		}

		$errorCode = $this->normalizeErrorCode($payload['error_code'] ?? null, $outcome);
		$summary = $this->normalizeSafeSummary(
			$payload['safe_summary'] ?? null,
			is_array($definition['summary_fields'] ?? null) ? $definition['summary_fields'] : []
		);
		if ($summary instanceof WP_Error) {
			return $summary;
		}

		$storedRunId = $anonymous ? $this->anonymousHash('run', $rawRunId) : $rawRunId;
		$actorHash = $anonymous ? $this->anonymousHash('actor', $rawRunId) : null;
		$created = current_time('mysql');
		$createdGmt = current_time('mysql', true);

		return [
			// Existing required columns retained by the additive table contract.
			'run_id'               => $storedRunId,
			'user_id'              => $anonymous ? 0 : max(0, $userId),
			'created'              => $created,
			'ability'              => $ability,
			'outcome'              => $outcome,
			// Batch 7 normalized event columns.
			'event_id'             => $eventId,
			'actor_hash'           => $actorHash,
			'recorded_at_gmt'      => $createdGmt,
			'tool_name'            => str_replace('/', '.', $ability),
			'provider'             => substr($provider, 0, 100),
			'risk'                 => $risk,
			'surface'              => in_array($context['surface'] ?? null, ['frontend', 'wp-admin'], true)
				? $context['surface']
				: 'unknown',
			'page_context'         => $this->boundedIdentifier($context['context'] ?? null, 'unknown'),
			'page_path'            => $this->boundedPath($context['path'] ?? null),
			'duration_ms'          => $duration,
			'confirmation_outcome' => $confirmation,
			'error_code'           => $errorCode,
			'safe_summary'         => $summary,
		];
	}

	/**
	 * Exact first-party allowlist. Providers may add definitions with the
	 * `webmcp_activity_ability_definitions` filter on the server.
	 *
	 * @return array<string,array<string,mixed>> Ability definitions.
	 */
	private function defaultDefinitions(): array
	{
		$definitions = [];
		$reads = [
			'webmcp/get-page-context',
			'webmcp/list-site-destinations',
			'webmcp/list-admin-destinations',
			'webmcp/editor-context',
			'webmcp/read-blocks',
			'webmcp/list-block-types',
			'webmcp/get-theme-design-tokens',
			'webmcp/list-patterns',
			'webmcp/list-templates',
		];
		$writes = [
			'webmcp/insert-blocks',
			'webmcp/update-block-attributes',
			'webmcp/insert-pattern',
			'webmcp/remove-blocks',
			'webmcp/move-blocks',
			'webmcp/replace-blocks',
			'webmcp/edit-post-attributes',
			'webmcp/undo',
		];

		foreach ($reads as $ability) {
			$definitions[$ability] = ['provider' => 'WebMCP Adapter', 'risk' => 'read'];
		}
		foreach ($writes as $ability) {
			$definitions[$ability] = ['provider' => 'WebMCP Adapter', 'risk' => 'reversible'];
		}
		$definitions['webmcp/save-post'] = ['provider' => 'WebMCP Adapter', 'risk' => 'consequential'];
		$definitions['wordpress/settings/stage-general-form'] = [
			'provider'       => 'WordPress',
			'risk'           => 'reversible',
			'summary_fields' => [
				'changedFields'     => ['type' => 'string_list', 'enum' => self::GENERAL_SETTINGS_FIELDS],
				'unchangedFields'   => ['type' => 'string_list', 'enum' => self::GENERAL_SETTINGS_FIELDS],
				'requiresUserSave' => ['type' => 'boolean'],
			],
		];

		return $definitions;
	}

	/** @param mixed $value Candidate UUID. */
	private function uuid($value): ?string
	{
		if (!is_string($value)) {
			return null;
		}
		$value = strtolower($value);

		return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/', $value)
			? $value
			: null;
	}

	/** @param mixed $value Candidate WordPress Ability name. */
	private function abilityName($value): ?string
	{
		if (!is_string($value) || strlen($value) > 191) {
			return null;
		}

		return preg_match('/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)+$/', $value)
			? $value
			: null;
	}

	/** @param mixed $candidate Client confirmation value. */
	private function normalizeConfirmation($candidate, string $risk, string $outcome): ?string
	{
		if (!in_array($risk, ['consequential', 'privileged'], true)) {
			return 'not_required';
		}
		if ('declined' === $outcome) {
			return 'declined';
		}
		if ('expired' === $outcome) {
			return 'expired';
		}
		if ('ran' === $outcome) {
			return 'confirmed' === $candidate ? 'confirmed' : null;
		}

		$allowed = ['not_requested', 'confirmed', 'cancelled'];

		return is_string($candidate) && in_array($candidate, $allowed, true) ? $candidate : null;
	}

	/** @param mixed $candidate Client error-code hint. */
	private function normalizeErrorCode($candidate, string $outcome): ?string
	{
		if ('ran' === $outcome) {
			return null;
		}

		$byOutcome = [
			'failed'    => ['ability_refused', 'ability_execution_failed'],
			'declined'  => ['confirmation_declined'],
			'expired'   => ['confirmation_expired'],
			'cancelled' => ['invocation_cancelled'],
			'stale'     => ['stale_context', 'stale_registration'],
		];
		$allowed = $byOutcome[$outcome] ?? [];

		return is_string($candidate) && in_array($candidate, $allowed, true)
			? $candidate
			: ($allowed[0] ?? null);
	}

	/**
	 * @param mixed                       $candidate Client-provided candidate object.
	 * @param array<string,array<string,mixed>> $rules Server-owned field rules.
	 * @return array<string,mixed>|null|WP_Error Safe summary.
	 */
	private function normalizeSafeSummary($candidate, array $rules)
	{
		if (null === $candidate) {
			return null;
		}
		if ([] === $rules) {
			return $this->error('webmcp_activity_invalid_summary', 'The safe activity summary is invalid.');
		}
		if (!is_array($candidate) || array_is_list($candidate)) {
			return $this->error('webmcp_activity_invalid_summary', 'The safe activity summary is invalid.');
		}

		$summary = [];
		foreach ($candidate as $key => $value) {
			$rule = is_string($key) && is_array($rules[$key] ?? null) ? $rules[$key] : null;
			if (null === $rule) {
				return $this->error('webmcp_activity_invalid_summary', 'The safe activity summary is invalid.');
			}
			if ('boolean' === ($rule['type'] ?? null) && is_bool($value)) {
				$summary[$key] = $value;
				continue;
			}
			if ('string_list' === ($rule['type'] ?? null) && is_array($value) && array_is_list($value)) {
				$allowed = is_array($rule['enum'] ?? null) ? $rule['enum'] : [];
				if (count($value) > 20 || array_filter($value, static fn($item): bool => !is_string($item) || !in_array($item, $allowed, true))) {
					return $this->error('webmcp_activity_invalid_summary', 'The safe activity summary is invalid.');
				}
				$summary[$key] = array_values(array_unique($value));
				continue;
			}

			return $this->error('webmcp_activity_invalid_summary', 'The safe activity summary is invalid.');
		}

		return $summary;
	}

	private function anonymousHash(string $purpose, string $runId): string
	{
		return hash_hmac('sha256', $purpose . ':' . $runId, wp_salt('auth') . '|webmcp-activity-actor-v1');
	}

	/** @param mixed $value Candidate context identifier. */
	private function boundedIdentifier($value, string $fallback): string
	{
		if (!is_string($value) || !preg_match('/^[a-zA-Z0-9._:-]{1,100}$/', $value)) {
			return $fallback;
		}

		return $value;
	}

	/** @param mixed $value Candidate path. */
	private function boundedPath($value): string
	{
		if (!is_string($value) || '' === $value || '/' !== $value[0]) {
			return '/';
		}

		return substr($value, 0, 1000);
	}

	private function error(string $code, string $message): WP_Error
	{
		return new WP_Error($code, __($message, 'webmcp-adapter'), ['status' => 400]);
	}
}
