<?php
// RoboValley Projects: Stage 1 checks (capabilities, saving, sanitizing, seeding, no public exposure).
// LOCAL TEST SITE ONLY. Run: wp eval-file rvprojects-stage1-admin-test.php   (creates temporary users/project/term and deletes them again).
// wp eval-file runs this inside a function, so counters must live in $GLOBALS (a plain `global $pass` would be a different variable).
$GLOBALS['rvp_pass'] = 0;
$GLOBALS['rvp_fail'] = 0;
function t( $name, $ok ) { $ok ? $GLOBALS['rvp_pass']++ : $GLOBALS['rvp_fail']++; echo ( $ok ? 'PASS ' : 'FAIL ' ) . $name . "\n"; }

// --- capabilities per role
foreach ( array( 'administrator' => true, 'editor' => true, 'author' => false, 'contributor' => false, 'subscriber' => false ) as $r => $expect ) {
	$role = get_role( $r );
	t( "role $r can edit+publish+manage terms = " . var_export( $expect, true ),
		( $role->has_cap( 'edit_rv_projects' ) && $role->has_cap( 'publish_rv_projects' ) && $role->has_cap( 'manage_rv_project_terms' ) ) === $expect );
	t( "role $r has no cap leakage when expect=false", $expect || ! ( $role->has_cap( 'edit_rv_projects' ) || $role->has_cap( 'publish_rv_projects' ) || $role->has_cap( 'delete_rv_projects' ) ) );
}

// --- no REST route, no rewrite rule
$routes = array_keys( rest_get_server()->get_routes() );
t( 'no REST route for rv_project / taxonomies', 0 === count( preg_grep( '#rv_project|rv_technology|rv_education|rv_subject|/wp/v2/rv_#', $routes ) ) );
$rules = (array) get_option( 'rewrite_rules' );
t( 'no rewrite rule mentions rv_', 0 === count( preg_grep( '#rv_(project|technology|education|subject)#', array_merge( array_keys( $rules ), array_values( $rules ) ) ) ) );
t( 'post type not queryable on front end', ! is_post_type_viewable( 'rv_project' ) );

// --- users
$editor_id = wp_insert_user( array( 'user_login' => 'rvp_t_editor', 'user_pass' => wp_generate_password( 24 ), 'user_email' => 'rvp_t_editor@example.invalid', 'role' => 'editor' ) );
$author_id = wp_insert_user( array( 'user_login' => 'rvp_t_author', 'user_pass' => wp_generate_password( 24 ), 'user_email' => 'rvp_t_author@example.invalid', 'role' => 'author' ) );

// --- author cannot create or publish
wp_set_current_user( $author_id );
t( 'author cannot edit_rv_projects', ! current_user_can( 'edit_rv_projects' ) );
t( 'author cannot assign project terms via manage cap', ! current_user_can( 'manage_rv_project_terms' ) );

// --- editor saves a project through the real save_post path (nonce + POST)
wp_set_current_user( $editor_id );
$tech = get_term_by( 'slug', 'robotics', 'rv_technology' );
$pid  = wp_insert_post( array( 'post_type' => 'rv_project', 'post_title' => 'RVP TEST (delete me)', 'post_status' => 'draft' ) );
t( 'editor can create a project', $pid && ! is_wp_error( $pid ) );
$_POST = array(
	'rvp_nonce_summary' => wp_create_nonce( 'rvp_save_summary_' . $pid ),
	'rvp_nonce_details' => wp_create_nonce( 'rvp_save_details_' . $pid ),
	'rvp_short_desc'    => "  Short <b>desc</b>\nsecond line ",
	'rvp_difficulty'    => 'advanced',
	'rvp_featured'      => '1',
	'rvp_order'         => '-5',
	'rvp_overview'      => "Line1\n<script>alert(1)</script>Line2",
	'rvp_skills'        => "Soldering\nPython",
	'rvp_components'    => 'Arduino',
	'rvp_outcome'       => 'A working robot',
);
wp_update_post( array( 'ID' => $pid, 'post_title' => 'RVP TEST (delete me)', 'post_status' => 'publish' ) );
t( 'short desc sanitized to one clean line', 'Short desc second line' === get_post_meta( $pid, '_rvp_short_desc', true ) );
t( 'difficulty saved', 'advanced' === get_post_meta( $pid, '_rvp_difficulty', true ) );
t( 'featured saved', '1' === get_post_meta( $pid, '_rvp_featured', true ) );
t( 'negative order becomes absolute integer', '5' === get_post_meta( $pid, '_rvp_order', true ) );
t( 'script tag stripped from overview, newline kept', false === strpos( get_post_meta( $pid, '_rvp_overview', true ), '<script' ) && false !== strpos( get_post_meta( $pid, '_rvp_overview', true ), "\n" ) );
t( 'skills saved with newline', "Soldering\nPython" === get_post_meta( $pid, '_rvp_skills', true ) );

// --- bad nonce / bad difficulty change nothing
$_POST = array( 'rvp_nonce_summary' => 'bad', 'rvp_nonce_details' => 'bad', 'rvp_difficulty' => 'beginner', 'rvp_overview' => 'HACK' );
wp_update_post( array( 'ID' => $pid, 'post_title' => 'RVP TEST (delete me)' ) );
t( 'invalid nonce: difficulty unchanged', 'advanced' === get_post_meta( $pid, '_rvp_difficulty', true ) );
t( 'invalid nonce: overview unchanged', 'HACK' !== get_post_meta( $pid, '_rvp_overview', true ) );
$_POST = array( 'rvp_nonce_summary' => wp_create_nonce( 'rvp_save_summary_' . $pid ), 'rvp_difficulty' => 'god-mode' );
wp_update_post( array( 'ID' => $pid, 'post_title' => 'RVP TEST (delete me)' ) );
t( 'unknown difficulty value is dropped', '' === (string) get_post_meta( $pid, '_rvp_difficulty', true ) );
t( 'summary-only save leaves members-only box untouched', 'A working robot' === get_post_meta( $pid, '_rvp_outcome', true ) );

// --- author cannot save into the project
wp_set_current_user( $author_id );
$_POST = array( 'rvp_nonce_details' => wp_create_nonce( 'rvp_save_details_' . $pid ), 'rvp_outcome' => 'AUTHOR WROTE THIS' );
do_action( 'save_post_rv_project', $pid, get_post( $pid ), true );
t( 'author save is refused', 'AUTHOR WROTE THIS' !== get_post_meta( $pid, '_rvp_outcome', true ) );
$_POST = array();

// --- restricted data never in REST or public output paths
wp_set_current_user( 0 );
$all_meta_in_rest = false;
foreach ( get_registered_meta_keys( 'post', 'rv_project' ) as $k => $def ) { if ( ! empty( $def['show_in_rest'] ) ) { $all_meta_in_rest = true; } }
t( 'no project meta key is exposed to REST', ! $all_meta_in_rest );
$req = new WP_REST_Request( 'GET', '/wp/v2/posts' );
$resp = rest_do_request( $req );
t( 'restricted text absent from public /wp/v2/posts', false === strpos( wp_json_encode( $resp->get_data() ), 'A working robot' ) );
$resp = rest_do_request( new WP_REST_Request( 'GET', '/wp/v2/search' ) );
t( 'restricted text absent from public /wp/v2/search', false === strpos( wp_json_encode( $resp->get_data() ), 'RVP TEST' ) );
$q = new WP_Query( array( 'post_type' => 'any', 's' => 'RVP TEST', 'post_status' => 'publish' ) );
t( 'project not found by front-end search', 0 === $q->found_posts );

// --- term meta save as admin (nonce path) + non-image id rejected
$admin = get_users( array( 'role' => 'administrator', 'number' => 1 ) );
wp_set_current_user( $admin[0]->ID );
$_POST = array( 'rvp_term_nonce' => wp_create_nonce( 'rvp_term_meta' ), 'rvp_order' => '7', 'rvp_image_id' => (string) $pid, 'rvp_show_empty' => '1' ); // $pid is not an attachment.
$new = wp_insert_term( 'RVP TEST TECH', 'rv_technology', array( 'slug' => 'rvp-test-tech' ) );
t( 'term created', ! is_wp_error( $new ) );
t( 'term order saved', 7 === (int) get_term_meta( $new['term_id'], 'rvp_order', true ) );
t( 'non-image id rejected for term image', 0 === (int) get_term_meta( $new['term_id'], 'rvp_image_id', true ) );
t( 'show_empty saved', (bool) get_term_meta( $new['term_id'], 'rvp_show_empty', true ) );
$_POST = array();

// --- seeding is idempotent and never overwrites edits
wp_update_term( $tech->term_id, 'rv_technology', array( 'name' => 'Robotics (renamed by admin)', 'description' => 'Admin text' ) );
update_term_meta( $tech->term_id, 'rvp_order', 999 );
delete_option( 'rvp_terms_seeded' );
$before = wp_count_terms( array( 'taxonomy' => 'rv_technology', 'hide_empty' => false ) );
rvp_seed_terms();
$after = wp_count_terms( array( 'taxonomy' => 'rv_technology', 'hide_empty' => false ) );
$tech2 = get_term( $tech->term_id );
t( 'reseed adds no duplicates', $before === $after );
t( 'reseed keeps admin rename + description', 'Robotics (renamed by admin)' === $tech2->name && 'Admin text' === $tech2->description );
t( 'reseed keeps admin order', 999 === (int) get_term_meta( $tech->term_id, 'rvp_order', true ) );
$none = get_posts( array( 'post_type' => 'rv_project', 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids', 'exclude' => array( $pid ) ) );
t( 'plugin created no projects of its own', 0 === count( $none ) );

// --- cleanup (restore renamed term too)
wp_update_term( $tech->term_id, 'rv_technology', array( 'name' => 'Robotics', 'description' => '' ) );
update_term_meta( $tech->term_id, 'rvp_order', 10 );
wp_delete_term( $new['term_id'], 'rv_technology' );
wp_delete_post( $pid, true );
require_once ABSPATH . 'wp-admin/includes/user.php';
wp_delete_user( $editor_id ); wp_delete_user( $author_id );
update_option( 'rvp_terms_seeded', RVP_VERSION, false );

echo "\n" . $GLOBALS['rvp_pass'] . ' passed, ' . $GLOBALS['rvp_fail'] . " failed\n";
