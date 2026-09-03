<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

use WP_Error;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Issues and validates short-lived, signed activity-ingestion context tokens.
 *
 * Tokens bind an ingestion request to the server-rendered page surface, context,
 * and path. Anonymous tokens are anti-abuse credentials only; they do not confer
 * WordPress authentication or authorization.
 */
final class ActivityToken
{
	/** @var int Default token lifetime in seconds. */
	private const DEFAULT_TTL = 300;

	/** @var int Maximum encoded token length accepted from a request. */
	private const MAX_TOKEN_LENGTH = 2048;

	/**
	 * Issues a token for the current rendered document.
	 *
	 * @param array<string,mixed> $pageContext Server-owned page context.
	 * @param string              $audience    `authenticated` or `anonymous`.
	 * @return string Signed compact token.
	 */
	public function issue(array $pageContext, string $audience): string
	{
		$now = time();
		/**
		 * Filters the activity-ingestion token lifetime.
		 *
		 * The result is constrained to 60 through 900 seconds.
		 *
		 * @since 0.16.0
		 *
		 * @param int $seconds Token lifetime in seconds. Default 300.
		 */
		$ttl = (int) apply_filters('webmcp_activity_token_ttl_seconds', self::DEFAULT_TTL);
		$ttl = min(900, max(60, $ttl));
		$claims = [
			'v'       => 1,
			'aud'     => $this->normalizeAudience($audience),
			'iat'     => $now,
			'exp'     => $now + $ttl,
			'jti'     => bin2hex(random_bytes(16)),
			'surface' => $this->normalizeSurface($pageContext['surface'] ?? null),
			'context' => $this->normalizeContext($pageContext),
			'path'    => $this->normalizePath((string) ($pageContext['url'] ?? '/')),
		];

		$payload = $this->base64UrlEncode((string) wp_json_encode($claims));
		$signature = hash_hmac('sha256', $payload, $this->signingKey());

		return $payload . '.' . $signature;
	}

	/**
	 * Validates a token and returns its bounded server-issued claims.
	 *
	 * @param string $token            Encoded token from the request header.
	 * @param string $expectedAudience Required token audience.
	 * @return array<string,int|string>|WP_Error Valid claims or a generic error.
	 */
	public function validate(string $token, string $expectedAudience)
	{
		if ('' === $token || strlen($token) > self::MAX_TOKEN_LENGTH) {
			return $this->invalidToken();
		}

		$parts = explode('.', $token);
		if (2 !== count($parts)) {
			return $this->invalidToken();
		}

		[$payload, $signature] = $parts;
		$expected = hash_hmac('sha256', $payload, $this->signingKey());
		if (!hash_equals($expected, $signature)) {
			return $this->invalidToken();
		}

		$json = $this->base64UrlDecode($payload);
		$claims = false === $json ? null : json_decode($json, true);
		if (!is_array($claims)) {
			return $this->invalidToken();
		}

		$audience = $this->normalizeAudience($expectedAudience);
		$issuedAt = is_int($claims['iat'] ?? null) ? $claims['iat'] : 0;
		$expiresAt = is_int($claims['exp'] ?? null) ? $claims['exp'] : 0;
		$jti = is_string($claims['jti'] ?? null) ? $claims['jti'] : '';
		if (
			1 !== ($claims['v'] ?? null) ||
			$audience !== ($claims['aud'] ?? null) ||
			!preg_match('/^[a-f0-9]{32}$/', $jti) ||
			$issuedAt > time() + 30 ||
			$expiresAt <= time() ||
			$expiresAt > $issuedAt + 900
		) {
			return $this->invalidToken();
		}

		return [
			'aud'     => $audience,
			'iat'     => $issuedAt,
			'exp'     => $expiresAt,
			'jti'     => $jti,
			'surface' => $this->normalizeSurface($claims['surface'] ?? null),
			'context' => $this->normalizeIdentifier($claims['context'] ?? null, 'unknown'),
			'path'    => $this->normalizePath((string) ($claims['path'] ?? '/')),
		];
	}

	/** @return WP_Error Generic invalid/expired-token response. */
	private function invalidToken(): WP_Error
	{
		return new WP_Error(
			'webmcp_activity_invalid_token',
			__('The activity token is invalid or expired.', 'webmcp-adapter'),
			['status' => 403]
		);
	}

	private function normalizeAudience(string $audience): string
	{
		return 'authenticated' === $audience ? 'authenticated' : 'anonymous';
	}

	/** @param mixed $surface Raw surface value. */
	private function normalizeSurface($surface): string
	{
		return in_array($surface, ['frontend', 'wp-admin'], true) ? $surface : 'unknown';
	}

	/** @param array<string,mixed> $pageContext Server-owned page context. */
	private function normalizeContext(array $pageContext): string
	{
		$candidate = 'wp-admin' === ($pageContext['surface'] ?? null)
			? ($pageContext['screenId'] ?? $pageContext['pageType'] ?? null)
			: ($pageContext['pageType'] ?? null);

		return $this->normalizeIdentifier($candidate, 'unknown');
	}

	/** @param mixed $value Candidate identifier. */
	private function normalizeIdentifier($value, string $fallback): string
	{
		if (!is_string($value) || '' === $value) {
			return $fallback;
		}

		$value = preg_replace('/[^a-zA-Z0-9._:-]/', '-', $value);
		$value = is_string($value) ? trim($value, '-') : '';

		return '' === $value ? $fallback : substr($value, 0, 100);
	}

	private function normalizePath(string $url): string
	{
		$path = wp_parse_url($url, PHP_URL_PATH);
		if (!is_string($path) || '' === $path || '/' !== $path[0]) {
			return '/';
		}

		return substr($path, 0, 1000);
	}

	private function signingKey(): string
	{
		return wp_salt('nonce') . '|webmcp-activity-token-v1';
	}

	private function base64UrlEncode(string $value): string
	{
		return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
	}

	/** @return string|false */
	private function base64UrlDecode(string $value)
	{
		if (!preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
			return false;
		}

		$padding = strlen($value) % 4;
		if (0 !== $padding) {
			$value .= str_repeat('=', 4 - $padding);
		}

		return base64_decode(strtr($value, '-_', '+/'), true);
	}
}
