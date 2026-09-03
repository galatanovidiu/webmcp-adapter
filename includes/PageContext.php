<?php

declare(strict_types=1);

namespace Automattic\WebmcpAdapter;

if (!defined('ABSPATH')) {
	exit;
}

/**
 * Builds the minimal page context exposed to browser-owned Abilities.
 */
final class PageContext
{
	/**
	 * Returns the current public or wp-admin document context.
	 *
	 * @return array<string,bool|int|string|null> Minimal page context.
	 */
	public function build(): array
	{
		$context = [
			'surface'       => is_admin() ? 'wp-admin' : 'frontend',
			'url'           => $this->currentUrl(),
			'pageType'      => null,
			'objectType'    => null,
			'objectId'      => null,
			'screenId'      => null,
			'postType'      => null,
			'taxonomy'      => null,
			'authenticated' => is_user_logged_in(),
		];

		if (is_admin()) {
			return $this->addAdminContext($context);
		}

		return $this->addFrontendContext($context);
	}

	/**
	 * Adds fields owned by the current wp-admin screen.
	 *
	 * @param array<string,bool|int|string|null> $context Base context.
	 * @return array<string,bool|int|string|null> Admin context.
	 */
	private function addAdminContext(array $context): array
	{
		$screen = function_exists('get_current_screen') ? get_current_screen() : null;
		$context['pageType'] = $screen instanceof \WP_Screen ? $screen->base : 'admin';
		$context['screenId'] = $screen instanceof \WP_Screen ? $screen->id : null;
		$context['postType'] = $screen instanceof \WP_Screen && $screen->post_type
			? $screen->post_type
			: null;
		$context['objectType'] = $context['postType'];

		if (isset($_GET['post'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only page orientation.
			$post_id = absint(wp_unslash($_GET['post'])); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			$context['objectId'] = $post_id > 0 ? $post_id : null;
		}

		return $context;
	}

	/**
	 * Adds fields owned by the current frontend query.
	 *
	 * @param array<string,bool|int|string|null> $context Base context.
	 * @return array<string,bool|int|string|null> Frontend context.
	 */
	private function addFrontendContext(array $context): array
	{
		if (is_front_page()) {
			$context['pageType'] = 'front-page';
		} elseif (is_home()) {
			$context['pageType'] = 'posts-page';
		} elseif (is_singular()) {
			$context['pageType']   = 'singular';
			$context['postType']   = get_post_type() ?: null;
			$context['objectType'] = $context['postType'];
			$object_id = get_queried_object_id();
			$context['objectId'] = $object_id > 0 ? $object_id : null;
		} elseif (is_search()) {
			$context['pageType'] = 'search';
		} elseif (is_404()) {
			$context['pageType'] = '404';
		} elseif (is_category() || is_tag() || is_tax()) {
			$context['pageType']   = 'taxonomy-archive';
			$context['objectType'] = 'term';
			$queried = get_queried_object();
			if ($queried instanceof \WP_Term) {
				$context['objectId'] = $queried->term_id;
				$context['taxonomy'] = $queried->taxonomy;
			}
		} elseif (is_archive()) {
			$context['pageType'] = 'archive';
		} else {
			$context['pageType'] = 'unknown';
		}

		return $context;
	}

	/**
	 * Returns the current same-origin URL without authentication parameters.
	 *
	 * @return string Current URL.
	 */
	private function currentUrl(): string
	{
		$request_uri = isset($_SERVER['REQUEST_URI'])
			? wp_unslash($_SERVER['REQUEST_URI'])
			: '/';
		$home = wp_parse_url(home_url('/'));
		$origin = ($home['scheme'] ?? 'http') . '://' . ($home['host'] ?? 'localhost');
		if (isset($home['port'])) {
			$origin .= ':' . (int) $home['port'];
		}

		$url = $origin . '/' . ltrim($request_uri, '/');
		$url = remove_query_arg(
			['_wpnonce', '_wp_http_referer', 'password', 'pass', 'pwd'],
			$url
		);

		return esc_url_raw($url);
	}
}
