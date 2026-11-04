<?php
/**
 * Capabilities. Projects use their own capability set, so only roles that are explicitly given it can
 * create, edit or publish them. Administrators and editors get it; authors, contributors, subscribers
 * and the registered members of the RoboValley app (who are not WordPress users) never do.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Every capability the plugin uses (post type + taxonomy management). */
function rvp_capabilities() {
	return array(
		'edit_rv_projects',
		'edit_others_rv_projects',
		'edit_published_rv_projects',
		'edit_private_rv_projects',
		'publish_rv_projects',
		'read_private_rv_projects',
		'delete_rv_projects',
		'delete_others_rv_projects',
		'delete_published_rv_projects',
		'delete_private_rv_projects',
		'manage_rv_project_terms',
	);
}

/** Roles that manage projects. */
function rvp_manager_roles() {
	return array( 'administrator', 'editor' );
}

/** Adds the capabilities to the manager roles. Safe to run repeatedly. */
function rvp_grant_capabilities() {
	foreach ( rvp_manager_roles() as $role_name ) {
		$role = get_role( $role_name );
		if ( ! $role ) {
			continue;
		}
		foreach ( rvp_capabilities() as $cap ) {
			$role->add_cap( $cap );
		}
	}
}

/** Removes the capabilities from every role (used by uninstall.php). */
function rvp_revoke_capabilities() {
	foreach ( wp_roles()->role_objects as $role ) {
		foreach ( rvp_capabilities() as $cap ) {
			$role->remove_cap( $cap );
		}
	}
}
