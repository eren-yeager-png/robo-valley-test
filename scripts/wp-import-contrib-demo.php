<?php
// LOCAL TEST SITE ONLY. Creates (or updates) the three contribution-DEMO pages as DRAFTS and loads their Elementor content from frontend/elementor/contrib-demo/.
//   MSYS_NO_PATHCONV=1 docker compose -f docker-compose.wordpress.yml --env-file .env.local run --rm -T -e WP_ENVIRONMENT_TYPE=local wpcli wp eval-file /scripts/wp-import-contrib-demo.php
// Refuses unless WP_ENVIRONMENT_TYPE is explicitly local or development. Never publishes a page. Does not touch any other page.
if ( ! in_array( wp_get_environment_type(), array( 'local', 'development' ), true ) || ( ! defined( 'WP_ENVIRONMENT_TYPE' ) && false === getenv( 'WP_ENVIRONMENT_TYPE' ) ) ) {
	WP_CLI::error( 'Refusing: WP_ENVIRONMENT_TYPE must be explicitly local or development.' );
}
$dir  = '/frontend/elementor/contrib-demo/';
$list = json_decode( file_get_contents( $dir . 'contrib-demo-pages.json' ), true );
foreach ( $list['pages'] as $p ) {
	$j      = json_decode( file_get_contents( $dir . $p['file'] ), true );
	$exists = get_page_by_path( $p['slug'], OBJECT, 'page' );
	$id     = $exists ? $exists->ID : wp_insert_post( array( 'post_type' => 'page', 'post_title' => $p['title'], 'post_name' => $p['slug'], 'post_status' => 'draft' ) );
	update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $j['content'] ) ) );
	update_post_meta( $id, '_elementor_edit_mode', 'builder' );
	update_post_meta( $id, '_elementor_template_type', 'wp-page' );
	update_post_meta( $id, '_elementor_version', '4.3.5' );
	update_post_meta( $id, '_elementor_page_settings', $j['page_settings'] );
	update_post_meta( $id, '_wp_page_template', 'elementor_header_footer' );
	update_post_meta( $id, 'ast-site-content-layout', 'full-width-container' );
	update_post_meta( $id, 'site-post-title', 'disabled' );
	echo "page {$id} ({$p['slug']}) is a draft and has its content\n";
}
