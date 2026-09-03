<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Hardened ingestion and administrator review routes for Site tools activity.
 *
 * POST accepts one final event after a browser invocation settles. Logged-in
 * requests require cookie authentication plus a REST nonce; anonymous requests
 * require a short-lived page-issued token and pass a keyed, no-raw-IP rate limit.
 * GET remains administrator-only.
 */
final class ActivityRestController
{
	private const NAMESPACE = 'webmcp/v1';

	private const ROUTE = '/activity';

	private const MAX_PAYLOAD_BYTES = 4096;

	private ActivityRepository $repository;

	private ActivityToken $token;

	private ActivityRateLimiter $rateLimiter;

	private ActivityEventNormalizer $normalizer;

	public function __construct(
		?ActivityRepository $repository = null,
		?ActivityToken $token = null,
		?ActivityRateLimiter $rateLimiter = null,
		?ActivityEventNormalizer $normalizer = null
	) {
		$this->repository = $repository ?? new ActivityRepository();
		$this->token = $token ?? new ActivityToken();
		$this->rateLimiter = $rateLimiter ?? new ActivityRateLimiter();
		$this->normalizer = $normalizer ?? new ActivityEventNormalizer();
	}

	public function register(): void
	{
		add_action('rest_api_init', [$this, 'registerRoutes']);
	}

	public function registerRoutes(): void
	{
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			[
				[
					'methods'             => 'POST',
					'callback'            => [$this, 'record'],
					'permission_callback' => [$this, 'recordPermissionCheck'],
				],
				[
					'methods'             => 'GET',
					'callback'            => [$this, 'list'],
					'permission_callback' => [$this, 'reviewPermissionCheck'],
					'args'                => [
						'run_id' => [
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						],
						'limit'  => [
							'type'              => 'integer',
							'required'          => false,
							'default'           => 100,
							'sanitize_callback' => 'absint',
						],
					],
				],
			]
		);
	}

	/** @return true|WP_Error Whether a POST has valid bounded ingestion credentials. */
	public function recordPermissionCheck(WP_REST_Request $request)
	{
		$sizeError = $this->validatePayloadSize($request);
		if ($sizeError instanceof WP_Error) {
			return $sizeError;
		}

		$context = $this->authenticateContext($request);

		return $context instanceof WP_Error ? $context : true;
	}

	public function reviewPermissionCheck(): bool
	{
		return current_user_can('manage_options');
	}

	/**
	 * Stores one normalized final event and fires the exporter contract.
	 *
	 * After a successful insert, `webmcp_activity_stored` receives the exact
	 * normalized event array and database row id. Export can be suppressed through
	 * `webmcp_activity_should_export`; exporters must treat the supplied event as
	 * already allowlisted and must not recover request bodies or raw client data.
	 *
	 * @return WP_REST_Response|WP_Error Storage result.
	 */
	public function record(WP_REST_Request $request)
	{
		$sizeError = $this->validatePayloadSize($request);
		if ($sizeError instanceof WP_Error) {
			return $sizeError;
		}

		$auth = $this->authenticateContext($request);
		if ($auth instanceof WP_Error) {
			return $auth;
		}

		$payload = $request->get_json_params();
		if (!is_array($payload) || array_is_list($payload)) {
			return new WP_Error(
				'webmcp_activity_invalid_payload',
				__('The activity payload must be a JSON object.', 'webmcp-adapter'),
				['status' => 400]
			);
		}

		if ($auth['anonymous']) {
			$runId = is_string($payload['run_id'] ?? null) ? $payload['run_id'] : '';
			$address = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
			if (!$this->rateLimiter->consume((string) $auth['context']['jti'], $runId, $address)) {
				return new WP_Error(
					'webmcp_activity_rate_limited',
					__('Too many anonymous activity events were submitted.', 'webmcp-adapter'),
					['status' => 429]
				);
			}
		}

		$event = $this->normalizer->normalize(
			$payload,
			$auth['context'],
			$auth['user_id'],
			$auth['anonymous']
		);
		if ($event instanceof WP_Error) {
			return $event;
		}

		$id = $this->repository->insert($event);
		if (0 === $id) {
			if (defined('WP_DEBUG') && WP_DEBUG) {
				error_log('WebMCP Adapter: failed to record a normalized Site tools activity event.');
			}

			return new WP_Error(
				'webmcp_activity_record_failed',
				__('Could not record activity.', 'webmcp-adapter'),
				['status' => 500]
			);
		}

		$this->repository->pruneConfigured();

		/**
		 * Filters whether a normalized Site tools activity event is exported.
		 *
		 * @since 0.16.0
		 *
		 * @param bool                $shouldExport Whether to fire the exporter action.
		 * @param array<string,mixed> $event        Normalized, allowlisted event data.
		 * @param int                 $id           Stored activity row ID.
		 */
		$shouldExport = apply_filters('webmcp_activity_should_export', true, $event, $id);
		if ($shouldExport) {
			/**
			 * Fires after a normalized Site tools activity event is stored.
			 *
			 * @since 0.16.0
			 *
			 * @param array<string,mixed> $event Normalized, allowlisted event data.
			 * @param int                 $id    Stored activity row ID.
			 */
			do_action('webmcp_activity_stored', $event, $id);
		}

		return new WP_REST_Response(
			['id' => $id, 'event_id' => $event['event_id']],
			201
		);
	}

	/** @return WP_REST_Response Administrator-only activity rows or run summaries. */
	public function list(WP_REST_Request $request): WP_REST_Response
	{
		$runId = (string) $request['run_id'];
		$limit = min(500, max(1, (int) $request['limit']));

		if ('' !== $runId) {
			$rows = array_map([$this, 'shapeRow'], $this->repository->recentByRun($runId, $limit));

			return new WP_REST_Response($rows, 200);
		}

		return new WP_REST_Response($this->repository->listSessions($limit), 200);
	}

	/**
	 * @return array{anonymous:bool,user_id:int,context:array<string,int|string>}|WP_Error
	 */
	private function authenticateContext(WP_REST_Request $request)
	{
		$authenticated = is_user_logged_in();
		$audience = $authenticated ? 'authenticated' : 'anonymous';
		$token = (string) $request->get_header('x_webmcp_activity_token');
		$context = $this->token->validate($token, $audience);
		if ($context instanceof WP_Error) {
			return $context;
		}

		if ($authenticated) {
			$nonce = (string) $request->get_header('x_wp_nonce');
			if ('' === $nonce || !wp_verify_nonce($nonce, 'wp_rest')) {
				return new WP_Error(
					'webmcp_activity_invalid_nonce',
					__('The activity request nonce is invalid.', 'webmcp-adapter'),
					['status' => 403]
				);
			}
		}

		return [
			'anonymous' => !$authenticated,
			'user_id'   => $authenticated ? get_current_user_id() : 0,
			'context'   => $context,
		];
	}

	/** @return true|WP_Error */
	private function validatePayloadSize(WP_REST_Request $request)
	{
		$body = $request->get_body();
		if (strlen($body) <= self::MAX_PAYLOAD_BYTES) {
			return true;
		}

		return new WP_Error(
			'webmcp_activity_payload_too_large',
			__('The activity payload is too large.', 'webmcp-adapter'),
			['status' => 413]
		);
	}

	/** @param array<string,mixed> $row Stored row. */
	private function shapeRow(array $row): array
	{
		unset($row['session_token']);
		$row['params'] = $this->decodeJsonObject($row['params'] ?? null);
		$row['safe_summary'] = $this->decodeJsonObject($row['safe_summary'] ?? null);
		$row['legacy'] = empty($row['event_id']);

		return $row;
	}

	/** @param mixed $value Stored JSON string. @return array<string,mixed> */
	private function decodeJsonObject($value): array
	{
		$decoded = is_string($value) ? json_decode($value, true) : null;

		return is_array($decoded) ? $decoded : [];
	}
}
