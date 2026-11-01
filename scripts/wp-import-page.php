<?php
// Run through WP-CLI by scripts/wp-local-setup.sh:  wp eval-file /scripts/wp-import-page.php <page id>
// Loads the Elementor widget tree and page settings of "Find a Service" (page 510) from frontend/ into the local site.
$j  = json_decode( file_get_contents( '/frontend/elementor/find-a-service-510/find-a-service-510.elementor.json' ), true );
$id = (int) $args[0];
update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $j['content'] ) ) );
update_post_meta( $id, '_elementor_edit_mode', 'builder' );
update_post_meta( $id, '_elementor_template_type', 'wp-page' );
update_post_meta( $id, '_elementor_version', '4.3.5' );
update_post_meta( $id, '_elementor_page_settings', $j['page_settings'] );
update_post_meta( $id, '_wp_page_template', 'elementor_header_footer' );
update_post_meta( $id, 'ast-site-content-layout', 'full-width-container' );
update_post_meta( $id, 'site-post-title', 'disabled' );
echo "page $id configured\n";
