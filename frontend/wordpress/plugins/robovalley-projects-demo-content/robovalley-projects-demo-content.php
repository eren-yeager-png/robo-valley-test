<?php
/**
 * Plugin Name:       RoboValley Projects: Demo Content
 * Description:       One-click sample projects for a client presentation, and one-click removal. Administrators only. Needs the RoboValley Projects plugin.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            RoboValley
 * Text Domain:       robovalley-projects-demo-content
 *
 * Nothing happens when this plugin is activated, deactivated or deleted. Sample projects are created only by the
 * "Install demo projects" button (Projects > Demo content) and removed only by the "Remove demo projects" button.
 * Everything it creates is tagged with the post meta _rvp_demo = 1, and removal touches only things carrying that tag.
 * It never changes the main plugin, taxonomies, terms or any setting. There is deliberately no uninstall.php.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RVPDC_VERSION', '0.1.0' );
define( 'RVPDC_DIR', plugin_dir_path( __FILE__ ) );
define( 'RVPDC_SLUG', 'rvpdc-demo-content' );

require_once RVPDC_DIR . 'includes/dataset.php';
require_once RVPDC_DIR . 'includes/installer.php';
require_once RVPDC_DIR . 'includes/admin.php';
