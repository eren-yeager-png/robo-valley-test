<?php
/**
 * Public catalogue endpoint:  GET /wp-json/rvp/v1/projects
 *
 *   search      words, matched against title, short description and technology / education names
 *   technology  slug(s)  - several = any of them
 *   education   slug(s)  - several = any of them
 *   difficulty  beginner | intermediate | advanced (several = any of them)
 *   view        featured | latest | all (default all)
 *   page        1..1000 (default 1)
 *   per_page    1..24 (default 12; larger values are lowered to 24)
 *   include     project ids to restrict the result to (see the SUBJECT FILTER HOOK in catalogue.php)
 *
 * Different groups combine with AND, several values inside one group with OR.
 * There is deliberately no subject parameter: any "subject" in the request is never read and never echoed.
 * The response holds public fields only and is the same for every visitor, so it can be cached.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'rvp/v1',
			'/projects',
			array(
				'methods'             => WP_REST_Server::READABLE, // GET (HEAD is handled by WordPress).
				'callback'            => 'rvp_rest_catalogue',
				'permission_callback' => '__return_true', // public data only.
				'args'                => array(
					'search'     => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'rvp_sanitize_search',
					),
					'technology' => array(
						'type'              => 'array',
						'items'             => array( 'type' => 'string' ),
						'default'           => array(),
						'sanitize_callback' => 'rvp_sanitize_slug_list',
					),
					'education'  => array(
						'type'              => 'array',
						'items'             => array( 'type' => 'string' ),
						'default'           => array(),
						'sanitize_callback' => 'rvp_sanitize_slug_list',
					),
					'difficulty' => array(
						'type'    => 'array',
						'items'   => array(
							'type' => 'string',
							'enum' => array_keys( rvp_difficulties() ),
						),
						'default' => array(),
					),
					'view'       => array(
						'type'    => 'string',
						'enum'    => array( 'featured', 'latest', 'all' ),
						'default' => 'all',
					),
					'page'       => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
						'maximum' => 1000,
					),
					'per_page'   => array(
						'type'    => 'integer',
						'default' => 12,
						'minimum' => 1,
					),
					'include'    => array(
						'type'              => 'array',
						'items'             => array( 'type' => 'integer' ),
						'validate_callback' => 'rvp_validate_id_list',
						'sanitize_callback' => 'rvp_sanitize_id_list',
					),
				),
			)
		);
	}
);

/** One line of search text, at most 100 characters. */
function rvp_sanitize_search( $value ) {
	return mb_substr( sanitize_text_field( is_scalar( $value ) ? (string) $value : '' ), 0, 100 );
}

/** A list of term slugs: accepts an array or a comma-separated string, at most 12 clean slugs. */
function rvp_sanitize_slug_list( $value ) {
	$out = array();
	foreach ( wp_parse_list( $value ) as $item ) {
		$slug = is_scalar( $item ) ? sanitize_title( (string) $item ) : '';
		if ( '' !== $slug ) {
			$out[] = $slug;
		}
	}
	return array_slice( array_values( array_unique( $out ) ), 0, 12 );
}

/** Rejects an "include" list longer than the limit (a custom sanitizer replaces WordPress's own schema check). */
function rvp_validate_id_list( $value ) {
	if ( count( wp_parse_list( $value ) ) > RVP_MAX_INCLUDE ) {
		return new WP_Error( 'rest_invalid_param', sprintf( 'include may contain at most %d ids.', RVP_MAX_INCLUDE ), array( 'status' => 400 ) );
	}
	return true;
}

/** A list of positive ids. */
function rvp_sanitize_id_list( $value ) {
	$out = array();
	foreach ( wp_parse_list( $value ) as $item ) {
		$id = is_scalar( $item ) ? absint( $item ) : 0;
		if ( $id > 0 ) {
			$out[] = $id;
		}
	}
	return array_slice( array_values( array_unique( $out ) ), 0, RVP_MAX_INCLUDE );
}

/**
 * Runs the catalogue for already-validated parameters and returns the response WITHOUT cache headers (the caller adds them:
 * the public GET is cacheable, the POST query is not). Shared by both routes so they can never drift apart.
 */
function rvp_catalogue_response( array $params ) {
	$per_page = $params['per_page'];
	$query    = rvp_catalogue_query( $params );
	$items    = array();
	foreach ( $query->posts as $post ) {
		$items[] = rvp_public_project( $post );
	}
	$total       = (int) $query->found_posts;
	$total_pages = (int) ceil( $total / $per_page );

	$response = new WP_REST_Response(
		array(
			'items'        => $items,
			'pagination'   => array(
				'page'        => $params['page'],
				'per_page'    => $per_page,
				'total'       => $total,
				'total_pages' => $total_pages,
			),
			'technologies' => rvp_technology_list(),
		)
	);
	$response->header( 'X-WP-Total', (string) $total );
	$response->header( 'X-WP-TotalPages', (string) $total_pages );
	return $response;
}

function rvp_rest_catalogue( WP_REST_Request $request ) {
	$response = rvp_catalogue_response(
		array(
			'search'     => (string) $request->get_param( 'search' ),
			'technology' => (array) $request->get_param( 'technology' ),
			'education'  => (array) $request->get_param( 'education' ),
			'difficulty' => (array) $request->get_param( 'difficulty' ),
			'view'       => (string) $request->get_param( 'view' ),
			'page'       => max( 1, (int) $request->get_param( 'page' ) ),
			'per_page'   => min( max( 1, (int) $request->get_param( 'per_page' ) ), RVP_MAX_PER_PAGE ),
			// Present but empty means "nothing matched": that must return nothing, not everything.
			'include'    => $request->has_param( 'include' ) ? (array) $request->get_param( 'include' ) : null,
		)
	);

	// Same for every visitor: safe to cache briefly (browser 1 min, shared caches 2 min). Edits purge sooner, see below.
	$response->header( 'Cache-Control', 'public, max-age=60, s-maxage=120' );
	$response->header( 'Vary', 'Accept-Encoding' );
	$response->header( 'X-Robots-Tag', 'noindex' ); // the JSON itself is not a page for search engines.
	// LiteSpeed Cache API (does nothing when that plugin is absent). Behaviour on the live server: needs staging.
	do_action( 'litespeed_tag_add', 'rvp_catalogue' );
	return $response;
}

/* ---------- Clear cached catalogue responses when something public changes ---------- */

function rvp_purge_catalogue_cache() {
	do_action( 'litespeed_purge', 'rvp_catalogue' ); // LiteSpeed Cache API; needs staging.
}
add_action( 'save_post_' . RVP_POST_TYPE, 'rvp_purge_catalogue_cache' );
add_action( 'trashed_post', 'rvp_purge_catalogue_cache_for_post' );
add_action( 'deleted_post', 'rvp_purge_catalogue_cache_for_post' );
add_action( 'set_object_terms', 'rvp_purge_catalogue_cache_for_post' );
function rvp_purge_catalogue_cache_for_post( $post_id ) {
	if ( RVP_POST_TYPE === get_post_type( $post_id ) ) {
		rvp_purge_catalogue_cache();
	}
}
foreach ( array( 'created_', 'edited_', 'delete_' ) as $rvp_prefix ) {
	foreach ( array( RVP_TAX_TECH, RVP_TAX_EDU ) as $rvp_tax ) {
		add_action( $rvp_prefix . $rvp_tax, 'rvp_purge_catalogue_cache' );
	}
}
unset( $rvp_prefix, $rvp_tax );
