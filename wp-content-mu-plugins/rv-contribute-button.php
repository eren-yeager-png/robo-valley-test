<?php
/**
 * Plugin Name: RoboValley Contribution button
 * Description: Adds the "Contribution" button to the right end of the Robots by Sector / RoboValley Directory bar (rv-sector-bar 2.0.0). Does not edit that plugin.
 * Version: 1.1.0
 *
 * Settings (optional, in wp-config.php):
 *   define( 'RV_CONTRIBUTE_URL', 'https://techytree.in/contribute-now/' ); // where the button goes (default: /contribute-now/ on this site)
 *   define( 'RV_CONTRIBUTE_PUBLIC', true );                           // show to everyone (default: only logged-in administrators)
 * The button is never shown on the Contact Us page. Filters: rv_contribute_button_url, rv_contribute_button_visible.
 *
 * How it hooks in: rv-sector-bar prints its bar only through the [rv_sector_bar] shortcode, as
 * <nav class="rv-sector-bar" id="rv-sector-bar"> .rv-fixed (the two tabs), one .rv-group per tab, then </nav>.
 * The filter below adds the button as the last child of that nav, so it is outside .rv-fixed and there is exactly one per bar.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rv_contribute_url() {
	$url = defined( 'RV_CONTRIBUTE_URL' ) && RV_CONTRIBUTE_URL ? RV_CONTRIBUTE_URL : home_url( '/contribute-now/' );
	return esc_url( apply_filters( 'rv_contribute_button_url', $url ) );
}

function rv_contribute_visible() {
	if ( is_admin() || is_feed() ) {
		return false;
	}
	$public = defined( 'RV_CONTRIBUTE_PUBLIC' ) && RV_CONTRIBUTE_PUBLIC;
	$show   = $public || current_user_can( 'manage_options' );
	if ( $show && function_exists( 'is_page' ) && did_action( 'wp' ) && is_page( array( 'contact-us', 'contact' ) ) ) {
		$show = false;
	}
	return (bool) apply_filters( 'rv_contribute_button_visible', $show );
}

function rv_contribute_button_html() {
	return '<a class="rv-contribute-btn" href="' . rv_contribute_url() . '" aria-label="Contribute to RoboValley">'
		. '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Contribution</a>';
}

/* The button goes inside the bar's <nav>, after the tabs and groups, so the bar's flex row pushes it to the right (margin-left:auto). */
add_filter(
	'do_shortcode_tag',
	function ( $output, $tag ) {
		if ( 'rv_sector_bar' !== $tag || false !== strpos( $output, 'rv-contribute-btn' ) || ! rv_contribute_visible() ) {
			return $output;
		}
		$pos = strripos( $output, '</nav>' );
		if ( false === $pos ) {
			return $output;
		}
		$output = substr_replace( $output, rv_contribute_button_html(), $pos, 0 );
		return preg_replace( '/<nav class="rv-sector-bar"/', '<nav class="rv-sector-bar rv-has-contribute"', $output, 1 );
	},
	20,
	2
);

/*
 * Styles: the reference design. Two changes forced by the real bar (it is a flex row with overflow-x:auto, so it also clips vertically):
 *  - margin-right is 0, not the mock's -24px: inside the theme header the bar has no side padding, so a negative margin cut the button off;
 *  - the bar gets room above and below (.rv-has-contribute) so the shadow and the 1px hover lift are not clipped.
 * The button is sticky at the right edge, so on a phone (where the bar scrolls sideways) it stays visible.
 * Printed once, only when the button can show.
 */
add_action(
	'wp_head',
	function () {
		if ( ! rv_contribute_visible() ) {
			return;
		}
		echo '<style id="rv-contribute-btn-css">'
			. '.rv-contribute-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;height:40px;padding:0 22px;margin-left:auto;margin-right:0;border-radius:12px;background:linear-gradient(180deg,#1B6952 0%,#19614B 100%);color:#fff;font-size:15px;font-weight:700;line-height:1;white-space:nowrap;text-decoration:none;box-shadow:0 6px 14px rgba(16,70,52,.35),0 2px 4px rgba(0,0,0,.18);transition:transform .15s ease,box-shadow .15s ease,background .15s ease}'
			. '.rv-contribute-btn:hover{color:#fff;background:linear-gradient(180deg,#17594A 0%,#134E3C 100%);transform:translateY(-1px);box-shadow:0 8px 18px rgba(16,70,52,.4),0 2px 4px rgba(0,0,0,.2)}'
			. '.rv-contribute-btn:active{transform:translateY(0);box-shadow:0 3px 8px rgba(16,70,52,.35)}'
			. '.rv-contribute-btn:focus-visible{outline:3px solid #9AD3B5;outline-offset:2px}'
			. '.rv-contribute-btn svg{flex:none}'
			. '.rv-sector-bar.rv-has-contribute{padding-top:6px;padding-bottom:16px;margin-bottom:-8px}'
			. '.rv-sector-bar .rv-contribute-btn{flex:0 0 auto;position:sticky;right:0;z-index:2}'
			. '@media (max-width:720px){.rv-contribute-btn{min-height:44px}.rv-sector-bar .rv-contribute-btn{right:8px}}'
			. '@media (prefers-reduced-motion:reduce){.rv-contribute-btn{transition:none}.rv-contribute-btn:hover{transform:none}}'
			. '</style>' . "\n";
	},
	99
);
