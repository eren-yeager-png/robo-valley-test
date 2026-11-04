<?php
/**
 * Runs when the plugin is DELETED in wp-admin (not when it is merely deactivated).
 * Removes the capabilities and the seed flag only. Projects, terms and their fields are deliberately left in
 * the database, so deleting the plugin by mistake loses no content.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once __DIR__ . '/includes/capabilities.php';

rvp_revoke_capabilities();
delete_option( 'rvp_terms_seeded' );
