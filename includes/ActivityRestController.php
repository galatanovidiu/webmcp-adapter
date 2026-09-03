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
 * Exposes the gated record/list REST endpoints for Site tools activity.
 *
 * Registers two routes under `webmcp/v1/activity`:
 *  - POST records one tool call (audit-only): the server builds the row from the
 *    request plus trusted server state (current user, login session token, time),
 *    redacts the params through {@see ActivityRedactor}, inserts it via
 *    {@see ActivityRepository}, and prunes the table to its retention cap.
 *  - GET lists activity: either the recent rows for one run, or a per-run summary.
 *
 * Authorization is `manage_options` on both routes — the hard guard. Nonce is NOT
 * hand-rolled: cookie-authenticated REST plus the `X-WP-Nonce` that `wp.apiFetch`
 * sends is validated by core (`rest_cookie_check_errors`) before the handler runs.
 *
 * @since 0.8.0
 */
final class ActivityRestController
{
	/**
	 * REST namespace for the adapter's routes.
	 *
	 * @var string
	 */
	private const NAMESPACE = 'webmcp/v1';

	/**
	 * Route, relative to the namespace.
	 *
	 * @var string
	 */
	private const ROUTE = '/activity';

	/**
	 * Number of most-recent rows retained in the activity table.
	 *
	 * @var int
	 */
	private const RETENTION_CAP = 2000;

	/**
	 * Allowed `outcome` values for a recorded activity row.
	 *
	 * @var array<int,string>
	 */
	private const OUTCOMES = ['ran', 'failed', 'declined', 'expired'];

	/**
	 * Activity store the controller reads from and writes to.
	 *
	 * @var ActivityRepository
	 */
	private ActivityRepository $repository;

	/**
	 * @param ActivityRepository|null $repository Optional store. When null, a
	 *                                            default {@see ActivityRepository}
	 *                                            is created.
	 */
	public function __construct(?ActivityRepository $repository = null)
	{
		$this->repository = $repository ?? new ActivityRepository();
	}

	/**
	 * Registers the `rest_api_init` hook.
	 *
	 * @return void
	 */
	public function register(): void
	{
		add_action('rest_api_init', [$this, 'registerRoutes']);
	}

	/**
	 * Registers the record (POST) and list (GET) routes.
	 *
	 * @return void
	 */
	public function registerRoutes(): void
	{
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			[
				[
					'methods'             => 'POST',
					'callback'            => [$this, 'record'],
					'permission_callback' => [$this, 'permissionCheck'],
					'args'                => [
						'run_id'     => [
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
							'validate_callback' => static fn($value): bool => is_string($value) && '' !== trim($value),
						],
						'ability'    => [
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
							'validate_callback' => static fn($value): bool => is_string($value) && '' !== trim($value),
						],
						'outcome'    => [
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
							'validate_callback' => static fn($value): bool => in_array($value, self::OUTCOMES, true),
						],
						'screen_url' => [
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'esc_url_raw',
						],
						'params'     => [
							'type'              => 'object',
							'required'          => false,
							'default'           => [],
							// The redactor (ActivityRedactor::redact) is the sanitizer for this
							// bag — it caps depth/size and redacts secrets before storage; here
							// we only assert the shape so a non-object is rejected early.
							'validate_callback' => static fn($value): bool => is_array($value),
						],
					],
				],
				[
					'methods'             => 'GET',
					'callback'            => [$this, 'list'],
					'permission_callback' => [$this, 'permissionCheck'],
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

	/**
	 * Authorizes a request: only `manage_options` users may record or list.
	 *
	 * This is the hard guard. Core validates the cookie nonce separately
	 * (`rest_cookie_check_errors`); we do not re-check it here.
	 *
	 * @return bool True when the current user may use the endpoint.
	 */
	public function permissionCheck(): bool
	{
		return current_user_can('manage_options');
	}

	/**
	 * Records one tool call (audit-only).
	 *
	 * Builds the row server-side from trusted state — the current user, the login
	 * session token, and the current time — taking only the action fields from the
	 * request. Params are redacted before they are JSON-encoded and stored. After a
	 * successful insert the table is pruned to its retention cap.
	 *
	 * On insert failure this returns a generic 500 `WP_Error`; the detail stays in
	 * the server log and is never leaked to the caller.
	 *
	 * @param WP_REST_Request<array<string,mixed>> $request The record request.
	 * @return WP_REST_Response|WP_Error The new row id with status 201, or a 500 error.
	 */
	public function record(WP_REST_Request $request)
	{
		$screenUrl = $request['screen_url'];
		$params    = is_array($request['params']) ? $request['params'] : [];

		$row = [
			'run_id'        => (string) $request['run_id'],
			'user_id'       => get_current_user_id(),
			'session_token' => (string) wp_get_session_token(),
			'created'       => current_time('mysql'),
			'ability'       => (string) $request['ability'],
			'outcome'       => (string) $request['outcome'],
			'screen_url'    => ('' === (string) $screenUrl) ? null : (string) $screenUrl,
			'params'        => wp_json_encode(ActivityRedactor::redact($params)),
		];

		$id = $this->repository->insert($row);

		if (0 === $id) {
			// Audit-only path: log the detail server-side (debug only), return a generic error.
			if (defined('WP_DEBUG') && WP_DEBUG) {
				error_log('WebMCP Adapter: failed to record Site tools activity row.');
			}

			return new WP_Error(
				'webmcp_activity_record_failed',
				__('Could not record activity.', 'webmcp-adapter'),
				['status' => 500]
			);
		}

		// Retention: bound table growth right after a successful insert.
		$this->repository->pruneToCap(self::RETENTION_CAP);

		return new WP_REST_Response(['id' => $id], 201);
	}

	/**
	 * Lists activity rows.
	 *
	 * With a `run_id` it returns the recent rows for that run (newest first); without
	 * one it returns a per-run summary for the review screen. Each row's stored
	 * `params` JSON is decoded back to an object for the client.
	 *
	 * @param WP_REST_Request<array<string,mixed>> $request The list request.
	 * @return WP_REST_Response The matching rows with status 200.
	 */
	public function list(WP_REST_Request $request): WP_REST_Response
	{
		$runId = (string) $request['run_id'];
		$limit = min(500, max(1, (int) $request['limit']));

		if ('' !== $runId) {
			$rows = array_map(
				[$this, 'shapeRow'],
				$this->repository->recentByRun($runId, $limit)
			);

			return new WP_REST_Response($rows, 200);
		}

		return new WP_REST_Response($this->repository->listSessions($limit), 200);
	}

	/**
	 * Shapes one stored row for the client.
	 *
	 * Decodes the stored `params` JSON back into an object so the client receives a
	 * structure, not a string. A null or malformed value decodes to an empty object.
	 *
	 * @param array<string,mixed> $row One row as read from the store.
	 * @return array<string,mixed> The row with `params` decoded.
	 */
	private function shapeRow(array $row): array
	{
		$decoded = is_string($row['params'] ?? null)
			? json_decode((string) $row['params'], true)
			: null;

		$row['params'] = is_array($decoded) ? $decoded : [];

		return $row;
	}
}
