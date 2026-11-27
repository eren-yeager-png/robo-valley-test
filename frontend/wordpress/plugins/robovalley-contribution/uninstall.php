<?php
/**
 * Uninstall: keeps everything by default (the ideas live in the RoboValley app anyway; this plugin stores only a few options and its
 * pages). Only when RV_CONTRIB_UNINSTALL_DELETE is defined as true in wp-config.php are the plugin's own options removed. Pages are
 * never deleted automatically: an administrator decides that in Pages.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}
if ( defined( 'RV_CONTRIB_UNINSTALL_DELETE' ) && true === RV_CONTRIB_UNINSTALL_DELETE ) {
	foreach ( array( 'rv_contrib_setup_version', 'rv_contrib_page_form', 'rv_contrib_page_ideas', 'rv_contrib_switch_over' ) as $option ) {
		delete_option( $option );
	}
}
