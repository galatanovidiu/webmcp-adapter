<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Server-rendered wp-admin "Agent activity" review screen.
 *
 * Adds a read-only page under Tools that reads from {@see ActivityRepository}.
 * The sessions view lists one row per run (run id, owner, action count, first
 * and last activity); the detail view lists the recorded actions for one run
 * (time, ability, outcome, screen, params). All output is escaped at the point
 * of rendering and the page is guarded by the `manage_options` capability.
 *
 * @since 0.8.0
 */
final class ActivityScreen
{
	/**
	 * Admin page slug.
	 *
	 * @var string
	 */
	private const PAGE = 'webmcp-activity';

	/**
	 * Maximum sessions listed in the sessions view.
	 *
	 * @var int
	 */
	private const SESSIONS_LIMIT = 100;

	/**
	 * Maximum rows listed in the per-run detail view.
	 *
	 * @var int
	 */
	private const DETAIL_LIMIT = 200;

	/**
	 * Registers the admin-side hook for the review page.
	 *
	 * @return void
	 */
	public function register(): void
	{
		add_action('admin_menu', [$this, 'addPage']);
	}

	/**
	 * Registers the review page under the Tools menu.
	 *
	 * @return void
	 */
	public function addPage(): void
	{
		add_submenu_page(
			'tools.php',
			__('Agent activity', 'webmcp-adapter'),
			__('Agent activity', 'webmcp-adapter'),
			'manage_options',
			self::PAGE,
			[$this, 'render']
		);
	}

	/**
	 * Renders the review page (sessions list or per-run detail).
	 *
	 * @return void
	 */
	public function render(): void
	{
		if (!current_user_can('manage_options')) {
			wp_die(esc_html__('You do not have permission to view agent activity.', 'webmcp-adapter'));
		}

		$run = isset($_GET['run']) ? sanitize_text_field(wp_unslash($_GET['run'])) : '';

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__('Agent activity', 'webmcp-adapter') . '</h1>';

		if ('' !== $run) {
			$this->renderDetail($run);
		} else {
			$this->renderSessions();
		}

		echo '</div>';
	}

	/**
	 * Renders the per-run detail table for one run id.
	 *
	 * @param string $run The run id to show.
	 * @return void
	 */
	private function renderDetail(string $run): void
	{
		$rows     = (new ActivityRepository())->recentByRun($run, self::DETAIL_LIMIT);
		$back_url = remove_query_arg('run', admin_url('tools.php?page=' . self::PAGE));

		printf(
			'<p><a href="%1$s">%2$s</a></p>',
			esc_url($back_url),
			esc_html__('&larr; Back to sessions', 'webmcp-adapter')
		);

		printf(
			'<p>%s <code>%s</code></p>',
			esc_html__('Run:', 'webmcp-adapter'),
			esc_html($run)
		);

		if (array() === $rows) {
			echo '<div class="notice notice-info inline"><p>' . esc_html__('No actions recorded for this run.', 'webmcp-adapter') . '</p></div>';

			return;
		}

		echo '<table class="wp-list-table widefat fixed striped">';
		echo '<thead><tr>';
		echo '<th>' . esc_html__('Time', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Ability', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Outcome', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Screen', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Params', 'webmcp-adapter') . '</th>';
		echo '</tr></thead>';
		echo '<tbody>';

		foreach ($rows as $row) {
			$screen_url = isset($row['screen_url']) ? (string) $row['screen_url'] : '';

			echo '<tr>';
			echo '<td>' . esc_html((string) ($row['created'] ?? '')) . '</td>';
			echo '<td>' . esc_html((string) ($row['ability'] ?? '')) . '</td>';
			echo '<td>' . esc_html((string) ($row['outcome'] ?? '')) . '</td>';

			if ('' !== $screen_url) {
				printf(
					'<td><a href="%1$s" target="_blank" rel="noopener noreferrer">%1$s</a></td>',
					esc_url($screen_url)
				);
			} else {
				echo '<td>&mdash;</td>';
			}

			echo '<td><pre>' . esc_html($this->formatParams($row['params'] ?? null)) . '</pre></td>';
			echo '</tr>';
		}

		echo '</tbody></table>';
	}

	/**
	 * Renders the sessions summary table (one row per run).
	 *
	 * @return void
	 */
	private function renderSessions(): void
	{
		$sessions = (new ActivityRepository())->listSessions(self::SESSIONS_LIMIT);

		if (array() === $sessions) {
			echo '<div class="notice notice-info inline"><p>' . esc_html__('No agent activity recorded yet.', 'webmcp-adapter') . '</p></div>';

			return;
		}

		echo '<table class="wp-list-table widefat fixed striped">';
		echo '<thead><tr>';
		echo '<th>' . esc_html__('Run', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Owner', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Actions', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('First', 'webmcp-adapter') . '</th>';
		echo '<th>' . esc_html__('Last', 'webmcp-adapter') . '</th>';
		echo '</tr></thead>';
		echo '<tbody>';

		foreach ($sessions as $session) {
			$run_id  = $session['run_id'];
			$user_id = $session['user_id'];
			$user    = get_userdata($user_id);
			$owner   = $user ? $user->display_name : ('#' . $user_id);
			$link    = admin_url('tools.php?page=' . self::PAGE . '&run=' . rawurlencode($run_id));

			echo '<tr>';
			printf(
				'<td><a href="%1$s"><code>%2$s</code></a></td>',
				esc_url($link),
				esc_html($this->shortenRunId($run_id))
			);
			echo '<td>' . esc_html((string) $owner) . '</td>';
			echo '<td>' . (int) $session['action_count'] . '</td>';
			echo '<td>' . esc_html($session['first_activity']) . '</td>';
			echo '<td>' . esc_html($session['last_activity']) . '</td>';
			echo '</tr>';
		}

		echo '</tbody></table>';
	}

	/**
	 * Formats stored JSON params for display.
	 *
	 * The params column stores a JSON string. Decode it and re-encode pretty so
	 * the detail view is readable. When the value is not valid JSON, return the
	 * raw string unchanged (still escaped by the caller).
	 *
	 * @param mixed $params The stored params value.
	 * @return string The display string.
	 */
	private function formatParams($params): string
	{
		$raw = (string) ($params ?? '');

		if ('' === $raw) {
			return '';
		}

		$decoded = json_decode($raw, true);

		if (null === $decoded && JSON_ERROR_NONE !== json_last_error()) {
			return $raw;
		}

		$pretty = wp_json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

		return false === $pretty ? $raw : $pretty;
	}

	/**
	 * Shortens a run id for compact display in the sessions table.
	 *
	 * @param string $runId The full run id.
	 * @return string The shortened run id.
	 */
	private function shortenRunId(string $runId): string
	{
		if (strlen($runId) <= 12) {
			return $runId;
		}

		return substr($runId, 0, 8) . '...';
	}
}
