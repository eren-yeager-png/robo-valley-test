<?php
// RoboValley Projects: removes everything stage2-setup.php created. LOCAL TEST SITE ONLY. Run: wp eval-file stage2-teardown.php
if ( ! defined( 'RVP_POST_TYPE' ) ) {
	WP_CLI::error( 'RoboValley Projects is not active.' );
}
global $wpdb;
$ids = $wpdb->get_col( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = %s AND post_title LIKE %s", RVP_POST_TYPE, 'RVPT %' ) );
foreach ( $ids as $id ) {
	wp_delete_post( (int) $id, true );
}
foreach ( get_terms( array( 'taxonomy' => RVP_TAX_SUBJECT, 'hide_empty' => false, 'name__like' => 'RVPMARK_' ) ) as $term ) {
	wp_delete_term( $term->term_id, RVP_TAX_SUBJECT );
}
foreach ( get_posts( array( 'post_type' => 'attachment', 'meta_key' => '_rvp_test_image', 'meta_value' => '1', 'numberposts' => -1, 'post_status' => 'inherit', 'fields' => 'ids' ) ) as $att ) {
	wp_delete_attachment( (int) $att, true );
}
$other = get_term_by( 'slug', 'other-technologies', RVP_TAX_TECH );
if ( $other ) {
	delete_term_meta( $other->term_id, 'rvp_show_empty' );
}
$dir = wp_upload_dir();
@unlink( $dir['basedir'] . '/rvp-markers.json' );
WP_CLI::success( 'Removed ' . count( $ids ) . ' test projects, the test image, the marker subject term and the marker file.' );
