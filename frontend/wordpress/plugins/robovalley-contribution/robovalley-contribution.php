<?php
/**
 * Plugin Name: RoboValley Contribution
 * Description: The Contribution Publishing Workflow on the website: the "Share Your Idea" form ([rv_contribution_form]) and the public "Community Ideas" page ([rv_community_ideas]). A thin shell: the screens are plain HTML, CSS and JavaScript, and all data lives in the RoboValley app (no WordPress tables, no WordPress roles). The Moderator Workspace and the Admin Approval Dashboard are in the app's admin portal.
 * Version: 1.5.0
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
 *
 * SWITCH-OVER (one setting, OFF by default: Settings > Contribution workflow). ON: both pages are public, the current form's pages
 * (contribute-now, contribution, contributor, or RV_CONTRIBUTION_PAGES) redirect to "Share Your Idea" with 301 (keeping ?sector=, never
 * cached so it can be undone), and the "Contribute to this sector" button points at the new form. OFF (or this plugin deactivated):
 * exactly today's behaviour: the pages are private again, no redirect, the button as the current form prints it.
 *
 * "+ CONTRIBUTE TO THIS SECTOR" IN THE HEADER AND ON EVERY FIELD of every Robots by Sector page (sector-buttons.php: THE injection
 * hooks, do not remove them). On as soon as the plugin is active, for every visitor and role, independent of the switch-over: they open
 * the contribute flow that is live (the current form, or "Share Your Idea" once switched over) with the sector (and the field) filled
 * in. A per-field off switch on the settings page is the only way to hide a field's button.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RV_CONTRIB_VERSION = '1.5.0';
const RV_CONTRIB_OPTION  = 'rv_contrib_setup_version';
const RV_CONTRIB_SWITCH  = 'rv_contrib_switch_over';

require_once __DIR__ . '/sector-buttons.php'; // the header button and the field buttons of the sector pages: the one injection hook

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

/** The ONE switch-over setting. Off unless an administrator turned it on. */
function rv_contrib_switched() {
	return '1' === (string) get_option( RV_CONTRIB_SWITCH, '0' );
}

/**
 * Idempotent setup: creates each missing page (private, or public once switched over, with its shortcode). A page that exists is never
 * changed or duplicated (an existing page with the same address is used only if it already holds this plugin's shortcode); a page that
 * was deleted is not re-created on every load (only when the version changes).
 */
function rv_contrib_setup() {
	foreach ( rv_contrib_pages() as $option => $page ) {
		list( $slug, $title, $shortcode ) = $page;
		$id = (int) get_option( $option, 0 );
		if ( $id && get_post( $id ) ) {
			continue;
		}
		$existing = get_page_by_path( $slug, OBJECT, 'page' );
		if ( $existing && has_shortcode( $existing->post_content, trim( $shortcode, '[]' ) ) ) {
			update_option( $option, (int) $existing->ID, false );
			continue;
		}
		$new_id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => rv_contrib_switched() ? 'publish' : 'private',
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
	rv_contrib_apply_visibility();
}
register_activation_hook( __FILE__, 'rv_contrib_setup' );

/**
 * The switch-over's visibility: this plugin's own pages are public while switched over and private otherwise. Only the post status of
 * a page this plugin owns, that still holds its shortcode and is not in the trash, is ever changed; nothing else on the site.
 */
function rv_contrib_apply_visibility( $public = null ) {
	$public = null === $public ? rv_contrib_switched() : (bool) $public;
	foreach ( rv_contrib_pages() as $option => $page ) {
		$id   = (int) get_option( $option, 0 );
		$post = $id ? get_post( $id ) : null;
		if ( ! $post || 'page' !== $post->post_type || 'trash' === $post->post_status || ! has_shortcode( $post->post_content, trim( $page[2], '[]' ) ) ) {
			continue;
		}
		$want = $public ? 'publish' : 'private';
		if ( $post->post_status !== $want ) {
			wp_update_post( array( 'ID' => $id, 'post_status' => $want ) );
		}
	}
}
/* Deactivating the plugin is a full undo: its pages go back to private (the setting itself is kept for a re-activation). */
register_deactivation_hook(
	__FILE__,
	function () {
		rv_contrib_apply_visibility( false );
	}
);
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

/* ---------------------------------------------------------------- the switch-over (one setting, off by default) */

/** The current form's pages (the current Contribute plugin's slugs: RV_CONTRIBUTION_PAGES or its defaults); never a contact page. */
function rv_contrib_old_slugs() {
	$raw = defined( 'RV_CONTRIBUTION_PAGES' ) ? (string) RV_CONTRIBUTION_PAGES : 'contribute-now,contribution,contributor';
	$out = array();
	foreach ( explode( ',', $raw ) as $s ) {
		$s = sanitize_title( $s );
		if ( '' !== $s && ! in_array( $s, array( 'contact-us', 'contact', 'share-your-idea', 'community-ideas' ), true ) ) {
			$out[] = $s;
		}
	}
	return array_values( array_unique( $out ) );
}

/** The new form's address, only while its page is public. '' otherwise (then nothing is redirected or rewritten). */
function rv_contrib_form_url() {
	$id = (int) get_option( 'rv_contrib_page_form', 0 );
	return ( $id && 'publish' === get_post_status( $id ) ) ? (string) get_permalink( $id ) : '';
}

/** "?sector=" kept from the old address: one sector slug (the first, if several were given), cleaned. */
function rv_contrib_sector_arg( $raw ) {
	$first = explode( ',', (string) $raw );
	return sanitize_title( $first[0] );
}

/* Switched over: the current form's pages send visitors to "Share Your Idea" (301, never cached by browsers or caches, so switching
   off takes effect at once). Not in wp-admin, AJAX or previews. */
add_action(
	'template_redirect',
	function () {
		if ( ! rv_contrib_switched() || is_admin() || wp_doing_ajax() || is_preview() ) {
			return;
		}
		$slugs = rv_contrib_old_slugs();
		if ( empty( $slugs ) || ! is_page( $slugs ) ) {
			return;
		}
		$to = rv_contrib_form_url();
		if ( '' === $to ) {
			return;
		}
		// A public link, read only: no nonce.
		$sector = isset( $_GET['sector'] ) ? rv_contrib_sector_arg( wp_unslash( (string) $_GET['sector'] ) ) : '';
		if ( '' !== $sector ) {
			$to = add_query_arg( 'sector', $sector, $to );
		}
		// a sector page's button on a page cached before the switch-over: keep the field, the resource and the way back
		$field = isset( $_GET['field'] ) ? sanitize_title( wp_unslash( (string) $_GET['field'] ) ) : '';
		if ( '' !== $field ) {
			$to = add_query_arg( 'field', $field, $to );
		}
		$path = isset( $_GET['resource_path'] ) ? mb_substr( sanitize_text_field( wp_unslash( (string) $_GET['resource_path'] ) ), 0, 300 ) : '';
		if ( '' !== $path ) {
			$to = add_query_arg( 'resource_path', rawurlencode( $path ), $to );
		}
		foreach ( array( 'resource_url', 'return_to' ) as $arg ) {
			$u = isset( $_GET[ $arg ] ) ? esc_url_raw( wp_unslash( (string) $_GET[ $arg ] ), array( 'http', 'https' ) ) : '';
			if ( '' !== $u && strlen( $u ) <= 2048 ) {
				$to = add_query_arg( $arg, rawurlencode( $u ), $to );
			}
		}
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		nocache_headers();
		header( 'Cache-Control: no-store, max-age=0', true );
		wp_safe_redirect( $to, 301, 'RoboValley Contribution' );
		exit;
	},
	1
);

/* Switched over: the "Contribute to this sector" button (printed by the current Contribute plugin into the page content at priority
   1000) points straight at the new form, keeping its sector. Only that button's address changes. */
add_filter(
	'the_content',
	function ( $content ) {
		if ( ! rv_contrib_switched() || false === strpos( (string) $content, 'rv-c2-sector-btn' ) ) {
			return $content;
		}
		$form = rv_contrib_form_url();
		if ( '' === $form ) {
			return $content;
		}
		return preg_replace_callback(
			'#(<a class="rv-c2-sector-btn" href=")([^"]*)(")#',
			function ( $m ) use ( $form ) {
				$query = (string) wp_parse_url( html_entity_decode( $m[2] ), PHP_URL_QUERY );
				parse_str( $query, $args );
				$sector = isset( $args['sector'] ) ? rv_contrib_sector_arg( $args['sector'] ) : '';
				return $m[1] . esc_url( '' !== $sector ? add_query_arg( 'sector', $sector, $form ) : $form ) . $m[3];
			},
			$content
		);
	},
	1001
);

/* The setting itself: Settings > Contribution workflow, one checkbox, administrators only. */
add_action(
	'admin_init',
	function () {
		register_setting(
			'rv_contrib',
			RV_CONTRIB_SWITCH,
			array(
				'type'              => 'string',
				'default'           => '0',
				'sanitize_callback' => 'rv_contrib_sanitize_switch',
			)
		);
	}
);
function rv_contrib_sanitize_switch( $v ) {
	return '1' === (string) $v ? '1' : '0';
}
function rv_contrib_apply_visibility_after_save() {
	rv_contrib_apply_visibility();
}
add_action( 'update_option_' . RV_CONTRIB_SWITCH, 'rv_contrib_apply_visibility_after_save' );
add_action( 'add_option_' . RV_CONTRIB_SWITCH, 'rv_contrib_apply_visibility_after_save' );
add_action(
	'admin_menu',
	function () {
		add_options_page( 'Contribution workflow', 'Contribution workflow', 'manage_options', 'rv-contribution-workflow', 'rv_contrib_settings_page' );
	}
);
function rv_contrib_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$on    = rv_contrib_switched();
	$state = $on ? __( 'switched over: the new workflow is live', 'robovalley-contribution' ) : __( 'not switched over: the current Contribute form is live', 'robovalley-contribution' );
	echo '<div class="wrap"><h1>' . esc_html__( 'Contribution workflow', 'robovalley-contribution' ) . '</h1>';
	echo '<p>' . esc_html__( 'Now:', 'robovalley-contribution' ) . ' <strong>' . esc_html( $state ) . '</strong></p>';
	echo '<form method="post" action="options.php">';
	settings_fields( 'rv_contrib' );
	echo '<p><label><input type="checkbox" name="' . esc_attr( RV_CONTRIB_SWITCH ) . '" value="1" ' . checked( $on, true, false ) . '> ' . esc_html__( 'Switch over to the new contribution workflow', 'robovalley-contribution' ) . '</label></p>';
	echo '<p>' . esc_html__( 'When ON: "Share Your Idea" and "Community Ideas" are public, the current form pages send visitors to "Share Your Idea" (keeping the sector), and "Contribute to this sector" opens the new form. When OFF: exactly today\'s behaviour (the two pages are private again). Purge the site cache after changing it.', 'robovalley-contribution' ) . '</p>';
	echo rv_contrib_fields_settings_html(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts
	submit_button();
	echo '</form></div>';
}
