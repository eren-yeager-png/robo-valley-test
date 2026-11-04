<?php
/**
 * Plugin Name:       RoboValley Projects
 * Description:       Projects catalogue for RoboValley: the "Project" content type, its technology / education / subject taxonomies and the admin fields. Public fields are served from WordPress; the members-only fields are stored here but never output publicly.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            RoboValley
 * License:           GPL-2.0-or-later
 * Text Domain:       robovalley-projects
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RVP_VERSION', '0.1.0' );
define( 'RVP_FILE', __FILE__ );
define( 'RVP_DIR', plugin_dir_path( __FILE__ ) );
define( 'RVP_URL', plugin_dir_url( __FILE__ ) );

// Content type and taxonomy names. "rv_" prefixed so they cannot clash with other plugins or page slugs.
define( 'RVP_POST_TYPE', 'rv_project' );
define( 'RVP_TAX_TECH', 'rv_technology' );
define( 'RVP_TAX_EDU', 'rv_education' );
define( 'RVP_TAX_SUBJECT', 'rv_subject' );

require_once RVP_DIR . 'includes/capabilities.php';
require_once RVP_DIR . 'includes/post-type.php';
require_once RVP_DIR . 'includes/taxonomies.php';
require_once RVP_DIR . 'includes/term-meta.php';
require_once RVP_DIR . 'includes/meta.php';
require_once RVP_DIR . 'includes/meta-boxes.php';
require_once RVP_DIR . 'includes/admin-columns.php';
require_once RVP_DIR . 'includes/seed.php';

/**
 * Activation: grant the capabilities and add the starter taxonomy terms (once). Creates no projects.
 * The post type and taxonomies are registered by hand first because "init" has not run yet.
 */
function rvp_activate() {
	rvp_register_post_type();
	rvp_register_taxonomies();
	rvp_grant_capabilities();
	rvp_seed_terms();
}
register_activation_hook( RVP_FILE, 'rvp_activate' );
