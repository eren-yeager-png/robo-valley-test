<?php
// RoboValley Projects: Demo Content, install / re-install / remove, in process (WP-CLI). LOCAL TEST SITE ONLY.
// Run on a site with the main plugin and the demo plugin active and NO projects:  wp eval-file rvpdc-demo-content-test.php <dataset-out.json>
// It creates its own decoy posts (a project, a post, a page, an image), proves they survive, and deletes them at the end.

$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok, $detail = '' ) {
	$ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++;
	echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . ( ! $ok && '' !== $detail ? '  -> ' . ( is_scalar( $detail ) ? $detail : wp_json_encode( $detail ) ) : '' ) . "\n";
}
if ( ! function_exists( 'rvpdc_install' ) || ! rvpdc_main_plugin_ready() ) { WP_CLI::error( 'Both plugins must be active.' ); }
wp_set_current_user( 1 );
global $wpdb;
$out_json = isset( $args[0] ) ? $args[0] : '';

function snap_posts() { global $wpdb; $rows = $wpdb->get_results( "SELECT post_type, post_status, COUNT(*) n FROM {$wpdb->posts} WHERE post_type NOT IN ('revision','auto-draft') GROUP BY post_type, post_status ORDER BY post_type, post_status", ARRAY_A ); return wp_json_encode( $rows ); }
function snap_terms() {
	$all = array();
	foreach ( array( RVP_TAX_TECH, RVP_TAX_EDU, RVP_TAX_SUBJECT ) as $tx ) {
		foreach ( get_terms( array( 'taxonomy' => $tx, 'hide_empty' => false ) ) as $term ) {
			$meta = get_term_meta( $term->term_id );
			ksort( $meta );
			$all[] = array( $tx, $term->term_id, $term->slug, $term->name, $meta );
		}
	}
	return md5( wp_json_encode( $all ) ) . ':' . count( $all );
}
function snap_options() { return md5( wp_json_encode( array( get_option( 'rvp_terms_seeded' ), get_option( 'robovalley_api_base' ), get_option( 'blogname' ), get_option( 'permalink_structure' ), get_option( 'rewrite_rules' ) ? 1 : 0 ) ) ); }
function demo_posts() { return rvpdc_project_ids(); }

if ( get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) ) ) { WP_CLI::error( 'This test needs a site with no projects.' ); }

// ---------- dataset sanity (pure data)
$ds = rvpdc_dataset();
t( 'dataset has 20 projects', 20 === count( $ds ) );
t( 'unique keys and titles', 20 === count( array_unique( wp_list_pluck( $ds, 'key' ) ) ) && 20 === count( array_unique( wp_list_pluck( $ds, 'title' ) ) ) );
$bad = array();
foreach ( $ds as $d ) {
	$sent = function ( $x ) { return preg_match_all( '/[.!?](\s|$)/', $x ); };
	if ( mb_strlen( $d['desc'] ) > 200 ) { $bad[] = $d['key'] . ' desc length'; }
	if ( $sent( $d['overview'] ) < 2 || $sent( $d['overview'] ) > 3 ) { $bad[] = $d['key'] . ' overview sentences ' . $sent( $d['overview'] ); }
	if ( count( $d['skills'] ) < 4 || count( $d['skills'] ) > 6 ) { $bad[] = $d['key'] . ' skills ' . count( $d['skills'] ); }
	if ( count( $d['components'] ) < 4 || count( $d['components'] ) > 6 ) { $bad[] = $d['key'] . ' components ' . count( $d['components'] ); }
	if ( $sent( $d['outcome'] ) < 1 || $sent( $d['outcome'] ) > 2 ) { $bad[] = $d['key'] . ' outcome sentences ' . $sent( $d['outcome'] ); }
	if ( preg_match( '/\bdemo\b/i', $d['title'] . $d['desc'] . $d['overview'] . $d['outcome'] ) ) { $bad[] = $d['key'] . ' mentions demo'; }
	if ( ! is_readable( RVPDC_DIR . 'assets/images/' . $d['key'] . '.png' ) ) { $bad[] = $d['key'] . ' image missing'; }
	if ( filesize( RVPDC_DIR . 'assets/images/' . $d['key'] . '.png' ) > 80 * 1024 ) { $bad[] = $d['key'] . ' image > 80 KB'; }
}
t( 'every project: desc <= 200, overview 2-3 sentences, 4-6 skills, 4-6 components, outcome 1-2 sentences, no "demo" word, image <= 80 KB', ! $bad, $bad );

// ---------- decoys (must survive everything)
$decoy_proj = wp_insert_post( array( 'post_type' => RVP_POST_TYPE, 'post_title' => 'RVPDC decoy project', 'post_status' => 'publish' ) );
update_post_meta( $decoy_proj, '_rvp_demo', '0' ); // not "1": must not be removed
$decoy_post = wp_insert_post( array( 'post_type' => 'post', 'post_title' => 'RVPDC decoy post', 'post_status' => 'publish' ) );
update_post_meta( $decoy_post, '_rvp_demo', '1' ); // a non-project carrying the tag: not a project, must not be removed
$decoy_page = wp_insert_post( array( 'post_type' => 'page', 'post_title' => 'RVPDC decoy page', 'post_status' => 'draft' ) );
$upl        = wp_upload_dir();
$decoy_file = $upl['path'] . '/rvpdc-decoy.png';
file_put_contents( $decoy_file, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' ) );
$decoy_att = wp_insert_attachment( array( 'post_mime_type' => 'image/png', 'post_title' => 'RVPDC decoy image', 'post_status' => 'inherit' ), $decoy_file );
$decoy_ids = array( $decoy_proj, $decoy_post, $decoy_page, $decoy_att );

$base_posts = snap_posts(); $base_terms = snap_terms(); $base_opts = snap_options();
$purges = 0; add_action( 'litespeed_purge', function ( $tag ) use ( &$purges ) { if ( 'rvp_catalogue' === $tag ) { $purges++; } } );

// ---------- install
t( 'before install: 0 demo projects, 0 demo images', 0 === count( demo_posts() ) && 0 === count( rvpdc_attachment_ids() ) );
// first click runs out of time on purpose (budget 0): must stop cleanly after one complete project
add_filter( 'rvpdc_time_budget', '__return_zero' );
$r0 = rvpdc_install();
remove_filter( 'rvpdc_time_budget', '__return_zero' );
t( 'install that runs out of time stops cleanly: 1 created, 19 remaining, 1 image, no errors', ! is_wp_error( $r0 ) && 1 === $r0['created'] && 19 === $r0['remaining'] && 1 === $r0['images'] && ! $r0['errors'], $r0 );
$first = demo_posts();
t( '...and that one project is complete (published, thumbnail, restricted fields)', 1 === count( $first ) && 'publish' === get_post_status( $first[0] ) && get_post_thumbnail_id( $first[0] ) && get_post_meta( $first[0], '_rvp_overview', true ) );
$r = rvpdc_install();
t( 'the next click finishes the job: 19 created, 1 skipped, 19 images, 0 remaining, no errors, no missing terms', ! is_wp_error( $r ) && 19 === $r['created'] && 1 === $r['skipped'] && 19 === $r['images'] && 0 === $r['remaining'] && ! $r['errors'] && ! $r['missing_terms'], $r );
t( 'install asked the catalogue cache to refresh (LiteSpeed hook fired; real purge: needs staging)', $purges >= 1, $purges );
$ids = demo_posts(); sort( $ids );
t( 'exactly 20 demo projects and 20 demo images exist', 20 === count( $ids ) && 20 === count( rvpdc_attachment_ids() ) );
t( 'all published, all of post type rv_project, all with a demo key', 20 === count( array_filter( $ids, function ( $i ) { return 'publish' === get_post_status( $i ) && RVP_POST_TYPE === get_post_type( $i ) && get_post_meta( $i, '_rvp_demo_key', true ); } ) ) );
t( 'no title carries a DEMO prefix or word (clean cards on the public site)', 0 === count( array_filter( $ids, function ( $i ) { return preg_match( '/demo/i', get_the_title( $i ) . get_post_meta( $i, '_rvp_short_desc', true ) ); } ) ) );
t( 'terms are unchanged by install (same ids, names, slugs, meta, count)', $base_terms === snap_terms() );
t( 'settings are unchanged by install', $base_opts === snap_options() );

// coverage
$by_key = array(); foreach ( $ids as $i ) { $by_key[ get_post_meta( $i, '_rvp_demo_key', true ) ] = $i; }
$tech_n = array(); $edu_n = array(); $sub_n = array(); $dif_n = array(); $feat = array(); $term_bad = array();
foreach ( $ds as $d ) {
	$i = $by_key[ $d['key'] ] ?? 0;
	$tt = wp_list_pluck( wp_get_object_terms( $i, RVP_TAX_TECH ), 'slug' ); $te = wp_list_pluck( wp_get_object_terms( $i, RVP_TAX_EDU ), 'slug' ); $ts = wp_list_pluck( wp_get_object_terms( $i, RVP_TAX_SUBJECT ), 'slug' );
	sort( $te ); sort( $ts ); $xe = $d['edu']; $xs = $d['subjects']; sort( $xe ); sort( $xs );
	if ( array( $d['tech'] ) !== $tt || $te !== $xe || $ts !== $xs ) { $term_bad[] = $d['key']; }
	foreach ( $tt as $s ) { $tech_n[ $s ] = ( $tech_n[ $s ] ?? 0 ) + 1; }
	foreach ( $te as $s ) { $edu_n[ $s ] = ( $edu_n[ $s ] ?? 0 ) + 1; }
	foreach ( $ts as $s ) { $sub_n[ $s ] = ( $sub_n[ $s ] ?? 0 ) + 1; }
	$df = get_post_meta( $i, '_rvp_difficulty', true ); $dif_n[ $df ] = ( $dif_n[ $df ] ?? 0 ) + 1;
	if ( get_post_meta( $i, '_rvp_featured', true ) ) { $feat[ (int) get_post_meta( $i, '_rvp_order', true ) ] = $d['key']; }
}
t( 'every project has exactly its technology, education levels and subjects from the table', ! $term_bad, $term_bad );
t( 'all 10 technologies, 2 projects each', 10 === count( $tech_n ) && 2 === min( $tech_n ) && 2 === max( $tech_n ), $tech_n );
t( 'all 7 education levels covered', 7 === count( $edu_n ), $edu_n );
t( 'all 8 subjects covered', 8 === count( $sub_n ), $sub_n );
t( 'all 3 difficulty levels covered', 3 === count( $dif_n ) && isset( $dif_n['beginner'], $dif_n['intermediate'], $dif_n['advanced'] ), $dif_n );
ksort( $feat );
t( '6 featured projects with display order 1..6', array( 1, 2, 3, 4, 5, 6 ) === array_keys( $feat ), $feat );
$orders = array_map( function ( $i ) { return (int) get_post_meta( $i, '_rvp_order', true ); }, $ids );
t( 'display orders are all different (varied)', count( array_unique( $orders ) ) === 20 );
$dates = array_map( function ( $i ) { return get_post_field( 'post_date_gmt', $i ); }, $ids );
t( 'publish dates are staggered (20 different days), none in the future', count( array_unique( array_map( function ( $d ) { return substr( $d, 0, 10 ); }, $dates ) ) ) === 20 && max( $dates ) <= gmdate( 'Y-m-d H:i:s' ), array_slice( $dates, 0, 3 ) );
t( 'restricted fields stored (overview, skills, components, outcome) on every project', 20 === count( array_filter( $ids, function ( $i ) { return get_post_meta( $i, '_rvp_overview', true ) && substr_count( get_post_meta( $i, '_rvp_skills', true ), "\n" ) >= 3 && substr_count( get_post_meta( $i, '_rvp_components', true ), "\n" ) >= 3 && get_post_meta( $i, '_rvp_outcome', true ); } ) ) );

// images
$img_bad = array(); $files = array();
foreach ( $ids as $i ) {
	$th = (int) get_post_thumbnail_id( $i ); $f = $th ? get_attached_file( $th ) : '';
	$m = $th ? wp_get_attachment_metadata( $th ) : array();
	if ( ! $th || ! $f || ! file_exists( $f ) ) { $img_bad[] = $i . ' no file'; continue; }
	$files[] = $f;
	if ( '1' !== get_post_meta( $th, '_rvp_demo', true ) ) { $img_bad[] = $i . ' not tagged'; }
	if ( trim( (string) get_post_meta( $th, '_wp_attachment_image_alt', true ) ) === '' ) { $img_bad[] = $i . ' no alt'; }
	if ( empty( $m['width'] ) || 960 !== (int) $m['width'] || 600 !== (int) $m['height'] ) { $img_bad[] = $i . ' size ' . ( $m['width'] ?? '?' ); }
	if ( filesize( $f ) > 80 * 1024 ) { $img_bad[] = $i . ' > 80 KB'; }
	if ( empty( $m['sizes']['medium_large'] ) ) { $img_bad[] = $i . ' no medium_large'; }
}
t( 'every project has its own tagged thumbnail: file exists, alt text, 960x600 (16:10), <= 80 KB, medium_large generated', ! $img_bad, $img_bad );

// public catalogue
wp_set_current_user( 0 );
$req = new WP_REST_Request( 'GET', '/rvp/v1/projects' ); $req->set_param( 'per_page', 24 ); $req->set_param( 'view', 'all' );
$resp = rest_do_request( $req ); $body = wp_json_encode( $resp->get_data() ); $items = $resp->get_data()['items'] ?? array();
$data = $resp->get_data();
t( 'public catalogue lists 21 projects: the 20 demo ones plus the published decoy', 21 === (int) ( $data['pagination']['total'] ?? -1 ), $data['pagination'] ?? null );
$leak = array(); foreach ( $ds as $d ) { foreach ( array_merge( array( $d['overview'], $d['outcome'] ), $d['skills'], $d['components'] ) as $s ) { if ( false !== strpos( $body, $s ) ) { $leak[] = $s; } } }
t( 'public catalogue response contains none of the restricted text', ! $leak, array_slice( $leak, 0, 3 ) );
$demo_titles = wp_list_pluck( $ds, 'title' );
$cards = array_filter( $items, function ( $p ) use ( $demo_titles ) { return in_array( $p['title'], $demo_titles, true ); } );
t( 'the 20 demo cards each have a thumbnail url and no "demo" word in title or description', 20 === count( $cards ) && 20 === count( array_filter( $cards, function ( $p ) { return ! empty( $p['thumbnail']['url'] ) && ! preg_match( '/demo/i', $p['title'] . $p['short_description'] ); } ) ) );
wp_set_current_user( 1 );

// ---------- re-install: nothing duplicated, nothing changed
$before = array(); foreach ( $ids as $i ) { $before[ $i ] = array( get_post_field( 'post_modified_gmt', $i ), md5( wp_json_encode( get_post_meta( $i ) ) ), get_post_thumbnail_id( $i ) ); }
$att_before = rvpdc_attachment_ids(); $all_posts_before = snap_posts();
$r2 = rvpdc_install(); $ids2 = demo_posts(); sort( $ids2 );
t( 're-install: 0 created, 20 skipped, 0 images, no errors', ! is_wp_error( $r2 ) && 0 === $r2['created'] && 20 === $r2['skipped'] && 0 === $r2['images'] && ! $r2['errors'], $r2 );
t( 're-install: same 20 project ids, same 20 images, no new posts anywhere', $ids2 === $ids && $att_before === rvpdc_attachment_ids() && $all_posts_before === snap_posts() );
$changed = array(); foreach ( $ids as $i ) { if ( $before[ $i ] !== array( get_post_field( 'post_modified_gmt', $i ), md5( wp_json_encode( get_post_meta( $i ) ) ), get_post_thumbnail_id( $i ) ) ) { $changed[] = $i; } }
t( 're-install updates nothing it already created (modified date, meta, thumbnail identical)', ! $changed, $changed );

// ---------- one demo project deleted by hand: only that one is recreated, its image is reused
$victim = $ids[3]; $victim_att = (int) get_post_thumbnail_id( $victim ); wp_delete_post( $victim, true );
t( 'a hand-deleted demo project leaves its (tagged) image behind', 19 === count( demo_posts() ) && 20 === count( rvpdc_attachment_ids() ) );
$r3 = rvpdc_install();
t( 'install recreates exactly the missing one and reuses its image (still 20 images)', 1 === $r3['created'] && 19 === $r3['skipped'] && 1 === $r3['images'] && 20 === count( demo_posts() ) && 20 === count( rvpdc_attachment_ids() ), $r3 );
// a trashed demo project counts as installed (not recreated), and Remove still deletes it
$tr = demo_posts()[0]; wp_trash_post( $tr );
$r4 = rvpdc_install();
t( 'a demo project in the Trash is not duplicated by install', 0 === $r4['created'] && 20 === count( demo_posts() ), $r4 );

// ---------- missing terms are reported, never created
$terms_before = wp_count_terms( array( 'taxonomy' => RVP_TAX_SUBJECT, 'hide_empty' => false ) );
list( $found, $missing ) = rvpdc_resolve_terms( RVP_TAX_SUBJECT, array( 'physics', 'nope-xyz' ) );
t( 'a missing term is reported and not created', 1 === count( $found ) && array( RVP_TAX_SUBJECT . ':nope-xyz' ) === $missing && ! get_term_by( 'slug', 'nope-xyz', RVP_TAX_SUBJECT ) && $terms_before === wp_count_terms( array( 'taxonomy' => RVP_TAX_SUBJECT, 'hide_empty' => false ) ) );

// ---------- remove
$purges_before = $purges; $files_before = array_filter( $files, 'file_exists' );
$rm = rvpdc_remove();
t( 'remove report: 20 projects (including the one in the Trash) and 20 images, no errors', ! is_wp_error( $rm ) && 20 === $rm['projects'] && 20 === $rm['images'] && ! $rm['errors'], $rm );
t( 'remove asked the catalogue cache to refresh (hook fired; real purge: needs staging)', $purges > $purges_before );
t( 'after remove: 0 demo projects, 0 demo images', 0 === count( demo_posts() ) && 0 === count( rvpdc_attachment_ids() ) );
t( 'after remove: the image files are gone from disk', ! array_filter( $files, 'file_exists' ) && count( $files_before ) >= 19, count( array_filter( $files, 'file_exists' ) ) );
t( 'after remove: no demo-looking leftovers in the uploads folder', ! glob( $upl['path'] . '/line-following-robot*' ) );
foreach ( $decoy_ids as $d ) { t( "decoy $d (" . get_post_type( $d ) . ') survived', (bool) get_post( $d ) && 'trash' !== get_post_status( $d ) ); }
t( 'after remove: post counts of every type and status are exactly what they were before install', $base_posts === snap_posts(), array( $base_posts, snap_posts() ) );
t( 'after remove: terms and settings are identical to before', $base_terms === snap_terms() && $base_opts === snap_options() );
t( 'the decoy image file still exists', file_exists( $decoy_file ) );
$rm2 = rvpdc_remove();
t( 'removing again is harmless (0 and 0)', 0 === $rm2['projects'] && 0 === $rm2['images'] );

// dataset out for the browser and leak tests, written while the data is gone: re-install once, dump ids, then remove again at the end of those tests
if ( $out_json ) {
	$labels = array(); foreach ( array( RVP_TAX_TECH, RVP_TAX_EDU, RVP_TAX_SUBJECT ) as $tx ) { foreach ( get_terms( array( 'taxonomy' => $tx, 'hide_empty' => false ) ) as $term ) { $labels[ $tx ][ $term->slug ] = $term->name; } }
	file_put_contents( $out_json, wp_json_encode( array( 'dataset' => $ds, 'labels' => $labels ) ) );
}

// cleanup decoys
foreach ( array( $decoy_proj, $decoy_post, $decoy_page ) as $d ) { wp_delete_post( $d, true ); }
wp_delete_attachment( $decoy_att, true ); @unlink( $decoy_file );
t( 'decoys cleaned up, nothing left behind', ! get_post( $decoy_proj ) && ! get_post( $decoy_post ) && ! get_post( $decoy_page ) && ! get_post( $decoy_att ) );
t( 'site is back to zero projects', ! get_posts( array( 'post_type' => RVP_POST_TYPE, 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids' ) ) );

echo "\n{$GLOBALS['rvp_pass']} passed, {$GLOBALS['rvp_fail']} failed\n";
exit( $GLOBALS['rvp_fail'] ? 1 : 0 );
