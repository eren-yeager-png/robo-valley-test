<?php
/**
 * RoboValley Contribution: "+ Contribute to this sector" in the header of EVERY Robots by Sector page, and a "Contribute to this
 * sector" button on EVERY field (section) of those pages.
 *
 * THE INJECTION HOOKS LIVE HERE. Do not remove them; nothing else adds these buttons and no page or field markup contains them:
 *   1. rv_contrib_fields_page_slug()  which pages: every child page of the "Robots by Sector" page (RV_CONTRIBUTION_SECTOR_PARENT,
 *                                     default robots-by-sector), so a sector or field page published later is covered at once;
 *                                     plugins can add pages with the rv_contrib_sector_slug filter.
 *   2. the_content, priority PHP_INT_MAX - 10 (late, so other plugins' content filters and page builders have run first): wraps the
 *      page content in <div class="rv-fields-root" data-rv-sector="..."> so the script knows the content area.
 *   3. wp_enqueue_scripts (late): assets/js/rv-sector.js (generated from public/cw/js/sector.js + fields.js) and
 *      assets/css/rv-sector.css (a copy of public/cw/sector.css), with the configuration; wp_print_footer_scripts at PHP_INT_MAX prints
 *      them anyway if another plugin dequeued them.
 * The script puts the header button next to the page title (sticky in the top-right while the page scrolls) and one sticky button on
 * every field, and puts them back after any change to the page (MutationObserver), so fields added later (an approved "Suggest a
 * field", a plugin, a re-render) get one without any code for that field.
 * A field: an element with data-rv-field="<id>" (the contract for plugins), a top-level section of the page content (Elementor
 * sections and containers, Gutenberg groups, <section>), or any selector added with the rv_contrib_field_selectors filter.
 * Shown to every visitor and every role. The buttons open the contribute flow that is live (the current form; "Share Your Idea" once
 * switched over) with ?sector=<sector> (and ?field=<field id>) and the page to come back to. The ONLY way to hide a field's button:
 * Settings > Contribution workflow > "Fields without the button". The header button is never hidden.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const RV_CONTRIB_FIELDS_OFF = 'rv_contrib_fields_off';

/** The sector slug of this page (a child of the Robots by Sector page), or ''. Plugins may name other pages with the filter. */
function rv_contrib_fields_page_slug() {
	$slug = '';
	if ( is_page() ) {
		$page = get_queried_object();
		if ( $page instanceof WP_Post && $page->post_parent ) {
			$parent      = get_post( $page->post_parent );
			$parent_slug = defined( 'RV_CONTRIBUTION_SECTOR_PARENT' ) ? sanitize_title( (string) RV_CONTRIBUTION_SECTOR_PARENT ) : 'robots-by-sector';
			if ( $parent instanceof WP_Post && $parent->post_name === $parent_slug ) {
				$slug = sanitize_title( $page->post_name );
			}
		}
	}
	return sanitize_title( (string) apply_filters( 'rv_contrib_sector_slug', $slug ) );
}

/** The fields an administrator turned the button off for: "<field id>" or "<sector>/<field id>", cleaned. */
function rv_contrib_fields_off() {
	$raw = get_option( RV_CONTRIB_FIELDS_OFF, array() );
	return rv_contrib_sanitize_fields_off( is_array( $raw ) ? $raw : explode( "\n", (string) $raw ) );
}
function rv_contrib_sanitize_fields_off( $v ) {
	$lines = is_array( $v ) ? $v : preg_split( '/[\r\n,]+/', (string) $v );
	$out   = array();
	foreach ( $lines as $line ) {
		$parts = array_map( 'sanitize_title', explode( '/', trim( (string) $line ), 2 ) );
		$id    = implode( '/', array_filter( $parts, 'strlen' ) );
		if ( '' !== $id ) {
			$out[] = $id;
		}
	}
	return array_values( array_unique( array_slice( $out, 0, 500 ) ) );
}

/** The contribute flow that is live: "Share Your Idea" once switched over, otherwise the current form's page. */
function rv_contrib_fields_form_url() {
	$new = rv_contrib_switched() ? rv_contrib_form_url() : '';
	if ( '' !== $new ) {
		return $new;
	}
	$slugs = rv_contrib_old_slugs();
	return home_url( '/' . ( $slugs ? $slugs[0] : 'contribute-now' ) . '/' );
}

/** What the script needs (printed before it). */
function rv_contrib_fields_config() {
	$selectors = apply_filters( 'rv_contrib_field_selectors', array() );
	return array(
		'sector'     => rv_contrib_fields_page_slug(),
		'sectorName' => wp_strip_all_tags( (string) get_the_title( get_queried_object_id() ) ),
		'form'       => esc_url_raw( rv_contrib_fields_form_url() ),
		'off'        => rv_contrib_fields_off(),
		'selectors'  => array_values( array_filter( array_map( 'strval', is_array( $selectors ) ? $selectors : array() ) ) ),
	);
}

/* 2. The content area, marked late so other plugins' content filters (and builders such as Elementor) have run first. */
add_filter(
	'the_content',
	function ( $content ) {
		if ( ! in_the_loop() || ! is_main_query() || '' === rv_contrib_fields_page_slug() || false !== strpos( (string) $content, 'rv-fields-root' ) ) {
			return $content;
		}
		return '<div class="rv-fields-root" data-rv-sector="' . esc_attr( rv_contrib_fields_page_slug() ) . '">' . $content . '</div>';
	},
	PHP_INT_MAX - 10
);

/* 3. The script and the stylesheet, on sector pages only, with the plugin's version (a cache purge serves the new files). */
add_action(
	'wp_enqueue_scripts',
	function () {
		if ( '' === rv_contrib_fields_page_slug() ) {
			return;
		}
		wp_enqueue_style( 'rv-sector', plugins_url( 'assets/css/rv-sector.css', __FILE__ ), array(), RV_CONTRIB_VERSION );
		wp_enqueue_script( 'rv-sector', plugins_url( 'assets/js/rv-sector.js', __FILE__ ), array(), RV_CONTRIB_VERSION, true );
		wp_add_inline_script( 'rv-sector', 'window.rvContribFields = ' . wp_json_encode( rv_contrib_fields_config() ) . ';', 'before' );
	},
	PHP_INT_MAX - 10
);

/* If another plugin dequeued them, print them anyway (the buttons must not depend on other plugins' asset settings). */
add_action(
	'wp_print_footer_scripts',
	function () {
		if ( '' === rv_contrib_fields_page_slug() || wp_script_is( 'rv-sector', 'done' ) ) {
			return;
		}
		echo '<link rel="stylesheet" id="rv-sector-fallback-css" href="' . esc_url( add_query_arg( 'ver', RV_CONTRIB_VERSION, plugins_url( 'assets/css/rv-sector.css', __FILE__ ) ) ) . '">' . "\n";
		echo '<script id="rv-sector-fallback-config">window.rvContribFields = ' . wp_json_encode( rv_contrib_fields_config() ) . ';</script>' . "\n";
		echo '<script id="rv-sector-fallback-js" src="' . esc_url( add_query_arg( 'ver', RV_CONTRIB_VERSION, plugins_url( 'assets/js/rv-sector.js', __FILE__ ) ) ) . '"></script>' . "\n";
	},
	PHP_INT_MAX
);

/* The per-field setting (administrators only), shown on the plugin's settings page. */
add_action(
	'admin_init',
	function () {
		register_setting(
			'rv_contrib',
			RV_CONTRIB_FIELDS_OFF,
			array(
				'type'              => 'array',
				'default'           => array(),
				'sanitize_callback' => 'rv_contrib_sanitize_fields_off',
			)
		);
	}
);

/** The settings rows for the plugin's settings page. */
function rv_contrib_fields_settings_html() {
	$off = implode( "\n", rv_contrib_fields_off() );
	return '<h2>' . esc_html__( '"Contribute to this sector" buttons', 'robovalley-contribution' ) . '</h2>'
		. '<p>' . esc_html__( 'Every Robots by Sector page shows "+ Contribute to this sector" next to its title, and every field (section) of the page shows a sticky "Contribute to this sector" button, also fields added later. Both are on by default. To turn the button off for one field, list the field here: one per line, as <field id> (every sector) or <sector>/<field id>. The field id is shown in the page as data-rv-field-id.', 'robovalley-contribution' ) . '</p>'
		. '<p><label for="rv-contrib-fields-off"><strong>' . esc_html__( 'Fields without the button', 'robovalley-contribution' ) . '</strong></label><br>'
		. '<textarea id="rv-contrib-fields-off" name="' . esc_attr( RV_CONTRIB_FIELDS_OFF ) . '" rows="5" cols="60">' . esc_textarea( $off ) . '</textarea></p>';
}
