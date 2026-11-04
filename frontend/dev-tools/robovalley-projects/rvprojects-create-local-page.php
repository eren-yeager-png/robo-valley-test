<?php
// RoboValley Projects: creates the Projects page on a LOCAL test site from the two rvprojects-page*.json files, the same way an
// admin would build it in Elementor. Run:  WP_ENVIRONMENT_TYPE=local wp eval-file rvprojects-create-local-page.php <path to frontend/elementor/rvprojects-page>
// Refuses unless WP_ENVIRONMENT_TYPE is local or development. Does nothing if a page with the slug already exists.
if ( ! in_array( wp_get_environment_type(), array( 'local', 'development' ), true ) || ( ! defined( 'WP_ENVIRONMENT_TYPE' ) && false === getenv( 'WP_ENVIRONMENT_TYPE' ) ) ) {
	WP_CLI::error( 'Refusing: WP_ENVIRONMENT_TYPE must be explicitly local or development.' );
}
$dir    = isset( $args[0] ) ? rtrim( $args[0], '/' ) : '';
$layout = json_decode( (string) @file_get_contents( $dir . '/rvprojects-page.elementor.json' ), true );
$config = json_decode( (string) @file_get_contents( $dir . '/rvprojects-page-config.json' ), true );
if ( ! $layout || ! $config ) { WP_CLI::error( 'Could not read the rvprojects-page JSON files in ' . $dir ); }
if ( get_page_by_path( $config['slug'] ) ) { WP_CLI::error( 'A page with the slug "' . $config['slug'] . '" already exists. Nothing changed.' ); }
$id = wp_insert_post( array( 'post_type' => 'page', 'post_title' => $config['title'], 'post_name' => $config['slug'], 'post_status' => $config['status'] ), true );
if ( is_wp_error( $id ) ) { WP_CLI::error( $id->get_error_message() ); }
foreach ( $config['meta'] as $k => $v ) {
	update_post_meta( $id, $k, $v );
}
update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $layout['content'] ) ) );
update_post_meta( $id, '_elementor_version', '4.3.5' );
WP_CLI::success( "Created page $id /{$config['slug']}/" );
