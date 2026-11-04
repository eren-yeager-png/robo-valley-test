<?php
// RoboValley Projects: Stage 2 checks of the public catalogue endpoint (in-process, anonymous). LOCAL TEST SITE ONLY.
// Run after stage2-setup.php:  wp eval-file stage2-test.php   (reads uploads/rvp-markers.json)
// The expected results are computed independently here (plain PHP over the stored data) and compared with the endpoint.

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . $detail : '' ) . "\n";
}

$dir  = wp_upload_dir();
$data = json_decode( (string) file_get_contents( $dir['basedir'] . '/rvp-markers.json' ), true );
if ( ! $data ) {
	WP_CLI::error( 'Run stage2-setup.php first.' );
}
$M = $data['markers'];
wp_set_current_user( 0 ); // anonymous visitor.

/** GET the endpoint; returns the WP_REST_Response. */
function call( $params = array() ) {
	$req = new WP_REST_Request( 'GET', '/rvp/v1/projects' );
	foreach ( $params as $k => $v ) {
		$req->set_param( $k, $v );
	}
	return rest_do_request( $req );
}
function ids_of( $res ) {
	$d = $res->get_data();
	return isset( $d['items'] ) ? array_map( function ( $i ) { return $i['id']; }, $d['items'] ) : null;
}
function titles_of( $res ) {
	$d = $res->get_data();
	return isset( $d['items'] ) ? array_map( function ( $i ) { return $i['title']; }, $d['items'] ) : null;
}

/** Oracle: every published, unprotected test project with its public data, newest-first by date. */
$all = array();
foreach ( get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'publish', 'numberposts' => -1, 'has_password' => false, 'orderby' => 'date', 'order' => 'DESC' ) ) as $p ) {
	$all[ $p->ID ] = array(
		'id'    => $p->ID,
		'title' => $p->post_title,
		'desc'  => (string) get_post_meta( $p->ID, '_rvp_short_desc', true ),
		'tech'  => wp_get_post_terms( $p->ID, RVP_TAX_TECH, array( 'fields' => 'slugs' ) ),
		'techn' => wp_get_post_terms( $p->ID, RVP_TAX_TECH, array( 'fields' => 'names' ) ),
		'edu'   => wp_get_post_terms( $p->ID, RVP_TAX_EDU, array( 'fields' => 'slugs' ) ),
		'edun'  => wp_get_post_terms( $p->ID, RVP_TAX_EDU, array( 'fields' => 'names' ) ),
		'diff'  => (string) get_post_meta( $p->ID, '_rvp_difficulty', true ),
		'feat'  => (bool) get_post_meta( $p->ID, '_rvp_featured', true ),
		'order' => (int) get_post_meta( $p->ID, '_rvp_order', true ),
		'date'  => $p->post_date,
	);
}
function oracle( $all, $f = array(), $view = 'all' ) {
	$out = array_filter(
		$all,
		function ( $p ) use ( $f, $view ) {
			if ( ! empty( $f['technology'] ) && ! array_intersect( $f['technology'], $p['tech'] ) ) { return false; }
			if ( ! empty( $f['education'] ) && ! array_intersect( $f['education'], $p['edu'] ) ) { return false; }
			if ( ! empty( $f['difficulty'] ) && ! in_array( $p['diff'], $f['difficulty'], true ) ) { return false; }
			if ( 'featured' === $view && ! $p['feat'] ) { return false; }
			if ( isset( $f['include'] ) && ! in_array( $p['id'], $f['include'], true ) ) { return false; }
			if ( ! empty( $f['search'] ) ) {
				$hay = array_merge( array( $p['title'], $p['desc'] ), $p['techn'], $p['edun'] );
				foreach ( preg_split( '/\s+/', trim( $f['search'] ) ) as $w ) {
					$hit = false;
					foreach ( $hay as $h ) { if ( false !== stripos( $h, $w ) ) { $hit = true; break; } }
					if ( ! $hit ) { return false; }
				}
			}
			return true;
		}
	);
	usort(
		$out,
		function ( $a, $b ) use ( $view ) {
			if ( 'latest' === $view ) { return strcmp( $b['date'], $a['date'] ) ?: $b['id'] - $a['id']; }
			if ( 'featured' === $view ) { return $a['order'] - $b['order'] ?: strcmp( $b['date'], $a['date'] ) ?: $b['id'] - $a['id']; }
			return $a['order'] - $b['order'] ?: strcmp( $a['title'], $b['title'] ) ?: $a['id'] - $b['id'];
		}
	);
	return array_map( function ( $p ) { return $p['id']; }, $out );
}
function same( $a, $b ) { return is_array( $a ) && $a === $b; }
$pub_total = count( $all );

// ===== basics
$r = call();
$d = $r->get_data();
t( 'default request returns 200', 200 === $r->get_status() );
t( 'top-level keys are exactly items, pagination, technologies', array( 'items', 'pagination', 'technologies' ) === array_keys( $d ) );
t( 'default page size is 12', 12 === count( $d['items'] ) && 12 === $d['pagination']['per_page'] );
t( 'total counts published, unprotected projects only', $pub_total === $d['pagination']['total'], $d['pagination']['total'] . ' vs ' . $pub_total );
t( 'default order = display order, then title', same( ids_of( $r ), array_slice( oracle( $all ), 0, 12 ) ) );
t( 'pagination block keys', array( 'page', 'per_page', 'total', 'total_pages' ) === array_keys( $d['pagination'] ) );

// ===== unpublished never listed (any request)
$every = array();
for ( $pg = 1; $pg <= 5; $pg++ ) { $every = array_merge( $every, (array) titles_of( call( array( 'per_page' => 24, 'page' => $pg ) ) ) ); }
t( 'no draft / pending / private / scheduled / password-protected project is ever listed', 0 === count( preg_grep( '/^RVPT Hidden (Draft|Pending|Private|Future|Password)/', $every ) ) );
t( 'all published test projects are listed across pages', count( $every ) === $pub_total, count( $every ) . ' vs ' . $pub_total );
t( 'hidden-fields project is listed with public data only (it is published)', in_array( 'RVPT Hidden Fields Project', $every, true ) );

// ===== item shape
$item = $d['items'][0];
t( 'item keys are exactly the public whitelist', array( 'id', 'title', 'short_description', 'thumbnail', 'technology', 'difficulty', 'education' ) === array_keys( $item ), implode( ',', array_keys( $item ) ) );
$any_tech = null; foreach ( $d['items'] as $i ) { if ( $i['technology'] ) { $any_tech = $i['technology'][0]; break; } }
t( 'technology entries are {slug,name}', $any_tech && array( 'slug', 'name' ) === array_keys( $any_tech ) );
$any_diff = null; foreach ( $d['items'] as $i ) { if ( $i['difficulty'] ) { $any_diff = $i['difficulty']; break; } }
t( 'difficulty is {slug,label}', $any_diff && array( 'slug', 'label' ) === array_keys( $any_diff ) );
$alpha = null; foreach ( call( array( 'search' => 'Alpha Rover' ) )->get_data()['items'] as $i ) { $alpha = $i; }
t( 'thumbnail has url, width, height, alt', $alpha && is_array( $alpha['thumbnail'] ) && ! empty( $alpha['thumbnail']['url'] ) && $alpha['thumbnail']['width'] > 0 && $alpha['thumbnail']['height'] > 0 && '' !== $alpha['thumbnail']['alt'], json_encode( $alpha['thumbnail'] ?? null ) );
$beta = call( array( 'search' => 'Beta Flyer' ) )->get_data()['items'][0];
t( 'project without an image has thumbnail null', null === $beta['thumbnail'] );
t( 'title is plain text (apostrophe not an HTML entity)', in_array( "RVPT Percent 100% _under_ it's", (array) titles_of( call( array( 'search' => 'Percent', 'per_page' => 24 ) ) ), true ) );

// ===== per_page cap, page bounds, invalid parameters
$r = call( array( 'per_page' => 100 ) );
t( 'per_page=100 is lowered to 24', 200 === $r->get_status() && 24 === $r->get_data()['pagination']['per_page'] && 24 === count( $r->get_data()['items'] ) );
t( 'per_page=0 -> 400', 400 === call( array( 'per_page' => 0 ) )->get_status() );
t( 'per_page=abc -> 400', 400 === call( array( 'per_page' => 'abc' ) )->get_status() );
t( 'page=0 -> 400', 400 === call( array( 'page' => 0 ) )->get_status() );
t( 'page=-3 -> 400', 400 === call( array( 'page' => -3 ) )->get_status() );
t( 'page=1001 -> 400', 400 === call( array( 'page' => 1001 ) )->get_status() );
t( 'page=abc -> 400', 400 === call( array( 'page' => 'abc' ) )->get_status() );
t( 'view=bogus -> 400', 400 === call( array( 'view' => 'bogus' ) )->get_status() );
t( 'difficulty=god -> 400', 400 === call( array( 'difficulty' => 'god' ) )->get_status() );
$p1 = call( array( 'per_page' => 10, 'page' => 1 ) ); $p2 = call( array( 'per_page' => 10, 'page' => 2 ) );
t( 'page 2 follows page 1 with no overlap', ! array_intersect( ids_of( $p1 ), ids_of( $p2 ) ) && same( array_merge( ids_of( $p1 ), ids_of( $p2 ) ), array_slice( oracle( $all ), 0, 20 ) ) );
t( 'total_pages = ceil(total / per_page)', (int) ceil( $pub_total / 10 ) === $p1->get_data()['pagination']['total_pages'] );
$last = call( array( 'per_page' => 10, 'page' => (int) ceil( $pub_total / 10 ) ) );
t( 'last page returns the remainder', count( ids_of( $last ) ) === $pub_total - 10 * ( (int) ceil( $pub_total / 10 ) - 1 ) );
$beyond = call( array( 'per_page' => 10, 'page' => 999 ) );
t( 'page beyond the end -> 200 with no items, total kept', 200 === $beyond->get_status() && array() === ids_of( $beyond ) && $pub_total === $beyond->get_data()['pagination']['total'] );

// ===== filters (each against the oracle)
$cases = array(
	'technology=robotics'                       => array( array( 'technology' => 'robotics' ), array( 'technology' => array( 'robotics' ) ) ),
	'technology=robotics,iot (OR)'              => array( array( 'technology' => 'robotics,iot' ), array( 'technology' => array( 'robotics', 'iot' ) ) ),
	'technology[]=stem&technology[]=automation' => array( array( 'technology' => array( 'stem', 'automation' ) ), array( 'technology' => array( 'stem', 'automation' ) ) ),
	'education=iti (project with 2 levels)'     => array( array( 'education' => 'iti' ), array( 'education' => array( 'iti' ) ) ),
	'education=iti,b-tech (OR)'                 => array( array( 'education' => 'iti,b-tech' ), array( 'education' => array( 'iti', 'b-tech' ) ) ),
	'difficulty=advanced'                       => array( array( 'difficulty' => 'advanced' ), array( 'difficulty' => array( 'advanced' ) ) ),
	'difficulty=beginner,advanced (OR)'         => array( array( 'difficulty' => 'beginner,advanced' ), array( 'difficulty' => array( 'beginner', 'advanced' ) ) ),
	'technology AND education'                  => array( array( 'technology' => 'robotics', 'education' => 'class-6-10' ), array( 'technology' => array( 'robotics' ), 'education' => array( 'class-6-10' ) ) ),
	'technology AND education AND difficulty'   => array( array( 'technology' => 'iot,stem', 'education' => 'intermediate,iti,b-tech', 'difficulty' => 'beginner,intermediate' ), array( 'technology' => array( 'iot', 'stem' ), 'education' => array( 'intermediate', 'iti', 'b-tech' ), 'difficulty' => array( 'beginner', 'intermediate' ) ) ),
	'all filters + search'                      => array( array( 'technology' => 'robotics', 'education' => 'class-6-10', 'difficulty' => 'beginner', 'search' => 'rover' ), array( 'technology' => array( 'robotics' ), 'education' => array( 'class-6-10' ), 'difficulty' => array( 'beginner' ), 'search' => 'rover' ) ),
);
foreach ( $cases as $name => $c ) {
	$exp = oracle( $all, $c[1] );
	$res = call( array_merge( array( 'per_page' => 24 ), $c[0] ) );
	t( "filter: $name", 200 === $res->get_status() && same( ids_of( $res ), array_slice( $exp, 0, 24 ) ) && count( $exp ) === $res->get_data()['pagination']['total'], count( $exp ) . ' expected, got ' . json_encode( ids_of( $res ) ) );
}
t( 'filter results are not trivially empty or full (sanity)', count( oracle( $all, array( 'technology' => array( 'robotics' ) ) ) ) > 0 && count( oracle( $all, array( 'technology' => array( 'robotics' ) ) ) ) < $pub_total );
$res = call( array( 'technology' => 'no-such-technology' ) );
t( 'unknown technology slug -> 200, empty', 200 === $res->get_status() && array() === ids_of( $res ) && 0 === $res->get_data()['pagination']['total'] );
$res = call( array( 'technology' => "robotics'; DROP TABLE wp_posts;--", 'education' => '../../etc/passwd' ) );
t( 'hostile slugs are sanitized, no error, no results', 200 === $res->get_status() && array() === ids_of( $res ) );
t( 'education with no match -> empty, 200', array() === ids_of( call( array( 'education' => 'class-6-10', 'technology' => 'drone-technology' ) ) ) );

// ===== views
foreach ( array( 'featured', 'latest', 'all' ) as $view ) {
	$exp = oracle( $all, array(), $view );
	$res = call( array( 'view' => $view, 'per_page' => 24 ) );
	t( "view=$view: membership and order match", same( ids_of( $res ), array_slice( $exp, 0, 24 ) ) && count( $exp ) === $res->get_data()['pagination']['total'] );
}
$feat = ids_of( call( array( 'view' => 'featured', 'per_page' => 24 ) ) );
$bad = array_filter( $feat, function ( $id ) use ( $all ) { return ! $all[ $id ]['feat']; } );
t( 'view=featured lists only featured projects', $feat && ! $bad );
$lat = ids_of( call( array( 'view' => 'latest', 'per_page' => 24 ) ) );
t( 'view=latest is newest first', $lat === array_slice( array_map( function ( $p ) { return $p['id']; }, array_values( $all ) ), 0, 24 ) );
$ord = ids_of( call( array( 'view' => 'all', 'per_page' => 24 ) ) );
t( 'view=all: a project with no display order counts as 0 (sorted with the 0s by title)', array_search( $data['ids']['published']['noorder'], $ord, true ) < array_search( $data['ids']['published']['bulk1'], $ord, true ) );

// ===== search
$s = function ( $q ) { return call( array( 'search' => $q, 'per_page' => 24 ) ); };
t( 'search matches the title', in_array( $data['ids']['published']['alpha'], ids_of( $s( 'alpha' ) ), true ) );
t( 'search matches the short description', same( ids_of( $s( 'unicorn' ) ), array( $data['ids']['published']['gamma'] ) ) );
t( 'search matches a technology name (Drone)', in_array( $data['ids']['published']['beta'], ids_of( $s( 'Drone' ) ), true ) );
t( 'search matches an education name (Postgraduate)', in_array( $data['ids']['published']['hidden_fields'], ids_of( $s( 'postgraduate' ) ), true ) );
t( 'search is case-insensitive', same( ids_of( $s( 'QUADCOPTER' ) ), array( $data['ids']['published']['beta'] ) ) );
t( 'multi-word search: every word must match', same( ids_of( $s( 'quadcopter beta' ) ), array( $data['ids']['published']['beta'] ) ) && array() === ids_of( $s( 'quadcopter alpha' ) ) );
t( 'search for a word only in OVERVIEW/SKILLS/COMPONENTS/OUTCOME ("zebra") finds nothing', array() === ids_of( $s( 'zebra' ) ) );
foreach ( array( 'overview' => 'RVPMARK_OVERVIEW', 'skills' => 'RVPMARK_SKILLS', 'components' => 'RVPMARK_COMPONENTS', 'outcome' => 'RVPMARK_OUTCOME', 'subject term' => 'RVPMARK_SUBJECT', 'post_content' => 'RVPMARK_CONTENT', 'post_excerpt' => 'RVPMARK_EXCERPT' ) as $what => $needle ) {
	t( "search for the $what marker finds nothing", array() === ids_of( $s( $needle ) ) );
}
t( 'search for an unpublished project title finds nothing', array() === ids_of( $s( 'Hidden Draft' ) ) );
t( 'search "%" is literal (matches only the project with a % in its text)', same( ids_of( $s( '%' ) ), array( $data['ids']['published']['pct'] ) ) );
t( 'search "_" is literal', same( ids_of( $s( '_under_' ) ), array( $data['ids']['published']['pct'] ) ) );
$res = $s( "'; DROP TABLE wp_posts;-- \" OR 1=1" );
t( 'SQL-ish search is harmless', 200 === $res->get_status() && array() === ids_of( $res ) );
t( 'search longer than 100 chars is cut, not an error', 200 === call( array( 'search' => str_repeat( 'a', 500 ) ) )->get_status() );
t( 'empty search = no search', same( ids_of( call( array( 'search' => '   ' ) ) ), ids_of( call() ) ) );
t( 'search with no results -> 200, empty, total 0', ( function () use ( $s ) { $r = $s( 'qqqnomatchqqq' ); return 200 === $r->get_status() && array() === ids_of( $r ) && 0 === $r->get_data()['pagination']['total'] && 0 === $r->get_data()['pagination']['total_pages']; } )() );

// ===== include (the subject-filter hook): ids only
$some = array_slice( oracle( $all, array( 'technology' => array( 'robotics' ) ) ), 0, 3 );
$res  = call( array( 'include' => implode( ',', $some ), 'technology' => 'robotics', 'per_page' => 24 ) );
t( 'include restricts the result to those ids (intersected with the other filters)', same( ids_of( $res ), oracle( $all, array( 'technology' => array( 'robotics' ), 'include' => $some ) ) ) && 3 === count( ids_of( $res ) ) );
t( 'include with ids outside the filter returns only the overlap', same( ids_of( call( array( 'include' => array( $data['ids']['published']['beta'], $data['ids']['published']['alpha'] ), 'technology' => 'robotics' ) ) ), array( $data['ids']['published']['alpha'] ) ) );
t( 'empty include = nothing matched = no results (fails closed)', array() === ids_of( call( array( 'include' => '' ) ) ) );
t( 'include of an unpublished project id still returns nothing', array() === ids_of( call( array( 'include' => (string) $data['ids']['unpublished']['draft'] ) ) ) );
t( 'garbage include ("abc") fails closed', array() === ids_of( call( array( 'include' => 'abc' ) ) ) );
t( 'include with more than 200 ids -> 400', 400 === call( array( 'include' => implode( ',', range( 1, 201 ) ) ) )->get_status() );

// ===== subject parameter is ignored and never echoed
$subj_slug = get_term( $data['subject_term'], RVP_TAX_SUBJECT )->slug;
$base      = wp_json_encode( call( array( 'per_page' => 24 ) )->get_data() );
foreach ( array( 'subject' => $subj_slug, 'subjects' => 'physics', 'rv_subject' => 'physics,chemistry' ) as $k => $v ) {
	$with = call( array( 'per_page' => 24, $k => $v ) );
	t( "?$k=… changes nothing", 200 === $with->get_status() && wp_json_encode( $with->get_data() ) === $base );
	t( "?$k=… is not echoed in the response", false === strpos( wp_json_encode( $with->get_data() ), $v ) && false === strpos( wp_json_encode( $with->get_headers() ), $v ) );
}
$arr = call( array( 'per_page' => 24, 'subject' => array( 'physics', 'zz' ) ) );
t( '?subject[]=… (array) changes nothing', wp_json_encode( $arr->get_data() ) === $base );
t( 'subject parameter is not in the route definition', ! isset( rest_get_server()->get_routes()['/rvp/v1/projects'][0]['args']['subject'] ) );

// ===== technologies for Section B
$techs = call()->get_data()['technologies'];
$slugs = array_column( $techs, 'slug' );
t( 'technology entries have exactly slug, name, description, image, order, count', ! array_diff( array( 'slug', 'name', 'description', 'image', 'order', 'count' ), array_keys( $techs[0] ) ) && 6 === count( $techs[0] ) );
t( 'empty technologies are hidden (embedded-systems)', ! in_array( 'embedded-systems', $slugs, true ) );
t( 'empty technology with "show even when empty" is listed (other-technologies, count 0)', in_array( 'other-technologies', $slugs, true ) && 0 === $techs[ array_search( 'other-technologies', $slugs, true ) ]['count'] );
$rob = $techs[ array_search( 'robotics', $slugs, true ) ];
t( 'count = published projects in that technology', count( oracle( $all, array( 'technology' => array( 'robotics' ) ) ) ) === $rob['count'], $rob['count'] );
$orders = array_column( $techs, 'order' ); $sorted = $orders; sort( $sorted );
t( 'technologies are sorted by display order', $orders === $sorted );
$robotics_term = get_term_by( 'slug', 'robotics', RVP_TAX_TECH );
update_term_meta( $robotics_term->term_id, 'rvp_image_id', $data['image_id'] ); wp_update_term( $robotics_term->term_id, RVP_TAX_TECH, array( 'description' => '<b>Robots</b> & <script>x</script>more' ) );
$rob = null; foreach ( call()->get_data()['technologies'] as $tt ) { if ( 'robotics' === $tt['slug'] ) { $rob = $tt; } }
t( 'technology image has url, width, height, alt', $rob && is_array( $rob['image'] ) && $rob['image']['url'] && $rob['image']['width'] && 'Robotics' === $rob['image']['alt'], json_encode( $rob['image'] ?? null ) );
t( 'technology description is plain text', $rob && false === strpos( $rob['description'], '<' ) && false !== strpos( $rob['description'], 'Robots & ' ), $rob['description'] ?? '' );
update_term_meta( $robotics_term->term_id, 'rvp_image_id', 0 ); wp_update_term( $robotics_term->term_id, RVP_TAX_TECH, array( 'description' => '' ) );
t( 'technology list is identical whatever the filters', wp_json_encode( call( array( 'search' => 'zzzz' ) )->get_data()['technologies'] ) === wp_json_encode( call()->get_data()['technologies'] ) );

// ===== headers and routing
$r = call( array( 'per_page' => 5 ) ); $h = $r->get_headers();
t( 'Cache-Control is public, short-lived', 'public, max-age=60, s-maxage=120' === ( $h['Cache-Control'] ?? '' ), $h['Cache-Control'] ?? '(none)' );
t( 'Vary: Accept-Encoding (not Cookie / Authorization)', 'Accept-Encoding' === ( $h['Vary'] ?? '' ) );
t( 'X-WP-Total / X-WP-TotalPages present and correct', (string) $pub_total === ( $h['X-WP-Total'] ?? '' ) && (string) (int) ceil( $pub_total / 5 ) === ( $h['X-WP-TotalPages'] ?? '' ) );
t( 'X-Robots-Tag: noindex', 'noindex' === ( $h['X-Robots-Tag'] ?? '' ) );
$routes = array_keys( rest_get_server()->get_routes() );
t( 'the plugin registers exactly one REST route (rvp/v1/projects)', array( '/rvp/v1', '/rvp/v1/projects' ) === array_values( preg_grep( '#^/rvp/#', $routes ) ) );
t( 'no REST route mentions rv_project / rv_subject / rv_technology', 0 === count( preg_grep( '#rv_(project|subject|technology|education)#', $routes ) ) );
$post = new WP_REST_Request( 'POST', '/rvp/v1/projects' ); $post->set_param( 'title', 'x' );
t( 'POST is not allowed', 404 === rest_do_request( $post )->get_status() || 405 === rest_do_request( $post )->get_status() );

// ===== the whole of every public response is free of every marker
$blob = '';
foreach ( array( array(), array( 'per_page' => 24 ), array( 'search' => 'RVP' ), array( 'view' => 'featured' ), array( 'per_page' => 24, 'page' => 2 ) ) as $q ) { $blob .= wp_json_encode( call( $q )->get_data() ) . wp_json_encode( call( $q )->get_headers() ); }
foreach ( $M as $what => $needle ) { t( "no response contains the $what marker", false === strpos( $blob, $needle ) && false === strpos( $blob, 'zebra' ) ); }

echo "\n" . $GLOBALS['rvp_pass'] . ' passed, ' . $GLOBALS['rvp_fail'] . " failed\n";
