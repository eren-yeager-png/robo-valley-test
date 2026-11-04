<?php
/**
 * Server-to-server bridge for the RoboValley app (the Next.js API). It is the ONLY place the members-only fields leave
 * WordPress, and only for a caller that proves it holds the shared secret.
 *
 *   GET /wp-json/rvp-bridge/v1/project/<id>               restricted + public fields of one published project
 *   GET /wp-json/rvp-bridge/v1/subject-ids?subjects=a,b   ids of published projects having ANY of those subjects
 *
 * Authentication (every request, no exceptions):
 *   - The secret is the constant RVP_BRIDGE_SECRET in wp-config.php (never stored in the database). If it is missing or
 *     shorter than 32 characters the whole bridge is switched off and answers 503.
 *   - Headers:  X-RVP-Timestamp (unix seconds), X-RVP-Nonce (16-64 chars of A-Z a-z 0-9 _ -), X-RVP-Signature (hex).
 *   - Signature = HMAC-SHA256(secret, "RVP1\n" METHOD "\n" ROUTE "\n" TIMESTAMP "\n" NONCE "\n" SHA256(canonical query))
 *     where ROUTE is the REST route (e.g. /rvp-bridge/v1/project/12) and the canonical query is the query parameters sorted
 *     by name, each as rawurlencode(name)=rawurlencode(value), joined with "&" (empty string when there are none).
 *   - The timestamp must be within 60 seconds of this server's clock, and each nonce works once.
 *   - A request that carries an Origin header (that is, a browser) is refused, and no Access-Control-* header is ever sent.
 * Every authentication failure gives the same generic body so nothing is learned from the error.
 * Responses are never cacheable. Nothing here logs the secret or any project data.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RVP_BRIDGE_NS', 'rvp-bridge/v1' );
define( 'RVP_BRIDGE_WINDOW', 60 );     // seconds a signed request stays valid (either side of this server's clock).
define( 'RVP_BRIDGE_MAX_IDS', 1000 );  // most ids one subject lookup returns; "truncated" says when there were more.

/** Most ids one subject lookup returns (filterable so tests can use a small number). */
function rvp_bridge_max_ids() {
	return max( 1, (int) apply_filters( 'rvp_bridge_max_ids', RVP_BRIDGE_MAX_IDS ) );
}

/** The shared secret, or null when the constant is missing, not a string, or shorter than 32 characters. */
function rvp_bridge_secret() {
	if ( ! defined( 'RVP_BRIDGE_SECRET' ) ) {
		return null;
	}
	$secret = constant( 'RVP_BRIDGE_SECRET' );
	return ( is_string( $secret ) && strlen( $secret ) >= 32 ) ? $secret : null;
}

/** True for a request addressed to the bridge namespace. */
function rvp_bridge_is_bridge_route( $route ) {
	return is_string( $route ) && 0 === strpos( $route, '/' . RVP_BRIDGE_NS . '/' );
}

/** The same body for every failure; only the status differs. */
function rvp_bridge_error( $status ) {
	$messages = array(
		401 => 'Denied.',
		403 => 'Denied.',
		404 => 'Not found.',
		503 => 'Unavailable.',
	);
	return new WP_Error( 'rvp_bridge_error', isset( $messages[ $status ] ) ? $messages[ $status ] : 'Denied.', array( 'status' => $status ) );
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			RVP_BRIDGE_NS,
			'/project/(?P<id>[0-9]{1,10})',
			array(
				'methods'             => 'GET',
				'callback'            => 'rvp_bridge_project',
				'permission_callback' => 'rvp_bridge_authorize',
			)
		);
		register_rest_route(
			RVP_BRIDGE_NS,
			'/subject-ids',
			array(
				'methods'             => 'GET',
				'callback'            => 'rvp_bridge_subject_ids',
				'permission_callback' => 'rvp_bridge_authorize',
			)
		);
	}
);

/* ---------- Authentication ---------- */

/** Query parameters as the signer saw them: sorted, RFC 3986 encoded. Null if any value is not a plain string. */
function rvp_bridge_canonical_query( WP_REST_Request $request ) {
	$params = $request->get_query_params();
	unset( $params['rest_route'] ); // present when the site uses plain permalinks.
	ksort( $params );
	$pairs = array();
	foreach ( $params as $name => $value ) {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$pairs[] = rawurlencode( (string) $name ) . '=' . rawurlencode( $value );
	}
	return implode( '&', $pairs );
}

/** The string the HMAC covers. */
function rvp_bridge_string_to_sign( $method, $route, $timestamp, $nonce, $canonical_query ) {
	return implode( "\n", array( 'RVP1', $method, $route, $timestamp, $nonce, hash( 'sha256', $canonical_query ) ) );
}

/**
 * Remembers a nonce so it cannot be used twice. One atomic INSERT IGNORE: only the first caller gets a row. The table
 * holds a hash of the nonce, never the secret. Old rows are removed now and then.
 */
function rvp_bridge_consume_nonce( $nonce ) {
	global $wpdb;
	$name    = 'rvp_bridge_nonce_' . substr( hash( 'sha256', $nonce ), 0, 40 );
	$expires = time() + 2 * RVP_BRIDGE_WINDOW + 5; // outlives the timestamp window on both sides.
	$added   = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} ( option_name, option_value, autoload ) VALUES ( %s, %s, 'no' )", $name, (string) $expires ) );
	if ( 1 !== $added ) {
		return false;
	}
	if ( 1 === wp_rand( 1, 20 ) ) {
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST( option_value AS UNSIGNED ) < %d", $wpdb->esc_like( 'rvp_bridge_nonce_' ) . '%', time() ) );
	}
	return true;
}

/** permission_callback for both routes. Returns true or a generic WP_Error. */
function rvp_bridge_authorize( WP_REST_Request $request ) {
	$secret = rvp_bridge_secret();
	if ( null === $secret ) {
		return rvp_bridge_error( 503 ); // switched off: never fail open.
	}
	if ( null !== $request->get_header( 'origin' ) ) {
		return rvp_bridge_error( 403 ); // a browser: this endpoint is for servers only.
	}
	$timestamp = (string) $request->get_header( 'x_rvp_timestamp' );
	$nonce     = (string) $request->get_header( 'x_rvp_nonce' );
	$signature = strtolower( (string) $request->get_header( 'x_rvp_signature' ) );
	if ( ! preg_match( '/^[0-9]{10}$/', $timestamp ) || ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) || ! preg_match( '/^[0-9a-f]{64}$/', $signature ) ) {
		return rvp_bridge_error( 401 );
	}
	if ( abs( time() - (int) $timestamp ) > RVP_BRIDGE_WINDOW ) {
		return rvp_bridge_error( 401 );
	}
	$query = rvp_bridge_canonical_query( $request );
	if ( null === $query ) {
		return rvp_bridge_error( 401 );
	}
	$expected = hash_hmac( 'sha256', rvp_bridge_string_to_sign( $request->get_method(), $request->get_route(), $timestamp, $nonce, $query ), $secret );
	if ( ! hash_equals( $expected, $signature ) ) {
		return rvp_bridge_error( 401 );
	}
	// Only a correctly signed request may use up a nonce, so strangers cannot burn nonces.
	if ( ! rvp_bridge_consume_nonce( $nonce ) ) {
		return rvp_bridge_error( 401 ); // replay.
	}
	return true;
}

/* ---------- Operations ---------- */

/** Free text as plain text, cut to $max characters. */
function rvp_bridge_text( $value, $max ) {
	return mb_substr( rvp_plain( $value ), 0, $max );
}

/** One item per line, at most $items items of $max characters. */
function rvp_bridge_lines( $value, $items, $max ) {
	$out = array();
	foreach ( preg_split( '/\R/u', (string) $value ) as $line ) {
		$line = mb_substr( rvp_plain( $line ), 0, $max );
		if ( '' !== $line ) {
			$out[] = $line;
		}
		if ( count( $out ) >= $items ) {
			break;
		}
	}
	return $out;
}

function rvp_bridge_project( WP_REST_Request $request ) {
	$post = get_post( absint( $request['id'] ) );
	// Same answer for "no such project", "not a project", "not published" and "password protected".
	if ( ! $post || RVP_POST_TYPE !== $post->post_type || 'publish' !== $post->post_status || '' !== $post->post_password ) {
		return rvp_bridge_error( 404 );
	}
	$public = rvp_public_project( $post );
	$public['thumbnail'] = rvp_public_image( (int) get_post_thumbnail_id( $post ), 'large', $post->post_title );

	$subjects = array();
	foreach ( rvp_public_terms( $post->ID, RVP_TAX_SUBJECT ) as $term ) {
		$subjects[] = $term;
	}
	return new WP_REST_Response(
		array_merge(
			$public,
			array(
				'overview'   => rvp_bridge_text( get_post_meta( $post->ID, '_rvp_overview', true ), 5000 ),
				'subjects'   => $subjects,
				'skills'     => rvp_bridge_lines( get_post_meta( $post->ID, '_rvp_skills', true ), 50, 150 ),
				'components' => rvp_bridge_lines( get_post_meta( $post->ID, '_rvp_components', true ), 50, 150 ),
				'outcome'    => rvp_bridge_text( get_post_meta( $post->ID, '_rvp_outcome', true ), 3000 ),
			)
		)
	);
}

function rvp_bridge_subject_ids( WP_REST_Request $request ) {
	$slugs = rvp_sanitize_slug_list( (string) $request->get_param( 'subjects' ) );
	$valid = array();
	foreach ( $slugs as $slug ) {
		if ( get_term_by( 'slug', $slug, RVP_TAX_SUBJECT ) ) { // only subjects that exist.
			$valid[] = $slug;
		}
	}
	$ids   = array();
	$total = 0;
	if ( $valid ) {
		$query = new WP_Query(
			array(
				'post_type'              => RVP_POST_TYPE,
				'post_status'            => 'publish',
				'has_password'           => false,
				'fields'                 => 'ids',
				'posts_per_page'         => rvp_bridge_max_ids(),
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
				'tax_query'              => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
					array(
						'taxonomy' => RVP_TAX_SUBJECT,
						'field'    => 'slug',
						'terms'    => $valid,
						'operator' => 'IN',
					),
				),
			)
		);
		$ids   = array_map( 'intval', $query->posts );
		$total = (int) $query->found_posts;
	}
	return new WP_REST_Response(
		array(
			'ids'       => $ids,
			'total'     => $total,
			'limit'     => rvp_bridge_max_ids(),
			'truncated' => $total > count( $ids ),
		)
	);
}

/* ---------- Headers: never cacheable, never CORS ---------- */

// Core's REST CORS helper echoes any Origin with credentials allowed. Drop it for bridge requests, and remove whatever
// CORS header is still set at the very end, so a browser can never be given permission to read this endpoint.
add_filter(
	'rest_pre_serve_request',
	function ( $served, $result, $request ) {
		if ( $request instanceof WP_REST_Request && rvp_bridge_is_bridge_route( $request->get_route() ) ) {
			remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );
		}
		return $served;
	},
	5,
	3
);
add_filter(
	'rest_pre_serve_request',
	function ( $served, $result, $request ) {
		if ( $request instanceof WP_REST_Request && rvp_bridge_is_bridge_route( $request->get_route() ) && ! headers_sent() ) {
			foreach ( array( 'Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Access-Control-Allow-Credentials', 'Access-Control-Expose-Headers', 'Access-Control-Max-Age' ) as $header ) {
				header_remove( $header );
			}
		}
		return $served;
	},
	999,
	3
);

add_filter(
	'rest_post_dispatch',
	function ( $response, $server, $request ) {
		if ( $response instanceof WP_HTTP_Response && $request instanceof WP_REST_Request && rvp_bridge_is_bridge_route( $request->get_route() ) ) {
			$response->header( 'Cache-Control', 'no-store, private' );
			$response->header( 'Pragma', 'no-cache' );
			$response->header( 'X-Robots-Tag', 'noindex, nofollow' );
			$response->header( 'X-LiteSpeed-Cache-Control', 'no-cache' ); // LiteSpeed: do not cache. Behaviour on the live server: needs staging.
			do_action( 'litespeed_control_set_nocache', 'rvp bridge' );
		}
		return $response;
	},
	999,
	3
);
