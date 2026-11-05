<?php
/**
 * Plugin Name: RoboValley Contribution button
 * Description: Adds the "Contribution" button to the right end of the Robots by Sector / RoboValley Directory bar (rv-sector-bar). Does not edit that plugin.
 * Version: 1.0.0
 *
 * Settings (optional, in wp-config.php):
 *   define( 'RV_CONTRIBUTE_URL', 'https://techytree.in/contribute/' ); // where the button goes (default: /contribute/ on this site)
 *   define( 'RV_CONTRIBUTE_PUBLIC', true );                           // show to everyone (default: only logged-in administrators)
 * The button is never shown on the Contact Us page. Filters: rv_contribute_button_url, rv_contribute_button_visible.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function rv_contribute_url() {
	$url = defined( 'RV_CONTRIBUTE_URL' ) && RV_CONTRIBUTE_URL ? RV_CONTRIBUTE_URL : home_url( '/contribute/' );
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

/* The button goes inside the bar's <nav>, after the tabs and pills, so the bar's flex row pushes it to the right (margin-left:auto). */
add_filter(
	'do_shortcode_tag',
	function ( $output, $tag ) {
		if ( 'rv_sector_bar' !== $tag || false !== strpos( $output, 'rv-contribute-btn' ) || ! rv_contribute_visible() ) {
			return $output;
		}
		$pos = strripos( $output, '</nav>' );
		return false === $pos ? $output : substr_replace( $output, rv_contribute_button_html(), $pos, 0 );
	},
	20,
	2
);

/* Styles: the reference design, exactly. Printed once, only when the button can show. */
add_action(
	'wp_head',
	function () {
		if ( ! rv_contribute_visible() ) {
			return;
		}
		echo '<style id="rv-contribute-btn-css">'
			. '.rv-contribute-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;height:40px;padding:0 22px;margin-left:auto;margin-right:-24px;border-radius:12px;background:linear-gradient(180deg,#1B6952 0%,#19614B 100%);color:#fff;font-size:15px;font-weight:700;line-height:1;white-space:nowrap;text-decoration:none;box-shadow:0 6px 14px rgba(16,70,52,.35),0 2px 4px rgba(0,0,0,.18);transition:transform .15s ease,box-shadow .15s ease,background .15s ease}'
			. '.rv-contribute-btn:hover{color:#fff;background:linear-gradient(180deg,#17594A 0%,#134E3C 100%);transform:translateY(-1px);box-shadow:0 8px 18px rgba(16,70,52,.4),0 2px 4px rgba(0,0,0,.2)}'
			. '.rv-contribute-btn:active{transform:translateY(0);box-shadow:0 3px 8px rgba(16,70,52,.35)}'
			. '.rv-contribute-btn:focus-visible{outline:3px solid #9AD3B5;outline-offset:2px}'
			. '.rv-contribute-btn svg{flex:none}'
			. '@media (max-width:720px){.rv-contribute-btn{margin-right:0;min-height:44px;position:sticky;right:8px;z-index:2}}'
			. '@media (prefers-reduced-motion:reduce){.rv-contribute-btn{transition:none}.rv-contribute-btn:hover{transform:none}}'
			. '</style>' . "\n";
	},
	99
);

/* Fallback: if the bar was printed some other way than the shortcode, add the button once in the browser. Never adds a second one. */
add_action(
	'wp_footer',
	function () {
		if ( ! rv_contribute_visible() ) {
			return;
		}
		?>
<script id="rv-contribute-btn-js">
( function () {
	var bar = document.getElementById( 'rv-sector-bar' );
	if ( ! bar || document.querySelector( '.rv-contribute-btn' ) ) { return; }
	var tpl = document.createElement( 'div' );
	tpl.innerHTML = <?php echo wp_json_encode( rv_contribute_button_html() ); ?>;
	bar.appendChild( tpl.firstChild );
}() );
</script>
		<?php
	},
	99
);
