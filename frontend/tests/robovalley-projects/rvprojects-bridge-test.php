<?php
// RoboValley Projects: Stage 3 checks of the server-to-server bridge (in-process). LOCAL TEST SITE ONLY.
// Needs: the plugin active, RVP_BRIDGE_SECRET defined in wp-config.php (>= 32 chars), and rvprojects-testdata-setup.php data.
// Run: wp eval-file rvprojects-bridge-test.php
// The signer below is written independently of the plugin's, so the two implementations check each other.

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . $detail : '' ) . "\n";
}

if ( ! defined( 'RVP_BRIDGE_SECRET' ) || strlen( RVP_BRIDGE_SECRET ) < 32 ) {
	WP_CLI::error( 'Define RVP_BRIDGE_SECRET (>= 32 chars) in wp-config.php first.' );
}
$SECRET = RVP_BRIDGE_SECRET;
$dir    = wp_upload_dir();
$data   = json_decode( (string) file_get_contents( $dir['basedir'] . '/rvp-markers.json' ), true );
if ( ! $data ) {
	WP_CLI::error( 'Run rvprojects-testdata-setup.php first.' );
}
$M = $data['markers'];
wp_set_current_user( 0 );

/** Builds a signed request. $over can change any part to build a bad one. */
function req( $route, $params = array(), $over = array() ) {
	$o      = $over + array( 'method' => 'GET', 'sign_route' => $route, 'sign_method' => null, 'secret' => RVP_BRIDGE_SECRET, 'ts' => time(), 'nonce' => bin2hex( random_bytes( 12 ) ), 'sig' => null, 'headers' => true, 'sign_params' => null, 'origin' => null );
	$q      = $o['sign_params'] ?? $params;
	ksort( $q );
	$pairs = array();
	foreach ( $q as $k => $v ) { $pairs[] = rawurlencode( $k ) . '=' . rawurlencode( $v ); }
	$string = "RVP1\n" . ( $o['sign_method'] ?? $o['method'] ) . "\n" . $o['sign_route'] . "\n" . $o['ts'] . "\n" . $o['nonce'] . "\n" . hash( 'sha256', implode( '&', $pairs ) );
	$sig    = $o['sig'] ?? hash_hmac( 'sha256', $string, $o['secret'] );
	$r      = new WP_REST_Request( $o['method'], $route );
	foreach ( $params as $k => $v ) { $r->set_param( $k, $v ); }
	$r->set_query_params( $params );
	if ( $o['headers'] ) {
		if ( false !== $o['ts'] )    { $r->set_header( 'X-RVP-Timestamp', (string) $o['ts'] ); }
		if ( false !== $o['nonce'] ) { $r->set_header( 'X-RVP-Nonce', (string) $o['nonce'] ); }
		if ( false !== $sig )        { $r->set_header( 'X-RVP-Signature', (string) $sig ); }
	}
	if ( null !== $o['origin'] ) { $r->set_header( 'Origin', $o['origin'] ); }
	return $r;
}
// WP_REST_Server::serve_request() applies rest_post_dispatch after dispatching; rest_do_request() does not, so do the same here.
function go( $request ) { $res = rest_do_request( $request ); return apply_filters( 'rest_post_dispatch', rest_ensure_response( $res ), rest_get_server(), $request ); }
$P = '/rvp-bridge/v1/project/';
$ids = $data['ids'];
$hid = $ids['published']['hidden_fields'];

// ===== valid project request
$r = go( req( $P . $hid ) ); $d = $r->get_data();
t( 'valid signed request -> 200', 200 === $r->get_status(), $r->get_status() );
t( 'restricted fields are returned to a valid caller', 200 === $r->get_status() && $d['overview'] === $M['overview'] && $d['outcome'] === $M['outcome'] && array( $M['skills'] ) === $d['skills'] && array( $M['components'] ) === $d['components'], wp_json_encode( array( $d['overview'] ?? null, $M['overview'], $d['skills'] ?? null, $d['components'] ?? null, $d['outcome'] ?? null ) ) );
t( 'subjects are returned (name and slug)', 200 === $r->get_status() && 1 === count( $d['subjects'] ) && $d['subjects'][0]['name'] === $M['subject'] );
t( 'public fields the modal needs are included', 200 === $r->get_status() && isset( $d['id'], $d['title'], $d['technology'], $d['difficulty'], $d['education'], $d['short_description'] ) && array_key_exists( 'thumbnail', $d ) );
t( 'response keys are exactly the expected set', 200 === $r->get_status() && array( 'components', 'difficulty', 'education', 'id', 'outcome', 'overview', 'short_description', 'skills', 'subjects', 'technology', 'thumbnail', 'title' ) === ( function ( $k ) { sort( $k ); return $k; } )( array_keys( $d ) ) );
t( 'post_content and excerpt markers never appear in the bridge response', false === strpos( wp_json_encode( $d ), $M['content'] ) && false === strpos( wp_json_encode( $d ), $M['excerpt'] ) );
$h = $r->get_headers();
t( 'Cache-Control: no-store, private', 'no-store, private' === ( $h['Cache-Control'] ?? '' ), $h['Cache-Control'] ?? '(none)' );
t( 'Pragma no-cache, noindex, LiteSpeed do-not-cache', 'no-cache' === ( $h['Pragma'] ?? '' ) && 'noindex, nofollow' === ( $h['X-Robots-Tag'] ?? '' ) && 'no-cache' === ( $h['X-LiteSpeed-Cache-Control'] ?? '' ) );
t( 'no Vary header on the bridge response', ! isset( $h['Vary'] ) );
t( 'no Access-Control-* header on the response object', 0 === count( preg_grep( '/^access-control/i', array_keys( $h ) ) ) );

// ===== length limits and plain text
$long = get_post( $hid );
update_post_meta( $hid, '_rvp_overview', str_repeat( 'é', 5000 ) ); // the registered sanitizer already caps at 5000.
update_post_meta( $hid, '_rvp_skills', implode( "\n", array_merge( array( str_repeat( 'x', 400 ) ), array_map( function ( $i ) { return "skill $i"; }, range( 1, 80 ) ) ) ) );
update_post_meta( $hid, '_rvp_outcome', "<b>Bold</b> &amp; <script>alert(1)</script>text" );
$d = go( req( $P . $hid ) )->get_data();
t( 'skills limited to 50 items, each at most 150 characters', 50 === count( $d['skills'] ) && 150 === mb_strlen( $d['skills'][0] ), count( $d['skills'] ) );
t( 'overview limited to 5000 characters', 5000 >= mb_strlen( $d['overview'] ) );
t( 'restricted text is plain text (tags removed, entities decoded)', false === strpos( $d['outcome'], '<' ) && false !== strpos( $d['outcome'], 'Bold & ' ), $d['outcome'] );
update_post_meta( $hid, '_rvp_overview', $M['overview'] ); update_post_meta( $hid, '_rvp_skills', $M['skills'] ); update_post_meta( $hid, '_rvp_outcome', $M['outcome'] );

// ===== authentication failures: all must be 401 with an identical generic body
$bad = array(
	'no signature headers at all'      => req( $P . $hid, array(), array( 'headers' => false ) ),
	'missing signature'                => req( $P . $hid, array(), array( 'sig' => false ) ),
	'missing timestamp'                => req( $P . $hid, array(), array( 'ts' => false ) ),
	'missing nonce'                    => req( $P . $hid, array(), array( 'nonce' => false ) ),
	'signature not hex'                => req( $P . $hid, array(), array( 'sig' => str_repeat( 'z', 64 ) ) ),
	'signature too short'              => req( $P . $hid, array(), array( 'sig' => 'abcd' ) ),
	'all-zero signature'               => req( $P . $hid, array(), array( 'sig' => str_repeat( '0', 64 ) ) ),
	'signed with the wrong secret'     => req( $P . $hid, array(), array( 'secret' => str_repeat( 'k', 40 ) ) ),
	'expired timestamp (-61 s)'        => req( $P . $hid, array(), array( 'ts' => time() - 61 ) ),
	'future timestamp (+61 s)'         => req( $P . $hid, array(), array( 'ts' => time() + 61 ) ),
	'timestamp zero'                   => req( $P . $hid, array(), array( 'ts' => 0 ) ),
	'timestamp not 10 digits'          => req( $P . $hid, array(), array( 'ts' => '1700000000.5' ) ),
	'nonce too short (15)'             => req( $P . $hid, array(), array( 'nonce' => str_repeat( 'a', 15 ) ) ),
	'nonce too long (65)'              => req( $P . $hid, array(), array( 'nonce' => str_repeat( 'a', 65 ) ) ),
	'nonce with bad characters'        => req( $P . $hid, array(), array( 'nonce' => 'aaaaaaaaaaaaaaa!aaaa' ) ),
	'signed for POST, sent as GET'     => req( $P . $hid, array(), array( 'sign_method' => 'POST' ) ),
	'signed for another project id'    => req( $P . $hid, array(), array( 'sign_route' => $P . ( $hid + 1 ) ) ),
	'signed for another route'         => req( $P . $hid, array(), array( 'sign_route' => '/rvp-bridge/v1/subject-ids' ) ),
	'query added after signing'        => req( $P . $hid, array( 'x' => '1' ), array( 'sign_params' => array() ) ),
	'query changed after signing'      => req( '/rvp-bridge/v1/subject-ids', array( 'subjects' => 'physics' ), array( 'sign_params' => array( 'subjects' => 'chemistry' ) ) ),
	'array-valued query parameter'     => ( function () use ( $P, $hid ) { $r = req( $P . $hid ); $r->set_query_params( array( 'a' => array( '1' ) ) ); return $r; } )(),
);
$bodies = array();
foreach ( $bad as $name => $request ) {
	$res = go( $request ); $bodies[ $name ] = wp_json_encode( $res->get_data() );
	t( "$name -> 401", 401 === $res->get_status(), $res->get_status() );
}
t( 'every authentication failure has the identical generic body', 1 === count( array_unique( $bodies ) ) && false !== strpos( reset( $bodies ), '"Denied."' ), json_encode( array_unique( $bodies ) ) );
t( 'generic body reveals nothing (no detail, no field names)', ! preg_match( '/signature|timestamp|nonce|secret|expired|replay|hmac/i', reset( $bodies ) ) );
t( 'failure responses also carry no-store', 'no-store, private' === ( go( req( $P . $hid, array(), array( 'sig' => 'abcd' ) ) )->get_headers()['Cache-Control'] ?? '' ) );

// ===== boundary and replay
t( 'timestamp 59 s old is accepted', 200 === go( req( $P . $hid, array(), array( 'ts' => time() - 59 ) ) )->get_status() );
t( 'timestamp 59 s ahead is accepted', 200 === go( req( $P . $hid, array(), array( 'ts' => time() + 59 ) ) )->get_status() );
$first = req( $P . $hid ); $nonce = $first->get_header( 'x_rvp_nonce' );
t( 'first use of a nonce -> 200', 200 === go( $first )->get_status() );
$again = req( $P . $hid, array(), array( 'nonce' => $nonce ) );
t( 'replay of the same nonce (even freshly signed) -> 401', 401 === go( $again )->get_status() );
$replay_exact = clone $first;
t( 'replay of the exact same request -> 401', 401 === go( $replay_exact )->get_status() );
$n2 = bin2hex( random_bytes( 12 ) );
go( req( $P . $hid, array(), array( 'nonce' => $n2, 'sig' => str_repeat( '1', 64 ) ) ) );
t( 'a request with a bad signature does not burn its nonce', 200 === go( req( $P . $hid, array(), array( 'nonce' => $n2 ) ) )->get_status() );
global $wpdb;
t( 'nonce rows hold only hashes and expiry, never the nonce or secret', 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_name LIKE %s AND ( option_name LIKE %s OR option_value LIKE %s )", 'rvp_bridge_nonce_%', '%' . $wpdb->esc_like( $n2 ) . '%', '%' . $wpdb->esc_like( $SECRET ) . '%' ) ) );

// ===== browsers are refused
$o = go( req( $P . $hid, array(), array( 'origin' => 'https://evil.example' ) ) );
t( 'valid signature but an Origin header -> 403', 403 === $o->get_status(), $o->get_status() );
t( 'Origin refusal has the generic body and no CORS header objects', false !== strpos( wp_json_encode( $o->get_data() ), 'Denied.' ) && 0 === count( preg_grep( '/^access-control/i', array_keys( $o->get_headers() ) ) ) );
$oo = req( $P . $hid ); $n3 = $oo->get_header( 'x_rvp_nonce' ); $oo->set_header( 'Origin', 'http://localhost:8080' ); go( $oo );
t( 'an Origin refusal does not consume the nonce', 200 === go( req( $P . $hid, array(), array( 'nonce' => $n3 ) ) )->get_status() );
t( 'empty Origin header is also refused', 403 === go( req( $P . $hid, array(), array( 'origin' => '' ) ) )->get_status() );
t( 'Origin: null (sandboxed iframe / redirect) is refused too', 403 === go( req( $P . $hid, array(), array( 'origin' => 'null' ) ) )->get_status() );

// ===== which projects are visible
$notfound = array();
foreach ( $ids['unpublished'] as $what => $id ) {
	$res = go( req( $P . $id ) ); $notfound[ $what ] = wp_json_encode( $res->get_data() );
	t( "$what project -> 404", 404 === $res->get_status(), $res->get_status() );
}
$plain = wp_insert_post( array( 'post_type' => 'post', 'post_title' => 'RVPT plain post', 'post_status' => 'publish' ) );
$notfound['plain post'] = wp_json_encode( go( req( $P . $plain ) )->get_data() );
t( 'a normal post id -> 404', 404 === go( req( $P . $plain ) )->get_status() );
wp_delete_post( $plain, true );
$notfound['missing id'] = wp_json_encode( go( req( $P . '999999' ) )->get_data() );
t( 'id that does not exist -> 404', 404 === go( req( $P . '999999' ) )->get_status() );
t( 'every 404 body is identical and generic', 1 === count( array_unique( $notfound ) ) && false !== strpos( reset( $notfound ), 'Not found.' ), json_encode( array_unique( $notfound ) ) );
t( 'a 404 never contains any marker or title', ! preg_match( '/RVPMARK|RVPT/', reset( $notfound ) ) );
t( 'non-integer id has no route (404, no data)', 404 === go( req( '/rvp-bridge/v1/project/abc' ) )->get_status() && 404 === go( req( '/rvp-bridge/v1/project/12abc' ) )->get_status() && 404 === go( req( '/rvp-bridge/v1/project/-5' ) )->get_status() );
t( 'id with 11 digits has no route', 404 === go( req( '/rvp-bridge/v1/project/12345678901' ) )->get_status() );

// ===== other methods and routes
foreach ( array( 'POST', 'PUT', 'DELETE', 'PATCH' ) as $m ) { t( "$m on the bridge is refused", in_array( go( req( $P . $hid, array(), array( 'method' => $m ) ) )->get_status(), array( 404, 405 ), true ) ); }
$bridge_routes = array_filter( rest_get_server()->get_routes(), function ( $k ) { return 0 === strpos( $k, '/rvp-bridge/' ); }, ARRAY_FILTER_USE_KEY );
$names = array_keys( $bridge_routes ); sort( $names );
t( 'the bridge registers exactly the namespace index plus 3 routes', array( '/rvp-bridge/v1', '/rvp-bridge/v1/project/(?P<id>[0-9]{1,10})', '/rvp-bridge/v1/subject-ids', '/rvp-bridge/v1/subjects' ) === $names, json_encode( $names ) );
$only_get = true;
foreach ( array( '/rvp-bridge/v1/project/(?P<id>[0-9]{1,10})', '/rvp-bridge/v1/subject-ids', '/rvp-bridge/v1/subjects' ) as $route ) { foreach ( $bridge_routes[ $route ] as $endpoint ) { $only_get = $only_get && array( 'GET' => true ) === $endpoint['methods']; } }
t( 'all bridge routes accept GET only', $only_get );
$sl = go( req( '/rvp-bridge/v1/subjects' ) );
t( 'subjects list: signed request -> 200 with slug+name entries incl. the marker subject', 200 === $sl->get_status() && count( $sl->get_data()['subjects'] ) >= 8 && array( 'slug', 'name' ) === array_keys( $sl->get_data()['subjects'][0] ) && in_array( $M['subject'], array_column( $sl->get_data()['subjects'], 'name' ), true ) );
t( 'subjects list: unsigned -> 401, with Origin -> 403', 401 === go( req( '/rvp-bridge/v1/subjects', array(), array( 'sig' => false ) ) )->get_status() && 403 === go( req( '/rvp-bridge/v1/subjects', array(), array( 'origin' => 'https://evil.example' ) ) )->get_status() );
t( 'subjects list: no-store', 'no-store, private' === ( $sl->get_headers()['Cache-Control'] ?? '' ) );

// ===== subject ids
$S = '/rvp-bridge/v1/subject-ids';
$slug = get_term( $data['subject_term'], RVP_TAX_SUBJECT )->slug;
$expect = array();
foreach ( get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'publish', 'has_password' => false, 'numberposts' => -1, 'fields' => 'ids', 'tax_query' => array( array( 'taxonomy' => RVP_TAX_SUBJECT, 'field' => 'slug', 'terms' => array( $slug ) ) ) ) ) as $i ) { $expect[] = (int) $i; }
sort( $expect );
$r = go( req( $S, array( 'subjects' => $slug ) ) ); $d = $r->get_data();
t( 'subject-ids returns the matching published, unprotected projects', 200 === $r->get_status() && $d['ids'] === $expect && $d['total'] === count( $expect ) && false === $d['truncated'] && count( $expect ) >= 30, json_encode( $d ) );
t( 'subject-ids excludes draft / pending / private / future / password projects', ! array_intersect( $d['ids'], array_values( $ids['unpublished'] ) ) );
t( 'subject-ids response keys are ids, total, limit, truncated', array( 'ids', 'limit', 'total', 'truncated' ) === ( function ( $k ) { sort( $k ); return $k; } )( array_keys( $d ) ) );
$d = go( req( $S, array( 'subjects' => 'no-such-subject' ) ) )->get_data();
t( 'unknown subject slug -> empty list, not an error', array() === $d['ids'] && 0 === $d['total'] );
$d = go( req( $S, array( 'subjects' => "physics'; DROP TABLE x;--,../etc" ) ) )->get_data();
t( 'hostile subject value is sanitized and finds nothing', array() === $d['ids'] );
t( 'missing subjects parameter -> empty list', array() === go( req( $S ) )->get_data()['ids'] );
$d = go( req( $S, array( 'subjects' => $slug . ',physics' ) ) )->get_data();
t( 'several subjects = any of them', $d['ids'] === $expect );
add_filter( 'rvp_bridge_max_ids', function () { return 5; } );
$d = go( req( $S, array( 'subjects' => $slug ) ) )->get_data();
t( 'a result over the cap is cut AND reported (truncated true, total real)', 5 === count( $d['ids'] ) && true === $d['truncated'] && count( $expect ) === $d['total'] && 5 === $d['limit'], json_encode( $d ) );
remove_all_filters( 'rvp_bridge_max_ids' );
t( 'subject-ids without a signature -> 401 and no ids', ( function () use ( $S, $slug ) { $r = go( req( $S, array( 'subjects' => $slug ), array( 'sig' => false ) ) ); return 401 === $r->get_status() && ! isset( $r->get_data()['ids'] ); } )() );

// ===== the secret and the public surfaces
$blob = wp_json_encode( $bodies ) . wp_json_encode( $notfound ) . wp_json_encode( go( req( $P . $hid ) )->get_headers() ) . wp_json_encode( go( req( $P . $hid, array(), array( 'sig' => 'x' ) ) )->get_headers() );
t( 'the secret never appears in any response or header', false === strpos( $blob, $SECRET ) );
t( 'bridge secret is not stored in the database', 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->options} WHERE option_value LIKE %s", '%' . $wpdb->esc_like( $SECRET ) . '%' ) ) );
t( 'rvp_bridge_secret() accepts a 32+ character constant', $SECRET === rvp_bridge_secret() );
$pub = wp_json_encode( rest_do_request( new WP_REST_Request( 'GET', '/rvp/v1/projects' ) )->get_data() );
t( 'the public catalogue still contains no marker', false === strpos( $pub, 'RVPMARK' ) && false === strpos( $pub, 'zebra' ) );

echo "\n" . $GLOBALS['rvp_pass'] . ' passed, ' . $GLOBALS['rvp_fail'] . " failed\n";
