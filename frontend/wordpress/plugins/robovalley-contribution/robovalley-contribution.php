<?php
/**
 * Plugin Name: RoboValley Contribution
 * Description: The Contribution Publishing Workflow on the website: the "Share Your Idea" form ([rv_contribution_form]) and the public "Community Ideas" page ([rv_community_ideas]). A thin shell: the screens are plain HTML, CSS and JavaScript, and all data lives in the RoboValley app (no WordPress tables, no WordPress roles). The Moderator Workspace and the Admin Approval Dashboard are in the app's admin portal.
 * Version: 1.3.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * Author: RoboValley
 * License: GPL-2.0-or-later
 * Text Domain: robovalley-contribution
 *
 * Zero manual setup: on activation (and whenever this file's version changes) it creates its pages if missing, as PRIVATE (visible
 * to WordPress administrators only), and never touches a page someone edited or the pages of the current Contribute form
 * (plugin rv-contribution-v2), which stays exactly as it is.
 *
 * The app address is the one the current Contribute form already uses: RV_CONTRIBUTION_APP_URL in wp-config.php (or, if that is not
 * set, the robovalley_api_base option of the RoboValley Landing plugin). Nothing new to configure.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RV_CONTRIB_VERSION = '1.3.0';
const RV_CONTRIB_OPTION  = 'rv_contrib_setup_version';

/** The pages this plugin owns: option name => [slug, title, shortcode]. */
function rv_contrib_pages() {
	return array(
		'rv_contrib_page_form'  => array( 'share-your-idea', 'Share Your Idea', '[rv_contribution_form]' ),
		'rv_contrib_page_ideas' => array( 'community-ideas', 'Community Ideas', '[rv_community_ideas]' ),
	);
}

/** The app address (http or https, no trailing slash), or '' when it is missing or does not look like one. */
function rv_contrib_app_url() {
	$u = defined( 'RV_CONTRIBUTION_APP_URL' ) ? (string) RV_CONTRIBUTION_APP_URL : (string) get_option( 'robovalley_api_base', '' );
	$u = rtrim( trim( $u ), '/' );
	return preg_match( '#^https?://[A-Za-z0-9.\-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~\-/]*)?$#', $u ) ? $u : '';
}

/**
 * Idempotent setup: creates each missing page (private, with its shortcode). A page that exists is never changed or duplicated;
 * a page that was deleted is not re-created on every load (only when the version changes).
 */
function rv_contrib_setup() {
	foreach ( rv_contrib_pages() as $option => $page ) {
		list( $slug, $title, $shortcode ) = $page;
		$id = (int) get_option( $option, 0 );
		if ( $id && get_post( $id ) ) {
			continue;
		}
		$existing = get_page_by_path( $slug, OBJECT, 'page' );
		if ( $existing ) {
			update_option( $option, (int) $existing->ID, false );
			continue;
		}
		$new_id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'private',
				'post_title'   => $title,
				'post_name'    => $slug,
				'post_content' => $shortcode,
			),
			true
		);
		if ( ! is_wp_error( $new_id ) ) {
			update_option( $option, (int) $new_id, false );
			update_post_meta( $new_id, 'site-post-title', 'disabled' ); // Astra: the screen has its own heading (other themes ignore this)
		}
	}
	update_option( RV_CONTRIB_OPTION, RV_CONTRIB_VERSION, false );
}
register_activation_hook( __FILE__, 'rv_contrib_setup' );
add_action(
	'plugins_loaded',
	function () {
		if ( get_option( RV_CONTRIB_OPTION ) !== RV_CONTRIB_VERSION ) {
			rv_contrib_setup();
		}
	}
);

/** Does the current request show one of our shortcodes? */
function rv_contrib_on_our_page() {
	if ( ! is_singular() ) {
		return false;
	}
	$post = get_post();
	return $post && ( has_shortcode( $post->post_content, 'rv_contribution_form' ) || has_shortcode( $post->post_content, 'rv_community_ideas' ) );
}

/* Our pages are personal (the form) or live (published ideas): never cached by WordPress caches or LiteSpeed. */
add_action(
	'template_redirect',
	function () {
		if ( rv_contrib_on_our_page() ) {
			if ( ! defined( 'DONOTCACHEPAGE' ) ) {
				define( 'DONOTCACHEPAGE', true );
			}
			nocache_headers();
		}
	}
);

/* Our stylesheet and script, ONLY on pages that contain our shortcodes, with the plugin's version so a cache purge serves new files. */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! rv_contrib_on_our_page() ) {
			return;
		}
		wp_enqueue_style( 'rv-contribution', plugins_url( 'assets/css/contribution-workflow.css', __FILE__ ), array(), RV_CONTRIB_VERSION );
		wp_enqueue_script( 'rv-contribution', plugins_url( 'assets/js/robovalley-contribution.js', __FILE__ ), array(), RV_CONTRIB_VERSION, true );
	}
);

/** The container a screen is drawn into (the script finds it by data-rv-cw). */
function rv_contrib_container( $screen ) {
	$base = rv_contrib_app_url();
	if ( '' === $base ) {
		return '<div class="rv-app"><div class="rv-panel"><div class="rv-notice rv-n-err" role="status">' . esc_html__( 'This page is not available right now. Please try again later.', 'robovalley-contribution' ) . '</div></div></div>';
	}
	return '<div class="rv-cw-root"><div data-rv-cw="' . esc_attr( $screen ) . '" data-api-base="' . esc_attr( $base ) . '"></div></div>';
}

add_shortcode(
	'rv_contribution_form',
	function () {
		return rv_contrib_container( 'form' );
	}
);

add_shortcode(
	'rv_community_ideas',
	function () {
		return rv_contrib_container( 'site' );
	}
);

/* Tell administrators when the app address is missing (visitors see a plain "not available" note). */
add_action(
	'admin_notices',
	function () {
		if ( current_user_can( 'manage_options' ) && '' === rv_contrib_app_url() ) {
			echo '<div class="notice notice-warning"><p>' . esc_html__( 'RoboValley Contribution: the app address is missing (RV_CONTRIBUTION_APP_URL in wp-config.php, as for the current Contribute form).', 'robovalley-contribution' ) . '</p></div>';
		}
	}
);
