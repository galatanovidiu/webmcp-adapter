<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Fixed-window anonymous activity-ingestion limiter.
 *
 * Transient keys contain only keyed hashes. Raw IP addresses, tokens, and session
 * identifiers are never stored.
 */
final class ActivityRateLimiter
{
	private const DEFAULT_LIMIT = 60;

	private const DEFAULT_WINDOW = 60;

	/**
	 * Consumes one anonymous-ingestion allowance.
	 *
	 * Both the signed token identifier and a keyed network hash are limited. This
	 * prevents a single page token or a client minting repeated page tokens from
	 * bypassing the bound while keeping the raw address out of storage.
	 *
	 * @param string $tokenId Token jti claim.
	 * @param string $runId   Raw client run identifier (never stored by this class).
	 * @param string $address Raw remote address (used only as HMAC input).
	 * @return bool Whether the request is within both limits.
	 */
	public function consume(string $tokenId, string $runId, string $address): bool
	{
		/**
		 * Filters the anonymous activity-event limit for one fixed window.
		 *
		 * The result is constrained to 1 through 1,000 events.
		 *
		 * @since 0.16.0
		 *
		 * @param int $limit Event limit per window. Default 60.
		 */
		$limit = (int) apply_filters('webmcp_activity_anonymous_rate_limit', self::DEFAULT_LIMIT);
		/**
		 * Filters the anonymous activity rate-limit window.
		 *
		 * The result is constrained to 10 through 3,600 seconds.
		 *
		 * @since 0.16.0
		 *
		 * @param int $seconds Window duration in seconds. Default 60.
		 */
		$window = (int) apply_filters('webmcp_activity_rate_window_seconds', self::DEFAULT_WINDOW);
		$limit = min(1000, max(1, $limit));
		$window = min(3600, max(10, $window));

		$subjects = ['token:' . $tokenId . ':' . $runId];
		if ('' !== $address) {
			$subjects[] = 'network:' . $address;
		}

		foreach ($subjects as $subject) {
			if (!$this->consumeSubject($subject, $limit, $window)) {
				return false;
			}
		}

		return true;
	}

	private function consumeSubject(string $subject, int $limit, int $window): bool
	{
		$key = 'webmcp_rate_' . substr(
			hash_hmac('sha256', $subject, wp_salt('nonce') . '|webmcp-activity-rate-v1'),
			0,
			32
		);
		$count = get_transient($key);
		$count = is_numeric($count) ? (int) $count : 0;
		if ($count >= $limit) {
			return false;
		}

		set_transient($key, $count + 1, $window);

		return true;
	}
}
