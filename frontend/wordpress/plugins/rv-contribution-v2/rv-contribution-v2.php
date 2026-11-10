<?php
/**
 * Plugin Name: RoboValley Contribution (v2)
 * Description: The new Contribute form for the Contribution and Contributor pages. It only renders the form and talks to the RoboValley app; it stores nothing in WordPress. Nothing changes until RV_CONTRIBUTION_V2 is set to true in wp-config.php.
 * Version: 0.1.1
 * Requires PHP: 7.4
 * Author: RoboValley
 *
 * SETTINGS (wp-config.php, above "That's all, stop editing!"; names only, you type the values yourself)
 *   RV_CONTRIBUTION_V2       true = show the new form on the two pages; missing or false = the old content shows exactly as before.
 *   RV_CONTRIBUTION_APP_URL  the RoboValley app's address, e.g. https://<your-app-address> (no trailing slash needed).
 *   RV_CONTRIBUTION_PAGES    optional: the page slugs to switch, comma separated. Default: contribution,contributor.
 *                            The Contact page (contact-us, contact) can never be switched, even if listed.
 *
 * WHAT IT DOES
 *   * When the switch is on, the page content of the listed pages is REPLACED IN DISPLAY ONLY by the form. The pages themselves,
 *     their old content and every other page are not changed or deleted. Switch off (or deactivate the plugin) = exactly as before.
 *   * The form talks only to the app API with the visitor's own RoboValley sign-in (cookies, credentials: include). The app checks
 *     everything again, saves submissions as pending, and does the duplicate checks and the review. WordPress stores nothing:
 *     no options, no database rows, no browser storage.
 *   * Shortcode [rv_contribution_v2] shows the same form anywhere, also only while the switch is on.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RV_C2_VERSION = '0.1.1';

/** Is the switch on? Only an explicit true counts. */
function rv_c2_enabled() {
	return defined( 'RV_CONTRIBUTION_V2' ) && true === RV_CONTRIBUTION_V2;
}

/** The app address from wp-config.php, or '' when it is missing or does not look like an http(s) address. */
function rv_c2_app_url() {
	$u = defined( 'RV_CONTRIBUTION_APP_URL' ) ? trim( (string) RV_CONTRIBUTION_APP_URL ) : '';
	$u = rtrim( $u, '/' );
	return preg_match( '#^https?://[A-Za-z0-9.\-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~\-/]*)?$#', $u ) ? $u : '';
}

/** The page slugs to switch. The Contact page is always left out. */
function rv_c2_page_slugs() {
	$raw = defined( 'RV_CONTRIBUTION_PAGES' ) ? (string) RV_CONTRIBUTION_PAGES : 'contribution,contributor';
	$out = array();
	foreach ( explode( ',', $raw ) as $s ) {
		$s = sanitize_title( $s );
		if ( '' !== $s && ! in_array( $s, array( 'contact-us', 'contact' ), true ) ) {
			$out[] = $s;
		}
	}
	return array_values( array_unique( $out ) );
}

/** Is this request one of the switched pages, with the switch on? */
function rv_c2_is_target_page() {
	if ( ! rv_c2_enabled() ) {
		return false;
	}
	$slugs = rv_c2_page_slugs();
	return ! empty( $slugs ) && is_page( $slugs );
}

/** The form markup (static HTML from the plugin folder; no visitor data is ever put into it on the server). */
function rv_c2_markup() {
	$file = __DIR__ . '/assets/rv-contribution-v2.html';
	$html = is_readable( $file ) ? (string) file_get_contents( $file ) : '';
	return '' === $html ? '' : $html;
}

function rv_c2_enqueue() {
	wp_enqueue_style( 'rv-contribution-v2', plugins_url( 'assets/rv-contribution-v2.css', __FILE__ ), array(), RV_C2_VERSION );
	wp_enqueue_script( 'rv-contribution-v2', plugins_url( 'assets/rv-contribution-v2.js', __FILE__ ), array(), RV_C2_VERSION, true );
	wp_add_inline_script(
		'rv-contribution-v2',
		'window.RoboValleyApi = window.RoboValleyApi || {}; if ( ! window.RoboValleyApi.base ) { window.RoboValleyApi.base = ' . wp_json_encode( rv_c2_app_url() ) . '; }',
		'before'
	);
}

/* Replace the displayed content of the switched pages (late, so it also wins over page builders). */
add_filter(
	'the_content',
	function ( $content ) {
		if ( ! rv_c2_is_target_page() || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}
		return rv_c2_markup();
	},
	PHP_INT_MAX
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( rv_c2_is_target_page() ) {
			rv_c2_enqueue();
		}
	}
);

add_shortcode(
	'rv_contribution_v2',
	function () {
		if ( ! rv_c2_enabled() ) {
			return '';
		}
		rv_c2_enqueue();
		return rv_c2_markup();
	}
);

/* Tell administrators when the switch is on but the app address is missing (visitors then see a plain "not available" note). */
add_action(
	'admin_notices',
	function () {
		if ( rv_c2_enabled() && '' === rv_c2_app_url() && current_user_can( 'manage_options' ) ) {
			echo '<div class="notice notice-warning"><p>' . esc_html( 'RoboValley Contribution (v2): RV_CONTRIBUTION_V2 is on, but RV_CONTRIBUTION_APP_URL is missing or not a valid address, so the form cannot reach the app.' ) . '</p></div>';
		}
	}
);
