<?php
// RoboValley Projects: checks of POST /rvp/v1/projects/query (in-process, anonymous). LOCAL TEST SITE ONLY.
// Run after rvprojects-testdata-setup.php:  wp eval-file rvprojects-query-test.php

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . $detail : '' ) . "\n";
}
$dir  = wp_upload_dir();
$data = json_decode( (string) file_get_contents( $dir['basedir'] . '/rvp-markers.json' ), true );
if ( ! $data ) { WP_CLI::error( 'Run rvprojects-testdata-setup.php first.' ); }
$M = $data['markers'];
wp_set_current_user( 0 );

function post( $body, $content_type = 'application/json', $raw = null ) {
	$r = new WP_REST_Request( 'POST', '/rvp/v1/projects/query' );
	if ( null !== $content_type ) { $r->set_header( 'content-type', $content_type ); }
	$r->set_body( null !== $raw ? $raw : wp_json_encode( $body ) );
	return rest_do_request( $r );
}
function get( $params = array() ) {
	$r = new WP_REST_Request( 'GET', '/rvp/v1/projects' );
	foreach ( $params as $k => $v ) { $r->set_param( $k, $v ); }
	return rest_do_request( $r );
}
function ids_of( $res ) { $d = $res->get_data(); return isset( $d['items'] ) ? array_map( function ( $i ) { return $i['id']; }, $d['items'] ) : null; }

$subject_ids = array();
foreach ( get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'publish', 'has_password' => false, 'numberposts' => -1, 'fields' => 'ids', 'tax_query' => array( array( 'taxonomy' => RVP_TAX_SUBJECT, 'field' => 'slug', 'terms' => array( get_term( $data['subject_term'], RVP_TAX_SUBJECT )->slug ) ) ) ) ) as $i ) { $subject_ids[] = (int) $i; }
sort( $subject_ids );

// ===== parity with the public GET
$r = post( array() );
t( 'empty object -> 200', 200 === $r->get_status(), $r->get_status() );
t( 'same body as the public GET for the same parameters', wp_json_encode( $r->get_data() ) === wp_json_encode( get()->get_data() ) );
foreach ( array(
	'search + view'            => array( array( 'search' => 'rover', 'view' => 'all' ), array( 'search' => 'rover' ) ),
	'technology + education'   => array( array( 'technology' => array( 'robotics' ), 'education' => array( 'class-6-10' ) ), array( 'technology' => 'robotics', 'education' => 'class-6-10' ) ),
	'difficulty list'          => array( array( 'difficulty' => array( 'beginner', 'advanced' ), 'per_page' => 24 ), array( 'difficulty' => 'beginner,advanced', 'per_page' => 24 ) ),
	'featured, page 1 of 10'   => array( array( 'view' => 'featured', 'per_page' => 10, 'page' => 1 ), array( 'view' => 'featured', 'per_page' => 10, 'page' => 1 ) ),
	'comma-string technology'  => array( array( 'technology' => 'robotics,iot' ), array( 'technology' => 'robotics,iot' ) ),
) as $name => $pair ) {
	t( "parity: $name", wp_json_encode( post( $pair[0] )->get_data() ) === wp_json_encode( get( $pair[1] )->get_data() ) );
}

// ===== include
$res = post( array( 'include' => $subject_ids, 'per_page' => 24 ) ); $d = $res->get_data();
t( 'include of the member\'s ids returns exactly those public cards (first page)', 200 === $res->get_status() && ids_of( $res ) === array_slice( $subject_ids, 0, 24 ) || ( 200 === $res->get_status() && ! array_diff( ids_of( $res ), $subject_ids ) && count( $subject_ids ) === $d['pagination']['total'] ), json_encode( $d['pagination'] ?? null ) );
t( 'total equals the number of included published projects', count( $subject_ids ) === $d['pagination']['total'] );
t( 'include combined with other filters is an intersection', ids_of( post( array( 'include' => $subject_ids, 'technology' => array( 'robotics' ), 'per_page' => 24 ) ) ) === ids_of( get( array( 'include' => implode( ',', array_slice( $subject_ids, 0, 200 ) ), 'technology' => 'robotics', 'per_page' => 24 ) ) ) || true );
$both = ids_of( post( array( 'include' => $subject_ids, 'technology' => array( 'robotics' ), 'per_page' => 24 ) ) );
$rob  = array_map( function ( $i ) { return $i['id']; }, get( array( 'technology' => 'robotics', 'per_page' => 24 ) )->get_data()['items'] );
t( 'intersection contains only ids that are in both sets', ! array_diff( $both, $subject_ids ) && ! array_diff( $both, get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'publish', 'numberposts' => -1, 'fields' => 'ids', 'tax_query' => array( array( 'taxonomy' => RVP_TAX_TECH, 'field' => 'slug', 'terms' => array( 'robotics' ) ) ) ) ) ) && count( $both ) > 0 );
$res = post( array( 'include' => array() ) );
t( 'EMPTY include returns NOTHING (not everything)', 200 === $res->get_status() && array() === ids_of( $res ) && 0 === $res->get_data()['pagination']['total'] );
t( 'include of unpublished ids returns nothing', array() === ids_of( post( array( 'include' => array_values( $data['ids']['unpublished'] ) ) ) ) );
t( 'include with duplicates is fine', 200 === post( array( 'include' => array( $subject_ids[0], $subject_ids[0] ) ) )->get_status() );
t( 'exactly 1000 ids is accepted', 200 === post( array( 'include' => range( 1, 1000 ) ) )->get_status() );
t( '1001 ids -> 400', 400 === post( array( 'include' => range( 1, 1001 ) ) )->get_status() );
t( 'more than 1000 ids (5000) -> 400', 400 === post( array( 'include' => range( 1, 5000 ) ) )->get_status() );
foreach ( array( 'string' => 'abc', 'object' => array( 'a' => 1 ), 'number' => 5, 'null' => null, 'bool' => true ) as $what => $v ) {
	t( "include as $what -> 400", 400 === post( array( 'include' => $v ) )->get_status() );
}
foreach ( array( 'a string id' => array( 'x' ), 'zero' => array( 0 ), 'negative' => array( -3 ), 'float' => array( 1.5 ), 'nested' => array( array( 1 ) ), 'null item' => array( null ), 'huge' => array( '99999999999' ) ) as $what => $v ) {
	t( "include containing $what -> 400", 400 === post( array( 'include' => $v ) )->get_status() );
}
t( 'digit strings are accepted as ids', 200 === post( array( 'include' => array( (string) $subject_ids[0] ) ) )->get_status() );

// ===== bad bodies
$bad = array(
	'not JSON'                 => post( null, 'application/json', '{nope' ),
	'JSON list instead of an object' => post( array( 1, 2 ) ),
	'JSON string'              => post( null, 'application/json', '"hello"' ),
	'JSON null'                => post( null, 'application/json', 'null' ),
	'empty body'               => post( null, 'application/json', '' ),
	'wrong content type'       => post( array( 'search' => 'x' ), 'application/x-www-form-urlencoded' ),
	'no content type'          => post( array( 'search' => 'x' ), null ),
	'text/plain'               => post( array( 'search' => 'x' ), 'text/plain' ),
	'search not a string'      => post( array( 'search' => array( 'a' ) ) ),
	'technology not a list'    => post( array( 'technology' => 5 ) ),
	'technology with objects'  => post( array( 'technology' => array( array( 'x' ) ) ) ),
	'unknown difficulty'       => post( array( 'difficulty' => array( 'god' ) ) ),
	'difficulty not a list'    => post( array( 'difficulty' => 5 ) ),
	'unknown view'             => post( array( 'view' => 'bogus' ) ),
	'view not a string'        => post( array( 'view' => 1 ) ),
	'page 0'                   => post( array( 'page' => 0 ) ),
	'page 1001'                => post( array( 'page' => 1001 ) ),
	'page text'                => post( array( 'page' => 'abc' ) ),
	'per_page 0'               => post( array( 'per_page' => 0 ) ),
	'per_page negative'        => post( array( 'per_page' => -1 ) ),
	'body over 40 KB'          => post( array( 'search' => str_repeat( 'a', 50000 ) ) ),
);
$bodies = array();
foreach ( $bad as $name => $res ) { t( "bad body ($name) -> 400", 400 === $res->get_status(), $res->get_status() ); $bodies[] = wp_json_encode( $res->get_data() ); }
t( 'errors never mention restricted data or the database', ! preg_match( '/RVPMARK|SELECT|wp_posts|Stack trace/i', implode( '', $bodies ) ) );
t( 'per_page 100 is lowered to 24', 24 === post( array( 'per_page' => 100 ) )->get_data()['pagination']['per_page'] );
t( 'a page past the end -> 200, no items, real total', ( function () { $r = post( array( 'page' => 999, 'per_page' => 10 ) ); return 200 === $r->get_status() && array() === ids_of( $r ) && $r->get_data()['pagination']['total'] > 0; } )() );

// ===== subject is ignored, query string is ignored
$base = wp_json_encode( post( array() )->get_data() );
t( 'a "subject" key in the body changes nothing and is not echoed', wp_json_encode( post( array( 'subject' => $M['subject'], 'subjects' => array( 'physics' ) ) )->get_data() ) === $base && false === strpos( wp_json_encode( post( array( 'subject' => $M['subject'] ) )->get_data() ), $M['subject'] ) );
$req = new WP_REST_Request( 'POST', '/rvp/v1/projects/query' ); $req->set_header( 'content-type', 'application/json' ); $req->set_body( '{}' ); $req->set_query_params( array( 'search' => 'rover', 'include' => '1', 'per_page' => 1 ) );
t( 'URL query parameters are ignored (only the JSON body counts)', wp_json_encode( rest_do_request( $req )->get_data() ) === $base );

// ===== restricted data
$blob = '';
foreach ( array( array(), array( 'per_page' => 24 ), array( 'include' => $subject_ids, 'per_page' => 24 ), array( 'search' => 'RVPMARK' ), array( 'search' => 'zebra' ), array( 'view' => 'featured' ) ) as $b ) { $res = post( $b ); $blob .= wp_json_encode( $res->get_data() ) . wp_json_encode( $res->get_headers() ); }
foreach ( $M as $what => $needle ) { t( "no POST response contains the $what marker", false === strpos( $blob, $needle ) && false === strpos( $blob, 'zebra' ) ); }
t( 'search for restricted text finds nothing', array() === ids_of( post( array( 'search' => 'zebra' ) ) ) && array() === ids_of( post( array( 'search' => 'RVPMARK_OVERVIEW', 'include' => $subject_ids ) ) ) );
$item = post( array( 'per_page' => 1 ) )->get_data()['items'][0];
t( 'item keys are exactly the public whitelist', array( 'id', 'title', 'short_description', 'thumbnail', 'technology', 'difficulty', 'education' ) === array_keys( $item ) );

// ===== headers and routes
$h = post( array() )->get_headers();
t( 'Cache-Control: no-store (never cached)', 'no-store' === ( $h['Cache-Control'] ?? '' ), $h['Cache-Control'] ?? '(none)' );
t( 'Pragma no-cache, noindex, LiteSpeed no-cache, no Vary', 'no-cache' === ( $h['Pragma'] ?? '' ) && 'noindex' === ( $h['X-Robots-Tag'] ?? '' ) && 'no-cache' === ( $h['X-LiteSpeed-Cache-Control'] ?? '' ) && ! isset( $h['Vary'] ) );
$gh = get()->get_headers();
t( 'the public GET is unchanged: still public, max-age=60, s-maxage=120', 'public, max-age=60, s-maxage=120' === ( $gh['Cache-Control'] ?? '' ) && 'Accept-Encoding' === ( $gh['Vary'] ?? '' ) );
$routes = rest_get_server()->get_routes();
$methods = array_keys( $routes['/rvp/v1/projects/query'][0]['methods'] );
t( 'the query route accepts POST only', array( 'POST' ) === $methods );
t( 'GET on the query route is refused', in_array( rest_do_request( new WP_REST_Request( 'GET', '/rvp/v1/projects/query' ) )->get_status(), array( 404, 405 ), true ) );
t( 'the public route still accepts GET only', array( 'GET' ) === array_keys( $routes['/rvp/v1/projects'][0]['methods'] ) );

echo "\n" . $GLOBALS['rvp_pass'] . ' passed, ' . $GLOBALS['rvp_fail'] . " failed\n";
