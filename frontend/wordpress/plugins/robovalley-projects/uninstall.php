<?php
/**
 * Runs when the plugin is DELETED in wp-admin (not when it is merely deactivated).
 * Removes the capabilities, the seed flag and the bridge's leftover one-time-use records (rvp_bridge_nonce_* options, which
 * only hold a hash and an expiry). Projects, terms and their fields are deliberately left in the database, so deleting the
 * plugin by mistake loses no content.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once __DIR__ . '/includes/capabilities.php';

rvp_revoke_capabilities();
delete_option( 'rvp_terms_seeded' );

global $wpdb;
$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( 'rvp_bridge_nonce_' ) . '%' ) );
