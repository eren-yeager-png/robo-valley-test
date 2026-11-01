<?php
/**
 * Plugin Name:       RoboValley Landing
 * Description:       Scoped styles, self-hosted fonts and the slider and chart scripts for the RoboValley landing page. Loads only on pages flagged with the robovalley_landing meta.
 * Version:           1.3.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            RoboValley
 * License:           GPL-2.0-or-later
 * Text Domain:       robovalley-landing
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'ROBOVALLEY_LANDING_VERSION', '1.3.0' );

/**
 * Per-page opt-in flag. Editable through the REST API by users who can edit the page.
 */
add_action(
	'init',
	function () {
		register_post_meta(
			'page',
			'robovalley_landing',
			array(
				'type'          => 'boolean',
				'single'        => true,
				'default'       => false,
				'show_in_rest'  => true,
				'auth_callback' => function ( $allowed, $meta_key, $post_id ) {
					return current_user_can( 'edit_post', $post_id );
				},
			)
		);
	}
);

/**
 * Whether the current request renders a flagged landing page.
 */
function robovalley_landing_is_active() {
	if ( ! is_singular( 'page' ) ) {
		return false;
	}
	return (bool) get_post_meta( get_queried_object_id(), 'robovalley_landing', true );
}

/**
 * Whether the request is Elementor's editor or its preview iframe. The zone-strip
 * script must not run there: it clones elements, which confuses the editor.
 */
function robovalley_landing_is_elementor_editing() {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only flag check.
	if ( isset( $_GET['elementor-preview'] ) ) {
		return true;
	}
	if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance ) ) {
		$elementor = \Elementor\Plugin::$instance;
		if ( isset( $elementor->preview ) && $elementor->preview->is_preview_mode() ) {
			return true;
		}
		if ( isset( $elementor->editor ) && $elementor->editor->is_edit_mode() ) {
			return true;
		}
	}
	return false;
}

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( ! robovalley_landing_is_active() ) {
			return;
		}
		$base = plugin_dir_url( __FILE__ ) . 'assets/';
		// Self-hosted fonts (SIL OFL 1.1): no requests to external font services.
		wp_enqueue_style( 'robovalley-landing-fonts', $base . 'robovalley-fonts.css', array(), ROBOVALLEY_LANDING_VERSION );
		// Reference-design styles: every rule is scoped to .robovalley-home sections.
		wp_enqueue_style( 'robovalley-home', $base . 'robovalley-home.css', array( 'robovalley-landing-fonts' ), ROBOVALLEY_LANDING_VERSION );
		if ( robovalley_landing_is_elementor_editing() ) {
			return;
		}
		wp_enqueue_script(
			'robovalley-home',
			$base . 'robovalley-home.js',
			array(),
			ROBOVALLEY_LANDING_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	},
	20
);

add_filter(
	'body_class',
	function ( $classes ) {
		if ( robovalley_landing_is_active() ) {
			$classes[] = 'robovalley-landing-page';
		}
		return $classes;
	}
);

/**
 * Address of the RoboValley API (the Next.js app), e.g. https://app.techytree.in or http://localhost:3000.
 * Set it in Settings (option robovalley_api_base) or with the robovalley_api_base filter. Empty = the API features
 * (admin Upload Files, school directory search, "Admin" header label) stay switched off and the site is unchanged.
 */
function robovalley_landing_api_base() {
	$base = apply_filters( 'robovalley_api_base', get_option( 'robovalley_api_base', '' ) );
	$base = is_string( $base ) ? esc_url_raw( trim( $base ), array( 'http', 'https' ) ) : '';
	return untrailingslashit( $base );
}

// Defines window.RoboValleyApi in the page head so the Find a Service widgets and the header script can read it.
add_action(
	'wp_head',
	function () {
		$base = robovalley_landing_api_base();
		if ( '' === $base ) {
			return;
		}
		echo '<script>window.RoboValleyApi=' . wp_json_encode( array( 'base' => $base ) ) . ';</script>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- wp_json_encode output.
	},
	1
);

// Header account label (every page): "Admin" instead of Sign In for a signed-in administrator.
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( '' === robovalley_landing_api_base() || robovalley_landing_is_elementor_editing() ) {
			return;
		}
		wp_enqueue_script(
			'robovalley-account',
			plugin_dir_url( __FILE__ ) . 'assets/robovalley-account.js',
			array(),
			ROBOVALLEY_LANDING_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	},
	20
);
