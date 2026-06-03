<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Reads and writes agent-activity rows in the `{prefix}webmcp_activity` table.
 *
 * Wraps `$wpdb` so every query uses safe formats and prepared statements; values
 * are never interpolated into SQL. The table name is validated once at
 * construction (it comes from {@see ActivityMigrator::tableName()}, not user
 * input) and reused as a trusted identifier.
 *
 * @since 0.8.0
 */
final class ActivityRepository
{
	/**
	 * Fully-qualified activity table name.
	 *
	 * @var string
	 */
	private string $table;

	/**
	 * @param string|null $table Optional table name. When null, derived from
	 *                           {@see ActivityMigrator::tableName()}.
	 */
	public function __construct(?string $table = null)
	{
		$this->table = $table ?? (new ActivityMigrator())->tableName();
	}

	/**
	 * Inserts one activity row.
	 *
	 * Casts each field defensively to its storage type and inserts with explicit
	 * `%s`/`%d` formats. Missing fields fall back to safe defaults so a partial
	 * payload never produces an invalid row. Returns 0 on failure (the caller —
	 * an audit path — must never treat a failed insert as fatal).
	 *
	 * @param array{
	 *     run_id?: string,
	 *     user_id?: int,
	 *     session_token?: string,
	 *     created?: string,
	 *     ability?: string,
	 *     outcome?: string,
	 *     screen_url?: string|null,
	 *     params?: string|null
	 * } $row Activity fields.
	 * @return int The new row id, or 0 on failure.
	 */
	public function insert(array $row): int
	{
		$wpdb = $GLOBALS['wpdb'];

		$data = [
			'run_id'        => substr((string) ($row['run_id'] ?? ''), 0, 64),
			'user_id'       => (int) ($row['user_id'] ?? 0),
			'session_token' => substr((string) ($row['session_token'] ?? ''), 0, 64),
			'created'       => (string) ($row['created'] ?? current_time('mysql')),
			'ability'       => substr((string) ($row['ability'] ?? ''), 0, 191),
			'outcome'       => substr((string) ($row['outcome'] ?? ''), 0, 20),
			'screen_url'    => isset($row['screen_url']) ? (string) $row['screen_url'] : null,
			'params'        => isset($row['params']) ? (string) $row['params'] : null,
		];

		$formats = ['%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s'];

		$inserted = $wpdb->insert($this->table, $data, $formats);

		if (false === $inserted) {
			return 0;
		}

		return (int) $wpdb->insert_id;
	}

	/**
	 * Returns the most recent rows for one run, newest first.
	 *
	 * @param string $runId The client-minted run id.
	 * @param int    $limit Maximum rows to return.
	 * @return array<int,array<string,mixed>> Rows as associative arrays.
	 */
	public function recentByRun(string $runId, int $limit = 100): array
	{
		$wpdb  = $GLOBALS['wpdb'];
		$limit = max(1, $limit);

		$sql = $wpdb->prepare(
			"SELECT * FROM %i WHERE run_id = %s ORDER BY created DESC, id DESC LIMIT %d",
			$this->table,
			$runId,
			$limit
		);

		$rows = $wpdb->get_results($sql, ARRAY_A);

		return is_array($rows) ? $rows : [];
	}

	/**
	 * Returns a per-run summary for the admin review screen, newest run first.
	 *
	 * Groups rows by `run_id` and reports the owning user, the action count, and
	 * the first/last activity time. Ordered by the most recent activity.
	 *
	 * @param int $limit Maximum runs (sessions) to return.
	 * @return array<int,array{
	 *     run_id: string,
	 *     user_id: int,
	 *     action_count: int,
	 *     first_activity: string,
	 *     last_activity: string
	 * }> Session summaries.
	 */
	public function listSessions(int $limit = 50): array
	{
		$wpdb  = $GLOBALS['wpdb'];
		$limit = max(1, $limit);

		$sql = $wpdb->prepare(
			"SELECT run_id,
				MAX(user_id) AS user_id,
				COUNT(*) AS action_count,
				MIN(created) AS first_activity,
				MAX(created) AS last_activity
			FROM %i
			GROUP BY run_id
			ORDER BY last_activity DESC
			LIMIT %d",
			$this->table,
			$limit
		);

		$rows = $wpdb->get_results($sql, ARRAY_A);

		if (!is_array($rows)) {
			return [];
		}

		return array_map(
			static fn(array $row): array => [
				'run_id'         => (string) $row['run_id'],
				'user_id'        => (int) $row['user_id'],
				'action_count'   => (int) $row['action_count'],
				'first_activity' => (string) $row['first_activity'],
				'last_activity'  => (string) $row['last_activity'],
			],
			$rows
		);
	}

	/**
	 * Deletes rows beyond the most recent `$maxRows` to bound table growth.
	 *
	 * Finds the id at offset `$maxRows` (the newest row that must be kept is at
	 * offset `$maxRows - 1`) and deletes every row with a smaller id. When the
	 * table holds at most `$maxRows` rows the offset lookup returns nothing and no
	 * rows are deleted.
	 *
	 * @param int $maxRows Number of most-recent rows to keep.
	 * @return int Number of rows deleted.
	 */
	public function pruneToCap(int $maxRows = 2000): int
	{
		$wpdb    = $GLOBALS['wpdb'];
		$maxRows = max(1, $maxRows);

		$cutoffId = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM %i ORDER BY id DESC LIMIT 1 OFFSET %d",
				$this->table,
				$maxRows
			)
		);

		if (null === $cutoffId) {
			return 0;
		}

		$deleted = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM %i WHERE id <= %d",
				$this->table,
				(int) $cutoffId
			)
		);

		return is_numeric($deleted) ? (int) $deleted : 0;
	}
}
