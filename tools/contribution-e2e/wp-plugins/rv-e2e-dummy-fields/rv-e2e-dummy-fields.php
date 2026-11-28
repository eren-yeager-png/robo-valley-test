<?php
/**
 * Plugin Name: RV e2e dummy fields (TEST ONLY)
 * Description: For the contribution workflow's end-to-end check on a THROW-AWAY WordPress only. Adds fields to the Robots by Sector pages the way other plugins might, so the check can prove every one of them gets its "Contribute to this sector" button without any code for that field: one field through the_content (server side), one added by JavaScript after the page has loaded, and the "suggested" fields an administrator approved (option rv_e2e_suggested_fields: a list of {id, label, status}; only status "approved" is shown). With the option rv_e2e_hostile_css set, it also prints CSS that tries to hide the buttons. Never install it on a real site.
 * Version: 0.1.0
 * License: GPLv2 or later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** True on a child page of the Robots by Sector page (the same pages robovalley-contribution adds the buttons to). */
function rv_e2e_dummy_is_sector_page() {
	if ( ! is_page() ) {
		return false;
	}
	$page = get_queried_object();
	if ( ! ( $page instanceof WP_Post ) || ! $page->post_parent ) {
		return false;
	}
	$parent = get_post( $page->post_parent );
	return $parent instanceof WP_Post && 'robots-by-sector' === $parent->post_name;
}

/* A field added by a plugin on the server, and the suggested fields an administrator approved. */
add_filter(
	'the_content',
	function ( $content ) {
		if ( ! in_the_loop() || ! is_main_query() || ! rv_e2e_dummy_is_sector_page() ) {
			return $content;
		}
		$html  = '<section data-rv-field="plugin-weather-station" data-rv-field-label="Weather station (added by a plugin)">';
		$html .= '<h3>Weather station</h3><p>This field was added by a plugin through the_content.</p>';
		// a wide table in plain markup (no other plugin's styles): wider than a phone, so it must scroll inside its field
		$html .= '<table><tr><th>Station</th><th>Temperature</th><th>Humidity</th><th>Rainfall</th><th>Windspeed</th><th>Sunshine</th><th>Evaporation</th><th>Soilmoisture</th></tr>';
		$html .= '<tr><td>Guntur</td><td>Thirty-two</td><td>Sixty-eight</td><td>Twelve</td><td>Fourteen</td><td>Eight</td><td>Five</td><td>Twenty-one</td></tr></table></section>';
		$suggested = get_option( 'rv_e2e_suggested_fields', array() );
		foreach ( is_array( $suggested ) ? $suggested : array() as $field ) {
			if ( ! is_array( $field ) || 'approved' !== ( $field['status'] ?? '' ) ) {
				continue; // a suggestion that is still pending is not on the page
			}
			$html .= '<section data-rv-field="' . esc_attr( sanitize_title( (string) ( $field['id'] ?? '' ) ) ) . '">';
			$html .= '<h3>' . esc_html( (string) ( $field['label'] ?? '' ) ) . '</h3><p>A suggested field, approved by an administrator.</p></section>';
		}
		return $content . $html;
	},
	20
);

/* A field added by JavaScript after the page has loaded (like a plugin that draws on the client), and the optional hostile CSS. */
add_action(
	'wp_footer',
	function () {
		if ( ! rv_e2e_dummy_is_sector_page() ) {
			return;
		}
		echo "<script>window.addEventListener('load',function(){setTimeout(function(){var r=document.querySelector('.rv-fields-root')||document.querySelector('.entry-content');if(!r)return;var s=document.createElement('section');s.setAttribute('data-rv-field','js-feed-planner');s.innerHTML='<h3>Feed planner</h3><p>This field was added by JavaScript after the page loaded.</p>';r.appendChild(s);},1200);});</script>\n";
		if ( get_option( 'rv_e2e_hostile_css' ) ) {
			echo '<style id="rv-e2e-hostile">.rv-contribute-btn{display:none;visibility:hidden;opacity:0}.rv-contribute-field{display:none;visibility:hidden}.entry-content a{display:none}.rv-sector-rail,.rv-sector-cta{display:none;visibility:hidden}</style>' . "\n";
		}
	}
);
