<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Redacts a tool-call param bag before it is persisted to the activity table.
 *
 * This is the privacy boundary for stored activity. Params ARE recorded, but
 * never in the clear: any value whose KEY matches a sensitive substring (case-
 * insensitive — password, token, secret, key, email, etc.) is replaced with the
 * string `[redacted]`. The walk is conservative — when in doubt, redact.
 *
 * The redactor is also a storage guard: it caps recursion depth, total element
 * count, and string length so a hostile or huge param bag cannot blow up the row.
 * The result is always JSON-encodable.
 *
 * Mirrors the abilities plugin's `SecretSafeError` / `OptionAllowList` redaction
 * style, but is self-contained (the adapter is a separate plugin).
 *
 * @since 0.8.0
 */
final class ActivityRedactor
{
	/**
	 * Replacement token written in place of a redacted value.
	 *
	 * @var string
	 */
	private const REDACTED = '[redacted]';

	/**
	 * Maximum length of a stored string value before truncation.
	 *
	 * @var int
	 */
	private const MAX_STRING_LENGTH = 500;

	/**
	 * Maximum nesting depth walked before a sub-tree is dropped.
	 *
	 * @var int
	 */
	private const MAX_DEPTH = 6;

	/**
	 * Maximum number of scalar/array elements processed across the whole bag.
	 *
	 * @var int
	 */
	private const MAX_ELEMENTS = 1000;

	/**
	 * Sensitive key substrings (case-insensitive). A key containing any of these
	 * has its value redacted, whatever the value's type.
	 *
	 * @var array<int,string>
	 */
	private const SENSITIVE_KEYS = [
		'password',
		'passwd',
		'pwd',
		'secret',
		'token',
		'nonce',
		'api_key',
		'apikey',
		'access_key',
		'secret_key',
		'private_key',
		'authorization',
		'auth_token',
		'email',
		'credential',
		'credit_card',
		'card_number',
		'ssn',
		'cookie',
		'session',
	];
	// Note: broad substrings ('key', 'card', 'auth') were deliberately narrowed so the
	// audit log keeps useful fields (author, taxonomy, meta_key, dashboard) un-redacted
	// while still catching real secrets (api_key, access_key, credit_card, authorization).

	/**
	 * Returns a redacted, JSON-encodable copy of a param bag.
	 *
	 * Rule, applied recursively: redact any value whose key matches a sensitive
	 * substring (case-insensitive); truncate any long string value; and stop
	 * walking past the depth or element cap (over-cap sub-trees are dropped). The
	 * input is never mutated.
	 *
	 * @param array<array-key,mixed> $params The raw param bag from the tool call.
	 * @return array<array-key,mixed> The redacted, capped, JSON-encodable copy.
	 */
	public static function redact(array $params): array
	{
		$count = 0;

		return self::walk($params, 0, $count);
	}

	/**
	 * Recursively redacts one array level.
	 *
	 * @param array<array-key,mixed> $input The array to walk.
	 * @param int                    $depth Current nesting depth (0 at the top).
	 * @param int                    $count Running element counter, passed by reference.
	 * @return array<array-key,mixed> The redacted copy of this level.
	 */
	private static function walk(array $input, int $depth, int &$count): array
	{
		$out = [];

		foreach ($input as $key => $value) {
			if ($count >= self::MAX_ELEMENTS) {
				break;
			}

			$count++;

			if (self::isSensitiveKey((string) $key)) {
				$out[$key] = self::REDACTED;

				continue;
			}

			if (is_array($value)) {
				if ($depth >= self::MAX_DEPTH) {
					// Too deep to walk safely — drop the sub-tree rather than recurse.
					$out[$key] = self::REDACTED;

					continue;
				}

				$out[$key] = self::walk($value, $depth + 1, $count);

				continue;
			}

			$out[$key] = self::redactScalar($value);
		}

		return $out;
	}

	/**
	 * Normalizes a single scalar value for storage.
	 *
	 * Truncates long strings (appending an ellipsis) and reduces non-JSON-safe
	 * scalars (objects, resources) to a safe placeholder. Null, bool, int, and
	 * float pass through unchanged.
	 *
	 * @param mixed $value The scalar value.
	 * @return mixed The JSON-encodable value.
	 */
	private static function redactScalar($value)
	{
		if (is_string($value)) {
			if (mb_strlen($value) > self::MAX_STRING_LENGTH) {
				return mb_substr($value, 0, self::MAX_STRING_LENGTH) . '…';
			}

			return $value;
		}

		if (null === $value || is_bool($value) || is_int($value) || is_float($value)) {
			return $value;
		}

		// Objects, resources, closures — not safely JSON-encodable; redact.
		return self::REDACTED;
	}

	/**
	 * Returns whether a key matches any sensitive substring (case-insensitive).
	 *
	 * @param string $key The array key to test.
	 * @return bool True when the key looks sensitive and its value must be redacted.
	 */
	private static function isSensitiveKey(string $key): bool
	{
		$key = strtolower($key);

		foreach (self::SENSITIVE_KEYS as $needle) {
			if (str_contains($key, $needle)) {
				return true;
			}
		}

		return false;
	}
}
