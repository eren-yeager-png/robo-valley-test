<?php
// Run through WP-CLI by scripts/wp-local-setup.sh (local development only):  wp eval-file /scripts/wp-apply-header.php
// Applies the Astra header settings (Sign In link) and the Additional CSS that are stored in frontend/wordpress/.
$s = json_decode( file_get_contents( '/frontend/wordpress/header/astra-header-signin.json' ), true );
unset( $s['note'] );
$opt = get_option( 'astra-settings', array() );
if ( ! is_array( $opt ) ) {
	$opt = array();
}
update_option( 'astra-settings', array_replace( $opt, $s ) );
wp_update_custom_css_post( file_get_contents( '/frontend/wordpress/additional-css.css' ) );
echo "header and additional CSS applied\n";
