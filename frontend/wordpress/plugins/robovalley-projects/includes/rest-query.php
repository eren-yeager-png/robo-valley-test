<?php
/**
 * POST /wp-json/rvp/v1/projects/query  -  the catalogue for requests too big for a URL.
 *
 * Used only for the members' subject filter: the signed-in app route returns the ids of the projects with the chosen
 * subjects (up to 1000), and the page sends them here as "include" together with its other filters. It returns exactly what
 * the public GET returns (public fields only, the same item shape), but it is never cached.
 *
 * JSON body (all keys optional):
 *   search      string
 *   technology  array of slugs (or one comma-separated string)
 *   education   array of slugs (or one comma-separated string)
 *   difficulty  array of beginner | intermediate | advanced
 *   view        featured | latest | all (default all)
 *   page        integer 1..1000
 *   per_page    integer >= 1 (lowered to 24)
 *   include     array of up to 1000 positive integers. Present but empty = nothing matched = no results.
 * Anything else in the body is ignored and never echoed (there is no subject parameter). Any wrongly typed value, an
 * invalid body, or more than 1000 ids gives 400.
 *
 * It takes only data from the JSON body (not the URL), accepts only application/json, and reads at most 40 KB.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RVP_QUERY_MAX_INCLUDE', 1000 );
define( 'RVP_QUERY_MAX_BODY', 40000 );

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'rvp/v1',
			'/projects/query',
			array(
				'methods'             => 'POST',
				'callback'            => 'rvp_rest_query',
				'permission_callback' => '__return_true', // public data only.
			)
		);
	}
);

function rvp_query_error( $message ) {
	return new WP_Error( 'rvp_invalid_query', $message, array( 'status' => 400 ) );
}

/** A JSON value as a list of strings (an array of strings or one comma-separated string), or null if it is neither. */
function rvp_query_string_list( $value ) {
	if ( is_string( $value ) ) {
		return rvp_sanitize_slug_list( $value );
	}
	if ( is_array( $value ) && ( array() === $value || array_keys( $value ) === range( 0, count( $value ) - 1 ) ) ) {
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				return null;
			}
		}
		return rvp_sanitize_slug_list( $value );
	}
	return null;
}

/** An integer sent as a JSON number or a string of digits, else null. */
function rvp_query_int( $value ) {
	if ( is_int( $value ) ) {
		return $value;
	}
	return ( is_string( $value ) && preg_match( '/^[0-9]{1,10}$/', $value ) ) ? (int) $value : null;
}

/**
 * Validates the decoded body. Returns the parameters for rvp_catalogue_response(), or a 400 WP_Error.
 *
 * @param mixed $body The decoded JSON.
 */
function rvp_query_params( $body ) {
	if ( ! is_array( $body ) || ( array() !== $body && array_keys( $body ) === range( 0, count( $body ) - 1 ) ) ) {
		return rvp_query_error( 'The body must be a JSON object.' );
	}
	$p = array(
		'search'     => '',
		'technology' => array(),
		'education'  => array(),
		'difficulty' => array(),
		'view'       => 'all',
		'page'       => 1,
		'per_page'   => 12,
		'include'    => null,
	);

	if ( array_key_exists( 'search', $body ) ) {
		if ( ! is_string( $body['search'] ) ) {
			return rvp_query_error( 'search must be a string.' );
		}
		$p['search'] = rvp_sanitize_search( $body['search'] );
	}
	foreach ( array( 'technology', 'education' ) as $key ) {
		if ( array_key_exists( $key, $body ) ) {
			$list = rvp_query_string_list( $body[ $key ] );
			if ( null === $list ) {
				return rvp_query_error( "$key must be a list of slugs." );
			}
			$p[ $key ] = $list;
		}
	}
	if ( array_key_exists( 'difficulty', $body ) ) {
		$raw = is_string( $body['difficulty'] ) ? wp_parse_list( $body['difficulty'] ) : $body['difficulty'];
		if ( ! is_array( $raw ) ) {
			return rvp_query_error( 'difficulty must be a list.' );
		}
		foreach ( $raw as $d ) {
			if ( ! is_string( $d ) || ! isset( rvp_difficulties()[ $d ] ) ) {
				return rvp_query_error( 'difficulty has an unknown value.' );
			}
		}
		$p['difficulty'] = array_values( array_unique( $raw ) );
	}
	if ( array_key_exists( 'view', $body ) ) {
		if ( ! is_string( $body['view'] ) || ! in_array( $body['view'], array( 'featured', 'latest', 'all' ), true ) ) {
			return rvp_query_error( 'view must be featured, latest or all.' );
		}
		$p['view'] = $body['view'];
	}
	if ( array_key_exists( 'page', $body ) ) {
		$page = rvp_query_int( $body['page'] );
		if ( null === $page || $page < 1 || $page > 1000 ) {
			return rvp_query_error( 'page must be an integer from 1 to 1000.' );
		}
		$p['page'] = $page;
	}
	if ( array_key_exists( 'per_page', $body ) ) {
		$per = rvp_query_int( $body['per_page'] );
		if ( null === $per || $per < 1 ) {
			return rvp_query_error( 'per_page must be a positive integer.' );
		}
		$p['per_page'] = min( $per, RVP_MAX_PER_PAGE );
	}
	if ( array_key_exists( 'include', $body ) ) {
		$inc = $body['include'];
		if ( ! is_array( $inc ) || ( array() !== $inc && array_keys( $inc ) !== range( 0, count( $inc ) - 1 ) ) ) {
			return rvp_query_error( 'include must be a list of project ids.' );
		}
		if ( count( $inc ) > RVP_QUERY_MAX_INCLUDE ) {
			return rvp_query_error( sprintf( 'include may contain at most %d ids.', RVP_QUERY_MAX_INCLUDE ) );
		}
		$ids = array();
		foreach ( $inc as $id ) {
			$n = rvp_query_int( $id );
			if ( null === $n || $n < 1 ) {
				return rvp_query_error( 'include must contain positive integers only.' );
			}
			$ids[] = $n;
		}
		$p['include'] = array_values( array_unique( $ids ) ); // empty list stays empty: it means "nothing matched".
	}
	return $p;
}

function rvp_rest_query( WP_REST_Request $request ) {
	if ( ! $request->is_json_content_type() ) {
		return rvp_query_error( 'Send the body as application/json.' );
	}
	if ( strlen( (string) $request->get_body() ) > RVP_QUERY_MAX_BODY ) {
		return rvp_query_error( 'The body is too large.' );
	}
	$body = json_decode( (string) $request->get_body(), true );
	if ( JSON_ERROR_NONE !== json_last_error() ) {
		return rvp_query_error( 'The body is not valid JSON.' );
	}
	$params = rvp_query_params( $body );
	if ( is_wp_error( $params ) ) {
		return $params;
	}

	$response = rvp_catalogue_response( $params );
	// Never cached anywhere: the request body carries ids chosen for a signed-in member.
	$response->header( 'Cache-Control', 'no-store' );
	$response->header( 'Pragma', 'no-cache' );
	$response->header( 'X-Robots-Tag', 'noindex' );
	$response->header( 'X-LiteSpeed-Cache-Control', 'no-cache' ); // behaviour on the live server: needs staging.
	do_action( 'litespeed_control_set_nocache', 'rvp query' );
	return $response;
}
