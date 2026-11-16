<?php
/**
 * Plugin Name: RoboValley Contribution (v2)
 * Description: The new Contribute form for the Contribution and Contributor pages. It only renders the form and talks to the RoboValley app; it stores nothing in WordPress. Nothing changes until RV_CONTRIBUTION_V2 is set to true in wp-config.php.
 * Version: 0.1.6
 * Requires PHP: 7.4
 * Author: RoboValley
 *
 * SETTINGS (wp-config.php, above "That's all, stop editing!"; names only, you type the values yourself)
 *   RV_CONTRIBUTION_V2       true = show the new form on the two pages; missing or false = the old content shows exactly as before.
 *   RV_CONTRIBUTION_APP_URL  the RoboValley app's address, e.g. https://<your-app-address> (no trailing slash needed).
 *   RV_CONTRIBUTION_PAGES    optional: the page slugs to switch, comma separated. Default: contribute-now,contribution,contributor.
 *                            The FIRST slug is the form page the "Contribute to this sector" button links to.
 *                            The Contact page (contact-us, contact) can never be switched, even if listed.
 *
 * WHAT IT DOES
 *   * When the switch is on, the page content of the listed pages is REPLACED IN DISPLAY ONLY by the form. The pages themselves,
 *     their old content and every other page are not changed or deleted. Switch off (or deactivate the plugin) = exactly as before.
 *   * The form talks only to the app API with the visitor's own RoboValley sign-in (cookies, credentials: include). The app checks
 *     everything again, saves submissions as pending, and does the duplicate checks and the review. WordPress stores nothing:
 *     no options, no database rows, no browser storage.
 *   * Shortcode [rv_contribution_v2] shows the same form anywhere, also only while the switch is on.
 *   * "Contribute to this sector": on each Robots by Sector page (a child page of the page with the slug in
 *     RV_CONTRIBUTION_SECTOR_PARENT, default robots-by-sector) a button at the top right, next to the heading, links to the form
 *     page with that sector ticked (?sector=<the page's slug>). It shows only while RV_CONTRIBUTION_V2 and RV_CONTRIBUTE_PUBLIC are
 *     both true (the same rule as the Contribution button in the sector bar).
 *   * Sign Out on the Contribute page (0.1.6): the form pages show the member banner WITHOUT its Sign Out button (the button is taken out
 *     of the markup on the server, so it is not in the page at all). The site header's account menu keeps Sign out on every page.
 *     The shortcode keeps the button unless it is written as [rv_contribution_v2 sign_out="no"].
 *   * Members contribute, administrators review (0.1.4): WordPress administrators never see the buttons, and on the form pages they
 *     see a short note with a link to the app's Moderation page instead of the form. Signed in to the app as an administrator or
 *     moderator, the form shows the same kind of note (the app refuses their submissions anyway). Display only: the app decides.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RV_C2_VERSION = '0.1.6';

/** A WordPress administrator? They review contributions in the app, so the form and the buttons are hidden from them (display only). */
function rv_c2_is_wp_admin() {
	return function_exists( 'current_user_can' ) && current_user_can( 'manage_options' );
}

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
	$raw = defined( 'RV_CONTRIBUTION_PAGES' ) ? (string) RV_CONTRIBUTION_PAGES : 'contribute-now,contribution,contributor';
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

/** What a WordPress administrator sees instead of the form: no form, a link to the app's Moderation page. */
function rv_c2_admin_note() {
	$app  = rv_c2_app_url();
	$link = '' === $app ? '' : ' <a href="' . esc_url( $app . '/moderation' ) . '">Open Moderation</a>';
	return '<div id="rv-c2-admin-note" style="border-left:4px solid #237A33;background:#F1F8F2;padding:12px 14px;border-radius:4px;margin:14px 0">'
		. esc_html( 'You are signed in to WordPress as an administrator, so the Contribute form is hidden here: members contribute, administrators review. Contributions are reviewed in the RoboValley app.' )
		. $link . '</div>';
}

/** The member banner's Sign Out button, exactly as it is in assets/rv-contribution-v2.html (a test keeps the two in step). */
const RV_C2_SIGN_OUT_BUTTON = ' <button type="button" id="sign-out">Sign Out</button>';

/**
 * The form markup (static HTML from the plugin folder; no visitor data is ever put into it on the server).
 * $sign_out = false (the Contribute page itself): the banner's Sign Out button is removed, and the form is told so with
 * data-sign-out="no" (then the reviewer note shows no Sign Out either). The header's account menu still has Sign out.
 */
function rv_c2_markup( $sign_out = true ) {
	$file = __DIR__ . '/assets/rv-contribution-v2.html';
	$html = is_readable( $file ) ? (string) file_get_contents( $file ) : '';
	if ( '' === $html ) {
		return '';
	}
	if ( ! $sign_out ) {
		$html = str_replace( RV_C2_SIGN_OUT_BUTTON, '', $html );
		$html = str_replace( '<div class="rv-c2" id="rv-c2">', '<div class="rv-c2" id="rv-c2" data-sign-out="no">', $html );
	}
	return $html;
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
		return rv_c2_is_wp_admin() ? rv_c2_admin_note() : rv_c2_markup( false ); // the Contribute page: no Sign Out in the banner
	},
	PHP_INT_MAX
);

add_action(
	'wp_enqueue_scripts',
	function () {
		if ( rv_c2_is_target_page() && ! rv_c2_is_wp_admin() ) {
			rv_c2_enqueue();
		}
	}
);

add_shortcode(
	'rv_contribution_v2',
	function ( $atts ) {
		if ( ! rv_c2_enabled() ) {
			return '';
		}
		if ( rv_c2_is_wp_admin() ) {
			return rv_c2_admin_note();
		}
		$atts = shortcode_atts( array( 'sign_out' => 'yes' ), is_array( $atts ) ? $atts : array(), 'rv_contribution_v2' );
		rv_c2_enqueue();
		return rv_c2_markup( 'no' !== strtolower( trim( (string) $atts['sign_out'] ) ) );
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

/* ---------- "Contribute to this sector" on the Robots by Sector pages ---------- */

/** The sector slug of this page when it is a child of the Robots by Sector page, otherwise ''. */
function rv_c2_sector_slug() {
	if ( ! is_page() ) {
		return '';
	}
	$page = get_queried_object();
	if ( ! $page instanceof WP_Post || ! $page->post_parent ) {
		return '';
	}
	$parent      = get_post( $page->post_parent );
	$parent_slug = defined( 'RV_CONTRIBUTION_SECTOR_PARENT' ) ? sanitize_title( (string) RV_CONTRIBUTION_SECTOR_PARENT ) : 'robots-by-sector';
	if ( ! $parent instanceof WP_Post || $parent->post_name !== $parent_slug ) {
		return '';
	}
	return sanitize_title( $page->post_name );
}

/** Show the button? Only while the form is on and RV_CONTRIBUTE_PUBLIC is true, and never to WordPress administrators (they review). */
function rv_c2_sector_button_visible() {
	if ( ! rv_c2_enabled() || '' === rv_c2_sector_slug() ) {
		return false;
	}
	return defined( 'RV_CONTRIBUTE_PUBLIC' ) && true === RV_CONTRIBUTE_PUBLIC && ! rv_c2_is_wp_admin();
}

function rv_c2_sector_button_html() {
	$slugs = rv_c2_page_slugs();
	$url   = add_query_arg( 'sector', rv_c2_sector_slug(), home_url( '/' . ( $slugs ? $slugs[0] : 'contribute-now' ) . '/' ) );
	return '<div class="rv-c2-sector-cta"><a class="rv-c2-sector-btn" href="' . esc_url( $url ) . '">'
		. '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>'
		. 'Contribute to this sector</a></div>';
}

/* The button goes at the top of the page content (it works without JavaScript); a tiny script then moves it into the theme's
   heading row, next to the heading, when the theme has one (Astra: .entry-header > .entry-title). */
add_filter(
	'the_content',
	function ( $content ) {
		if ( ! in_the_loop() || ! is_main_query() || ! rv_c2_sector_button_visible() || false !== strpos( $content, 'rv-c2-sector-cta' ) ) {
			return $content;
		}
		return rv_c2_sector_button_html() . $content;
	},
	1000
);

add_action(
	'wp_head',
	function () {
		if ( ! rv_c2_sector_button_visible() ) {
			return;
		}
		echo '<style id="rv-c2-sector-css">'
			. '.rv-c2-sector-cta{display:flex;justify-content:flex-end;margin:0 0 16px}'
			. '.rv-c2-sector-btn{display:inline-flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;padding:10px 18px;border:1.5px solid #237A33;border-radius:8px;color:#237A33;background:#fff;font-weight:700;line-height:1.2;text-decoration:none;white-space:nowrap}'
			. '.rv-c2-sector-btn:hover{color:#1B5E28;background:#F1F8F2;text-decoration:none}'
			. '.rv-c2-sector-btn:focus-visible{outline:3px solid #9AD3B5;outline-offset:2px}'
			. '.rv-c2-sector-btn svg{flex:none}'
			. '.rv-c2-has-sector-cta{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}'
			. '.rv-c2-has-sector-cta .rv-c2-sector-cta{margin:0}'
			. '@media (max-width:600px){.rv-c2-sector-cta{justify-content:flex-start}}'
			. '</style>' . "\n";
	},
	99
);

add_action(
	'wp_footer',
	function () {
		if ( ! rv_c2_sector_button_visible() ) {
			return;
		}
		echo '<script id="rv-c2-sector-js">(function(){var c=document.querySelector(".rv-c2-sector-cta"),h=document.querySelector(".entry-header");'
			. 'if(c&&h&&h.querySelector(".entry-title")){h.classList.add("rv-c2-has-sector-cta");h.appendChild(c);}})();</script>' . "\n";
	}
);
